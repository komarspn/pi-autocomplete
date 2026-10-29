import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { WordCount } from "./ngram-backend.ts";

/** Web word and two-word counts, as scripts/build-web-prior.ts writes them. */
export interface WebPrior {
	/** Word counts, sorted by word in UTF-16 order, each word once. */
	words: readonly WordCount[];
	/** Sentences in the source, which is how often the sentence-start context occurs. */
	sentences: number;
	pairs: WebPairs;
}

/** The context index of the sentence start in WebPairs. */
export const SENTENCE_START = -1;

/**
 * Counts of the words seen after each context word, in groups, one per context. Words are indexes into
 * WebPrior.words, so their order is the order of the words. Typed arrays rather than tuples: the shipped
 * prior has 500,000 pairs, and resolving their strings to words takes the loader alone.
 */
export interface WebPairs {
	/** The context of each group: a word index, or SENTENCE_START. Increasing. */
	contexts: Int32Array;
	/** The rows of group `g` run from `starts[g]` up to `starts[g + 1]`. One more entry than `contexts`. */
	starts: Int32Array;
	/** The word index of each row. Increasing within a group. */
	words: Int32Array;
	/** The count of each row. */
	counts: Float64Array;
}

/** WebPairs with no groups. */
export function noPairs(): WebPairs {
	return { contexts: new Int32Array(0), starts: new Int32Array(1), words: new Int32Array(0), counts: new Float64Array(0) };
}

/** The prior that ships with the package, built by scripts/build-web-prior.ts. */
export const WEB_PRIOR_PATH = fileURLToPath(new URL("../data/web-prior.tsv.gz", import.meta.url));

const unzip = promisify(gunzip);
// Lines parsed between yields to the event loop, so loading never holds up pi for long.
const SLICE_LINES = 2_000;
// Bytes decoded to a string at once. Decoding all 12 MB of the shipped prior holds the event loop for about 10 ms.
const CHUNK_BYTES = 256 * 1024;

/**
 * Reads a gzipped prior file: `word\tcount` lines sorted by word, then a `\tsentences` line, then
 * `context\tword\tcount` lines sorted by context and word. Resolves to undefined when the file is
 * missing or corrupt, so completion goes on with learned words alone. Never rejects. Decompression runs
 * off the main thread, and parsing yields between slices of lines.
 */
export async function loadWebPrior(path: string = WEB_PRIOR_PATH): Promise<WebPrior | undefined> {
	let data: Buffer;
	try {
		data = await unzip(await readFile(path));
	} catch {
		// Missing or not gzip: the prior is optional.
		return undefined;
	}
	const words: WordCount[] = [];
	let sentences = 0;
	// Each word's index, to resolve the pair strings. Filled with the words, so it is built in slices too.
	const indexOf = new Map<string, number>();
	let isInPairs = false;
	const contexts: number[] = [];
	const starts: number[] = [];
	const rowWords: number[] = [];
	const rowCounts: number[] = [];
	let lastContext: string | undefined;
	let previous = "";
	let lines = 0;
	for (let chunkStart = 0; chunkStart < data.length; ) {
		// Cut after a newline, so no line spans two chunks and no character is split.
		const cut = data.indexOf(10, Math.min(chunkStart + CHUNK_BYTES, data.length));
		const chunkEnd = cut === -1 ? data.length : cut + 1;
		const text = data.toString("utf8", chunkStart, chunkEnd);
		chunkStart = chunkEnd;
		// Fields are read in place rather than from a slice or split of each line, which doubles the
		// parse time and the garbage the collector pauses for.
		for (let start = 0; start < text.length; ) {
			if (++lines % SLICE_LINES === 0) await new Promise((resolve) => setImmediate(resolve));
			const newline = text.indexOf("\n", start);
			const end = newline === -1 ? text.length : newline;
			const lineStart = start;
			start = end + 1;
			if (end === lineStart) continue;
			const tab = text.indexOf("\t", lineStart);
			if (tab === -1 || tab >= end) return undefined;
			const lastTab = text.lastIndexOf("\t", end - 1);
			const count = countAt(text, lastTab + 1, end);
			if (count === undefined) return undefined;
			const first = text.slice(lineStart, tab);
			if (tab === lastTab && !isInPairs) {
				if (!first) {
					sentences = count;
					isInPairs = true;
					continue;
				}
				// Strictly increasing words also rule out duplicates, which would count a word twice.
				if (first <= previous) return undefined;
				indexOf.set(first, words.length);
				words.push([first, count]);
				previous = first;
				continue;
			}
			const word = isInPairs ? indexOf.get(text.slice(tab + 1, lastTab)) : undefined;
			if (word === undefined) return undefined;
			if (first !== lastContext) {
				const context = first ? indexOf.get(first) : SENTENCE_START;
				// The sentence start comes first, so a context that does not follow the last one is out of order.
				if (context === undefined || context <= (contexts.at(-1) ?? SENTENCE_START - 1)) return undefined;
				contexts.push(context);
				starts.push(rowWords.length);
				lastContext = first;
			} else if (word <= (rowWords.at(-1) ?? -1)) {
				return undefined;
			}
			rowWords.push(word);
			rowCounts.push(count);
		}
	}
	starts.push(rowWords.length);
	const pairs: WebPairs = {
		contexts: Int32Array.from(contexts),
		starts: Int32Array.from(starts),
		words: Int32Array.from(rowWords),
		counts: Float64Array.from(rowCounts),
	};
	return words.length > 0 ? { words, sentences, pairs } : undefined;
}

/** The positive count written in `text` from `start` up to `end`, or undefined when it is not one. */
function countAt(text: string, start: number, end: number): number | undefined {
	if (start >= end) return undefined;
	let count = 0;
	for (let i = start; i < end; i++) {
		const digit = text.charCodeAt(i) - 48;
		if (digit < 0 || digit > 9) return undefined;
		count = count * 10 + digit;
	}
	return count > 0 && Number.isSafeInteger(count) ? count : undefined;
}
