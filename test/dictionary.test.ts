import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { loadDictionary } from "../src/dictionary.ts";

let root: string;

before(() => {
	root = mkdtempSync(join(tmpdir(), "dictionary-"));
});

after(() => {
	rmSync(root, { recursive: true, force: true });
});

function dictionaryFile(name: string, content: Buffer): string {
	const path = join(root, name);
	writeFileSync(path, content);
	return path;
}

describe("loadDictionary", () => {
	it("loads the shipped word list, lowercase", async () => {
		const words = await loadDictionary();
		assert.ok(words, "the shipped list loads");
		assert.ok(words.size > 80_000, `${words.size} words`);
		for (const word of ["because", "zygote", "don't", "paris"]) assert.ok(words.has(word), word);
		assert.ok(!words.has("becaufe"));
		assert.ok([...words].every((word) => word === word.toLowerCase()));
	});

	it("reads one word per line and skips the notice lines that start with #", async () => {
		const path = dictionaryFile("small.txt.gz", gzipSync("# Copyright\n#\nant\nbee\n"));
		assert.deepEqual(await loadDictionary(path), new Set(["ant", "bee"]));
	});

	it("resolves to undefined for a missing, corrupt or empty file", async () => {
		assert.equal(await loadDictionary(join(root, "missing.txt.gz")), undefined);
		assert.equal(await loadDictionary(dictionaryFile("plain.txt", Buffer.from("ant\nbee\n"))), undefined);
		assert.equal(await loadDictionary(dictionaryFile("empty.txt.gz", gzipSync("# notice only\n"))), undefined);
	});
});
