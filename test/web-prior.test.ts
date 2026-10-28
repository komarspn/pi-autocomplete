import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { NgramBackend, type NgramSnapshot, type WordCount } from "../src/ngram-backend.ts";
import { loadWebPrior, type WebPrior } from "../src/web-prior.ts";

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
	return { unigrams: byFirst(snapshot.unigrams), bigrams: table(snapshot.bigrams), trigrams: table(snapshot.trigrams) };
}

function priorFile(name: string, content: Buffer): string {
	const path = join(root, name);
	writeFileSync(path, content);
	return path;
}

describe("loadWebPrior", () => {
	it("loads the shipped prior, sorted by word", () => {
		assert.ok(shipped.length > 100_000);
		const words = shipped.map(([word]) => word);
		assert.deepEqual(words, [...new Set(words)].sort(), "sorted, each word once");
	});

	it("reads word and count lines", async () => {
		const path = priorFile("small.tsv.gz", gzipSync("ant\t5\nbee\t7\n"));
		assert.deepEqual(await loadWebPrior(path), [["ant", 5], ["bee", 7]]);
	});

	const broken: [name: string, content: Buffer][] = [
		["missing", Buffer.alloc(0)],
		["not gzip", Buffer.from("ant\t5\n")],
		["cut short", gzipSync("ant\t5\nbee\t7\n".repeat(50)).subarray(0, 40)],
		["missing a count", gzipSync("ant\t5\nbee\n")],
		["holding a bad count", gzipSync("ant\t5\nbee\t-7\n")],
		["out of order", gzipSync("bee\t7\nant\t5\n")],
		["empty", gzipSync("")],
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
		const backend = new NgramBackend();
		await backend.usePrior(shipped);
		assert.equal(await backend.complete("", "ver"), "y");
		for (let i = 0; i < 12; i++) backend.observe("bump the version");
		assert.equal(await backend.complete("", "ver"), "sion");
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
		for (const word of ["zoo", "dog", "cow", "aardvark"]) backend.observe(word);
		await backend.usePrior([["ant", 1], ["bee", 1], ["cow", 1], ["cup", 1], ["eel", 1]]);
		const expected: [prefix: string, suffix: string][] = [
			["aa", "rdvark"], ["an", "t"], ["b", "ee"], ["co", "w"], ["cu", "p"], ["d", "og"], ["e", "el"], ["z", "oo"],
		];
		for (const [prefix, suffix] of expected) assert.equal(await backend.complete("", prefix), suffix, prefix);
	});

	it("rejects an unsorted prior and a second prior without changing completions", async () => {
		const backend = new NgramBackend();
		backend.observe("zoo");
		await assert.rejects(backend.usePrior([["bee", 1], ["ant", 1]]), /not sorted/);
		assert.equal(await backend.complete("", "a"), null);
		await backend.usePrior([["ant", 1]]);
		await assert.rejects(backend.usePrior([["bee", 1]]), /already in use/);
		assert.equal(await backend.complete("", "b"), null);
	});

	it("counts each word once when counts are learned and restored while the prior is added", async () => {
		// 25,000 equal words and one that holds 5,000 shares: it shows for "a" at a posterior of 0.167.
		// Counting words the prior added before a restore twice drops it below 0.15.
		const prior: WordCount[] = Array.from({ length: 25_000 }, (_, i) => [`a${String(i).padStart(5, "0")}`, 1]);
		prior[20_000] = ["a20000", 5_000];
		const backend = new NgramBackend();
		let isDone = false;
		const adding = backend.usePrior(prior).then(() => (isDone = true));
		assert.equal(await backend.complete("", "a2000"), null, "no prior before it resolves");
		// Between every slice, so some restores land after prior words got ids.
		while (!isDone) {
			backend.restore({ unigrams: [["zygomorphic", 1]], bigrams: [], trigrams: [] });
			backend.observe("quixotic");
			await new Promise((resolve) => setImmediate(resolve));
		}
		await adding;
		assert.equal(await backend.complete("", "a"), "20000");
		assert.equal(await backend.complete("", "zygo"), "morphic");
		assert.equal(await backend.complete("", "quix"), "otic");
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
		backend.observe("please look at the zygomorphic flower");
		assert.equal(await backend.complete("", "zygo"), "morphic");
		assert.equal(await backend.complete("", "becau"), null);
	});
});
