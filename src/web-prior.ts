import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { WordCount } from "./ngram-backend.ts";

/** Web word counts, sorted by word in UTF-16 order, each word once. */
export type WebPrior = readonly WordCount[];

/** The prior that ships with the package, built by scripts/build-web-prior.ts. */
export const WEB_PRIOR_PATH = fileURLToPath(new URL("../data/web-prior.tsv.gz", import.meta.url));

const unzip = promisify(gunzip);
// Lines parsed between yields to the event loop, so loading never holds up pi for long.
const SLICE_LINES = 2_000;

/**
 * Reads a gzipped file of `word\tcount` lines. Resolves to undefined when the file is missing or
 * corrupt, so completion goes on with learned words alone. Never rejects. Decompression runs off the
 * main thread, and parsing yields between slices of lines.
 */
export async function loadWebPrior(path: string = WEB_PRIOR_PATH): Promise<WebPrior | undefined> {
	let text: string;
	try {
		text = (await unzip(await readFile(path))).toString("utf8");
	} catch {
		// Missing or not gzip: the prior is optional.
		return undefined;
	}
	const prior: WordCount[] = [];
	let previous = "";
	// Line by line rather than one split, which alone would hold the event loop for tens of milliseconds.
	for (let start = 0, i = 0; start < text.length; i++) {
		if (i % SLICE_LINES === SLICE_LINES - 1) await new Promise((resolve) => setImmediate(resolve));
		const newline = text.indexOf("\n", start);
		const end = newline === -1 ? text.length : newline;
		const line = text.slice(start, end);
		start = end + 1;
		if (!line) continue;
		const tab = line.indexOf("\t");
		const word = line.slice(0, tab);
		const count = Number(line.slice(tab + 1));
		// Strictly increasing words also rule out duplicates, which would count a word twice.
		if (tab <= 0 || !Number.isSafeInteger(count) || count <= 0 || word <= previous) return undefined;
		prior.push([word, count]);
		previous = word;
	}
	return prior.length > 0 ? prior : undefined;
}
