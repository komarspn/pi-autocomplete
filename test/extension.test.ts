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

function ctx(setEditorComponent: (factory: EditorFactory) => void = () => {}): ExtensionContext {
	return fromPartial<ExtensionContext>({
		hasUI: true,
		ui: { setEditorComponent, theme: { fg: (_color: string, text: string) => text } },
	});
}

/** Rendered lines without pi's cursor markers, which split the ghost's first letter from the rest. */
function plainText(lines: readonly string[]): string {
	return lines.join("\n").replace(/\x1b_[^\x07]*\x07/g, "");
}

/** Runs the extension through session start and builds the editor it installs. */
async function startSession() {
	const handlers = new Map<string, Handler>();
	let factory: EditorFactory | undefined;
	wordCompletion(fakePi(handlers));
	await handlers.get("session_start")?.({ type: "session_start" }, ctx((f) => (factory = f)));
	assert.ok(factory, "editor factory set");
	const tui = fromPartial<TUI>({ terminal: { rows: 40, columns: 80 }, requestRender() {} });
	const theme = fromPartial<EditorTheme>({ borderColor: (s: string) => s, selectList: {} });
	// Real pi-tui instance; pi-coding-agent's KeybindingsManager subclass adds only members the editor does not use.
	const keybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
	const editor = factory(tui, theme, keybindings);
	assert.ok(editor instanceof WordCompletionEditor);
	editor.focused = true;
	return { handlers, editor };
}

describe("extension", () => {
	it("installs the word-completion editor on session start", async () => {
		const { editor } = await startSession();
		assert.ok(editor instanceof WordCompletionEditor);
	});

	it("learns interactive prompts from the input event and drops stale ghost answers", async () => {
		const { handlers, editor } = await startSession();
		const ghostFor = async (text: string) => {
			editor.setText(text);
			editor.render(40);
			await new Promise((resolve) => setImmediate(resolve));
			return plainText(editor.render(40));
		};
		assert.doesNotMatch(await ghostFor("zygo"), /morphic/);

		await handlers.get("input")?.({ type: "input", text: "the zygomorphic flower", source: "interactive" }, ctx());
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
