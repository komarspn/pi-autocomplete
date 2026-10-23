import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import wordCompletion from "../extensions/index.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0] & {};

describe("extension", () => {
	it("installs the word-completion editor on session start", async () => {
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
		const pi = { on: (name: string, fn: never) => handlers.set(name, fn) } as unknown as ExtensionAPI;
		let factory: EditorFactory | undefined;
		const ctx = {
			hasUI: true,
			ui: { setEditorComponent: (f: EditorFactory) => (factory = f), theme: { fg: (_c: string, s: string) => s } },
		} as unknown as ExtensionContext;

		wordCompletion(pi);
		await handlers.get("session_start")?.({ type: "session_start" }, ctx);

		assert.ok(factory, "editor factory set");
		const tui = { terminal: { rows: 40 }, requestRender() {} } as unknown as TUI;
		const theme = { borderColor: (s: string) => s, selectList: {} } as unknown as EditorTheme;
		const keybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
		assert.ok(factory(tui, theme, keybindings) instanceof WordCompletionEditor);
	});

	it("does nothing without a UI", async () => {
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
		const pi = { on: (name: string, fn: never) => handlers.set(name, fn) } as unknown as ExtensionAPI;
		let called = false;
		const ctx = { hasUI: false, ui: { setEditorComponent: () => (called = true) } } as unknown as ExtensionContext;

		wordCompletion(pi);
		await handlers.get("session_start")?.({ type: "session_start" }, ctx);
		assert.equal(called, false);
	});
});
