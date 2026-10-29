import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { NgramBackend, NgramSnapshot, WordCount } from "./ngram-backend.ts";
import { listSessionFiles, readSessionPrompts } from "./session-history.ts";

/** What the store writes to disk. */
interface StoreFile {
	version: typeof VERSION;
	ngram: NgramSnapshot;
	/** Bytes read from the start of each session file, keyed by path. Always the end of a complete line. */
	offsets: Record<string, number>;
	/** Timestamps of the user messages already learned, live or read. */
	learned: number[];
	/** True once the counts hold the prompts of other tools' history. Missing in snapshots saved before seeding existed. */
	seeded?: boolean;
}

// Bump when the file shape or the meaning of the counts changes. Older files are then discarded and rebuilt.
// Version 2: a rare misspelling counts as the real word it folds into.
const VERSION = 2;
// Same cadence as omp: save once changes stop for 5 minutes, and never leave a change unsaved past 15.
const IDLE_SAVE_MS = 5 * 60_000;
const MAX_SAVE_MS = 15 * 60_000;

/**
 * Keeps an n-gram backend's learned state across pi runs. The snapshot is a cache: pi's session
 * files hold every prompt. The offsets skip what was read before, and the learned timestamps skip
 * a message seen again: a live prompt pi appends later, or the history pi copies into a fork.
 */
export class NgramStore {
	private readonly backend: NgramBackend;
	private readonly path: string;
	private readonly offsets = new Map<string, number>();
	// A set, not a newest-timestamp mark: pi stamps a follow-up when it is queued, so files are not in timestamp order.
	private readonly learned = new Set<number>();
	// Saving before the snapshot is loaded would replace it with less.
	private isLoaded = false;
	private isSeeded = false;
	// Apart from isSeeded, which is saved: a save during the read must not claim counts not yet learned.
	private isSeeding = false;
	private readonly closing = new AbortController();
	private idleTimer: NodeJS.Timeout | undefined;
	private maxTimer: NodeJS.Timeout | undefined;

	constructor(backend: NgramBackend, path: string) {
		this.backend = backend;
		this.path = path;
	}

	/**
	 * Loads the saved snapshot and learns the user messages added to the session files under
	 * `sessionDirs` since it was saved. Never rejects: unreadable files are skipped.
	 */
	async open(sessionDirs: readonly string[]): Promise<void> {
		const saved = await this.load();
		if (this.isClosed) return;
		if (saved) {
			this.backend.restore(saved.ngram);
			for (const [file, offset] of Object.entries(saved.offsets)) this.offsets.set(file, offset);
			// Adds to the marks made while loading.
			for (const timestamp of saved.learned) this.learned.add(timestamp);
			this.isSeeded = saved.seeded === true;
		}
		this.isLoaded = true;
		for (const file of await listSessionFiles(sessionDirs)) {
			if (this.isClosed) return;
			await this.ingest(file);
		}
	}

	/** Learns a prompt the user just submitted. */
	observe(text: string): void {
		this.backend.observe(text);
		this.changed();
	}

	/**
	 * Records that the user message with `timestamp` needs no learning: it was learned live, or came
	 * from a source that is not learned. Call it before pi appends the message to a session file.
	 */
	markSeen(timestamp: number): void {
		if (this.learned.has(timestamp)) return;
		this.learned.add(timestamp);
		this.changed();
	}

	/**
	 * Learns the prompts `read` returns, unless these counts already hold them. A rebuilt snapshot lost
	 * them, so it is seeded again. Resolves to true when it learned; false before `open` resolves, after
	 * `close`, or when `read` rejects. `read` runs only when seeding goes ahead.
	 */
	async seed(read: () => Promise<readonly string[]>): Promise<boolean> {
		if (!this.isLoaded || this.isClosed || this.isSeeded || this.isSeeding) return false;
		// Set before reading, so a second call made meanwhile does not count the prompts again.
		this.isSeeding = true;
		let prompts: readonly string[];
		try {
			prompts = await read();
		} catch {
			// Nothing was learned, so a later call may try again.
			return false;
		} finally {
			this.isSeeding = false;
		}
		// Closed meanwhile: the saved snapshot says not seeded, so the next run seeds.
		if (this.isClosed) return false;
		for (const prompt of prompts) this.backend.observe(prompt);
		this.isSeeded = true;
		this.changed();
		return true;
	}

