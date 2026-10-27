import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURSOR_MARKER, renderFakeCursor, visibleWidth } from "@earendil-works/pi-tui";
import { paintGhost, paintSpace } from "../src/ghost-text.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const END_CURSOR = CURSOR_MARKER + renderFakeCursor(" ");

// Mirrors the cursor line that pi's Editor.render emits for "hel" at end of line.
function cursorLine(text: string, width: number, paddingX: number): string {
	const contentWidth = width - paddingX * 2;
	const pad = " ".repeat(paddingX);
	return `${pad}${text}${END_CURSOR}${" ".repeat(contentWidth - text.length - 1)}${pad}`;
}

describe("paintGhost", () => {
	it("puts the fake cursor on the first ghost character and dims the rest", () => {
		const lines = ["───", cursorLine("hel", 20, 1), "───"];
		const result = paintGhost(lines, { suffix: "lo", width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, true);
		assert.equal(result.lines[1], ` hel${CURSOR_MARKER}${renderFakeCursor(dim("l"))}${dim("o")}${" ".repeat(13)} `);
	});

	it("keeps the line width exact", () => {
		for (const paddingX of [0, 1, 2]) {
			const line = cursorLine("hel", 20, paddingX);
			const result = paintGhost([line], { suffix: "lo world", width: 20, paddingX, style: dim });
			assert.equal(result.painted, true);
			assert.equal(visibleWidth(result.lines[0]!), 20, `paddingX ${paddingX}`);
		}
	});

	it("counts wide characters by display width", () => {
		const result = paintGhost([cursorLine("a", 10, 0)], { suffix: "日本", width: 10, paddingX: 0, style: dim });
		assert.equal(result.painted, true);
		assert.equal(visibleWidth(result.lines[0]!), 10);
	});

	it("shows a ghost that exactly fills the content width", () => {
		// content width 18, "hel" + cursor leaves 14 spaces; a 15-column suffix fills it.
		const result = paintGhost([cursorLine("hel", 20, 1)], { suffix: "x".repeat(15), width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, true);
		assert.equal(visibleWidth(result.lines[0]!), 20);
	});

	it("hides a ghost that would overflow the content width", () => {
		const line = cursorLine("hel", 20, 1);
		const result = paintGhost([line], { suffix: "x".repeat(16), width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, false);
		assert.deepEqual(result.lines, [line]);
	});

	it("hides the ghost when the cursor already sits in the right padding", () => {
		// pi trims one right-padding column when the end cursor overflows into it.
		const line = ` ${"x".repeat(18)}${END_CURSOR}`;
		const result = paintGhost([line], { suffix: "a", width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, false);
	});

	it("does nothing when the cursor is not at the end of the line", () => {
		const line = ` he${CURSOR_MARKER}${renderFakeCursor("l")}lo${" ".repeat(13)} `;
		const result = paintGhost([line], { suffix: "p", width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, false);
		assert.deepEqual(result.lines, [line]);
	});

	it("does nothing without a cursor marker (editor not focused)", () => {
		const line = ` hel${renderFakeCursor(" ")}${" ".repeat(14)} `;
		const result = paintGhost([line], { suffix: "lo", width: 20, paddingX: 1, style: dim });
		assert.equal(result.painted, false);
	});

	it("does nothing for an empty suffix", () => {
		const line = cursorLine("hel", 20, 1);
		assert.equal(paintGhost([line], { suffix: "", width: 20, paddingX: 1, style: dim }).painted, false);
	});
});

describe("paintSpace", () => {
	it("puts a space before the cursor and keeps the line width exact", () => {
		const result = paintSpace([cursorLine("hello", 20, 1)], { width: 20, paddingX: 1 });
		const [line = ""] = result.lines;
		assert.equal(result.painted, true);
		assert.equal(line, ` hello ${END_CURSOR}${" ".repeat(11)} `);
		assert.equal(visibleWidth(line), 20);
	});

	it("does nothing when no column is free before the right padding", () => {
		// content width 18: 17 characters plus the cursor cell fill it.
		const line = cursorLine("x".repeat(17), 20, 1);
		const result = paintSpace([line], { width: 20, paddingX: 1 });
		assert.equal(result.painted, false);
		assert.deepEqual(result.lines, [line]);
	});
});
