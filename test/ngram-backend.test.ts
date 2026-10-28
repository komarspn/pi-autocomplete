import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NgramBackend, type NgramSnapshot, type WordCount } from "../src/ngram-backend.ts";

// Saved by the backend that kept its counts in Maps keyed by word strings, with the completions it gave.
const MAP_ERA_SNAPSHOT: NgramSnapshot = {
	unigrams: [
		["open", 3], ["the", 7], ["pull", 4], ["request", 3], ["run", 3], ["full", 3], ["test", 3], ["suite", 3],
		["write", 3], ["a", 3], ["summary", 3], ["please", 2], ["summarize", 2], ["then", 1], ["zygomorphic", 1],
		["flower", 1],
	],
	bigrams: [
		["", [["open", 3], ["run", 3], ["write", 3], ["please", 2], ["then", 1]]],
		["open", [["the", 3]]],
		["the", [["pull", 3], ["full", 3], ["zygomorphic", 1]]],
		["pull", [["request", 3], ["the", 1]]],
		["run", [["the", 3]]],
		["full", [["test", 3]]],
		["test", [["suite", 3]]],
		["write", [["a", 3]]],
		["a", [["summary", 3]]],
		["please", [["summarize", 2]]],
		["then", [["pull", 1]]],
		["zygomorphic", [["flower", 1]]],
	],
	trigrams: [
		["\0open", [["the", 3]]],
		["open\0the", [["pull", 3]]],
		["the\0pull", [["request", 3]]],
		["\0run", [["the", 3]]],
		["run\0the", [["full", 3]]],
		["the\0full", [["test", 3]]],
		["full\0test", [["suite", 3]]],
		["\0write", [["a", 3]]],
		["write\0a", [["summary", 3]]],
		["\0please", [["summarize", 2]]],
		["\0then", [["pull", 1]]],
		["then\0pull", [["the", 1]]],
		["pull\0the", [["zygomorphic", 1]]],
		["the\0zygomorphic", [["flower", 1]]],
	],
};
const MAP_ERA_COMPLETIONS: [before: string, prefix: string, suffix: string][] = [
	["open the ", "pu", "ll"],
	["run the ", "fu", "ll"],
	["write a ", "sum", "mary"],
	["please ", "sum", "marize"],
	["", "zygo", "morphic"],
	["", "p", "lease"],
	["the ", "r", "equest"],
	["pull the ", "z", "ygomorphic"],
	["", "t", "he"],
];

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

	it("loads a snapshot saved by the Map-based backend and gives the same completions", async () => {
		const backend = new NgramBackend();
		backend.restore(MAP_ERA_SNAPSHOT);
		for (const [before, prefix, suffix] of MAP_ERA_COMPLETIONS) {
			assert.equal(await backend.complete(before, prefix), suffix, `${before}|${prefix}`);
		}
		assert.deepEqual(backend.snapshot(), MAP_ERA_SNAPSHOT);
	});

	it("counts every word under a prefix when words arrive out of order, live and restored", async () => {
		const backend = new NgramBackend();
		const unigrams: WordCount[] = [["cow", 1], ["cat", 1], ["dog", 1], ["bee", 1], ["cup", 1]];
		backend.restore({ unigrams, bigrams: [], trigrams: [] });
		// Live words land before, between, and after the restored ones.
		for (const word of ["cry", "ant", "cab", "zoo", "cod", "cog", "eel", "cot"]) backend.observe(word);
		// Eight equally likely words under "c" leave the best at 0.125, below 0.15. Losing any one would show a ghost.
		assert.equal(await backend.complete("", "c"), null);
		backend.observe("cub");
		backend.observe("cub");
		assert.equal(await backend.complete("", "c"), "ub");
		const others: [prefix: string, suffix: string][] = [
			["a", "nt"], ["b", "ee"], ["d", "og"], ["e", "el"], ["z", "oo"], ["cr", "y"],
		];
		for (const [prefix, suffix] of others) {
			assert.equal(await backend.complete("", prefix), suffix, prefix);
		}
	});

	it("does not extend a prefix that is itself the likeliest word", async () => {
		const backend = new NgramBackend();
		for (let i = 0; i < 5; i++) backend.observe("the");
		backend.observe("there");
		assert.equal(await backend.complete("", "the"), null);
		assert.equal(await backend.complete("", "th"), "e");
	});
});
