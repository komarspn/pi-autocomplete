import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";

/** A user message read from a session file. */
export interface SessionPrompt {
	/** The message's text parts, joined by newlines. */
	readonly text: string;
	/** The message's own timestamp, in Unix milliseconds. */
	readonly timestamp: number;
}

const NEWLINE = 0x0a;
// Raw marker of a user message line. Inside a JSON string the quotes are escaped, so tool output cannot match it.
const USER_ROLE = Buffer.from('"role":"user"');

/**
 * The session files under each directory: its own `*.jsonl` files and those one level down, which
 * is how pi groups sessions by working directory. Never rejects: missing or unreadable directories are skipped.
 */
export async function listSessionFiles(dirs: readonly string[]): Promise<string[]> {
	const files = new Set<string>();
	for (const dir of dirs) {
		for (const entry of await readdirOrEmpty(dir)) {
			const path = join(dir, entry.name);
			if (entry.isFile() && entry.name.endsWith(".jsonl")) files.add(path);
			else if (entry.isDirectory()) {
				for (const inner of await readdirOrEmpty(path)) {
					if (inner.isFile() && inner.name.endsWith(".jsonl")) files.add(join(path, inner.name));
				}
			}
		}
	}
	return [...files].sort();
}

/**
 * Reads the complete lines of `file` from byte `start` to byte `end` and calls `onPrompt` for each
 * user message, with the byte offset just past its line. Resolves to the offset past the last
 * complete line read, so a line pi is still writing is read next time. Stops early once `signal` aborts.
 * Rejects when the file cannot be read or `onPrompt` throws.
 */
export async function readSessionPrompts(
	file: string,
	start: number,
	end: number,
	signal: AbortSignal,
	onPrompt: (prompt: SessionPrompt, offset: number) => void,
): Promise<number> {
	if (end <= start) return start;
	let offset = start;
	let carry: Buffer[] = [];
	const stream = createReadStream(file, { start, end: end - 1 });
	for await (const chunk of stream) {
		// Leaving the loop closes the stream.
		if (signal.aborted) break;
		if (!Buffer.isBuffer(chunk)) continue;
		let lineStart = 0;
		let newline = chunk.indexOf(NEWLINE);
		while (newline !== -1) {
			const part = chunk.subarray(lineStart, newline);
			const line = carry.length > 0 ? Buffer.concat([...carry, part]) : part;
			carry = [];
			offset += line.length + 1;
			if (line.includes(USER_ROLE)) {
				const prompt = parsePromptLine(line.toString("utf8"));
				if (prompt) onPrompt(prompt, offset);
			}
			lineStart = newline + 1;
			newline = chunk.indexOf(NEWLINE, lineStart);
		}
		if (lineStart < chunk.length) carry.push(chunk.subarray(lineStart));
	}
	return offset;
}

/** The user message on one session line, or undefined for any other line or a message with nothing to learn. */
function parsePromptLine(line: string): SessionPrompt | undefined {
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		// A damaged line teaches nothing; the rest of the file is still readable.
		return undefined;
	}
	if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) return undefined;
	const { role, content, timestamp } = entry.message;
	if (role !== "user" || typeof timestamp !== "number") return undefined;
	// Joined like one typed prompt, so the prose gates see a slash command or code fence whole.
	const text = contentTexts(content).join("\n");
	// pi stores `/skill:name args` expanded. Live learning skips the whole command, so skip the block and its args.
	if (text === "" || parseSkillBlock(text) !== null) return undefined;
	return { text, timestamp };
}

/** The text of a message's content, which is a string or an array of text and image parts. */
function contentTexts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	const texts: string[] = [];
	for (const part of content) {
		if (isObject(part) && part.type === "text" && typeof part.text === "string") texts.push(part.text);
	}
	return texts;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function readdirOrEmpty(dir: string) {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch {
		// No sessions yet, or a directory removed while listing: nothing to read.
		return [];
	}
}
