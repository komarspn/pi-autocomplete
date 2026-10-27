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

/** The whole word of the last returned ghost, and the context it was for. */
interface ShownWord {
	before: string;
	word: string;
}

/** The request in flight, and the backend generation it was sent to. */
interface ActiveRequest {
	key: string;
	generation: number;
}

/** The last buildQuery input and its result. */
interface QueryMemo {
	lines: readonly string[];
	cursorLine: number;
	cursorCol: number;
	query: Query | undefined;
}

/** What the last getWordCompletion call returned, and for which query key. */
interface Displayed {
	key: string;
	suffix: string | null;
}

const MAX_BEFORE = 2000;
// Same cap as omp. Clearing the whole map at the cap is cheaper than LRU and loses only recent misses.
const MAX_CACHE = 256;
const WORD_AT_END = /[\p{L}\p{M}']+$/u;

/**
 * Sync bridge between the editor's render and an async backend. A miss returns null at once,
 * asks the backend, and calls `onUpdate` when a suffix arrives so the editor can repaint.
 * Without a backend, word completion is off: no ghost and no requests.
 */
export class WordCompletionProvider {
	private readonly cache = new Map<string, string | null>();
	private active: ActiveRequest | undefined;
	private queued: Query | undefined;
	private lastShown: ShownWord | undefined;
	private displayed: Displayed | undefined;
	private memo: QueryMemo | undefined;
	// Bumped on each backend change so answers from the old backend are dropped.
	private generation = 0;
	private readonly prose = new ProseSource();

	private backend: WordPredictionBackend | undefined;
	private readonly onUpdate: () => void;

	constructor(backend: WordPredictionBackend | undefined, onUpdate: () => void) {
		this.backend = backend;
		this.onUpdate = onUpdate;
	}

	/**
	 * Switches to another backend, or turns word completion off with undefined. Answers still in flight
	 * from the old one are neither cached nor shown, and a request in flight still holds the single slot until it settles.
	 */
	setBackend(backend: WordPredictionBackend | undefined): void {
		this.backend = backend;
		this.reset();
	}

	/**
	 * Forgets every answer, for when the backend has learned something new. Answers still in flight
	 * are neither cached nor shown.
	 */
	reset(): void {
		this.generation++;
		this.cache.clear();
		this.queued = undefined;
		this.lastShown = undefined;
		this.displayed = undefined;
	}

	getWordCompletion(lines: readonly string[], cursorLine: number, cursorCol: number): string | null {
		const query = this.backend && this.query(lines, cursorLine, cursorCol);
		if (!query) {
			this.displayed = undefined;
			return null;
		}
		if (!this.cache.has(query.key)) this.request(query);
		const suffix = this.suggest(query);
		if (suffix) this.lastShown = { before: query.before, word: query.prefix + suffix };
		this.displayed = { key: query.key, suffix };
		return suffix;
	}

	wordCompletionFeedback(
		lines: readonly string[],
		cursorLine: number,
		cursorCol: number,
		suggestion: string,
		accepted: boolean,
	): void {
		// A rejected word must not come back through projection.
		if (!accepted) this.lastShown = undefined;
		const query = this.query(lines, cursorLine, cursorCol);
		if (query) this.backend?.feedback(query.before, query.prefix, suggestion, accepted);
	}

	/** buildQuery, memoized on the last input because render asks again every frame. */
	private query(lines: readonly string[], cursorLine: number, cursorCol: number): Query | undefined {
		const memo = this.memo;
		if (memo && memo.cursorLine === cursorLine && memo.cursorCol === cursorCol && sameLines(memo.lines, lines)) {
			return memo.query;
		}
		const query = buildQuery(lines, cursorLine, cursorCol, this.prose);
		// Copy: the editor mutates its lines array in place.
		this.memo = { lines: [...lines], cursorLine, cursorCol, query };
		return query;
	}

	/** The cached answer. A null or missing one falls back to the shown word, so typing through a ghost never blanks it. */
	private suggest(query: Query): string | null {
		return this.cache.get(query.key) ?? this.project(query) ?? null;
	}

	/** The rest of the last shown word when the user has typed more of it in the same context. */
	private project(query: Query): string | undefined {
		const shown = this.lastShown;
		if (!shown || shown.before !== query.before || shown.word.length <= query.prefix.length) return undefined;
		const typed = shown.word.slice(0, query.prefix.length);
		if (typed.toLowerCase() !== query.prefix.toLowerCase()) return undefined;
		return shown.word.slice(query.prefix.length);
	}

	/** Keeps one request in flight. A newer miss replaces the queued one, so fast typing sends the first and latest. */
	private request(query: Query): void {
		const active = this.active;
		if (active?.key === query.key && active.generation === this.generation) return;
		if (active) this.queued = query;
		else this.run(query);
	}

	private run(query: Query): void {
		const backend = this.backend;
		if (!backend) return;
		const generation = this.generation;
		this.active = { key: query.key, generation };
		void backend.complete(query.before, query.prefix).then((suffix) => {
			this.active = undefined;
			const isCurrent = generation === this.generation;
			if (isCurrent) {
				if (this.cache.size >= MAX_CACHE) this.cache.clear();
				// `||` on purpose: an empty suffix completes nothing, so cache it as null like a miss.
				this.cache.set(query.key, suffix || null);
			}
			// Start the queued query before the repaint, so a render inside onUpdate finds it in flight.
			const next = this.queued;
			this.queued = undefined;
			if (next && !this.cache.has(next.key)) this.run(next);
			const displayed = this.displayed;
			if (isCurrent && displayed?.key === query.key && this.suggest(query) !== displayed.suffix) this.onUpdate();
		});
	}
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((line, i) => line === b[i]);
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
