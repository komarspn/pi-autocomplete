// Builds data/web-prior.tsv.gz, the web unigram and bigram prior the n-gram engine ships with.
//
// Run: node scripts/build-web-prior.ts [--words 150000] [--pairs 500000] [--files N] [--jobs 3]
//                                      [--unigrams data/web-prior.tsv.gz] [--out data/web-prior.tsv.gz]
//
//   --words     How many words to keep, the most frequent first. Default 150,000.
//   --pairs     How many two-word pairs to keep, the most frequent first. Default 500,000.
//   --files     Read only the first N files of each source, to try the script quickly. Default all.
//               The first 2-gram files hold punctuation and numbers, so a small N keeps few pairs.
//   --jobs      Source files read at once, one worker thread each. Default 3.
//   --unigrams  Take the word counts from this prior file instead of reading the 1-grams again. The
//               2-gram pass alone takes about 95 minutes; this keeps the words of an earlier build.
//   --out       Output path. Default data/web-prior.tsv.gz.
//
// Source: Google Books Ngram, English 1-grams and 2-grams, version 20200217, CC BY 3.0 (see NOTICE and
// ticket 01 in .scratch/ngram-web-prior). The 24 1-gram files total about 14 GB gzipped and the 589
// 2-gram files about 324 GB. Each one streams from storage.googleapis.com through gunzip into a
// counter, so nothing large is written to disk. With --jobs 4 the 1-grams take about 10 minutes and the
// 2-grams about 95. The merged pairs reach 25 million. The same source and arguments give the same
// output.
//
// For each 1-gram line the script:
// - skips tokens with `_`. They are part-of-speech tagged copies such as `run_VERB`, which the plain
//   token's line already counts, or tag-only tokens such as `_START_`.
// - lowercases the token and keeps it only if it is a word as the engine reads one: letters and marks,
//   with apostrophes only between them (`don't`, not `'tis`). Books splits most contractions, as in
//   `do n't`, so `n't` is dropped too: nobody types it as a word.
// - sums `match_count` over all years.
// Each worker drops lowercased words seen fewer than PRUNE_BELOW times in its file, which keeps the
// maps it posts small. Case variants of one word can sit in different files, so this approximates
// the merge: a kept word loses under PRUNE_BELOW for each file where its variants fell below the cut.
// The 150,000th word has about 95,600, so the loss is a fraction of a percent and can only move
// words near the cut.
//
// For each 2-gram line the script skips pairs with a tagged or tag-only token, except `_START_` on the
// left, which marks the start of a sentence. It lowercases both tokens and keeps the pair when both are
// kept words, or the left one is `_START_`. Every untagged `_START_ x` line also adds to the number of
// sentences, kept word or not, since that is the whole of the sentence-start context. Workers drop
// pairs seen fewer than PAIR_PRUNE_BELOW times in their file, for the same reason and with the same
// approximation as the words. The files are split by the first token, so a pair's case variants, as
// in `The cat` and `the cat`, can sit in different files.
//
// Output: gzip of three kinds of lines:
//   word\tcount           the kept words, sorted by word in UTF-16 order, the order the engine searches
//   \tsentences           the number of sentences: the empty word is the sentence start
//   context\tword\tcount  the kept pairs, sorted by context then word; an empty context is the sentence start
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { createGunzip, createGzip, constants, gunzipSync } from "node:zlib";

/** What a worker thread is asked to count. */
interface Job {
	url: string;
	/** The kept words, for a 2-gram file. Absent for a 1-gram file. */
	words?: string[];
}

/** What a worker posts back: the kept counts, and for 2-grams the sentences in its file. */
interface Counts {
	entries: [key: string | number, count: number][];
	sentences: number;
}

