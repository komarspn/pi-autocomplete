import { proseRuns } from "./prose-gate.ts";
import { SENTENCE_START, type WebPrior } from "./web-prior.ts";
import type { WordPredictionBackend } from "./word-completion-provider.ts";

/** Counts of the words seen after one context, keyed by word id. */
interface Continuations {
	total: number;
	counts: Map<number, number>;
}

/** The web pair rows of one context word: `[start, end)` in the row arrays, sorted by word. */
interface WebContinuations {
	start: number;
	end: number;
	/** The sum of the web shares of the rows, at most 1. */
	covered: number;
}

/** A word and how often it was seen. */
export type WordCount = [word: string, count: number];

/** Plain-data copy of everything an NgramBackend has learned, for saving to disk. */
export interface NgramSnapshot {
	unigrams: WordCount[];
	/** Words seen after each one-word context. */
	bigrams: [context: string, counts: WordCount[]][];
	/** Words seen after each two-word context, keyed as `previous\0current`. */
	trigrams: [context: string, counts: WordCount[]][];
}

const LEADING_APOSTROPHES = /^'+/;
// Absolute discount taken from each seen count and spread over the lower order.
const DISCOUNT = 0.75;
// Least posterior a completion needs to be shown. Same as omp's n-gram default.
const SHOW_THRESHOLD = 0.15;
// Marks the start of a run of words. No word is empty, so it cannot collide.
const START = "";
// Id of START in the context tables. Word ids start at 0.
const START_ID = -1;
// Trigram contexts pack two ids into one number. Both stay below 2^26, so the key stays a safe integer.
const ID_LIMIT = 2 ** 26;
// Weight of the web prior at the unigram level, in learned words. Same as omp's mu1.
const PRIOR_WEIGHT = 10_000;
// Weight of the web pairs above the unigram level. Same as omp's web_bigram.
const WEB_PAIR_WEIGHT = 1;
// Times a word outside the prior and the dictionary must be learned before it is suggested, so a
// one-off typo does not come back as a ghost. Same as omp's min_count.
const MIN_COUNT = 2;
// Prior words added between yields to the event loop, so adding the prior never holds up pi for long.
const SLICE_WORDS = 2_000;

/**
 * Word trigram completion learned from the prompts the user submits, with interpolated absolute
 * discounting. An optional web prior smooths the unigram level and adds web pairs under the learned
 * bigram level. State is in memory only.
 */
export class NgramBackend implements WordPredictionBackend {
	// A word's id is its index here. Ids never change, so the count tables never need renumbering.
	private readonly words: string[] = [];
	private readonly ids = new Map<string, number>();
	/** Unigram counts, indexed by word id. */
	private readonly unigrams: number[] = [];
	private total = 0;
	/** Each word's share of the web prior, indexed by word id. Zero for words the prior lacks. */
	private readonly priors: number[] = [];
	// Zero until a prior is in use, so the unigram level is the plain learned share.
	private priorWeight = 0;
	private hasPrior = false;
	/** The web pair rows of each context word id, START_ID for the sentence start. Empty until a prior is in use. */
	private webPairs = new Map<number, WebContinuations>();
	/** Word id of each web pair row. */
	private webWords = new Int32Array(0);
	/** Web share of each row: how often the word follows its context, out of all the context's occurrences. */
	private webShares = new Float32Array(0);
	/** Real spellings, which may be suggested after one use. Empty until a dictionary is in use. */
	private dictionary: ReadonlySet<string> = new Set();
	private readonly bigrams = new Map<number, Continuations>();
	private readonly trigrams = new Map<number, Continuations>();
	// Every word id, sorted by word, so the words under a prefix are one contiguous range.
	private order: number[] = [];

