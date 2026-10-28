// Builds data/web-prior.tsv.gz, the web unigram prior the n-gram engine ships with.
//
// Run: node scripts/build-web-prior.ts [--words 150000] [--files 24] [--jobs 3] [--out data/web-prior.tsv.gz]
//
//   --words  How many words to keep, the most frequent first. Default 150,000.
//   --files  Read only the first N of the 24 source files, to try the script quickly. Default all.
//   --jobs   Source files read at once, one worker thread each. Default 3.
//   --out    Output path. Default data/web-prior.tsv.gz.
//
// Source: Google Books Ngram, English 1-grams, version 20200217, CC BY 3.0 (see NOTICE and ticket 01
// in .scratch/ngram-web-prior). The 24 files total about 14 GB gzipped. Each one streams from
// storage.googleapis.com through gunzip into a counter, so nothing large is written to disk. The run
// takes about an hour on 4 cores. The same source and arguments give the same output.
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
// Output: gzip of `word\tcount` lines, sorted by word in UTF-16 order, the order the engine searches.
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { createGunzip, createGzip, constants } from "node:zlib";

const SOURCE = "https://storage.googleapis.com/books/ngrams/books/20200217/eng";
const FILE_COUNT = 24;
const PRUNE_BELOW = 100;
const WORD = /^[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*$/u;
// Pieces of split contractions that pass WORD.
const NOT_WORDS = new Set(["n't"]);
const ATTEMPTS = 3;

if (isMainThread) await main();
else await work();

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			words: { type: "string", default: "150000" },
			files: { type: "string", default: String(FILE_COUNT) },
			jobs: { type: "string", default: "3" },
			out: { type: "string", default: "data/web-prior.tsv.gz" },
		},
	});
	const keep = Number(values.words);
	const files = Number(values.files);
	const jobs = Number(values.jobs);
	const out = resolve(values.out);

	const urls = Array.from({ length: files }, (_, i) => {
		const name = `1-${String(i).padStart(5, "0")}-of-${String(FILE_COUNT).padStart(5, "0")}.gz`;
		return `${SOURCE}/${name}`;
	});
	const totals = new Map<string, number>();
	let next = 0;
	const started = Date.now();
	const runJob = async (): Promise<void> => {
		while (next < urls.length) {
			const url = urls[next++]!;
			const counts = await countFile(url);
			for (const [word, count] of counts) totals.set(word, (totals.get(word) ?? 0) + count);
			const minutes = ((Date.now() - started) / 60_000).toFixed(1);
			console.error(`${url.slice(SOURCE.length + 1)}: ${counts.size} words, ${totals.size} merged, ${minutes} min`);
		}
	};
	await Promise.all(Array.from({ length: jobs }, runJob));

	// Ties go to the earlier word, so the cut does not depend on the order files finished in.
	const top = [...totals].sort(([a, x], [b, y]) => y - x || compare(a, b)).slice(0, keep);
	top.sort(([a], [b]) => compare(a, b));
	await mkdir(dirname(out), { recursive: true });
	const lines = top.map(([word, count]) => `${word}\t${count}\n`).join("");
	await pipeline(Readable.from([lines]), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(out));
	console.error(`wrote ${top.length} words to ${out}`);
}

/** Counts one source file in a worker thread, retrying the whole file when the download breaks. */
async function countFile(url: string): Promise<Map<string, number>> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await new Promise((resolveCounts, reject) => {
				const worker = new Worker(new URL(import.meta.url), { workerData: url });
				worker.once("message", (entries: [string, number][]) => resolveCounts(new Map(entries)));
				worker.once("error", reject);
				worker.once("exit", (code) => reject(new Error(`worker for ${url} exited with ${code}`)));
			});
		} catch (error) {
			if (attempt >= ATTEMPTS) throw error;
			console.error(`${url}: ${error instanceof Error ? error.message : String(error)}, retrying`);
		}
	}
}

/** Worker: streams one gzipped 1-gram file and posts the lowercased word counts. */
async function work(): Promise<void> {
	const url: string = workerData;
	const response = await new Promise<IncomingMessage>((resolveResponse, reject) => get(url, resolveResponse).on("error", reject));
	if (response.statusCode !== 200) throw new Error(`${url}: HTTP ${response.statusCode}`);
	const counts = new Map<string, number>();
	let rest = "";
	const text = response.pipe(createGunzip());
	response.on("error", (error) => text.destroy(error));
	text.setEncoding("utf8");
	for await (const chunk of text) {
		const lines = (rest + chunk).split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) countLine(counts, line);
	}
	countLine(counts, rest);
	const kept = [...counts].filter(([, count]) => count >= PRUNE_BELOW);
	parentPort?.postMessage(kept);
}

/** Adds one `token\tyear,match,volumes\t...` line to `counts`, if its token is a plain word. */
function countLine(counts: Map<string, number>, line: string): void {
	const tab = line.indexOf("\t");
	if (tab <= 0) return;
	const token = line.slice(0, tab);
	if (token.includes("_")) return;
	const word = token.toLowerCase();
	if (!WORD.test(word) || NOT_WORDS.has(word)) return;
	let total = 0;
	let at = tab;
	while (at !== -1) {
		const first = line.indexOf(",", at + 1);
		const second = line.indexOf(",", first + 1);
		total += Number(line.slice(first + 1, second));
		at = line.indexOf("\t", second);
	}
	counts.set(word, (counts.get(word) ?? 0) + total);
}

/** Orders words the way `<` does, by UTF-16 code units, which is the order the engine searches. */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
