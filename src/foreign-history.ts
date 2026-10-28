import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The user's answer to seeding from Claude Code and Codex history. */
export type SeedingAnswer = "accepted" | "declined";

/** What the answer file holds. */
interface AnswerFile {
	answer: SeedingAnswer;
}

// Claude Code replaces pastes and images in its history with these markers, e.g. `[Pasted text #1 +28 lines]`.
const PLACEHOLDER = /\[(?:Pasted text|Image) #\d+[^\]\n]*\]/g;

/** The prompt history files of Claude Code and Codex, under `home` or their config directory variables. */
export function foreignHistoryFiles(env: NodeJS.ProcessEnv, home: string): string[] {
	// Both tools move their whole config directory with these variables. `||`: an empty one counts as unset.
	return [
		join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "history.jsonl"),
		join(env.CODEX_HOME || join(home, ".codex"), "history.jsonl"),
	];
}

/** The prompts in Claude Code and Codex history files, without slash commands and placeholders. Never rejects. */
export async function readForeignPrompts(files: readonly string[]): Promise<string[]> {
	// Missing or unreadable files are skipped.
	const prompts: string[] = [];
	for (const file of files) {
		let text: string;
		try {
			text = await readFile(file, "utf8");
		} catch {
			// The tool is not installed, or its history was never written: nothing to learn.
			continue;
		}
		for (const line of text.split("\n")) {
			const prompt = parseHistoryLine(line);
			if (prompt !== undefined) prompts.push(prompt);
		}
	}
	return prompts;
}

/** The saved answer at `path`, or undefined when the user was never asked or the file cannot be used. */
export function loadSeedingAnswer(path: string): SeedingAnswer | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Missing or corrupt: the user is asked again, and the answer replaces the file.
		return undefined;
	}
	if (!isObject(parsed)) return undefined;
	return parsed.answer === "accepted" || parsed.answer === "declined" ? parsed.answer : undefined;
}

/** Saves `answer` to `path` through a temp file and a rename, so a crash never leaves half a file. Throws on write errors. */
export function saveSeedingAnswer(path: string, answer: SeedingAnswer): void {
	const file: AnswerFile = { answer };
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

/** The prompt on one history line, or undefined for a damaged line, a slash command or an empty prompt. */
function parseHistoryLine(line: string): string | undefined {
	if (line.trim() === "") return undefined;
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		// A damaged line teaches nothing; the rest of the file is still readable.
		return undefined;
	}
	if (!isObject(entry)) return undefined;
	// Claude Code writes `display`, older versions `text`. Codex writes `text`.
	const raw = typeof entry.display === "string" ? entry.display : entry.text;
	if (typeof raw !== "string" || raw.trimStart().startsWith("/")) return undefined;
	const prompt = raw.replace(PLACEHOLDER, "");
	return prompt.trim() === "" ? undefined : prompt;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
