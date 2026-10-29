import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

/** The word list that ships with the package, built by scripts/build-dictionary.ts. */
export const DICTIONARY_PATH = fileURLToPath(new URL("../data/dictionary.txt.gz", import.meta.url));

const unzip = promisify(gunzip);
// Lines read between yields to the event loop, so loading never holds up pi for long.
const SLICE_LINES = 2_000;

/**
 * Reads a gzipped word list: the license notice in lines that start with `#`, then one lowercase word
 * per line. Resolves to undefined when the file is missing, corrupt or holds no word, so a word outside
 * the prior then needs its uses. Never rejects. Decompression runs off the main thread, and reading the
 * lines yields between slices.
 */
export async function loadDictionary(path: string = DICTIONARY_PATH): Promise<ReadonlySet<string> | undefined> {
	let text: string;
	try {
		text = (await unzip(await readFile(path))).toString("utf8");
	} catch {
		// Missing or not gzip: the dictionary is optional.
		return undefined;
	}
	const words = new Set<string>();
	let lines = 0;
	for (let start = 0; start < text.length; ) {
		if (++lines % SLICE_LINES === 0) await new Promise((resolve) => setImmediate(resolve));
		const newline = text.indexOf("\n", start);
		const end = newline === -1 ? text.length : newline;
		if (end > start && text[start] !== "#") words.add(text.slice(start, end));
		start = end + 1;
	}
	return words.size > 0 ? words : undefined;
}
