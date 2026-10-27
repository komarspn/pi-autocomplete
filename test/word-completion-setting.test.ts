import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadMethod, resolveMethod, saveMethod } from "../src/word-completion-setting.ts";

describe("word completion setting", () => {
	let dir = "";
	let path = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "word-completion-setting-"));
		path = join(dir, "word-completion", "settings.json");
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("resolves auto to ngram and off to no engine", () => {
		assert.equal(resolveMethod("auto"), "ngram");
		assert.equal(resolveMethod("ngram"), "ngram");
		assert.equal(resolveMethod("off"), undefined);
	});

	it("defaults to auto when nothing is saved", () => {
		assert.equal(loadMethod(path), "auto");
	});

	it("reads back the saved method", () => {
		saveMethod(path, "off");
		assert.equal(loadMethod(path), "off");
		saveMethod(path, "ngram");
		assert.equal(loadMethod(path), "ngram");
		assert.deepEqual(readdirSync(join(dir, "word-completion")), ["settings.json"], "no temp file left");
	});

	it("falls back to auto for a corrupt file or an unknown method", () => {
		saveMethod(path, "off");
		writeFileSync(path, "{not json");
		assert.equal(loadMethod(path), "auto");
		writeFileSync(path, JSON.stringify({ method: "smollm" }));
		assert.equal(loadMethod(path), "auto");
		writeFileSync(path, "null");
		assert.equal(loadMethod(path), "auto");
	});
});
