import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	KeybindingsManager,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import { fromPartial } from "@total-typescript/shoehorn";
import wordCompletion from "../extensions/index.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";
import { saveMethod } from "../src/word-completion-setting.ts";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0] & {};
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;

let agentDir = "";
// Stands in for the home directory of Claude Code (`.claude`) and Codex (`.codex`).
let foreignHome = "";

function fakePi(handlers: Map<string, Handler>, commands = new Map<string, Command>()): ExtensionAPI {
	return fromPartial<ExtensionAPI>({
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		registerCommand: (name: string, command: Command) => {
			commands.set(name, command);
		},
	});
}

/** A command context that records notifications and answers the picker with `picked`. */
function commandCtx(picked?: string) {
	const notes: Array<{ message: string; type: string | undefined }> = [];
	const ctx = fromPartial<ExtensionCommandContext>({
		hasUI: true,
		ui: {
			notify: (message: string, type?: "info" | "warning" | "error") => notes.push({ message, type }),
			select: async () => picked,
		},
		sessionManager: { getSessionDir: () => join(agentDir, "sessions", "--project--"), getSessionFile: () => undefined },
	});
	return { ctx, notes };
}

/** Answers the seeding question. */
type Confirm = (title: string, message: string, opts?: { signal?: AbortSignal }) => Promise<boolean>;

// The extension swallows a failing confirm, so unexpected questions are counted and checked after each test.
let unexpectedQuestions: string[] = [];
const unexpectedConfirm: Confirm = async (title) => {
	unexpectedQuestions.push(title);
	return false;
};

function ctx(setEditorComponent: (factory: EditorFactory) => void = () => {}, confirm = unexpectedConfirm): ExtensionContext {
	return fromPartial<ExtensionContext>({
		hasUI: true,
		ui: { setEditorComponent, confirm, notify: () => {}, theme: { fg: (_color: string, text: string) => text } },
		sessionManager: { getSessionDir: () => join(agentDir, "sessions", "--project--"), getSessionFile: () => undefined },
	});
}

/** Rendered lines without pi's cursor markers, which split the ghost's first letter from the rest. */
function plainText(lines: readonly string[]): string {
	return lines.join("\n").replace(/\x1b_[^\x07]*\x07/g, "");
}

/**
 * Writes a session directory under the agent dir holding one user message, and returns the directory.
 * Give each message its own timestamp: a store skips timestamps it has learned before.
 */
function writePastSession(name: string, text: string, timestamp: number): string {
	const dir = join(agentDir, "sessions", name);
	mkdirSync(dir, { recursive: true });
	const message = { role: "user", content: text, timestamp };
	writeFileSync(join(dir, "s.jsonl"), `${JSON.stringify({ type: "message", id: "a1", parentId: null, timestamp: "", message })}\n`);
	return dir;
}

/**
 * Calls `read` until its result matches `pattern`, or 5 s passes, and returns the last result.
 * For state that background work such as `NgramStore.open` and the web prior load fills in with no promise to await.
 */
async function eventually(read: () => Promise<string>, pattern: RegExp): Promise<string> {
	const deadline = Date.now() + 5000;
	let result = await read();
	while (!pattern.test(result) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		result = await read();
	}
	return result;
}

/** Runs the extension through session start and builds the editor it installs. */
async function startSession(confirm?: Confirm) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	let factory: EditorFactory | undefined;
	wordCompletion(fakePi(handlers, commands));
	await handlers.get("session_start")?.({ type: "session_start" }, ctx((f) => (factory = f), confirm));
	assert.ok(factory, "editor factory set");
	const tui = fromPartial<TUI>({ terminal: { rows: 40, columns: 80 }, requestRender() {} });
	const theme = fromPartial<EditorTheme>({ borderColor: (s: string) => s, selectList: {} });
	// Real pi-tui instance; pi-coding-agent's KeybindingsManager subclass adds only members the editor does not use.
	const keybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
	const editor = factory(tui, theme, keybindings);
	assert.ok(editor instanceof WordCompletionEditor);
	editor.focused = true;
	const run = async (args: string, picked?: string) => {
		const command = commands.get("word-completion");
		assert.ok(command, "command registered");
		const { ctx, notes } = commandCtx(picked);
		await command.handler(args, ctx);
		return notes;
	};
	const ghostFor = async (text: string) => {
		editor.setText(text);
		editor.render(40);
		await new Promise((resolve) => setImmediate(resolve));
		return plainText(editor.render(40));
	};
	const learn = (text: string) => handlers.get("input")?.({ type: "input", text, source: "interactive" }, ctx());
	return { handlers, editor, run, ghostFor, learn, commands };
}