	/** Saves unsaved changes and stops reading sessions and saving. Safe to call more than once. */
	close(): void {
		if (this.isClosed) return;
		this.closing.abort();
		if (this.maxTimer) this.save();
	}

	private get isClosed(): boolean {
		return this.closing.signal.aborted;
	}

	/** Starts the save timers for a change: the idle one restarts, the max one keeps its first start. */
	private changed(): void {
		if (this.isClosed) return;
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.save(), IDLE_SAVE_MS);
		this.maxTimer ??= setTimeout(() => this.save(), MAX_SAVE_MS);
		// Pending saves must not keep pi alive; shutdown saves through close.
		this.idleTimer.unref();
		this.maxTimer.unref();
	}

	/** Writes the snapshot to a temp file and renames it over the old one, so a crash never leaves half a file. */
	private save(): void {
		clearTimeout(this.idleTimer);
		clearTimeout(this.maxTimer);
		this.idleTimer = undefined;
		this.maxTimer = undefined;
		if (!this.isLoaded) return;
		const file: StoreFile = {
			version: VERSION,
			ngram: this.backend.snapshot(),
			offsets: Object.fromEntries(this.offsets),
			learned: [...this.learned],
			seeded: this.isSeeded,
		};
		const temp = `${this.path}.${process.pid}.tmp`;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(temp, JSON.stringify(file));
			renameSync(temp, this.path);
		} catch {
			// A failed save loses nothing that matters: the next run reads the sessions past the old offsets.
			rmSync(temp, { force: true });
		}
	}

	/** Learns the user messages added to a session file since its offset. */
	private async ingest(file: string): Promise<void> {
		let size: number;
		try {
			({ size } = await stat(file));
		} catch {
			// Deleted since it was listed: nothing to learn.
			return;
		}
		let start = this.offsets.get(file) ?? 0;
		// A file shorter than its offset was rewritten. Read it again; `learned` skips what was counted.
		if (size < start) start = 0;
		let end: number;
		try {
			end = await readSessionPrompts(file, start, size, this.closing.signal, (prompt, offset) => {
				if (!this.learned.has(prompt.timestamp)) {
					this.backend.observe(prompt.text);
					this.learned.add(prompt.timestamp);
				}
				// Same tick as the counts, so a save between two lines stays consistent.
				this.offsets.set(file, offset);
			});
		} catch {
			// Unreadable now. The offset covers only what was learned, so the next run continues from there.
			end = this.offsets.get(file) ?? start;
		}
		// The lines after the last user message teach nothing, so skipping them is safe at any time.
		this.offsets.set(file, end);
		if (end !== start) this.changed();
	}

	/** The saved file, or undefined when there is none or it cannot be used. */
	private async load(): Promise<StoreFile | undefined> {
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch {
			// No snapshot yet: rebuild from the sessions.
			return undefined;
		}
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch {
			// Corrupt snapshot: rebuild from the sessions, and the next save replaces it.
			return undefined;
		}
		return isStoreFile(value) ? value : undefined;
	}
}

function isStoreFile(value: unknown): value is StoreFile {
	if (!isObject(value) || value.version !== VERSION || !isObject(value.ngram)) return false;
	const { unigrams, folded, bigrams, trigrams } = value.ngram;
	if (!isWordCounts(unigrams) || !isWordCounts(folded)) return false;
	if (!isContextTable(bigrams) || !isContextTable(trigrams)) return false;
	if (!isObject(value.offsets) || !Object.values(value.offsets).every(isCount)) return false;
	if (value.seeded !== undefined && typeof value.seeded !== "boolean") return false;
	return Array.isArray(value.learned) && value.learned.every(isCount);
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isContextTable(value: unknown): value is [string, WordCount[]][] {
	return Array.isArray(value) && value.every(isContextRow);
}

function isContextRow(value: unknown): value is [string, WordCount[]] {
	return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && isWordCounts(value[1]);
}

function isWordCounts(value: unknown): value is WordCount[] {
	return Array.isArray(value) && value.every(isWordCount);
}

function isWordCount(value: unknown): value is WordCount {
	if (!Array.isArray(value) || value.length !== 2) return false;
	const [word, count] = value;
	// Safe integers only: a huge count would overflow the totals and break predictions instead of rebuilding.
	return typeof word === "string" && word !== "" && isCount(count) && count > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
