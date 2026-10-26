// Ported from oh-my-pi packages/tui/src/prompt/markdown-prose.ts at commit 0b5c27ab.
// MIT License. Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük,
// Copyright (c) 2026 Stencil Labs, Inc.

// From oh-my-pi packages/tui/src/render/render-utils.ts: indent up to 3 spaces, then a fence marker.
const FENCE_RE = /^( {0,3})([`~]{3,})/;
// Tag or element name. Sticky so it can probe at an exact offset without slicing.
const TAG_NAME = /[A-Za-z][A-Za-z0-9-]*/y;

/** Index just past the run of backticks beginning at `i`. */
function backtickRunEnd(text: string, i: number, n: number): number {
	let j = i;
	while (j < n && text[j] === "`") j++;
	return j;
}

/**
 * Index just past the closing run of exactly `runLen` backticks, scanning from `from`, or -1.
 * An unmatched run is literal text. Positions already masked (fenced code) are skipped.
 */
function findBacktickClose(text: string, from: number, n: number, runLen: number, masked: Uint8Array): number {
	let k = from;
	while (k < n) {
		if (masked[k]) {
			k++;
			continue;
		}
		if (text[k] === "`") {
			const e = backtickRunEnd(text, k, n);
			if (e - k === runLen) return e;
			k = e;
			continue;
		}
		k++;
	}
	return -1;
}

/**
 * Index of the `>` closing a tag whose attributes begin at `j`, honoring quoted values.
 * Returns -1 when a new `<` comes first or there is no `>`, so the `<` stays literal.
 */
function findTagEnd(text: string, j: number, n: number): number {
	let quote = "";
	for (let k = j; k < n; k++) {
		const ch = text[k];
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") return k;
		if (ch === "<") return -1;
	}
	return -1;
}

/**
 * Index just past the `</name>` that balances an opening `<name>`, counting nested same-name tags,
 * or -1 when the section never closes (callers then mask only the opening tag).
 */
function findMatchingClose(text: string, start: number, n: number, name: string, masked: Uint8Array): number {
	const lname = name.toLowerCase();
	let depth = 1;
	let k = start;
	while (k < n) {
		if (masked[k] || text[k] !== "<") {
			k++;
			continue;
		}
		let m = k + 1;
		let isClose = false;
		if (text[m] === "/") {
			isClose = true;
			m++;
		}
		TAG_NAME.lastIndex = m;
		const nm = TAG_NAME.exec(text);
		if (!nm) {
			k++;
			continue;
		}
		const gt = findTagEnd(text, TAG_NAME.lastIndex, n);
		if (gt < 0) {
			k++;
			continue;
		}
		if (nm[0].toLowerCase() === lname) {
			if (isClose) {
				depth--;
				if (depth === 0) return gt + 1;
			} else if (text[gt - 1] !== "/") {
				depth++;
			}
		}
		k = gt + 1;
	}
	return -1;
}

/**
 * Masks the HTML/XML construct starting with `<` at `i`: a comment, a closing or self-closing tag
 * alone, or an opening tag through its matching close. Returns the index just past the masked
 * region, or `i` when the `<` does not start a tag.
 */
function maskTagAt(text: string, i: number, n: number, masked: Uint8Array): number {
	if (text.startsWith("<!--", i)) {
		const end = text.indexOf("-->", i + 4);
		const stop = end < 0 ? n : end + 3;
		masked.fill(1, i, stop);
		return stop;
	}
	let j = i + 1;
	let closing = false;
	if (text[j] === "/") {
		closing = true;
		j++;
	}
	TAG_NAME.lastIndex = j;
	const nm = TAG_NAME.exec(text);
	if (!nm) return i;
	const gt = findTagEnd(text, TAG_NAME.lastIndex, n);
	if (gt < 0) return i;
	const tagEnd = gt + 1;
	const selfClosing = text[gt - 1] === "/";
	masked.fill(1, i, tagEnd);
	if (closing || selfClosing) return tagEnd;
	const close = findMatchingClose(text, tagEnd, n, nm[0], masked);
	if (close < 0) return tagEnd;
	masked.fill(1, tagEnd, close);
	return close;
}

/** Marks every line of fenced code blocks, fences included. An unclosed fence runs to the end. */
function maskFences(text: string, masked: Uint8Array): void {
	const n = text.length;
	let fenceChar = "";
	let fenceLen = 0;
	let lineStart = 0;
	while (lineStart <= n) {
		let nl = text.indexOf("\n", lineStart);
		if (nl < 0) nl = n;
		const line = text.slice(lineStart, nl);
		const [, indent = "", marker = ""] = FENCE_RE.exec(line) ?? [];
		const info = line.slice(indent.length + marker.length);
		if (fenceChar) {
			masked.fill(1, lineStart, nl);
			// A closing fence is the same char, at least as long, with nothing else on the line.
			if (marker[0] === fenceChar && marker.length >= fenceLen && info.trim() === "") {
				fenceChar = "";
				fenceLen = 0;
			}
		} else if (marker && !(marker[0] === "`" && info.includes("`"))) {
			// A backtick fence's info string may not contain a backtick.
			fenceChar = marker[0] ?? "";
			fenceLen = marker.length;
			masked.fill(1, lineStart, nl);
		}
		if (nl === n) break;
		lineStart = nl + 1;
	}
}

/**
 * Returns a copy of `text` with the same length where fenced code, inline code spans, and HTML/XML
 * tags with their content are blanked to spaces. Newlines are kept. Text with no backtick, `<` or
 * `~~~` is returned unchanged.
 */
export function maskNonProse(text: string): string {
	if (!text.includes("`") && !text.includes("<") && !text.includes("~~~")) return text;
	const n = text.length;
	const masked = new Uint8Array(n);
	maskFences(text, masked);

	// Inline code spans and HTML/XML, outside fenced code.
	let i = 0;
	while (i < n) {
		if (masked[i]) {
			i++;
			continue;
		}
		const c = text[i];
		if (c === "`") {
			const runEnd = backtickRunEnd(text, i, n);
			const close = findBacktickClose(text, runEnd, n, runEnd - i, masked);
			if (close >= 0) masked.fill(1, i, close);
			i = close >= 0 ? close : runEnd;
			continue;
		}
		if (c === "<") {
			const end = maskTagAt(text, i, n, masked);
			i = end > i ? end : i + 1;
			continue;
		}
		i++;
	}

	let out = "";
	for (let p = 0; p < n; p++) out += masked[p] && text[p] !== "\n" ? " " : text[p];
	return out;
}