const SOURCE = "https://storage.googleapis.com/books/ngrams/books/20200217/eng";
const FILE_COUNT = 24;
const PAIR_FILE_COUNT = 589;
const PRUNE_BELOW = 100;
const PAIR_PRUNE_BELOW = 1_000;
const WORD = /^[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*$/u;
// Pieces of split contractions that pass WORD.
const NOT_WORDS = new Set(["n't"]);
const SENTENCE_START = "_START_";
// A pair key is context * PAIR_BASE + word, with word ids below PAIR_BASE and the sentence start at --words.
const PAIR_BASE = 2 ** 20;
// A Map holds at most 2^24 entries, and the merged pairs pass 16 million. Pair totals are split over this many Maps.
const PAIR_SHARDS = 64;
const ATTEMPTS = 3;

if (isMainThread) await main();
else await work();

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			words: { type: "string", default: "150000" },
			pairs: { type: "string", default: "500000" },
			files: { type: "string" },
			jobs: { type: "string", default: "3" },
			unigrams: { type: "string" },
			out: { type: "string", default: "data/web-prior.tsv.gz" },
		},
	});
	const keep = Number(values.words);
	const keepPairs = Number(values.pairs);
	const files = values.files === undefined ? undefined : Number(values.files);
	const jobs = Number(values.jobs);
	const out = resolve(values.out);
	if (keep >= PAIR_BASE) throw new Error(`--words must stay below ${PAIR_BASE}`);
	const started = Date.now();

	const top = values.unigrams
		? await readUnigrams(values.unigrams)
		: await countUnigrams(sourceUrls(1, Math.min(files ?? FILE_COUNT, FILE_COUNT)), jobs, keep, started);
	const words = top.map(([word]) => word);

	const shards = Array.from({ length: PAIR_SHARDS }, () => new Map<number, number>());
	let merged = 0;
	let sentences = 0;
	await runJobs(sourceUrls(2, Math.min(files ?? PAIR_FILE_COUNT, PAIR_FILE_COUNT)), jobs, started, { words }, (counts) => {
		for (const [key, count] of counts.entries) {
			if (typeof key !== "number") continue;
			const shard = shards[key % PAIR_SHARDS]!;
			const total = shard.get(key);
			if (total === undefined) merged++;
			shard.set(key, (total ?? 0) + count);
		}
		sentences += counts.sentences;
		return `${counts.entries.length} pairs, ${merged} merged`;
	});
	const pairs = topPairs(shards, merged, keepPairs);
	const cut = pairs.at(-1)?.[1] ?? 0;
	// Sorting by key sorts by context then word: ids are ranks in word order, and the sentence start sorts first.
	const rank = (id: number): number => (id === words.length ? -1 : id);
	pairs.sort(([a], [b]) => {
		const [contextA, wordA] = splitKey(a);
		const [contextB, wordB] = splitKey(b);
		return rank(contextA) - rank(contextB) || wordA - wordB;
	});

	await mkdir(dirname(out), { recursive: true });
	const lines = [
		...top.map(([word, count]) => `${word}\t${count}\n`),
		`\t${sentences}\n`,
		...pairs.map(([key, count]) => {
			const [context, word] = splitKey(key);
			return `${words[context] ?? ""}\t${words[word]}\t${count}\n`;
		}),
	];
	await pipeline(Readable.from([lines.join("")]), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(out));
	console.error(`wrote ${top.length} words, ${sentences} sentences and ${pairs.length} pairs (cut ${cut}) to ${out}`);
}

/**
 * The `keep` pairs with the highest totals. Ties go to the smaller key, the earlier context then word,
 * so the cut does not depend on the order files finished in. Finds the cut in a typed array first:
 * an array of all the merged pairs would not fit in the heap.
 */
function topPairs(shards: readonly Map<number, number>[], merged: number, keep: number): [number, number][] {
	const totals = new Float64Array(merged);
	let i = 0;
	for (const shard of shards) for (const total of shard.values()) totals[i++] = total;
	totals.sort();
	const cut = totals[Math.max(totals.length - keep, 0)] ?? 0;
	const kept: [number, number][] = [];
	for (const shard of shards) for (const [key, total] of shard) if (total >= cut) kept.push([key, total]);
	return kept.sort(([a, x], [b, y]) => y - x || a - b).slice(0, keep);
}

/** Counts the 1-gram files and returns the `keep` most frequent words, sorted by word. */
async function countUnigrams(urls: string[], jobs: number, keep: number, started: number): Promise<[string, number][]> {
	const totals = new Map<string, number>();
	await runJobs(urls, jobs, started, {}, (counts) => {
		for (const [word, count] of counts.entries) {
			if (typeof word === "string") totals.set(word, (totals.get(word) ?? 0) + count);
		}
		return `${counts.entries.length} words, ${totals.size} merged`;
	});
	// Ties go to the earlier word, so the cut does not depend on the order files finished in.
	const top = [...totals].sort(([a, x], [b, y]) => y - x || compare(a, b)).slice(0, keep);
	return top.sort(([a], [b]) => compare(a, b));
}

/** The word lines of an earlier prior file, which are already sorted by word. */
async function readUnigrams(path: string): Promise<[string, number][]> {
	const top: [string, number][] = [];
	for (const line of gunzipSync(await readFile(path)).toString("utf8").split("\n")) {
		const fields = line.split("\t");
		if (fields.length !== 2 || !fields[0]) continue;
		top.push([fields[0], Number(fields[1])]);
	}
	return top;
}

function sourceUrls(n: 1 | 2, files: number): string[] {
	const total = n === 1 ? FILE_COUNT : PAIR_FILE_COUNT;
	return Array.from({ length: files }, (_, i) => {
		const name = `${n}-${String(i).padStart(5, "0")}-of-${String(total).padStart(5, "0")}.gz`;
		return `${SOURCE}/${name}`;
	});
}

