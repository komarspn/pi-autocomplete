import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NgramBackend } from "../src/ngram-backend.ts";
import { NgramStore } from "../src/ngram-store.ts";
import { loadWebPrior } from "../src/web-prior.ts";

let root: string;
let sessions: string;
let snapshotPath: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ngram-store-"));
	sessions = join(root, "sessions");
	mkdirSync(join(sessions, "--project--"), { recursive: true });
	snapshotPath = join(root, "word-completion", "ngram.json");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

let clock = 1_000;

/** A session JSONL line holding a message with the given role and content. */
function messageLine(role: string, content: unknown, timestamp = clock++): string {
	const message = { role, content, timestamp };
	const entry = { type: "message", id: "a1b2c3d4", parentId: null, timestamp: "2026-10-27T10:00:00.000Z", message };
	return `${JSON.stringify(entry)}\n`;
}

function userLine(text: string, timestamp?: number): string {
	return messageLine("user", text, timestamp);
}

function sessionFile(name = "s1.jsonl"): string {
	return join(sessions, "--project--", name);
}

function writeSession(lines: readonly string[], file = sessionFile()): string {
	appendFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "uuid", timestamp: "", cwd: "/project" })}\n`);
	for (const line of lines) appendFileSync(file, line);
	return file;
}

async function openStore(backend = new NgramBackend()) {
	const store = new NgramStore(backend, snapshotPath);
	await store.open([sessions]);
	return { store, backend };
}

describe("NgramStore", () => {
	it("bootstraps from user messages whose content is a string or an array of parts", async () => {
		writeSession([
			userLine("please look at the zygomorphic flower"),
			messageLine("user", [
				{ type: "text", text: "then check the floriculture notes" },
				{ type: "image", data: "", mimeType: "image/png" },
			]),
		]);
		const { store, backend } = await openStore();
		assert.equal(await backend.complete("a ", "zygo"), "morphic");
		assert.equal(await backend.complete("a ", "flori"), "culture");
		store.close();
	});

	it("learns only what the user typed", async () => {
		const skill = [
			"<skill name=\"review\" location=\"/skills/review/SKILL.md\">",
			"References are relative to /skills/review.",
			"",
			"Check the zygomorphic parts.",
			"</skill>",
		].join("\n");
		writeSession([
			userLine(`${skill}\n\nand quixotic ones`),
			messageLine("user", [{ type: "text", text: skill }]),
			userLine("/compact keep the vexillology part"),
			messageLine("user", [{ type: "text", text: "/compact" }, { type: "text", text: "keep the bibliophile part" }]),
			messageLine("assistant", [{ type: "text", text: "the jabberwock replied" }]),
			messageLine("toolResult", [{ type: "text", text: '{"role":"user","content":"xylograph"}' }]),
			`${JSON.stringify({ type: "custom_message", customType: "note", content: "floriculture" })}\n`,
			userLine("please read the pamphlet"),
		]);
		const { store, backend } = await openStore();
		store.close();
		assert.equal(await backend.complete("a ", "pamph"), "let");
		for (const prefix of ["zygo", "quix", "vexi", "bibl", "jabb", "xylo", "flori"]) {
			assert.equal(await backend.complete("", prefix), null, prefix);
		}
	});

	it("keeps words learned in one run for the next run", async () => {
		const first = await openStore();
		first.store.observe("please look at the zygomorphic flower");
		first.store.close();

		const second = await openStore();
		assert.equal(await second.backend.complete("a ", "zygo"), "morphic");
		second.store.close();
	});

	it("does not save the web prior in the snapshot", async () => {
		const prior = await loadWebPrior();
		assert.ok(prior);
		const backend = new NgramBackend();
		await backend.usePrior(prior);
		const { store } = await openStore(backend);
		store.observe("please look at the zygomorphic flower");
		store.close();
		// The prior's 150,000 words would take megabytes. One prompt takes a few hundred bytes.
		assert.ok(statSync(snapshotPath).size < 2_000, `${statSync(snapshotPath).size} bytes`);
	});

	it("saves 5 minutes after the last change, and at most 15 minutes after the first unsaved one", async (t) => {
		const { store } = await openStore();
		t.after(() => store.close());
		t.mock.timers.enable({ apis: ["setTimeout"] });
		// Words in the saved snapshot. The reading store is not closed, so it never saves over the file.
		const savedWords = async () => {
			const { backend } = await openStore();
			const words = await Promise.all(["zygo", "flori", "vexi"].map((prefix) => backend.complete("", prefix)));
			return words.filter((word) => word !== null);
		};
		store.observe("zygomorphic");
		t.mock.timers.tick(4 * 60_000);
		store.observe("floriculture");
		t.mock.timers.tick(4 * 60_000);
		assert.deepEqual(await savedWords(), []);
		t.mock.timers.tick(60_000);
		assert.deepEqual(await savedWords(), ["morphic", "culture"]);

		for (let minute = 0; minute < 15; minute++) {
			store.observe("vexillology");
			t.mock.timers.tick(60_000);
		}
		assert.deepEqual(await savedWords(), ["morphic", "culture", "llology"]);
	});

	it("ingests nothing on a second pass and only new messages after that", async () => {
		const file = writeSession([userLine("please look at the zygomorphic flower")]);
		const first = await openStore();
		first.store.close();
		const learned = first.backend.snapshot();

		const second = await openStore();
		second.store.close();
		assert.deepEqual(second.backend.snapshot(), learned);

		appendFileSync(file, userLine("floriculture"));
		writeSession([userLine("vexillology")], sessionFile("s2.jsonl"));
		const third = await openStore();
		third.store.close();
		const expected = new NgramBackend();
		for (const text of ["please look at the zygomorphic flower", "floriculture", "vexillology"]) expected.observe(text);
		assert.deepEqual(sortedSnapshot(third.backend), sortedSnapshot(expected));
	});

	it("does not count a live prompt again when it shows up in the session file", async () => {
		const file = writeSession([userLine("open the pull request")]);
		const first = await openStore();
		const prompt = "please look at the zygomorphic flower";
		first.store.observe(prompt);
		// pi tells extensions about the user message, then appends it to the session file.
		const timestamp = clock++;
		first.store.markSeen(timestamp);
		appendFileSync(file, userLine(prompt, timestamp));
		first.store.close();

		const second = await openStore();
		second.store.close();
		const expected = new NgramBackend();
		for (const text of ["open the pull request", prompt]) expected.observe(text);
		assert.deepEqual(sortedSnapshot(second.backend), sortedSnapshot(expected));
	});

	const snapshotWith = (unigrams: unknown) =>
		JSON.stringify({ version: 1, ngram: { unigrams, bigrams: [], trigrams: [] }, offsets: {}, learned: [] });
	for (const [name, content] of [
		["corrupt", "{\"version\":1,\"ngram\":{\"unigr"],
		["incompatible", JSON.stringify({ version: 0, ngram: { unigrams: [["stale", 1]] }, cursors: {} })],
		["malformed", snapshotWith([["zygomorphic", -1]])],
		["overflowing", snapshotWith([["zygomorphic", 1e308], ["zygote", 1e308]])],
	] as const) {
		it(`rebuilds from the sessions when the snapshot is ${name}`, async () => {
			writeSession([userLine("please look at the zygomorphic flower")]);
			mkdirSync(join(root, "word-completion"), { recursive: true });
			writeFileSync(snapshotPath, content);
			const first = await openStore();
			first.store.close();
			assert.equal(await first.backend.complete("a ", "zygo"), "morphic");

			const second = await openStore();
			second.store.close();
			assert.deepEqual(second.backend.snapshot(), first.backend.snapshot());
		});
	}

	it("counts a prompt submitted while the sessions are still being read once, and older ones too", async () => {
		const file = writeSession([userLine("open the pull request")]);
		const backend = new NgramBackend();
		const store = new NgramStore(backend, snapshotPath);
		const opening = store.open([sessions]);
		const prompt = "please look at the zygomorphic flower";
		store.observe(prompt);
		const timestamp = clock++;
		store.markSeen(timestamp);
		appendFileSync(file, userLine(prompt, timestamp));
		await opening;
		store.close();

		const expected = new NgramBackend();
		for (const text of ["open the pull request", prompt]) expected.observe(text);
		assert.deepEqual(sortedSnapshot(backend), sortedSnapshot(expected));
		const reopened = await openStore();
		reopened.store.close();
		assert.deepEqual(sortedSnapshot(reopened.backend), sortedSnapshot(expected));
	});

	it("does not count the history pi copies into a forked session again", async () => {
		const lines = [userLine("please look at the zygomorphic flower")];
		writeSession(lines);
		const first = await openStore();
		first.store.close();
		const learned = first.backend.snapshot();

		writeSession([...lines, userLine("floriculture")], sessionFile("fork.jsonl"));
		const second = await openStore();
		second.store.close();
		const expected = new NgramBackend();
		for (const text of ["please look at the zygomorphic flower", "floriculture"]) expected.observe(text);
		assert.notDeepEqual(second.backend.snapshot(), learned);
		assert.deepEqual(sortedSnapshot(second.backend), sortedSnapshot(expected));
	});

	it("learns a message appended with an older timestamp than one already read", async () => {
		// pi stamps a follow-up when it is queued, so a steer sent later can be written first.
		const file = writeSession([userLine("please look at the zygomorphic flower", 500)]);
		const first = await openStore();
		first.store.close();

		appendFileSync(file, userLine("floriculture", 400));
		const second = await openStore();
		second.store.close();
		assert.equal(await second.backend.complete("", "flori"), "culture");
	});

	it("reads a line pi is still writing only once it is complete", async () => {
		const file = writeSession([]);
		const line = userLine("floriculture");
		appendFileSync(file, line.slice(0, 20));
		const first = await openStore();
		first.store.close();
		assert.equal(await first.backend.complete("", "flori"), null);

		appendFileSync(file, line.slice(20));
		const second = await openStore();
		second.store.close();
		assert.equal(await second.backend.complete("", "flori"), "culture");
	});

	it("seeds once, and not again after a restart", async () => {
		let reads = 0;
		const read = async () => {
			reads++;
			return ["please look at the zygomorphic flower"];
		};
		const first = await openStore();
		assert.equal(await first.store.seed(read), true);
		assert.equal(await first.store.seed(read), false);
		first.store.close();
		assert.equal(await first.backend.complete("a ", "zygo"), "morphic");

		const second = await openStore();
		assert.equal(await second.store.seed(read), false);
		second.store.close();
		assert.equal(reads, 1);
		assert.deepEqual(second.backend.snapshot(), first.backend.snapshot());
	});

	it("seeds again when the snapshot is rebuilt, because its counts are gone", async () => {
		const read = async () => ["please look at the zygomorphic flower"];
		const first = await openStore();
		await first.store.seed(read);
		first.store.close();
		writeFileSync(snapshotPath, "{oops");

		const second = await openStore();
		assert.equal(await second.store.seed(read), true);
		second.store.close();
		assert.deepEqual(second.backend.snapshot(), first.backend.snapshot());
	});

	it("seeds on the next run when closed while reading the history", async () => {
		const first = await openStore();
		// An unsaved change, so close saves while the history is still being read.
		first.store.observe("open the pull request");
		let finish: (prompts: string[]) => void = () => {};
		const seeding = first.store.seed(() => new Promise((resolve) => (finish = resolve)));
		first.store.close();
		finish(["zygomorphic"]);
		assert.equal(await seeding, false);

		const second = await openStore();
		assert.equal(await second.store.seed(async () => ["zygomorphic"]), true);
		second.store.close();
		assert.equal(await second.backend.complete("", "zygo"), "morphic");
	});

	it("does not seed before the snapshot is loaded or after closing", async () => {
		let reads = 0;
		const read = async () => {
			reads++;
			return ["zygomorphic"];
		};
		const unopened = new NgramStore(new NgramBackend(), snapshotPath);
		assert.equal(await unopened.seed(read), false);
		const { store } = await openStore();
		store.close();
		assert.equal(await store.seed(read), false);
		assert.equal(reads, 0);
	});
});

/** A backend's snapshot in a fixed order, to compare backends that learned the same text in different orders. */
function sortedSnapshot(backend: NgramBackend) {
	const snapshot = backend.snapshot();
	const byKey = <T extends [string, unknown]>(rows: T[]) => rows.sort(([a], [b]) => (a < b ? -1 : 1));
	const table = (rows: [string, [string, number][]][]) => byKey(rows.map(([context, counts]) => [context, byKey(counts)]));
	return { unigrams: byKey(snapshot.unigrams), bigrams: table(snapshot.bigrams), trigrams: table(snapshot.trigrams) };
}