	/** Learns the prose words of a submitted prompt. Slash commands and code are skipped by the prose gates. */
	observe(text: string): void {
		for (const run of proseRuns(text)) {
			let previous = START_ID;
			let current = START_ID;
			for (const word of run) {
				const id = this.count(word);
				countContinuation(this.bigrams, current, id);
				if (current !== START_ID) countContinuation(this.trigrams, trigramKey(previous, current), id);
				previous = current;
				current = id;
			}
		}
	}

	/**
	 * The likeliest word under the prefix, if its posterior among all words under the prefix reaches
	 * the show threshold. The prefix itself is one of those words, so a finished word is not extended.
	 */
	async complete(before: string, prefix: string): Promise<string | null> {
		// Learned words have no edge apostrophes; the suffix still goes after the whole prefix.
		const lower = prefix.replace(LEADING_APOSTROPHES, "").toLowerCase();
		if (!lower) return null;
		const [previous, current] = contextOf(before).map((word) => this.idOf(word));
		const afterCurrent = current === undefined ? undefined : this.bigrams.get(current);
		const afterBoth =
			previous === undefined || current === undefined ? undefined : this.trigrams.get(trigramKey(previous, current));
		const { words, unigrams, priors, priorWeight, order, webWords, webShares } = this;
		const web = current === undefined ? undefined : this.webPairs.get(current);
		// Rows and candidates are both sorted by word, so one pass over each matches them up.
		let row = web ? this.firstRow(web, lower) : 0;
		let best: string | undefined;
		let bestScore = 0;
		let sum = 0;
		for (let i = this.lowerBound(lower); i < order.length; i++) {
			const id = order[i];
			const word = id === undefined ? undefined : words[id];
			if (id === undefined || word === undefined || !word.startsWith(lower)) break;
			// P(word | previous current), each order interpolated with the one below. The unigram level is
			// the learned count with a Dirichlet prior: (c(w) + mu * p0(w)) / (N + mu).
			let lowerOrder = ((unigrams[id] ?? 0) + priorWeight * (priors[id] ?? 0)) / (this.total + priorWeight);
			if (web) {
				// The web pairs sit between the unigram and learned bigram levels: λ * pw(w | v) + (1 - λ * S(v)) * p1(w),
				// where S(v) is the share of v's occurrences that the rows cover.
				while (row < web.end && (words[webWords[row] ?? -1] ?? "") < word) row++;
				const share = row < web.end && webWords[row] === id ? (webShares[row] ?? 0) : 0;
				lowerOrder = WEB_PAIR_WEIGHT * share + (1 - WEB_PAIR_WEIGHT * web.covered) * lowerOrder;
			}
			const score = discounted(afterBoth, id, discounted(afterCurrent, id, lowerOrder));
			// A hidden word still takes its share of the posterior, as in omp, so it can keep a weak ghost back.
			sum += score;
			if (score > bestScore && this.isSuggestible(id, word)) {
				best = word;
				bestScore = score;
			}
		}
		if (best === undefined || best === lower || bestScore < SHOW_THRESHOLD * sum) return null;
		return best.slice(lower.length);
	}

	feedback(_before: string, _prefix: string, _suggestion: string, _accepted: boolean): void {}

	/** Everything learned so far, as plain data. */
	snapshot(): NgramSnapshot {
		const unigrams: WordCount[] = [];
		// Words known only as context, from an inconsistent snapshot, have no count to save.
		this.unigrams.forEach((count, id) => {
			if (count > 0) unigrams.push([this.wordOf(id), count]);
		});
		return {
			unigrams,
			bigrams: this.tableSnapshot(this.bigrams, (id) => this.wordOf(id)),
			trigrams: this.tableSnapshot(this.trigrams, (key) => {
				const current = key % ID_LIMIT;
				return `${this.wordOf((key - current) / ID_LIMIT - 1)}\0${this.wordOf(current)}`;
			}),
		};
	}

