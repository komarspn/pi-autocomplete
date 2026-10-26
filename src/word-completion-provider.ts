import { maskNonProse } from "./mask-non-prose.ts";
import { isProseWord, ProseSource } from "./prose-gate.ts";

/** Async word source behind the provider. `complete` never rejects; `feedback` is fire-and-forget. */
export interface WordPredictionBackend {
	/** Resolves to the rest of the word after `prefix`, or null. */
	complete(before: string, prefix: string): Promise<string | null>;
	/** Reports whether the user accepted `suggestion` for `prefix`. Returns at once and must not throw. */
	feedback(before: string, prefix: string, suggestion: string, accepted: boolean): void;
}

interface Query {
	key: string;
	before: string;
	prefix: string;
}

const MAX_BEFORE = 2000;
const WORD_AT_END = /[\p{L}\p{M}']+$/u;

/**
 * Sync bridge between the editor's render and an async backend. A miss returns null at once,
 * asks the backend, and calls `onUpdate` when a suffix arrives so the editor can repaint.
 */
export class WordCompletionProvider {
	private readonly cache = new Map<string, string | null>();
	private readonly pending = new Set<string>();
	private readonly prose = new ProseSource();

	private readonly backend: WordPredictionBackend;
	private readonly onUpdate: () => void;

	constructor(backend: WordPredictionBackend, onUpdate: () => void) {
		this.backend = backend;
		this.onUpdate = onUpdate;
	}

	getWordCompletion(lines: readonly string[], cursorLine: number, cursorCol: number): string | null {
		const query = buildQuery(lines, cursorLine, cursorCol, this.prose);
		if (!query) return null;
		if (this.cache.has(query.key)) return this.cache.get(query.key) ?? null;
		this.request(query);
		return null;
	}

	wordCompletionFeedback(
		lines: readonly string[],
		cursorLine: number,
		cursorCol: number,
		suggestion: string,
		accepted: boolean,
	): void {
		const query = buildQuery(lines, cursorLine, cursorCol, this.prose);
		if (query) this.backend.feedback(query.before, query.prefix, suggestion, accepted);
	}

	private request(query: Query): void {
		if (this.pending.has(query.key)) return;
		this.pending.add(query.key);
		void this.backend.complete(query.before, query.prefix).then((suffix) => {
			this.pending.delete(query.key);
			// `||` on purpose: an empty suffix completes nothing, so cache it as null like a miss.
			this.cache.set(query.key, suffix || null);
			if (suffix) this.onUpdate();
		});
	}
}

/** The query for the prose word ending at the cursor, or undefined when no ghost applies. */
function buildQuery(
	lines: readonly string[],
	cursorLine: number,
	cursorCol: number,
	prose: ProseSource,
): Query | undefined {
	const line = lines[cursorLine];
	if (line === undefined || cursorCol !== line.length) return undefined;
	const prefix = WORD_AT_END.exec(line)?.[0];
	if (!prefix) return undefined;
	const start = line.length - prefix.length;
	if (!isProseWord(line, maskNonProse(line), start, cursorCol)) return undefined;
	if (!prose.isProse(lines, cursorLine, start, cursorCol)) return undefined;
	const before = textBefore(lines, cursorLine, start);
	return { key: `${prefix}\0${before}`, before, prefix };
}

// Ported from oh-my-pi packages/tui/src/prompt/word-completion.ts at commit 0b5c27ab.
// MIT License. Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük,
// Copyright (c) 2026 Stencil Labs, Inc.
/** Editor text before the word starting at `start`, cut to its last MAX_BEFORE UTF-16 units. */
function textBefore(lines: readonly string[], cursorLine: number, start: number): string {
	const head = (lines[cursorLine] ?? "").slice(0, start);
	// Find the first line the capped tail reaches, then join once.
	let length = head.length;
	let first = cursorLine;
	while (first > 0 && length < MAX_BEFORE) {
		first--;
		length += (lines[first] ?? "").length + 1;
	}
	const text = [...lines.slice(first, cursorLine), head].join("\n");
	if (text.length <= MAX_BEFORE) return text;
	let cut = text.length - MAX_BEFORE;
	// Never start on the low half of a surrogate pair.
	const unit = text.charCodeAt(cut);
	if (unit >= 0xdc00 && unit <= 0xdfff) cut++;
	return text.slice(cut);
}
