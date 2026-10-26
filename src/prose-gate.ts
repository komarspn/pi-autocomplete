// Ported from oh-my-pi packages/tui/src/prompt/prose-gate.ts at commit 0b5c27ab.
// MIT License. Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük,
// Copyright (c) 2026 Stencil Labs, Inc.

import { maskNonProse } from "./mask-non-prose.ts";

const CODEISH_CHARACTERS = "\\/@_=:{}[]<>";
const CAMEL_CASE = /\p{Ll}\p{Lu}/u;
const DIGIT = /\d/;
/** Buffers above this many UTF-16 units get no prose assistance. */
const MAX_PROSE_BUFFER_LENGTH = 20_000;
/** Lines above this many UTF-16 units get no prose assistance. */
const MAX_PROSE_LINE_LENGTH = 1_000;

/** The whitespace-delimited token around `text[start, end)`. */
function tokenAt(text: string, start: number, end: number): string {
	let tokenStart = start;
	while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1] ?? "")) tokenStart--;
	let tokenEnd = end;
	while (tokenEnd < text.length && !/\s/.test(text[tokenEnd] ?? "")) tokenEnd++;
	return text.slice(tokenStart, tokenEnd);
}

/**
 * True when `text[start, end)` is a prose word: unmasked in `masked`, not part of a path- or
 * identifier-like token, and not on a slash-command or `->`/`=>` line.
 */
export function isProseWord(text: string, masked: string, start: number, end: number): boolean {
	if (start < 0 || end <= start || end > text.length) return false;
	if (masked.slice(start, end).trim().length === 0) return false;
	const token = tokenAt(text, start, end);
	for (const char of token) {
		if (CODEISH_CHARACTERS.includes(char)) return false;
	}
	if (CAMEL_CASE.test(token) || DIGIT.test(token)) return false;
	return !text.trimStart().startsWith("/") && !text.startsWith("->") && !text.startsWith("=>");
}

/**
 * Whole-buffer prose check that sees fenced code spanning lines. Keeps the mask of the last
 * buffer and recomputes it only when the text changes, so one instance should live across keystrokes.
 */
export class ProseSource {
	private readonly mask: (text: string) => string;
	private text: string | undefined;
	private masked = "";
	private lineOffsets: number[] = [];

	/** `mask` is replaceable for tests. */
	constructor(mask: (text: string) => string = maskNonProse) {
		this.mask = mask;
	}

	/** True when `[startCol, endCol)` of line `line` is prose and the buffer and line are within the caps. */
	isProse(lines: readonly string[], line: number, startCol: number, endCol: number): boolean {
		const text = lines.join("\n");
		if (text.length > MAX_PROSE_BUFFER_LENGTH || startCol < 0 || endCol <= startCol) return false;
		const current = lines[line];
		if (current === undefined || current.length > MAX_PROSE_LINE_LENGTH || endCol > current.length) return false;
		this.prepare(text, lines);
		const offset = this.lineOffsets[line];
		if (offset === undefined) return false;
		if (this.masked.slice(offset + startCol, offset + endCol).trim().length === 0) return false;
		return !this.isInOpenCodeSpan(lines, line, offset + startCol);
	}

	/**
	 * True when a backtick earlier in the paragraph has no closing run yet, so the word is being typed
	 * inside a code span. Closed spans are blank in the mask; an open run stays literal. Code spans end
	 * at a blank line. Not in oh-my-pi, which shows a ghost here.
	 */
	private isInOpenCodeSpan(lines: readonly string[], line: number, end: number): boolean {
		let first = line;
		while (first > 0 && lines[first - 1]?.trim()) first--;
		return this.masked.slice(this.lineOffsets[first], end).includes("`");
	}

	private prepare(text: string, lines: readonly string[]): void {
		if (this.text === text) return;
		this.text = text;
		this.masked = this.mask(text);
		this.lineOffsets = [];
		let offset = 0;
		for (const current of lines) {
			this.lineOffsets.push(offset);
			offset += current.length + 1;
		}
	}
}
