import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { NgramBackend, type NgramSnapshot, type WordCount } from "../src/ngram-backend.ts";
import { loadWebPrior, noPairs, SENTENCE_START, type WebPrior } from "../src/web-prior.ts";

let root: string;
let shipped: WebPrior;

before(async () => {
	root = mkdtempSync(join(tmpdir(), "web-prior-"));
	const prior = await loadWebPrior();
	assert.ok(prior, "the shipped prior loads");
	shipped = prior;
});

after(() => {
	rmSync(root, { recursive: true, force: true });
});

/** A snapshot with every list sorted, to compare content regardless of word ids. */
function sorted(snapshot: NgramSnapshot): NgramSnapshot {
	const byFirst = <T extends [string, unknown]>(rows: T[]): T[] => rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const table = (rows: [string, WordCount[]][]) => byFirst(rows.map(([context, counts]) => [context, byFirst(counts)]));
	return {
		unigrams: byFirst(snapshot.unigrams),
		folded: byFirst(snapshot.folded),
		bigrams: table(snapshot.bigrams),
		trigrams: table(snapshot.trigrams),
	};
}

/** A prior with words alone, no sentences and no pairs. */
function wordsOnly(words: readonly WordCount[]): WebPrior {
	return { words, sentences: 0, pairs: noPairs() };
}

/**
 * A prior with pairs given as words: the context `""` is the sentence start. A word missing from `words`
 * gets the index past the last word, so it names no word.
 */
function priorOf(
	words: readonly WordCount[],
	sentences: number,
	rows: readonly (readonly [context: string, counts: readonly WordCount[]])[],
): WebPrior {
	const indexOf = (word: string) => {
		const index = words.findIndex(([known]) => known === word);
		return index === -1 ? words.length : index;
	};
	const followers = rows.flatMap(([, counts]) => counts);
	return {
		words,
		sentences,
		pairs: {
			contexts: Int32Array.from(rows, ([context]) => (context ? indexOf(context) : SENTENCE_START)),
			starts: Int32Array.from([0, ...rows.map((_, i) => rows.slice(0, i + 1).flatMap(([, counts]) => counts).length)]),
			words: Int32Array.from(followers, ([word]) => indexOf(word)),
			counts: Float64Array.from(followers, ([, count]) => count),
		},
	};
}

function priorFile(name: string, content: Buffer): string {
	const path = join(root, name);
	writeFileSync(path, content);
	return path;
}

describe("loadWebPrior", () => {
	it("loads the shipped prior, sorted by word", () => {
		assert.ok(shipped.words.length > 100_000);
		const words = shipped.words.map(([word]) => word);
		assert.deepEqual(words, [...new Set(words)].sort(), "sorted, each word once");
	});

	it("reads word and count lines", async () => {
		const path = priorFile("small.tsv.gz", gzipSync("ant\t5\nbee\t7\n"));
		assert.deepEqual(await loadWebPrior(path), wordsOnly([["ant", 5], ["bee", 7]]));
	});

	it("reads the sentence count and the pair lines after the words", async () => {
		const words = "ant\t5\nbee\t7\ncow\t9\n";
		const pairs = "\t40\n\tbee\t3\nant\tbee\t2\nant\tcow\t1\ncow\tant\t4\n";
		const path = priorFile("pairs.tsv.gz", gzipSync(words + pairs));
		const expected = priorOf([["ant", 5], ["bee", 7], ["cow", 9]], 40, [
			["", [["bee", 3]]],
			["ant", [["bee", 2], ["cow", 1]]],
			["cow", [["ant", 4]]],
		]);
		assert.deepEqual(await loadWebPrior(path), expected);
	});

	const broken: [name: string, content: Buffer][] = [
		["missing", Buffer.alloc(0)],
		["not gzip", Buffer.from("ant\t5\n")],
		["cut short", gzipSync("ant\t5\nbee\t7\n".repeat(50)).subarray(0, 40)],
		["missing a count", gzipSync("ant\t5\nbee\n")],
		["holding a bad count", gzipSync("ant\t5\nbee\t-7\n")],
		["out of order", gzipSync("bee\t7\nant\t5\n")],
		["empty", gzipSync("")],
		["holding a pair before the sentence count", gzipSync("ant\t5\nbee\t7\nant\tbee\t2\n\t40\n")],
		["holding a word after a pair", gzipSync("ant\t5\n\t40\nant\tant\t2\nbee\t7\n")],
		["holding the sentence count twice", gzipSync("ant\t5\n\t40\n\t40\n")],
		["holding pairs out of order", gzipSync("ant\t5\nbee\t7\n\t40\nbee\tant\t2\nant\tbee\t2\n")],
		["holding a pair twice", gzipSync("ant\t5\nbee\t7\n\t40\nant\tbee\t2\nant\tbee\t2\n")],
		["holding a pair of an unknown word", gzipSync("ant\t5\nbee\t7\n\t40\nant\tcow\t2\n")],
		["holding a pair with a bad count", gzipSync("ant\t5\nbee\t7\n\t40\nant\tbee\t0\n")],
	];
	for (const [name, content] of broken) {
		it(`resolves to undefined when the file is ${name}`, async () => {
			const path = name === "missing" ? join(root, "absent.tsv.gz") : priorFile(`${name}.tsv.gz`, content);
			assert.equal(await loadWebPrior(path), undefined);
		});
	}
});

