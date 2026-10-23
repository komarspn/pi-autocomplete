import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WordListBackend } from "../src/word-list-backend.ts";

describe("WordListBackend", () => {
	const backend = new WordListBackend(["the", "there", "think", "hello"]);

	it("returns the suffix of the first listed word with the prefix", async () => {
		assert.equal(await backend.complete("", "th"), "e");
		assert.equal(await backend.complete("say ", "hel"), "lo");
	});

	it("matches the prefix case-insensitively", async () => {
		assert.equal(await backend.complete("", "Hel"), "lo");
	});

	it("skips words that equal the prefix", async () => {
		assert.equal(await backend.complete("", "the"), "re");
	});

	it("completes one-letter prefixes", async () => {
		assert.equal(await backend.complete("", "t"), "he");
	});

	it("returns null for unknown prefixes", async () => {
		assert.equal(await backend.complete("", "zz"), null);
	});

	it("ships a default word list", async () => {
		assert.equal(typeof (await new WordListBackend().complete("", "becau")), "string");
	});

	it("accepts feedback without throwing", () => {
		new WordListBackend().feedback("", "hel", "lo", true);
	});
});