	/** Adds the counts of a snapshot to what this backend has learned. */
	restore(snapshot: NgramSnapshot): void {
		const intern = (word: string): number => (word === START ? START_ID : this.intern(word));
		for (const [word, count] of snapshot.unigrams) {
			const id = this.intern(word);
			this.unigrams[id] = (this.unigrams[id] ?? 0) + count;
			this.total += count;
		}
		for (const [context, counts] of snapshot.bigrams) {
			const contextId = intern(context);
			for (const [word, count] of counts) countContinuation(this.bigrams, contextId, this.intern(word), count);
		}
		for (const [context, counts] of snapshot.trigrams) {
			const split = context.indexOf("\0");
			const key = trigramKey(intern(context.slice(0, split)), intern(context.slice(split + 1)));
			for (const [word, count] of counts) countContinuation(this.trigrams, key, this.intern(word), count);
		}
		this.sortOrder();
	}

	/**
	 * Uses a web prior, laid out as loadWebPrior gives it. Its word counts become a Dirichlet prior on
	 * the unigram level, and its pairs a level between that and the learned bigrams. Its words join the
	 * vocabulary with no learned count, so the snapshot never holds them. Adds the prior in slices that
	 * yield to the event loop; until it resolves, completion uses learned words alone, and `observe` and
	 * `restore` stay safe to call. Call it at most once. Rejects for a second call, unsorted words, or
	 * pairs that are unsorted or name a word the prior lacks, before changing anything.
	 */
	async usePrior(prior: WebPrior): Promise<void> {
		if (this.hasPrior) throw new Error("A web prior is already in use");
		// Set before the first yield, so a second call made meanwhile rejects.
		this.hasPrior = true;
		let total: number;
		try {
			total = await checkedTotal(prior);
		} catch (error) {
			this.hasPrior = false;
			throw error;
		}
		if (total === 0) return;
		// Ids interned here stay out of `order`, so `complete` skips them until the merge below.
		const added: number[] = [];
		// The id of each prior word, by its index in `prior.words`.
		const idOf = new Int32Array(prior.words.length);
		for (let i = 0; i < prior.words.length; i++) {
			if (i % SLICE_WORDS === SLICE_WORDS - 1) await yieldToEventLoop();
			const [word, count] = prior.words[i] ?? ["", 0];
			const known = this.ids.get(word);
			const id = known ?? this.intern(word);
			if (known === undefined) added.push(id);
			idOf[i] = id;
			this.priors[id] = count / total;
		}
		// Built aside and swapped in with the merge, so `complete` never sees part of the pairs.
		const { contexts, starts, words: rowWords, counts } = prior.pairs;
		const webPairs = new Map<number, WebContinuations>();
		const webWords = new Int32Array(rowWords.length);
		const webShares = new Float32Array(rowWords.length);
		for (let group = 0; group < contexts.length; group++) {
			if (group % SLICE_WORDS === SLICE_WORDS - 1) await yieldToEventLoop();
			const context = contexts[group] ?? SENTENCE_START;
			const start = starts[group] ?? 0;
			const end = starts[group + 1] ?? 0;
			// pw(w | v) = c(v w) / c(v). The sentence start occurs once per sentence.
			const occurrences = context === SENTENCE_START ? prior.sentences : (prior.words[context]?.[1] ?? 0);
			let covered = 0;
			for (let row = start; row < end; row++) {
				webWords[row] = idOf[rowWords[row] ?? -1] ?? -1;
				const share = (counts[row] ?? 0) / occurrences;
				webShares[row] = share;
				covered += share;
			}
			// The build script prunes counts per source file, so the shares can add up to a little over 1.
			webPairs.set(context === SENTENCE_START ? START_ID : (idOf[context] ?? -1), {
				start,
				end,
				covered: Math.min(covered, 1),
			});
		}
		// A restore meanwhile sorted some added ids into `order`. Take them out so the merge adds each once.
		const isAdded = new Uint8Array(this.words.length);
		for (const id of added) isAdded[id] = 1;
		this.order = this.mergeByWord(
			this.order.filter((id) => isAdded[id] === 0),
			added,
		);
		this.priorWeight = PRIOR_WEIGHT;
		this.webPairs = webPairs;
		this.webWords = webWords;
		this.webShares = webShares;
	}