/** Counts `urls` in `jobs` worker threads at a time, passing each file's counts to `merge` as it finishes. */
async function runJobs(
	urls: string[],
	jobs: number,
	started: number,
	job: Omit<Job, "url">,
	merge: (counts: Counts) => string,
): Promise<void> {
	let next = 0;
	const runJob = async (): Promise<void> => {
		while (next < urls.length) {
			const url = urls[next++]!;
			const summary = merge(await countFile({ ...job, url }));
			const minutes = ((Date.now() - started) / 60_000).toFixed(1);
			console.error(`${url.slice(SOURCE.length + 1)}: ${summary}, ${minutes} min`);
		}
	};
	await Promise.all(Array.from({ length: jobs }, runJob));
}

/** Counts one source file in a worker thread, retrying the whole file when the download breaks. */
async function countFile(job: Job): Promise<Counts> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await new Promise((resolveCounts, reject) => {
				const worker = new Worker(new URL(import.meta.url), { workerData: job });
				worker.once("message", resolveCounts);
				worker.once("error", reject);
				worker.once("exit", (code) => reject(new Error(`worker for ${job.url} exited with ${code}`)));
			});
		} catch (error) {
			if (attempt >= ATTEMPTS) throw error;
			console.error(`${job.url}: ${error instanceof Error ? error.message : String(error)}, retrying`);
		}
	}
}

/** Worker: streams one gzipped n-gram file and posts its counts. */
async function work(): Promise<void> {
	const { url, words }: Job = workerData;
	const response = await new Promise<IncomingMessage>((resolveResponse, reject) => get(url, resolveResponse).on("error", reject));
	if (response.statusCode !== 200) throw new Error(`${url}: HTTP ${response.statusCode}`);
	const counter = words ? pairCounter(words) : wordCounter();
	let rest = "";
	const text = response.pipe(createGunzip());
	response.on("error", (error) => text.destroy(error));
	text.setEncoding("utf8");
	for await (const chunk of text) {
		const lines = (rest + chunk).split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) counter.count(line);
	}
	counter.count(rest);
	parentPort?.postMessage(counter.result());
}

/** Counts `token\tyear,match,volumes\t...` lines by lowercased word. */
function wordCounter(): { count(line: string): void; result(): Counts } {
	const counts = new Map<string, number>();
	return {
		count(line) {
			const tab = line.indexOf("\t");
			if (tab <= 0) return;
			const token = line.slice(0, tab);
			if (token.includes("_")) return;
			const word = token.toLowerCase();
			if (!WORD.test(word) || NOT_WORDS.has(word)) return;
			counts.set(word, (counts.get(word) ?? 0) + matchCount(line, tab));
		},
		result: () => ({ entries: [...counts].filter(([, count]) => count >= PRUNE_BELOW), sentences: 0 }),
	};
}

/** Counts `left right\tyear,match,volumes\t...` lines by pair of kept words, and the sentences. */
function pairCounter(words: readonly string[]): { count(line: string): void; result(): Counts } {
	const ids = new Map(words.map((word, id) => [word, id]));
	const start = words.length;
	const counts = new Map<number, number>();
	let sentences = 0;
	return {
		count(line) {
			const tab = line.indexOf("\t");
			const space = line.indexOf(" ");
			if (space <= 0 || space > tab) return;
			const left = line.slice(0, space);
			const right = line.slice(space + 1, tab);
			// Tagged copies repeat the plain pair's count, and `_END_` is not a word anyone types.
			if (right.includes("_")) return;
			const isStart = left === SENTENCE_START;
			if (!isStart && left.includes("_")) return;
			const context = isStart ? start : ids.get(left.toLowerCase());
			const word = ids.get(right.toLowerCase());
			// Every sentence counts toward the start context, also those that open with a number or a rare word.
			if (isStart) sentences += matchCount(line, tab);
			if (context === undefined || word === undefined) return;
			const key = context * PAIR_BASE + word;
			counts.set(key, (counts.get(key) ?? 0) + matchCount(line, tab));
		},
		result: () => ({ entries: [...counts].filter(([, count]) => count >= PAIR_PRUNE_BELOW), sentences }),
	};
}

/** The sum of `match_count` over the year fields after `tab`. */
function matchCount(line: string, tab: number): number {
	let total = 0;
	let at = tab;
	while (at !== -1) {
		const first = line.indexOf(",", at + 1);
		const second = line.indexOf(",", first + 1);
		total += Number(line.slice(first + 1, second));
		at = line.indexOf("\t", second);
	}
	return total;
}

function splitKey(key: number): [context: number, word: number] {
	const word = key % PAIR_BASE;
	return [(key - word) / PAIR_BASE, word];
}

/** Orders words the way `<` does, by UTF-16 code units, which is the order the engine searches. */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
