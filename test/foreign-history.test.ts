import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	foreignHistoryFiles,
	loadSeedingAnswer,
	readForeignPrompts,
	saveSeedingAnswer,
} from "../src/foreign-history.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "foreign-history-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function writeLines(path: string, entries: readonly unknown[]): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, entries.map((entry) => `${typeof entry === "string" ? entry : JSON.stringify(entry)}\n`).join(""));
	return path;
}

describe("foreignHistoryFiles", () => {
	it("uses the home directory, or CLAUDE_CONFIG_DIR and CODEX_HOME when set", () => {
		assert.deepEqual(foreignHistoryFiles({}, "/home/u"), ["/home/u/.claude/history.jsonl", "/home/u/.codex/history.jsonl"]);
		assert.deepEqual(foreignHistoryFiles({ CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x" }, "/home/u"), [
			"/c/history.jsonl",
			"/x/history.jsonl",
		]);
	});
});

describe("readForeignPrompts", () => {
	it("reads Claude Code prompts from display or text, and Codex prompts from text", async () => {
		const claude = writeLines(join(root, ".claude", "history.jsonl"), [
			{ display: "the zygomorphic flower", pastedContents: {}, timestamp: 1, project: "/p" },
			{ text: "an older quixotic entry", timestamp: 2 },
		]);
		const codex = writeLines(join(root, ".codex", "history.jsonl"), [{ session_id: "s", ts: 3, text: "the floriculture notes" }]);
		assert.deepEqual(await readForeignPrompts([claude, codex]), [
			"the zygomorphic flower",
			"an older quixotic entry",
			"the floriculture notes",
		]);
	});

	it("skips missing files, damaged lines and entries with no text", async () => {
		const codex = writeLines(join(root, "history.jsonl"), ["{not json", { ts: 1 }, { text: 42 }, { text: "kept one" }]);
		assert.deepEqual(await readForeignPrompts([join(root, "missing.jsonl"), codex]), ["kept one"]);
	});

	it("skips slash commands and strips Claude Code placeholders", async () => {
		const claude = writeLines(join(root, "history.jsonl"), [
			{ display: "/compact keep the vexillology part" },
			{ display: "  /model" },
			{ display: "[Pasted text #1 +28 lines]" },
			{ display: "look at [Image #2] and [Pasted text #3 +5 lines] then the bibliophile list" },
		]);
		assert.deepEqual(await readForeignPrompts([claude]), ["look at  and  then the bibliophile list"]);
	});
});

describe("seeding answer", () => {
	it("is undefined until saved, then remembers the answer", () => {
		const path = join(root, "word-completion", "foreign-history.json");
		assert.equal(loadSeedingAnswer(path), undefined);
		saveSeedingAnswer(path, "declined");
		assert.equal(loadSeedingAnswer(path), "declined");
		saveSeedingAnswer(path, "accepted");
		assert.equal(loadSeedingAnswer(path), "accepted");
	});

	it("is undefined for a corrupt file", () => {
		const path = join(root, "foreign-history.json");
		writeFileSync(path, "{oops");
		assert.equal(loadSeedingAnswer(path), undefined);
		writeFileSync(path, JSON.stringify({ answer: "maybe" }));
		assert.equal(loadSeedingAnswer(path), undefined);
	});
});