	/**
	 * Uses a dictionary of real spellings, lowercase, as loadDictionary gives it. A learned word in it is
	 * suggested after one use; other words outside the prior need MIN_COUNT. It adds no word to the vocabulary.
	 */
	useDictionary(words: ReadonlySet<string>): void {
		this.dictionary = words;
	}

	/** Whether `word` may be suggested: a prior or dictionary word, or one learned at least MIN_COUNT times. */
	private isSuggestible(id: number, word: string): boolean {
		return (this.priors[id] ?? 0) > 0 || (this.unigrams[id] ?? 0) >= MIN_COUNT || this.dictionary.has(word);
	}

	/** Rebuilds `order` after words were interned in bulk: one sort instead of a splice per new word. */
	private sortOrder(): void {
		this.order = [...this.ids].sort(([a], [b]) => compare(a, b)).map(([, id]) => id);
	}

	/** Counts one occurrence of `word` and returns its id, keeping `order` sorted when the word is new. */
	private count(word: string): number {
		const known = this.ids.get(word);
		const id = known ?? this.intern(word);
		this.unigrams[id] = (this.unigrams[id] ?? 0) + 1;
		this.total++;
		if (known === undefined) this.order.splice(this.lowerBound(word), 0, id);
		return id;
	}

	/** The id of `word`, adding it with a zero count when new. Does not touch `order`. */
	private intern(word: string): number {
		let id = this.ids.get(word);
		if (id === undefined) {
			id = this.words.length;
			if (id >= ID_LIMIT) throw new Error(`Vocabulary is full at ${ID_LIMIT} words`);
			this.words.push(word);
			this.unigrams.push(0);
			this.priors.push(0);
			this.ids.set(word, id);
		}
		return id;
	}

	/** The id of a context word: START_ID for START, undefined for a word never learned. */
	private idOf(word: string): number | undefined {
		return word === START ? START_ID : this.ids.get(word);
	}

	/** The word with `id`, or START for START_ID. */
	private wordOf(id: number): string {
		if (id === START_ID) return START;
		const word = this.words[id];
		if (word === undefined) throw new Error(`No word has id ${id}`);
		return word;
	}

	/** One list of the ids in `a` and `b`, which are each sorted by word. */
	private mergeByWord(a: readonly number[], b: readonly number[]): number[] {
		const { words } = this;
		const merged: number[] = [];
		let i = 0;
		let j = 0;
		for (;;) {
			const left = a[i];
			const right = b[j];
			if (left === undefined || right === undefined) break;
			if ((words[left] ?? "") < (words[right] ?? "")) {
				merged.push(left);
				i++;
			} else {
				merged.push(right);
				j++;
			}
		}
		return merged.concat(a.slice(i), b.slice(j));
	}

	/** Index of the first row of `web` whose word is not less than `value`. */
	private firstRow(web: WebContinuations, value: string): number {
		return firstNotLess(this.words, this.webWords, web.start, web.end, value);
	}

	/** Index in `order` of the first word not less than `value`. */
	private lowerBound(value: string): number {
		return firstNotLess(this.words, this.order, 0, this.order.length, value);
	}

	private tableSnapshot(table: Map<number, Continuations>, contextOf: (key: number) => string): [string, WordCount[]][] {
		return [...table].map(([key, { counts }]) => [
			contextOf(key),
			[...counts].map(([id, count]): WordCount => [this.wordOf(id), count]),
		]);
	}
}

function countContinuation(table: Map<number, Continuations>, context: number, id: number, times = 1): void {
	let continuations = table.get(context);
	if (!continuations) {
		continuations = { total: 0, counts: new Map() };
		table.set(context, continuations);
	}
	continuations.total += times;
	continuations.counts.set(id, (continuations.counts.get(id) ?? 0) + times);
}

