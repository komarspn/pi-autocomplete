// Builds data/dictionary.txt.gz, the list of real spellings the n-gram engine ships with. A learned word
// in it is suggested after one use; other words outside the web prior need two.
//
// Run: node scripts/build-dictionary.ts <esdb-dir> <word-list> [--out data/dictionary.txt.gz]
//
//   esdb-dir   A clone of https://github.com/en-wl/wordlist at the commit below. The notice is copied from
//              its Copyright file and the commit from its git HEAD.
//   word-list  The list ESDB writes, one word per line.
//   --out      Output path. Default data/dictionary.txt.gz.
//
// Source: English Speller Database (ESDB, previously SCOWLv2), size 60, American English, under the
// MIT-like license in its Copyright file (see NOTICE and ticket 01 in .scratch/ngram-web-prior). The
// shipped list was built from commit 1e5b7d3a72f47a71da5d28686c1dd4b397178485 with Python 3.14 and
// SQLite 3.54:
//
//   git clone -b v2 https://github.com/en-wl/wordlist.git esdb
//   git -C esdb checkout 1e5b7d3a72f47a71da5d28686c1dd4b397178485
//   make -C esdb scowl.db                                       # about 2 minutes
//   (cd esdb && ./scowl --db scowl.db word-list 60 A 1) > wl.txt
//   node scripts/build-dictionary.ts esdb wl.txt
//
// The script lowercases each entry and keeps it only if it is a word as the engine reads one: letters
// and marks, with apostrophes only between them. That drops abbreviations with dots and hyphenated
// words. Case variants such as `Polish` and `polish` become one word. The same inputs give the same
// output.
//
// Output: gzip of the ESDB notice, each line prefixed with `# ` as the license asks it to appear in all
// copies, then the words, one per line, sorted in UTF-16 order.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const WORD = /^[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*$/u;

function main(): void {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { out: { type: "string", default: resolve(import.meta.dirname, "../data/dictionary.txt.gz") } },
	});
	const [esdb, list] = positionals;
	if (esdb === undefined || list === undefined) {
		throw new Error("Usage: node scripts/build-dictionary.ts <esdb-dir> <word-list> [--out path]");
	}
	const commit = execFileSync("git", ["-C", esdb, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	// The copyright line and the permission paragraph. The rest of the file covers sizes above 80 and
	// Australian lists, which this one is not.
	const notice = readFileSync(join(esdb, "Copyright"), "utf8").split(/\n\s*\n/).slice(0, 2).join("\n\n");
	const words = new Set<string>();
	for (const entry of readFileSync(list, "utf8").split("\n")) {
		const word = entry.trim().toLowerCase();
		if (WORD.test(word)) words.add(word);
	}
	const header = [
		"Words from the English Speller Database (ESDB, previously known as SCOWLv2), size 60, American",
		`English, https://github.com/en-wl/wordlist commit ${commit}, lowercased.`,
		"",
		...notice.split("\n"),
	];
	const sorted = [...words].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const text = `${header.map((line) => (line ? `# ${line}` : "#")).join("\n")}\n${sorted.join("\n")}\n`;
	writeFileSync(values.out, gzipSync(text, { level: 9 }));
	console.log(`${sorted.length} words, ${commit}, written to ${values.out}`);
}

main();
