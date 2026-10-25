import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import { fromPartial } from "@total-typescript/shoehorn";
import wordCompletion from "../extensions/index.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0] & {};
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function fakePi(handlers: Map<string, Handler>): ExtensionAPI {
	return fromPartial<ExtensionAPI>({
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
	});
}

describe("extension", () => {
	it("installs the word-completion editor on session start", async () => {
		const handlers = new Map<string, Handler>();
		const pi = fakePi(handlers);
		let factory: EditorFactory | undefined;
		const ctx = fromPartial<ExtensionContext>({
			hasUI: true,
			ui: {
				setEditorComponent: (f: EditorFactory) => {
					factory = f;
				},
				theme: { fg: (_color: string, text: string) => text },
			},
		});

		wordCompletion(pi);
		await handlers.get("session_start")?.({ type: "session_start" }, ctx);

		assert.ok(factory, "editor factory set");
		const tui = fromPartial<TUI>({ terminal: { rows: 40 }, requestRender() {} });
		const theme = fromPartial<EditorTheme>({ borderColor: (s: string) => s, selectList: {} });
		// Real pi-tui instance; pi-coding-agent's KeybindingsManager subclass adds only members the editor does not use.
		const keybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
		assert.ok(factory(tui, theme, keybindings) instanceof WordCompletionEditor);
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
