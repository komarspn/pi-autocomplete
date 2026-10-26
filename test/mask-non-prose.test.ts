import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskNonProse } from "../src/mask-non-prose.ts";

describe("maskNonProse", () => {
	it("returns text with no backtick, < or ~~~ unchanged", () => {
		const text = "plain prose, with ~ tildes > and ~~ pairs\nsecond line";
		assert.equal(maskNonProse(text), text);
	});

	it("blanks inline code to spaces of the same length", () => {
		assert.equal(maskNonProse("run `npm test` now"), "run            now");
	});

	it("treats an unmatched backtick run as literal text", () => {
		assert.equal(maskNonProse("a ` b"), "a ` b");
	});

	it("blanks a fenced block across lines and keeps the newlines", () => {
		const text = "before\n```ts\nconst x = 1;\n```\nafter";
		assert.equal(maskNonProse(text), "before\n     \n            \n   \nafter");
	});

	it("blanks a tilde fence through the end of the text when unterminated", () => {
		assert.equal(maskNonProse("intro\n~~~\ncode here"), "intro\n   \n         ");
	});

	it("blanks an HTML section with its content, and comments", () => {
		assert.equal(maskNonProse("see <b>bold</b> ok"), "see             ok");
		assert.equal(maskNonProse("x <!-- note --> y"), `x ${" ".repeat(13)} y`);
	});

	it("leaves a stray less-than alone", () => {
		assert.equal(maskNonProse("a < b and c"), "a < b and c");
	});

	it("keeps the length for every input", () => {
		for (const text of ["`a`", "<x>y</x>", "```\nz", "~~~", "<p>unclosed", "a `b` <i>c</i> ```"]) {
			assert.equal(maskNonProse(text).length, text.length, text);
		}
	});
});
