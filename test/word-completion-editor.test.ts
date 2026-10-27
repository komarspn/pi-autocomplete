import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	type AutocompleteProvider,
	CURSOR_MARKER,
	renderFakeCursor,
	type EditorTheme,
	KeybindingsManager as TuiKeybindingsManager,
	TUI_KEYBINDINGS,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { WordPredictionBackend } from "../src/word-completion-provider.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const GHOST = "\x1b[2m";
const TAB = "\t";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const CTRL_C = "\x03";
const ENTER = "\r";
// Ctrl+-, pi's default undo key.
const UNDO = "\x1f";
// Ctrl+J, pi's default newline key besides Shift+Enter.
const NEWLINE = "\n";

function setup(
	answer: (prefix: string) => string | null = (prefix) => (prefix === "hel" ? "lo" : null),
	appBindings: Record<string, { defaultKeys: string; description: string }> = {},
) {
	let renders = 0;
	const tui = fromPartial<TUI>({ terminal: { rows: 40, columns: 80 }, requestRender: () => renders++ });
	const plain = (s: string) => s;
	const theme = fromPartial<EditorTheme>({
		borderColor: plain,
		selectList: { selectedPrefix: plain, selectedText: plain, description: plain, scrollInfo: plain, noMatch: plain },
	});
	// Real pi-tui instance; pi-coding-agent's KeybindingsManager subclass adds only members the editor does not use.
	const keybindings = new TuiKeybindingsManager({
		...TUI_KEYBINDINGS,
		"app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
		...appBindings,
	}) as unknown as KeybindingsManager;
	const feedback: Array<{ suggestion: string; accepted: boolean }> = [];
	const pending: Array<() => void> = [];
	const backend: WordPredictionBackend = {
		complete: (_before, prefix) => new Promise((resolve) => pending.push(() => resolve(answer(prefix)))),
		feedback: (_before, _prefix, suggestion, accepted) => feedback.push({ suggestion, accepted }),
	};
	const editor = new WordCompletionEditor(tui, theme, keybindings, { backend, style: dim });
	editor.focused = true;
	const type = (text: string) => {
		for (const ch of text) editor.handleInput(ch);
	};
	const flush = async () => {
		for (const resolve of pending.splice(0)) resolve();
		await new Promise((resolve) => setImmediate(resolve));
	};
	// Types `text` and waits until its ghost is on screen.
	const showGhost = async (text: string) => {
		type(text);
		editor.render(40);
		await flush();
		editor.render(40);
	};
	return { editor, type, flush, showGhost, feedback, renders: () => renders };
}

function cursorRow(lines: string[]): string {
	const row = lines.find((line) => line.includes(CURSOR_MARKER));
	assert.ok(row, "cursor line rendered");
	return row;
}

describe("WordCompletionEditor", () => {
	it("shows the dim suffix after the async answer arrives and requests a repaint", async () => {
		const t = setup();
		t.type("hel");
		assert.ok(!cursorRow(t.editor.render(40)).includes(GHOST), "no ghost before the answer");

		const before = t.renders();
		await t.flush();
		assert.equal(t.renders(), before + 1);
		assert.ok(cursorRow(t.editor.render(40)).includes(`hel${CURSOR_MARKER}${renderFakeCursor(dim("l"))}${dim("o")}`));
	});

	it("keeps showing the rest of the word while typing through the ghost", async () => {
		const t = setup();
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.render(40);

		t.type("l");
		const ghost = `hell${CURSOR_MARKER}${renderFakeCursor(dim("o"))}`;
		assert.ok(cursorRow(t.editor.render(40)).includes(ghost), "no blank frame before the answer");
		// The backend knows nothing for "hell"; the shown word still stands.
		await t.flush();
		assert.ok(cursorRow(t.editor.render(40)).includes(ghost));
	});

	it("keeps every rendered line at the exact width with and without a ghost", async () => {
		const t = setup();
		t.type("hel");
		const plain = t.editor.render(40);
		await t.flush();
		const ghosted = t.editor.render(40);
		assert.notDeepEqual(plain, ghosted);
		for (const line of [...plain, ...ghosted]) assert.equal(visibleWidth(line), 40);
	});

	it("hides a ghost that would overflow the content width", async () => {
		const t = setup(() => "x".repeat(30));
		t.type("hel");
		await t.flush();
		const lines = t.editor.render(20);
		assert.ok(!cursorRow(lines).includes(GHOST));
		for (const line of lines) assert.equal(visibleWidth(line), 20);
	});

	it("shows no ghost when the cursor is not at the end of its line", async () => {
		const t = setup(() => "lo");
		t.type("hel x");
		t.editor.handleInput(LEFT);
		t.editor.handleInput(LEFT);
		await t.flush();
		assert.ok(!cursorRow(t.editor.render(40)).includes(GHOST));
	});

	it("shows no ghost while typing a path, a code span or a slash command", async () => {
		for (const text of ["open src/hel", "run `hel", "/hel"]) {
			const t = setup(() => "lo");
			t.type(text);
			t.editor.render(40);
			await t.flush();
			assert.ok(!cursorRow(t.editor.render(40)).includes(GHOST), text);
		}
	});

	it("shows no ghost when the editor is not focused", async () => {
		const t = setup();
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.focused = false;
		assert.ok(!t.editor.render(40).some((line) => line.includes(GHOST)));
	});

	it("inserts the suffix on Tab and sends positive feedback", async () => {
		const t = setup();
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.render(40);
		t.editor.handleInput(TAB);
		assert.equal(t.editor.getText(), "hello");
		assert.deepEqual(t.feedback, [{ suggestion: "lo", accepted: true }]);
	});

	it("leaves Tab to pi when no ghost is on screen", async () => {
		const t = setup();
		t.type("hel");
		t.editor.render(40);
		t.editor.handleInput(TAB);
		assert.equal(t.editor.getText(), "hel");
		assert.deepEqual(t.feedback, []);
	});

	it("does not accept a ghost painted for an earlier state", async () => {
		const t = setup();
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.render(40);
		t.type("p");
		t.editor.handleInput(TAB);
		assert.equal(t.editor.getText(), "help");
	});

	it("shows the ghost on the cursor line when the view is scrolled", async () => {
		const t = setup();
		t.editor.setText(`${"line\n".repeat(30)}hel`);
		const first = t.editor.render(40);
		assert.match(first[0]!, /more/, "top border shows hidden lines");
		await t.flush();
		const lines = t.editor.render(40);
		assert.ok(cursorRow(lines).includes(GHOST));
		for (const line of lines) assert.equal(visibleWidth(line), 40);
	});

	it("shows the ghost on a line that holds a paste marker", async () => {
		const t = setup();
		t.editor.handleInput(`\x1b[200~${"pasted\n".repeat(20)}\x1b[201~`);
		t.type(" hel");
		assert.match(t.editor.getText(), /\[paste #1 .*\] hel$/);
		t.editor.render(60);
		await t.flush();
		const lines = t.editor.render(60);
		assert.ok(cursorRow(lines).includes(GHOST));
		for (const line of lines) assert.equal(visibleWidth(line), 60);
	});

	it("lets an app action bound to Tab win over the ghost", async () => {
		const t = setup(undefined, { "app.editor.external": { defaultKeys: "tab", description: "External editor" } });
		let opened = 0;
		t.editor.onAction("app.editor.external", () => opened++);
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.render(40);
		t.editor.handleInput(TAB);
		assert.equal(opened, 1);
		assert.equal(t.editor.getText(), "hel");
	});

	it("lets an extension shortcut on Tab win over the ghost", async () => {
		const t = setup();
		t.editor.onExtensionShortcut = (data) => data === TAB;
		t.type("hel");
		t.editor.render(40);
		await t.flush();
		t.editor.render(40);
		t.editor.handleInput(TAB);
		assert.equal(t.editor.getText(), "hel");
	});

	it("inserts the suffix without a space on Right and sends positive feedback", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.editor.handleInput(RIGHT);
		t.type("'s");
		assert.equal(t.editor.getText(), "hello's");
		assert.deepEqual(t.feedback, [{ suggestion: "lo", accepted: true }]);
	});

	it("moves the cursor on Right when no ghost is on screen", () => {
		const t = setup();
		t.type("hel");
		t.editor.handleInput(LEFT);
		t.editor.handleInput(RIGHT);
		t.type("p");
		assert.equal(t.editor.getText(), "help");
		assert.deepEqual(t.feedback, []);
	});

	it("keeps one space when a space follows a Tab accept", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.editor.handleInput(TAB);
		t.type(" world");
		assert.equal(t.editor.getText(), "hello world");
	});

	it("keeps the space after a Tab accept when a word follows", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.editor.handleInput(TAB);
		t.type("world");
		assert.equal(t.editor.getText(), "hello world");
	});

	it("drops the space after a Tab accept when punctuation follows", async () => {
		for (const mark of "-.,;:!?)]}") {
			const t = setup();
			await t.showGhost("hel");
			t.editor.handleInput(TAB);
			t.type(mark);
			assert.equal(t.editor.getText(), `hello${mark}`);
		}
	});

	it("drops the space after a Tab accept for every key encoding and for multi-character input", async () => {
		const cases = [
			["\x1b[33;2u", "hello!"], // kitty
			["\x1b[27;2;33~", "hello!"], // modifyOtherKeys
			["\x1b[27;1;32~", "hello "],
			[".x", "hello.x"],
			[" x", "hello x"],
		] as const;
		for (const [data, text] of cases) {
			const t = setup();
			await t.showGhost("hel");
			t.editor.handleInput(TAB);
			t.editor.handleInput(data);
			assert.equal(t.editor.getText(), text, JSON.stringify(data));
		}
	});

	it("drops the space after a Tab accept when a newline follows", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.editor.handleInput(TAB);
		t.editor.handleInput(NEWLINE);
		t.type("x");
		assert.equal(t.editor.getText(), "hello\nx");
	});

	it("submits no trailing space when Enter follows a Tab accept", async () => {
		const t = setup();
		const submitted: string[] = [];
		t.editor.onSubmit = (text) => submitted.push(text);
		await t.showGhost("say hel");
		t.editor.handleInput(TAB);
		t.editor.handleInput(ENTER);
		assert.deepEqual(submitted, ["say hello"]);
	});

	it("restores the text before the accept with one undo", async () => {
		for (const key of [TAB, RIGHT]) {
			const t = setup();
			await t.showGhost("say hel");
			t.editor.handleInput(key);
			t.editor.handleInput(UNDO);
			assert.equal(t.editor.getText(), "say hel");
		}
	});

	it("shows the provisional space after a Tab accept and no ghost for the accepted word", async () => {
		const t = setup((prefix) => ({ hel: "lo", hello: "s" })[prefix] ?? null);
		await t.showGhost("hel");
		t.editor.handleInput(TAB);
		t.editor.render(40);
		await t.flush();
		const lines = t.editor.render(40);
		assert.ok(cursorRow(lines).includes(`hello ${CURSOR_MARKER}${renderFakeCursor(" ")}`));
		assert.ok(!cursorRow(lines).includes(GHOST));
		for (const line of lines) assert.equal(visibleWidth(line), 40);
	});

	it("sends negative feedback when a typed character diverges from the ghost", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.type("p");
		assert.equal(t.editor.getText(), "help");
		assert.deepEqual(t.feedback, [{ suggestion: "lo", accepted: false }]);
	});

	it("sends no feedback when typing through the ghost in another case", async () => {
		const t = setup();
		await t.showGhost("hel");
		t.type("L");
		t.editor.handleInput(LEFT);
		assert.deepEqual(t.feedback, []);
	});

	it("shows no ghost while the dropdown is open and leaves Tab to the dropdown", async () => {
		const t = setup();
		const files: AutocompleteProvider = {
			getSuggestions: async () => ({
				prefix: "hel",
				items: [
					{ value: "helm.md", label: "helm.md" },
					{ value: "help.md", label: "help.md" },
				],
			}),
			applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
				const text = (lines[cursorLine] ?? "").slice(0, cursorCol - prefix.length) + item.value;
				return { lines: [text], cursorLine, cursorCol: text.length };
			},
		};
		t.editor.setAutocompleteProvider(files);
		t.type("hel");
		t.editor.render(40);
		// No ghost yet, so Tab opens pi's dropdown.
		t.editor.handleInput(TAB);
		await t.flush();
		assert.equal(t.editor.isShowingAutocomplete(), true);

		assert.ok(!t.editor.render(40).some((line) => line.includes(GHOST)));
		t.editor.handleInput(TAB);
		assert.equal(t.editor.getText(), "helm.md");
		assert.deepEqual(t.feedback, []);
	});

	it("does not reopen the dropdown after an accept", async () => {
		let asked = 0;
		const t = setup();
		t.editor.setAutocompleteProvider(
			fromPartial<AutocompleteProvider>({
				getSuggestions: async () => {
					asked++;
					return null;
				},
			}),
		);
		await t.showGhost("hel");
		t.editor.handleInput(TAB);
		await t.flush();
		assert.equal(t.editor.isShowingAutocomplete(), false);
		assert.equal(asked, 0);
	});

	it("keeps app shortcuts working", () => {
		const t = setup();
		let cleared = 0;
		t.editor.onAction("app.clear", () => cleared++);
		t.editor.handleInput(CTRL_C);
		assert.equal(cleared, 1);
	});
});
