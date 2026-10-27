import { CURSOR_MARKER, renderFakeCursor, visibleWidth } from "@earendil-works/pi-tui";

/** Editor render geometry needed to find free columns after the cursor. */
export interface RenderGeometry {
	/** Width passed to the editor's render. */
	width: number;
	/** Editor's configured horizontal padding (before pi clamps it to the width). */
	paddingX: number;
}

/** Inputs for painting a ghost into one editor render. */
export interface GhostOptions extends RenderGeometry {
	/** Rest of the word to show after the cursor. */
	suffix: string;
	/** Styles ghost text, usually the theme's dim color. */
	style: (text: string) => string;
}

/** Lines after painting, and whether a ghost was painted into them. */
export interface GhostResult {
	/** A fresh array the caller owns, painted or not. */
	lines: string[];
	/** True when the ghost was painted. */
	painted: boolean;
}

/** The rendered line holding a focused end-of-line cursor. */
interface EndCursor {
	row: number;
	line: string;
	/** Index of the cursor marker in `line`. */
	at: number;
	/** Padding spaces after the cursor cell, right padding included. */
	tail: string;
	/** Columns between the cursor cell and the right padding. */
	freeColumns: number;
}

// pi's Editor.render emits exactly this when the focused cursor sits at the end of a line,
// followed only by padding spaces (pi-tui/dist/components/editor.js:455).
const END_CURSOR = CURSOR_MARKER + renderFakeCursor(" ");
const segmenter = new Intl.Segmenter();

/**
 * Paints ghost text into rendered editor lines. The fake cursor moves onto the first ghost
 * character and the padding shrinks by the extra width, so the line keeps its exact width.
 * Leaves the lines untouched when there is no focused end-of-line cursor or the ghost would
 * overflow the content width.
 */
export function paintGhost(lines: readonly string[], options: GhostOptions): GhostResult {
	const { suffix, style } = options;
	const unchanged = { lines: [...lines], painted: false };
	if (suffix.length === 0) return unchanged;

	const cursor = findEndCursor(lines, options);
	if (!cursor) return unchanged;
	const extra = visibleWidth(suffix) - 1;
	if (extra > cursor.freeColumns) return unchanged;

	const first = segmenter.segment(suffix)[Symbol.iterator]().next().value?.segment;
	if (first === undefined) return unchanged;
	const rest = suffix.slice(first.length);
	const ghost = renderFakeCursor(style(first)) + (rest ? style(rest) : "");
	const painted = [...lines];
	painted[cursor.row] = cursor.line.slice(0, cursor.at) + CURSOR_MARKER + ghost + " ".repeat(cursor.tail.length - extra);
	return { lines: painted, painted: true };
}

/**
 * Paints one space before the end-of-line cursor, as if it were typed, and keeps the line width.
 * Leaves the lines untouched when there is no focused end-of-line cursor or no free column.
 */
export function paintSpace(lines: readonly string[], options: RenderGeometry): GhostResult {
	const unchanged = { lines: [...lines], painted: false };
	const cursor = findEndCursor(lines, options);
	if (!cursor || cursor.freeColumns < 1) return unchanged;
	const painted = [...lines];
	painted[cursor.row] = `${cursor.line.slice(0, cursor.at)} ${END_CURSOR}${cursor.tail.slice(1)}`;
	return { lines: painted, painted: true };
}

function findEndCursor(lines: readonly string[], options: RenderGeometry): EndCursor | undefined {
	const row = lines.findIndex((line) => line.includes(END_CURSOR));
	if (row === -1) return undefined;
	const line = lines[row]!;
	const at = line.lastIndexOf(END_CURSOR);
	const tail = line.slice(at + END_CURSOR.length);
	if (!/^ *$/.test(tail)) return undefined;

	// Same clamp as Editor.render; the right padding is part of the tail.
	const paddingX = Math.min(options.paddingX, Math.max(0, Math.floor((options.width - 1) / 2)));
	return { row, line, at, tail, freeColumns: tail.length - paddingX };
}