/** Discounted share of word `id` after a context, plus the discounted mass spread by `lower`. */
function discounted(continuations: Continuations | undefined, id: number, lower: number): number {
	if (!continuations) return lower;
	const { total, counts } = continuations;
	const seen = Math.max((counts.get(id) ?? 0) - DISCOUNT, 0);
	return (seen + DISCOUNT * counts.size * lower) / total;
}

/**
 * The sum of the web word counts, after checking the order usePrior relies on: words sorted and each
 * once, pairs sorted by context then word, and every pair word a prior word. Throws before the caller
 * changes anything. Yields between slices.
 */
async function checkedTotal(prior: WebPrior): Promise<number> {
	let total = 0;
	let previous = "";
	for (let i = 0; i < prior.words.length; i++) {
		if (i % SLICE_WORDS === SLICE_WORDS - 1) await yieldToEventLoop();
		const [word, count] = prior.words[i] ?? ["", 0];
		if (word <= previous) throw new Error(`The web prior is not sorted at "${word}"`);
		total += count;
		previous = word;
	}
	const { contexts, starts, words: rowWords, counts } = prior.pairs;
	if (starts.length !== contexts.length + 1 || starts[0] !== 0 || starts.at(-1) !== rowWords.length) {
		throw new Error("The web prior pairs do not split into groups");
	}
	if (counts.length !== rowWords.length) throw new Error("The web prior pairs hold a count for each word");
	const wordAt = (index: number) => prior.words[index]?.[0];
	for (let group = 0; group < contexts.length; group++) {
		if (group % SLICE_WORDS === SLICE_WORDS - 1) await yieldToEventLoop();
		const context = contexts[group] ?? SENTENCE_START;
		const name = context === SENTENCE_START ? "the sentence start" : `"${wordAt(context)}"`;
		if (group > 0 && context <= (contexts[group - 1] ?? SENTENCE_START)) {
			throw new Error(`The web prior pairs are not sorted at context ${name}`);
		}
		if (context === SENTENCE_START ? prior.sentences <= 0 : wordAt(context) === undefined) {
			throw new Error(`The web prior pairs name a context the prior lacks: ${context}`);
		}
		const start = starts[group] ?? 0;
		const end = starts[group + 1] ?? 0;
		if (end <= start) throw new Error(`The web prior pairs hold no word after context ${name}`);
		for (let row = start; row < end; row++) {
			const word = rowWords[row] ?? -1;
			if (wordAt(word) === undefined) throw new Error(`The web prior pairs name a word the prior lacks: ${word}`);
			if (row > start && word <= (rowWords[row - 1] ?? -1)) {
				throw new Error(`The web prior pairs are not sorted at ${name} "${wordAt(word)}"`);
			}
		}
	}
	return total;
}

/** Index in `ids[low..high)`, sorted by word, of the first id whose word is not less than `value`. */
function firstNotLess(words: readonly string[], ids: ArrayLike<number>, low: number, high: number, value: string): number {
	while (low < high) {
		const mid = (low + high) >>> 1;
		const word = words[ids[mid] ?? -1];
		if (word !== undefined && word < value) low = mid + 1;
		else high = mid;
	}
	return low;
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function trigramKey(previous: number, current: number): number {
	return (previous + 1) * ID_LIMIT + current;
}

/** Orders words the way `<` does, by UTF-16 code units, which is the order `lowerBound` searches. */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The last two words of the run the cursor continues, padded with START. */
function contextOf(before: string): [string, string] {
	// A run never crosses a newline, so the last line holds all of it.
	const run = proseRuns(before.slice(before.lastIndexOf("\n") + 1)).at(-1) ?? [];
	const words = [START, START, ...run.slice(-2)];
	return [words.at(-2) ?? START, words.at(-1) ?? START];
}
