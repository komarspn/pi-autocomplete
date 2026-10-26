import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskNonProse } from "../src/mask-non-prose.ts";
import { ProseSource } from "../src/prose-gate.ts";

function countingSource() {
	let masks = 0;
	const source = new ProseSource((text) => {
		masks++;
		return maskNonProse(text);
	});
	return { source, masks: () => masks };
}

describe("ProseSource", () => {
	it("masks the buffer again only when the text changes", () => {
		const t = countingSource();
		const lines = ["say hel"];
		assert.equal(t.source.isProse(lines, 0, 4, 7), true);
		assert.equal(t.source.isProse(lines, 0, 4, 7), true);
		assert.equal(t.source.isProse(["say hel"], 0, 0, 3), true);
		assert.equal(t.masks(), 1);

		assert.equal(t.source.isProse(["say help"], 0, 4, 8), true);
		assert.equal(t.masks(), 2);
	});

	it("rejects a range inside a fenced block that spans lines", () => {
		const source = new ProseSource();
		const lines = ["text", "```", "inside wor", "more cod", "```", "after wor"];
		assert.equal(source.isProse(lines, 2, 7, 10), false);
		assert.equal(source.isProse(lines, 3, 5, 8), false);
		assert.equal(source.isProse(lines, 5, 6, 9), true);
	});

	it("rejects a buffer over 20,000 or a line over 1,000 UTF-16 units", () => {
		const source = new ProseSource();
		const atBufferCap = [`${"a ".repeat(500)}`, "x".repeat(18_995), "wor"];
		assert.equal(atBufferCap.join("\n").length, 20_000);
		assert.equal(source.isProse(atBufferCap, 2, 0, 3), true);
		assert.equal(source.isProse([...atBufferCap.slice(0, 2), "word"], 2, 0, 4), false);

		assert.equal(source.isProse([`${"a".repeat(997)} wo`], 0, 998, 1000), true);
		assert.equal(source.isProse([`${"a".repeat(997)} wor`], 0, 998, 1001), false);
	});
});
