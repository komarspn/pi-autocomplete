import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NgramBackend } from "../src/ngram-backend.ts";

describe("NgramBackend", () => {
	it("completes a word learned from an observed prompt", async () => {
		const backend = new NgramBackend();
		assert.equal(await backend.complete("", "zygo"), null);
		backend.observe("please look at the zygomorphic flower");
		assert.equal(await backend.complete("a ", "zygo"), "morphic");
	});

	it("uses the preceding words to pick between completions of the same prefix", async () => {
		const backend = new NgramBackend();
		for (let i = 0; i < 3; i++) {
			backend.observe("open the pull request");
			backend.observe("run the full test suite");
		}
		assert.equal(await backend.complete("open the ", "pu"), "ll");
		assert.equal(await backend.complete("run the ", "fu"), "ll");
		for (let i = 0; i < 3; i++) backend.observe("write a summary");
		for (let i = 0; i < 2; i++) backend.observe("please summarize");
		assert.equal(await backend.complete("write a ", "sum"), "mary");
		assert.equal(await backend.complete("please ", "sum"), "marize");
	});

	it("returns null when no candidate reaches the show threshold", async () => {
		const backend = new NgramBackend();
		// Ten equally likely words under "c": the best has a posterior of 0.1, below 0.15.
		for (const word of ["cat", "cow", "cup", "cab", "cod", "cog", "cot", "cub", "cue", "cry"]) backend.observe(word);
		assert.equal(await backend.complete("", "c"), null);
		// Five of them leave the best at 0.2, above the threshold.
		const fewer = new NgramBackend();
		for (const word of ["cat", "cow", "cup", "cab", "cod"]) fewer.observe(word);
		assert.notEqual(await fewer.complete("", "c"), null);
	});

	it("does not learn slash commands", async () => {
		const backend = new NgramBackend();
		backend.observe("/skill:review zygomorphic flowers");
		backend.observe("  /compact keep the zygomorphic part");
		assert.equal(await backend.complete("", "zygo"), null);
		assert.equal(await backend.complete("", "flo"), null);
	});

	it("learns the prose of a prompt but not its code", async () => {
		const backend = new NgramBackend();
		backend.observe("please read\n```ts\nconst zygomorphic = quixotic;\n```\nthen floriculture");
		backend.observe("run `xylograph` and open src/vexillology <kbd>jabberwock</kbd> now");
		backend.observe("rename snakeCaseThing and also_this or pi2go");
		assert.equal(await backend.complete("", "flori"), "culture");
		for (const prefix of ["zygo", "quix", "xylo", "vexi", "jabb", "snake", "also", "pi"]) {
			assert.equal(await backend.complete("", prefix), null, prefix);
		}
	});

	it("does not learn words after an unclosed backtick in the same paragraph", async () => {
		const backend = new NgramBackend();
		backend.observe("run `zygomorphic\nquixotic too\n\nthen floriculture");
		assert.equal(await backend.complete("", "zygo"), null);
		assert.equal(await backend.complete("", "quix"), null);
		assert.equal(await backend.complete("", "flori"), "culture");
	});

	it("does not learn from complete", async () => {
		const backend = new NgramBackend();
		backend.observe("open the pull request");
		const queries: [string, string][] = [
			["open the ", "pu"],
			["", "o"],
			["the zygomorphic ", "flo"],
		];
		const first = await Promise.all(queries.map(([before, prefix]) => backend.complete(before, prefix)));
		for (let i = 0; i < 20; i++) await backend.complete("zygomorphic zygomorphic ", "zygo");
		const again = await Promise.all(queries.map(([before, prefix]) => backend.complete(before, prefix)));
		assert.deepEqual(again, first);
		assert.equal(await backend.complete("", "zygo"), null);
	});

	it("does not extend a prefix that is itself the likeliest word", async () => {
		const backend = new NgramBackend();
		for (let i = 0; i < 5; i++) backend.observe("the");
		backend.observe("there");
		assert.equal(await backend.complete("", "the"), null);
		assert.equal(await backend.complete("", "th"), "e");
	});
});
