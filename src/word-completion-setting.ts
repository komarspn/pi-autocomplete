import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Values of the word completion setting, in the order the picker lists them. */
export const WORD_COMPLETION_METHODS = ["off", "auto", "ngram"] as const;

/** The word completion setting: off, or the engine to use. */
export type WordCompletionMethod = (typeof WORD_COMPLETION_METHODS)[number];

/** An engine a method resolves to. */
export type WordCompletionEngine = "ngram";

/** What the setting file holds. */
interface SettingFile {
	method: WordCompletionMethod;
}

const DEFAULT_METHOD: WordCompletionMethod = "auto";

/** True for a value of the word completion setting. */
export function isWordCompletionMethod(value: unknown): value is WordCompletionMethod {
	return WORD_COMPLETION_METHODS.some((method) => method === value);
}

/** The engine for `method`, or undefined for off. `auto` picks the best engine available, which is always ngram. */
export function resolveMethod(method: WordCompletionMethod): WordCompletionEngine | undefined {
	return method === "off" ? undefined : "ngram";
}

/** The method saved at `path`, or `auto` when the file is missing, unreadable or holds no known method. */
export function loadMethod(path: string): WordCompletionMethod {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Missing or corrupt: the default applies, and the next save replaces the file.
		return DEFAULT_METHOD;
	}
	if (typeof parsed !== "object" || parsed === null || !("method" in parsed)) return DEFAULT_METHOD;
	return isWordCompletionMethod(parsed.method) ? parsed.method : DEFAULT_METHOD;
}

/** Saves `method` to `path` through a temp file and a rename, so a crash never leaves half a file. Throws on write errors. */
export function saveMethod(path: string, method: WordCompletionMethod): void {
	const file: SettingFile = { method };
	const temp = `${path}.${process.pid}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(temp, `${JSON.stringify(file)}\n`);
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}
