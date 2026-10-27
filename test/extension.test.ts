import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
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

function ctx(setEditorComponent: (factory: EditorFactory) => void = () => {}): ExtensionContext {
	return fromPartial<ExtensionContext>({
		hasUI: true,
		ui: { setEditorComponent, theme: { fg: (_color: string, text: string) => text } },
		sessionManager: { getSessionDir: () => join(agentDir, "sessions", "--project--"), getSessionFile: () => undefined },
	});
}

/** Rendered lines without pi's cursor markers, which split the ghost's first letter from the rest. */
function plainText(lines: readonly string[]): string {
	return lines.join("\n").replace(/\x1b_[^\x07]*\x07/g, "");
}

/** Runs the extension through session start and builds the editor it installs. */
async function startSession() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	let factory: EditorFactory | undefined;
	wordCompletion(fakePi(handlers, commands));
	await handlers.get("session_start")?.({ type: "session_start" }, ctx((f) => (factory = f)));
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
	});

	after(() => {
		delete process.env.PI_CODING_AGENT_DIR;
		rmSync(agentDir, { recursive: true, force: true });
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
		const first = await startSession();
		await first.learn("the zygomorphic flower");
		assert.match(await first.ghostFor("zygo"), /morphic/);

		const notes = await first.run("off");
		assert.deepEqual(notes, [{ message: "Word completion: off", type: "info" }]);
		assert.doesNotMatch(await first.ghostFor("zygo"), /morphic/);
		await first.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());

		const second = await startSession();
		assert.doesNotMatch(await second.ghostFor("zygo"), /morphic/);
		await second.run("auto");
		// Turning it on opens the store, which loads the snapshot in the background.
		let ghost = await second.ghostFor("zygo");
		for (let tries = 0; tries < 100 && !/morphic/.test(ghost); tries++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			ghost = await second.ghostFor("zygo");
		}
		assert.match(ghost, /morphic/);
		const saved: unknown = JSON.parse(readFileSync(join(agentDir, "word-completion", "settings.json"), "utf8"));
		assert.deepEqual(saved, { method: "auto" });
		await second.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
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
		const pastSession = join(agentDir, "sessions", "--past--", "s.jsonl");
		mkdirSync(join(pastSession, ".."), { recursive: true });
		const message = { role: "user", content: "the hyacinthine sky", timestamp: 1 };
		writeFileSync(pastSession, `${JSON.stringify({ type: "message", id: "a1", parentId: null, timestamp: "", message })}\n`);
		const snapshot = join(agentDir, "word-completion", "ngram.json");
		try {
			const { run, handlers } = await startSession();
			await run("off");
			await new Promise((resolve) => setTimeout(resolve, 50));
			await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx());
			assert.ok(!existsSync(snapshot) || !readFileSync(snapshot, "utf8").includes("hyacinthine"));
		} finally {
			rmSync(join(pastSession, ".."), { recursive: true, force: true });
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