describe("extension", () => {
	// Keep the store away from the real agent directory and its sessions.
	before(() => {
		agentDir = mkdtempSync(join(tmpdir(), "word-completion-agent-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		foreignHome = mkdtempSync(join(tmpdir(), "word-completion-home-"));
		process.env.CLAUDE_CONFIG_DIR = join(foreignHome, ".claude");
		process.env.CODEX_HOME = join(foreignHome, ".codex");
	});

	afterEach(() => {
		assert.deepEqual(unexpectedQuestions, [], "asked without a test expecting it");
		unexpectedQuestions = [];
	});

	after(() => {
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CODEX_HOME;
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(foreignHome, { recursive: true, force: true });
	});

	it("installs the word-completion editor on session start", async () => {
		const { editor } = await startSession();
		assert.ok(editor instanceof WordCompletionEditor);
	});

	it("learns interactive prompts from the input event and drops stale ghost answers", async () => {
		const { ghostFor, learn } = await startSession();
		assert.doesNotMatch(await ghostFor("zygo"), /morphic/);

		await learn("the zygomorphic flower");
		assert.match(await ghostFor("zygo"), /morphic/);
	});

	it("does not learn input from RPC clients or extensions", async () => {
		const { handlers, editor } = await startSession();
		for (const source of ["rpc", "extension"] as const) {
			await handlers.get("input")?.({ type: "input", text: "the zygomorphic flower", source }, ctx());
		}
		editor.setText("zygo");
		editor.render(40);
		await new Promise((resolve) => setImmediate(resolve));
		assert.doesNotMatch(plainText(editor.render(40)), /morphic/);
	});

	it("turns word completion off with the command and keeps it off after a restart", async () => {
		// A past session, not a live prompt: a store closed before its load finishes saves nothing,
		// and the fake session writes no file to learn the prompt from again.
		const pastSession = writePastSession("--restart--", "the zygomorphic flower", 1);
		try {
			const first = await startSession();
			assert.match(await eventually(() => first.ghostFor("zygo"), /morphic/), /morphic/);

			const notes = await first.run("off");
			assert.deepEqual(notes, [{ message: "Word completion: off", type: "info" }]);
			assert.doesNotMatch(await first.ghostFor("zygo"), /morphic/);
			await first.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());

			const second = await startSession();
			assert.doesNotMatch(await second.ghostFor("zygo"), /morphic/);
			await second.run("auto");
			// Turning it on opens the store, which loads the snapshot in the background.
			assert.match(await eventually(() => second.ghostFor("zygo"), /morphic/), /morphic/);
			const saved: unknown = JSON.parse(readFileSync(join(agentDir, "word-completion", "settings.json"), "utf8"));
			assert.deepEqual(saved, { method: "auto" });
			await second.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
		} finally {
			rmSync(pastSession, { recursive: true, force: true });
		}
	});

	it("does not learn prompts while word completion is off", async () => {
		const { run, learn, ghostFor, handlers } = await startSession();
		await run("off");
		await learn("the xerophytic cactus");
		await run("ngram");
		assert.doesNotMatch(await ghostFor("xero"), /phytic/);
		await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
	});

	it("stops learning past sessions when turned off before they are read", async () => {
		const pastSession = writePastSession("--past--", "the hyacinthine sky", 2);
		const snapshot = join(agentDir, "word-completion", "ngram.json");
		try {
			const { run, handlers } = await startSession();
			await run("off");
			await new Promise((resolve) => setTimeout(resolve, 50));
			await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			assert.ok(!existsSync(snapshot) || !readFileSync(snapshot, "utf8").includes("hyacinthine"));
		} finally {
			rmSync(pastSession, { recursive: true, force: true });
			saveMethod(join(agentDir, "word-completion", "settings.json"), "auto");
		}
	});

	it("picks the method from a list when the command has no argument", async () => {
		const { run, handlers } = await startSession();
		assert.deepEqual(await run("", "off"), [{ message: "Word completion: off", type: "info" }]);
		assert.deepEqual(await run("", undefined), [], "cancelled picker changes nothing");
		await run("auto");
		await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
	});

	it("rejects an unknown method and offers the known ones", async () => {
		const { run, commands, ghostFor, learn, handlers } = await startSession();
		await learn("the zygomorphic flower");
		const notes = await run("smollm");
		assert.equal(notes[0]?.type, "error");
		assert.match(await ghostFor("zygo"), /morphic/);
		const items = await commands.get("word-completion")?.getArgumentCompletions?.("");
		assert.deepEqual(
			items?.map((item) => item.value),
			["off", "auto", "ngram"],
		);
		const narrowed = await commands.get("word-completion")?.getArgumentCompletions?.("o");
		assert.deepEqual(
			narrowed?.map((item) => item.value),
			["off"],
		);
		await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
	});

	describe("seeding from Claude Code and Codex history", () => {
		const answerPath = () => join(agentDir, "word-completion", "foreign-history.json");
		const snapshotPath = () => join(agentDir, "word-completion", "ngram.json");

		before(() => {
			mkdirSync(join(foreignHome, ".claude"), { recursive: true });
			mkdirSync(join(foreignHome, ".codex"), { recursive: true });
			const claude = [{ display: "the zygomorphic flower" }, { display: "/compact keep the vexillology part" }];
			writeFileSync(join(foreignHome, ".claude", "history.jsonl"), claude.map((e) => `${JSON.stringify(e)}\n`).join(""));
			writeFileSync(join(foreignHome, ".codex", "history.jsonl"), `${JSON.stringify({ ts: 1, text: "the floriculture notes" })}\n`);
		});

		after(() => {
			rmSync(join(foreignHome, ".claude"), { recursive: true, force: true });
			rmSync(join(foreignHome, ".codex"), { recursive: true, force: true });
		});

		// Each test starts unasked and with an empty model.
		const reset = () => {
			rmSync(answerPath(), { force: true });
			rmSync(snapshotPath(), { force: true });
		};

		it("learns nothing until the user agrees, then learns both files", async () => {
			reset();
			let agree: (value: boolean) => void = () => {};
			const asked: string[] = [];
			const confirm: Confirm = (title, message) => {
				asked.push(`${title} ${message}`);
				return new Promise((resolve) => (agree = resolve));
			};
			const { ghostFor, handlers } = await startSession(confirm);
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.equal(asked.length, 1);
			assert.match(asked[0]!, /\.claude.history\.jsonl.*\.codex.history\.jsonl/s);
			assert.doesNotMatch(await ghostFor("zygo"), /morphic/);

			agree(true);
			assert.match(await eventually(() => ghostFor("zygo"), /morphic/), /morphic/);
			// After `the`: at sentence start the web pairs pick `florida` over a word seen once mid-sentence.
			assert.match(await ghostFor("the flori"), /culture/);
			assert.doesNotMatch(await ghostFor("vexi"), /llology/, "slash command not learned");
			await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			assert.deepEqual(JSON.parse(readFileSync(answerPath(), "utf8")), { answer: "accepted" });

			// The next run neither asks nor counts the history again.
			const counts = readFileSync(snapshotPath(), "utf8");
			const second = await startSession();
			assert.match(await eventually(() => second.ghostFor("zygo"), /morphic/), /morphic/);
			await new Promise((resolve) => setTimeout(resolve, 50));
			await second.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			assert.equal(readFileSync(snapshotPath(), "utf8"), counts);
		});

		it("remembers a decline and does not ask again", async () => {
			reset();
			let asked = 0;
			const first = await startSession(async () => {
				asked++;
				return false;
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.doesNotMatch(await first.ghostFor("zygo"), /morphic/);
			await first.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			assert.equal(asked, 1);
			assert.deepEqual(JSON.parse(readFileSync(answerPath(), "utf8")), { answer: "declined" });

			const second = await startSession();
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.doesNotMatch(await second.ghostFor("zygo"), /morphic/);
			await second.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
		});

		it("does not save an answer when the session ends while asking", async () => {
			reset();
			let signal: AbortSignal | undefined;
			const { handlers } = await startSession((_title, _message, opts) => {
				signal = opts?.signal;
				return new Promise((resolve) => signal?.addEventListener("abort", () => resolve(false)));
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
			await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			await new Promise((resolve) => setTimeout(resolve, 20));
			assert.ok(signal?.aborted);
			assert.ok(!existsSync(answerPath()));
		});

		it("does not ask while word completion is off", async () => {
			reset();
			saveMethod(join(agentDir, "word-completion", "settings.json"), "off");
			try {
				const { handlers } = await startSession();
				await new Promise((resolve) => setTimeout(resolve, 50));
				await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			} finally {
				saveMethod(join(agentDir, "word-completion", "settings.json"), "auto");
			}
		});
	});

	it("does nothing without a UI", async () => {
		const handlers = new Map<string, Handler>();
		const pi = fakePi(handlers);
		let called = false;
		const ctx = fromPartial<ExtensionContext>({
			hasUI: false,
			ui: {
				setEditorComponent: () => {
					called = true;
				},
			},
		});

		wordCompletion(pi);
		await handlers.get("session_start")?.({ type: "session_start" }, ctx);
		assert.equal(called, false);
	});
});