describe("NgramBackend with the web prior", () => {
	it("completes common words before anything is learned", async () => {
		const backend = new NgramBackend();
		assert.equal(await backend.complete("", "becau"), null);
		await backend.usePrior(shipped);
		assert.equal(await backend.complete("", "becau"), "se");
		assert.equal(await backend.complete("it was ", "becau"), "se");
	});

	it("lets a word the user types often win over a more common web word", async () => {
		// After `please`, which no learned pair follows and no web pair joins to a `ver` word, the unigram
		// level decides. At sentence start the web pairs favour `very` for longer.
		const backend = new NgramBackend();
		await backend.usePrior(shipped);
		assert.equal(await backend.complete("please ", "ver"), "y");
		for (let i = 0; i < 12; i++) backend.observe("bump the version");
		assert.equal(await backend.complete("please ", "ver"), "sion");
	});

	it("gives the same completions whether the prior comes before or after the learned counts", async () => {
		const first = new NgramBackend();
		await first.usePrior(shipped);
		const second = new NgramBackend();
		for (const backend of [first, second]) {
			for (let i = 0; i < 12; i++) backend.observe("bump the zygomorphic version");
		}
		await second.usePrior(shipped);
		for (const prefix of ["ver", "zygo", "becau", "t", "bum"]) {
			assert.equal(await second.complete("", prefix), await first.complete("", prefix), prefix);
		}
	});

	it("finds every word under a prefix after merging a prior into learned words", async () => {
		const backend = new NgramBackend();
		// Real spellings, so each learned word shows after one use.
		backend.useDictionary(new Set(["zoo", "dog", "cow", "aardvark"]));
		for (const word of ["zoo", "dog", "cow", "aardvark"]) backend.observe(word);
		await backend.usePrior(wordsOnly([["ant", 1], ["bee", 1], ["cow", 1], ["cup", 1], ["eel", 1]]));
		const expected: [prefix: string, suffix: string][] = [
			["aa", "rdvark"], ["an", "t"], ["b", "ee"], ["co", "w"], ["cu", "p"], ["d", "og"], ["e", "el"], ["z", "oo"],
		];
		for (const [prefix, suffix] of expected) assert.equal(await backend.complete("", prefix), suffix, prefix);
	});

	it("rejects an unsorted prior and a second prior without changing completions", async () => {
		const backend = new NgramBackend();
		backend.observe("zoo");
		await assert.rejects(backend.usePrior(wordsOnly([["bee", 1], ["ant", 1]])), /not sorted/);
		assert.equal(await backend.complete("", "a"), null);
		await backend.usePrior(wordsOnly([["ant", 1]]));
		await assert.rejects(backend.usePrior(wordsOnly([["bee", 1]])), /already in use/);
		assert.equal(await backend.complete("", "b"), null);
	});

	it("counts each word once when counts are learned and restored while the prior is added", async () => {
		// 25,000 equal words and one that holds 5,000 shares: it shows for "a" at a posterior of 0.167.
		// Counting words the prior added before a restore twice drops it below 0.15.
		const prior: WordCount[] = Array.from({ length: 25_000 }, (_, i) => [`a${String(i).padStart(5, "0")}`, 1]);
		prior[20_000] = ["a20000", 5_000];
		const backend = new NgramBackend();
		let isDone = false;
		const adding = backend.usePrior(wordsOnly(prior)).then(() => (isDone = true));
		assert.equal(await backend.complete("", "a2000"), null, "no prior before it resolves");
		// Between every slice, so some restores land after prior words got ids.
		while (!isDone) {
			backend.restore({ unigrams: [["zygomorphic", 1]], folded: [], bigrams: [], trigrams: [] });
			backend.observe("quixotic");
			await new Promise((resolve) => setImmediate(resolve));
		}
		await adding;
		assert.equal(await backend.complete("", "a"), "20000");
		assert.equal(await backend.complete("", "zygo"), "morphic");
		assert.equal(await backend.complete("", "quix"), "otic");
	});

	it("keeps prior eligibility hidden throughout installation", async () => {
		const backend = new NgramBackend();
		backend.observe("aardvark");
		const filler: WordCount[] = Array.from({ length: 5_000 }, (_, i) => [`z${String(i).padStart(4, "0")}`, 1]);
		let done = false;
		const adding = backend.usePrior(wordsOnly([["aardvark", 1], ...filler])).then(() => (done = true));
		const during: Array<string | null> = [];
		while (!done) {
			during.push(await backend.complete("", "aard"));
			await new Promise((resolve) => setImmediate(resolve));
		}
		await adding;
		assert.ok(during.length > 1, "checked across event-loop yields");
		assert.ok(during.every((suffix) => suffix === null), "one learned use stays hidden until publication");
		assert.equal(await backend.complete("", "aard"), "vark");
	});

	it("keeps prior slip folding hidden throughout installation", async () => {
		const backend = new NgramBackend();
		backend.useDictionary(new Set(["because"]));
		const filler: WordCount[] = Array.from({ length: 2_500 }, (_, i) => [`z${String(i).padStart(4, "0")}`, 1]);
		let done = false;
		const adding = backend.usePrior(wordsOnly([["because", 1], ...filler])).then(() => (done = true));
		const during: NgramSnapshot[] = [];
		while (!done) {
			backend.observe("becuase");
			during.push(backend.snapshot());
			await new Promise((resolve) => setImmediate(resolve));
		}
		await adding;
		assert.equal(during.length, 2, "validation and installation each yield once");
		for (const [index, snapshot] of during.entries()) {
			assert.deepEqual(snapshot.unigrams, [["becuase", index + 1]]);
			assert.deepEqual(snapshot.folded, []);
		}
		backend.observe("becuase");
		assert.deepEqual(backend.snapshot().folded, [["becuase", 1]], "folding starts after publication");
	});

	it("keeps the prior out of the snapshot", async () => {
		const backend = new NgramBackend();
		await backend.usePrior(shipped);
		backend.observe("please look at the zygomorphic flower");
		const plain = new NgramBackend();
		plain.observe("please look at the zygomorphic flower");
		// Prior words take the low ids, so entries come out in another order.
		assert.deepEqual(sorted(backend.snapshot()), sorted(plain.snapshot()));
	});

	it("completes only learned words when the prior file cannot be read", async () => {
		const prior = await loadWebPrior(join(root, "absent.tsv.gz"));
		const backend = new NgramBackend();
		if (prior) await backend.usePrior(prior);
		for (let i = 0; i < 2; i++) backend.observe("please look at the zygomorphic flower");
		assert.equal(await backend.complete("", "zygo"), "morphic");
		assert.equal(await backend.complete("", "becau"), null);
	});
});

