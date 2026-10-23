import { CURSOR_MARKER, renderFakeCursor, visibleWidth } from "@earendil-works/pi-tui";

export interface GhostOptions {
	/** Rest of the word to show after the cursor. */
	suffix: string;
	/** Width passed to the editor's render. */
	width: number;
	/** Editor's configured horizontal padding (before pi clamps it to the width). */
	paddingX: number;
	/** Styles ghost text, usually the theme's dim color. */
	style: (text: string) => string;
}

export interface GhostResult {
	lines: string[];
	painted: boolean;
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
export function paintGhost(lines: string[], options: GhostOptions): GhostResult {
	const { suffix, width, style } = options;
	const unchanged = { lines, painted: false };
	if (suffix.length === 0) return unchanged;

	const row = lines.findIndex((line) => line.includes(END_CURSOR));
	if (row === -1) return unchanged;
	const line = lines[row]!;
	const at = line.lastIndexOf(END_CURSOR);
	const tail = line.slice(at + END_CURSOR.length);
	if (!/^ *$/.test(tail)) return unchanged;

	// Same clamp as Editor.render; the right padding is part of the tail.
	const paddingX = Math.min(options.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
	const freeColumns = tail.length - paddingX;
	const extra = visibleWidth(suffix) - 1;
	if (extra > freeColumns) return unchanged;

	const first = segmenter.segment(suffix)[Symbol.iterator]().next().value!.segment;
	const rest = suffix.slice(first.length);
	const ghost = renderFakeCursor(style(first)) + (rest ? style(rest) : "");
	const painted = [...lines];
	painted[row] = line.slice(0, at) + CURSOR_MARKER + ghost + " ".repeat(tail.length - extra);
	return { lines: painted, painted: true };
}
