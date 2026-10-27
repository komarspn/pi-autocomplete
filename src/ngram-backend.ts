import { proseRuns } from "./prose-gate.ts";
import type { WordPredictionBackend } from "./word-completion-provider.ts";

/** Counts of the words seen after one context. */
interface Continuations {
	total: number;
	counts: Map<string, number>;
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

/**
 * Word trigram completion learned from the prompts the user submits, with interpolated absolute
 * discounting. State is in memory only.
 */
export class NgramBackend implements WordPredictionBackend {
	private readonly unigrams = new Map<string, number>();
	private total = 0;
	private readonly bigrams = new Map<string, Continuations>();
	private readonly trigrams = new Map<string, Continuations>();
	// Every learned word, sorted, so the words under a prefix are one contiguous range.
	private vocabulary: string[] = [];

	/** Learns the prose words of a submitted prompt. Slash commands and code are skipped by the prose gates. */
	observe(text: string): void {
		for (const run of proseRuns(text)) {
			let previous = START;
			let current = START;
			for (const word of run) {
				this.count(word);
				countContinuation(this.bigrams, current, word);
				if (current !== START) countContinuation(this.trigrams, trigramKey(previous, current), word);
				previous = current;
				current = word;
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
		const [previous, current] = contextOf(before);
		const afterCurrent = this.bigrams.get(current);
		const afterBoth = this.trigrams.get(trigramKey(previous, current));
		const vocabulary = this.vocabulary;
		let best: string | undefined;
		let bestScore = 0;
		let sum = 0;
		for (let i = lowerBound(vocabulary, lower); i < vocabulary.length; i++) {
			const word = vocabulary[i];
			if (word === undefined || !word.startsWith(lower)) break;
			// P(word | previous current), each order interpolated with the one below.
			const unigram = (this.unigrams.get(word) ?? 0) / this.total;
			const score = discounted(afterBoth, word, discounted(afterCurrent, word, unigram));
			sum += score;
			if (score > bestScore) {
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
		return {
			unigrams: [...this.unigrams],
			bigrams: tableSnapshot(this.bigrams),
			trigrams: tableSnapshot(this.trigrams),
		};
	}

	/** Adds the counts of a snapshot to what this backend has learned. */
	restore(snapshot: NgramSnapshot): void {
		for (const [word, count] of snapshot.unigrams) {
			this.unigrams.set(word, (this.unigrams.get(word) ?? 0) + count);
			this.total += count;
		}
		// One sort instead of a splice per new word.
		this.vocabulary = [...this.unigrams.keys()].sort();
		for (const [context, counts] of snapshot.bigrams) {
			for (const [word, count] of counts) countContinuation(this.bigrams, context, word, count);
		}
		for (const [context, counts] of snapshot.trigrams) {
			for (const [word, count] of counts) countContinuation(this.trigrams, context, word, count);
		}
	}

	private count(word: string): void {
		const seen = this.unigrams.get(word);
		this.unigrams.set(word, (seen ?? 0) + 1);
		this.total++;
		if (seen === undefined) this.vocabulary.splice(lowerBound(this.vocabulary, word), 0, word);
	}
}

function countContinuation(table: Map<string, Continuations>, context: string, word: string, times = 1): void {
	let continuations = table.get(context);
	if (!continuations) {
		continuations = { total: 0, counts: new Map() };
		table.set(context, continuations);
	}
	continuations.total += times;
	continuations.counts.set(word, (continuations.counts.get(word) ?? 0) + times);
}

function tableSnapshot(table: Map<string, Continuations>): [string, WordCount[]][] {
	return [...table].map(([context, { counts }]) => [context, [...counts]]);
}

/** Discounted share of `word` after a context, plus the discounted mass spread by `lower`. */
function discounted(continuations: Continuations | undefined, word: string, lower: number): number {
	if (!continuations) return lower;
	const { total, counts } = continuations;
	const seen = Math.max((counts.get(word) ?? 0) - DISCOUNT, 0);
	return (seen + DISCOUNT * counts.size * lower) / total;
}

function trigramKey(previous: string, current: string): string {
	return `${previous}\0${current}`;
}

/** The last two words of the run the cursor continues, padded with START. */
function contextOf(before: string): [string, string] {
	// A run never crosses a newline, so the last line holds all of it.
	const run = proseRuns(before.slice(before.lastIndexOf("\n") + 1)).at(-1) ?? [];
	const words = [START, START, ...run.slice(-2)];
	return [words.at(-2) ?? START, words.at(-1) ?? START];
}

/** Index of the first item not less than `value`. */
function lowerBound(sorted: readonly string[], value: string): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const item = sorted[mid];
		if (item !== undefined && item < value) low = mid + 1;
		else high = mid;
	}
	return low;
}