describe("NgramBackend with web pairs", () => {
	// Without context `cat` is the more common word. The pairs pick `car` after `drive` and `cat` after `feed`.
	const vehicleWords: WordCount[] = [["car", 50], ["cat", 60], ["drive", 10], ["feed", 10]];
	const vehicles = priorOf(vehicleWords, 0, [
		["drive", [["car", 8]]],
		["feed", [["cat", 8]]],
	]);
	// `they` is the more common word, but `the` opens most sentences.
	const openers = priorOf([["foo", 10], ["the", 100], ["they", 120]], 1_000, [["", [["the", 600]]]]);

	it("completes the same prefix differently after two preceding words before anything is learned", async () => {
		const backend = new NgramBackend();
		await backend.usePrior(vehicles);
		assert.equal(await backend.complete("the ", "ca"), "t", "no context: the unigram level picks `cat`");
		assert.equal(await backend.complete("drive ", "ca"), "r");
		assert.equal(await backend.complete("feed ", "ca"), "t");
	});

	it("lets learned pairs outweigh the web pairs where the history disagrees", async () => {
		const backend = new NgramBackend();
		await backend.usePrior(vehicles);
		backend.observe("drive cat");
		assert.equal(await backend.complete("drive ", "ca"), "r", "one learned pair is not enough yet");
		backend.observe("drive cat");
		assert.equal(await backend.complete("drive ", "ca"), "t");
		assert.equal(await backend.complete("feed ", "ca"), "t");
	});

	it("uses the sentence-start pairs wherever the engine starts a run", async () => {
		const backend = new NgramBackend();
		await backend.usePrior(openers);
		assert.equal(await backend.complete("foo ", "th"), "ey", "mid-sentence the unigram level picks `they`");
		for (const before of ["", "It works. ", "foo\n", "Done! "]) {
			assert.equal(await backend.complete(before, "th"), "e", JSON.stringify(before));
		}
	});

	it("uses no web pairs until the prior is fully added", async () => {
		const backend = new NgramBackend();
		const filler: WordCount[] = Array.from({ length: 5_000 }, (_, i) => [`a${String(i).padStart(4, "0")}`, 1]);
		const words: WordCount[] = [...filler, ["car", 50], ["cat", 60], ["drive", 10]];
		// Separate prompts, so no learned pair follows `drive`.
		for (const prompt of ["cat", "cat", "car", "drive"]) backend.observe(prompt);
		const adding = backend.usePrior(priorOf(words, 0, [["drive", [["car", 8]]]]));
		assert.equal(await backend.complete("drive ", "ca"), "t");
		await adding;
		assert.equal(await backend.complete("drive ", "ca"), "r");
	});

	const broken: [name: string, rows: [string, WordCount[]][]][] = [
		["contexts out of order", [["feed", [["cat", 1]]], ["drive", [["car", 1]]]]],
		["words out of order", [["drive", [["cat", 1], ["car", 1]]]]],
		["a word the prior lacks", [["drive", [["bus", 1]]]]],
		["a context the prior lacks", [["ride", [["car", 1]]]]],
	];
	for (const [name, rows] of broken) {
		it(`rejects pairs with ${name} without changing completions`, async () => {
			const backend = new NgramBackend();
			for (let i = 0; i < 2; i++) backend.observe("cart");
			await assert.rejects(backend.usePrior(priorOf(vehicleWords, 0, rows)), /pairs/);
			assert.equal(await backend.complete("drive ", "ca"), "rt");
			await backend.usePrior(vehicles);
			assert.equal(await backend.complete("drive ", "ca"), "r");
		});
	}
});
