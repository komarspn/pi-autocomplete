import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NgramBackend, type NgramSnapshot, type WordCount } from "../src/ngram-backend.ts";
import { noPairs } from "../src/web-prior.ts";

// Saved by the backend that kept its counts in Maps keyed by word strings, with the completions it gave.
const MAP_ERA_SNAPSHOT: NgramSnapshot = {
	unigrams: [
		["open", 3], ["the", 7], ["pull", 4], ["request", 3], ["run", 3], ["full", 3], ["test", 3], ["suite", 3],
		["write", 3], ["a", 3], ["summary", 3], ["please", 2], ["summarize", 2], ["then", 1], ["zygomorphic", 1],
		["flower", 1],
	],
	// That backend had no folding. Written here because snapshot() writes it.
	folded: [],
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

/** A backend whose prior and dictionary hold the real words the misspelling tests fold into, or must not. */
async function slipBackend(): Promise<NgramBackend> {
	const backend = new NgramBackend();
	const words = ["auth", "canonical", "instead", "subagent", "the", "were"];
	backend.useDictionary(new Set(words));
	await backend.usePrior({ words: words.map((word) => [word, 1000]), sentences: 0, pairs: noPairs() });
	return backend;
}

/** The learned unigram counts, in no particular order. */
function learnedCounts(backend: NgramBackend): Map<string, number> {
	return new Map(backend.snapshot().unigrams);
}

describe("NgramBackend", () => {
	it("completes a word learned from an observed prompt", async () => {
		const backend = new NgramBackend();
		assert.equal(await backend.complete("", "zygo"), null);
		for (let i = 0; i < 2; i++) backend.observe("please look at the zygomorphic flower");
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
		const words = ["cat", "cow", "cup", "cab", "cod", "cog", "cot", "cub", "cue", "cry"];
		backend.useDictionary(new Set(words));
		for (const word of words) backend.observe(word);
		assert.equal(await backend.complete("", "c"), null);
		// Five of them leave the best at 0.2, above the threshold.
		const fewer = new NgramBackend();
		fewer.useDictionary(new Set(words));
		for (const word of words.slice(0, 5)) fewer.observe(word);
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
		// Real spellings show after one use, so a word learned from the code by mistake would show.
		backend.useDictionary(new Set(["zygomorphic", "quixotic", "xylograph", "vexillology", "floriculture"]));
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
		backend.useDictionary(new Set(["zygomorphic", "quixotic", "floriculture"]));
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
		// That backend suggested words learned once. As a real spelling, zygomorphic still is.
		backend.useDictionary(new Set(["zygomorphic"]));
		backend.restore(MAP_ERA_SNAPSHOT);
		for (const [before, prefix, suffix] of MAP_ERA_COMPLETIONS) {
			assert.equal(await backend.complete(before, prefix), suffix, `${before}|${prefix}`);
		}
		assert.deepEqual(backend.snapshot(), MAP_ERA_SNAPSHOT);
	});

	it("counts every word under a prefix when words arrive out of order, live and restored", async () => {
		const backend = new NgramBackend();
		const unigrams: WordCount[] = [["cow", 1], ["cat", 1], ["dog", 1], ["bee", 1], ["cup", 1]];
		const live = ["cry", "ant", "cab", "zoo", "cod", "cog", "eel", "cot"];
		// Real spellings, so each shows after one use.
		backend.useDictionary(new Set([...unigrams.map(([word]) => word), ...live, "cub"]));
		backend.restore({ unigrams, folded: [], bigrams: [], trigrams: [] });
		// Live words land before, between, and after the restored ones.
		for (const word of live) backend.observe(word);
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

	it("suggests a word outside the prior and the dictionary only once it was learned twice", async () => {
		const backend = new NgramBackend();
		backend.observe("check the zygomorphic flower");
		assert.equal(await backend.complete("", "zygo"), null);
		backend.observe("zygomorphic again");
		assert.equal(await backend.complete("", "zygo"), "morphic");
	});

	it("uses a word it does not suggest yet as context for the next word", async () => {
		const backend = new NgramBackend();
		for (let i = 0; i < 3; i++) backend.observe("glimmer");
		backend.observe("flurb gizmo");
		backend.observe("gizmo");
		assert.equal(await backend.complete("", "flu"), null, "flurb is hidden");
		assert.equal(await backend.complete("", "g"), "limmer");
		assert.equal(await backend.complete("flurb ", "g"), "izmo");
	});

	it("suggests a dictionary word or a web word learned once", async () => {
		const backend = new NgramBackend();
		backend.useDictionary(new Set(["zygomorphic"]));
		await backend.usePrior({ words: [["the", 1000], ["xylograph", 1]], sentences: 0, pairs: noPairs() });
		backend.observe("zygomorphic xylograph");
		assert.equal(await backend.complete("", "zygo"), "morphic");
		// One web count in 1001 leaves xylograph mostly to the learned count.
		assert.equal(await backend.complete("", "xylo"), "graph");
	});

	it("learns a rare misspelling as the real web word one edit away, and never suggests it", async () => {
		const backend = await slipBackend();
		backend.observe("isntead cannonical");
		assert.deepEqual(learnedCounts(backend), new Map([["instead", 1], ["canonical", 1]]));
		backend.observe("isntead cannonical");
		assert.equal(await backend.complete("", "isnt"), null);
		assert.equal(await backend.complete("", "cann"), null);
	});

	it("folds a spelling into a word outside the prior that the user typed 3 times as often", async () => {
		const backend = await slipBackend();
		for (let i = 0; i < 2; i++) backend.observe("frobnicate");
		backend.observe("frobnciate");
		assert.deepEqual(learnedCounts(backend), new Map([["frobnicate", 2], ["frobnciate", 1]]));
		backend.observe("frobnicate");
		backend.observe("frobnciate");
		// frobnciate's second typing needs 6 of frobnicate, which has 3. The first was not folded.
		assert.deepEqual(learnedCounts(backend), new Map([["frobnicate", 3], ["frobnciate", 2]]));
		const fresh = await slipBackend();
		for (let i = 0; i < 3; i++) fresh.observe("frobnicate");
		fresh.observe("frobnciate");
		assert.deepEqual(learnedCounts(fresh), new Map([["frobnicate", 4]]));
	});

	it("stops folding a spelling into a web word once it was typed 3 times", async () => {
		const backend = await slipBackend();
		for (let i = 0; i < 3; i++) backend.observe("cannonical");
		assert.deepEqual(learnedCounts(backend), new Map([["canonical", 3]]));
		backend.observe("cannonical");
		assert.deepEqual(learnedCounts(backend), new Map([["canonical", 3], ["cannonical", 1]]));
		assert.equal(await backend.complete("", "cann"), null);
		backend.observe("cannonical");
		assert.equal(await backend.complete("", "cann"), "onical");
	});

	it("keeps how often a folded spelling was typed across a snapshot", async () => {
		const before = await slipBackend();
		for (let i = 0; i < 3; i++) before.observe("cannonical");
		const after = await slipBackend();
		after.restore(before.snapshot());
		after.observe("cannonical");
		assert.deepEqual(learnedCounts(after), new Map([["canonical", 3], ["cannonical", 1]]));
	});

	it("does not fold a web word outside the dictionary with a web count of 2,000,000", async () => {
		const backend = new NgramBackend();
		backend.useDictionary(new Set(["cost", "separate"]));
		const words: WordCount[] = [
			["const", 2_000_000], ["cost", 400_000_000], ["separate", 90_000_000], ["seperate", 1_999_999],
		];
		await backend.usePrior({ words, sentences: 0, pairs: noPairs() });
		backend.observe("const seperate");
		assert.deepEqual(learnedCounts(backend), new Map([["const", 1], ["separate", 1]]));
	});

	it("does not fold a word into one that differs in its first letter, its last letter or an apostrophe", async () => {
		const backend = await slipBackend();
		for (let i = 0; i < 2; i++) backend.observe("oauth subagents we're");
		assert.deepEqual(learnedCounts(backend), new Map([["oauth", 2], ["subagents", 2], ["we're", 2]]));
		assert.equal(await backend.complete("", "oau"), "th");
		assert.equal(await backend.complete("", "we'"), "re");
	});

	it("does not extend a prefix that is itself the likeliest word", async () => {
		const backend = new NgramBackend();
		for (let i = 0; i < 5; i++) backend.observe("the");
		backend.observe("there");
		assert.equal(await backend.complete("", "the"), null);
		assert.equal(await backend.complete("", "th"), "e");
	});
});
