/** Async word source behind the provider. `complete` never rejects; `feedback` is fire-and-forget. */
export interface WordPredictionBackend {
	/** Resolves to the rest of the word after `prefix`, or null. */
	complete(before: string, prefix: string): Promise<string | null>;
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

	private readonly backend: WordPredictionBackend;
	private readonly onUpdate: () => void;

	constructor(backend: WordPredictionBackend, onUpdate: () => void) {
		this.backend = backend;
		this.onUpdate = onUpdate;
	}

	getWordCompletion(lines: string[], cursorLine: number, cursorCol: number): string | null {
		const query = buildQuery(lines, cursorLine, cursorCol);
		if (!query) return null;
		if (this.cache.has(query.key)) return this.cache.get(query.key) ?? null;
		this.request(query);
		return null;
	}

	wordCompletionFeedback(lines: string[], cursorLine: number, cursorCol: number, suggestion: string, accepted: boolean): void {
		const query = buildQuery(lines, cursorLine, cursorCol);
		if (query) this.backend.feedback(query.before, query.prefix, suggestion, accepted);
	}

	private request(query: Query): void {
		if (this.pending.has(query.key)) return;
		this.pending.add(query.key);
		void this.backend.complete(query.before, query.prefix).then((suffix) => {
			this.pending.delete(query.key);
			this.cache.set(query.key, suffix || null);
			if (suffix) this.onUpdate();
		});
	}
}

function buildQuery(lines: string[], cursorLine: number, cursorCol: number): Query | undefined {
	const line = lines[cursorLine];
	if (line === undefined || cursorCol !== line.length) return undefined;
	const prefix = WORD_AT_END.exec(line)?.[0];
	if (!prefix) return undefined;
	const text = [...lines.slice(0, cursorLine), line.slice(0, line.length - prefix.length)].join("\n");
	const before = text.slice(-MAX_BEFORE);
	return { key: `${prefix}\0${before}`, before, prefix };
}
