import { CustomEditor, type CustomEditorOptions, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { paintGhost, paintSpace } from "./ghost-text.ts";
import { type WordPredictionBackend, WordCompletionProvider } from "./word-completion-provider.ts";

/** CustomEditor options plus the word source and ghost styling. */
export interface WordCompletionEditorOptions extends CustomEditorOptions {
	backend: WordPredictionBackend;
	/** Styles ghost text, usually the theme's dim color. */
	style: (text: string) => string;
}

// Keys CustomEditor.handleInput claims besides registered action handlers.
const APP_KEYS = ["app.clipboard.pasteImage", "app.interrupt", "tui.editor.historyPrevious", "tui.editor.historyNext"] as const;

// Input starting with a space or one of these marks takes the place of the provisional space. Same set as omp.
const REPLACES_SPACE = /^[ \-.,;:!?)\]}]/;
// xterm modifyOtherKeys: ESC [ 27 ; <modifier + 1> ; <codepoint> ~. pi-tui does not export its decoder.
const MODIFY_OTHER_KEYS = /^\x1b\[27;(\d+);(\d+)~$/;
// Shift, Caps Lock and Num Lock still type a character; any other modifier makes the key a shortcut.
const TYPING_MODIFIERS = 1 | 64 | 128;

/** Editor text and cursor at one moment. */
interface EditorState {
	text: string;
	line: number;
	col: number;
}

/** A ghost painted in the last render, with the editor state it belongs to. */
interface ShownGhost extends EditorState {
	suffix: string;
}

/** pi's prompt editor plus word completion shown as ghost text at the end of a line. */
export class WordCompletionEditor extends CustomEditor {
	private readonly provider: WordCompletionProvider;
	private readonly style: (text: string) => string;
	private readonly appKeybindings: KeybindingsManager;
	private shown: ShownGhost | undefined;
	// Set by a Tab accept. The space is not in the text until a key that keeps it arrives.
	private provisionalSpace: EditorState | undefined;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: WordCompletionEditorOptions) {
		const { backend, style, ...editorOptions } = options;
		super(tui, theme, keybindings, editorOptions);
		this.appKeybindings = keybindings;
		this.style = style;
		this.provider = new WordCompletionProvider(backend, () => this.tui.requestRender());
	}

	/** Drops cached completions, so the next render asks the backend again. Call after the backend learns. */
	resetWordCompletion(): void {
		this.provider.reset();
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		this.shown = undefined;
		// Without focus pi emits no cursor marker, so there is nothing to anchor the ghost to.
		if (!this.focused || this.isShowingAutocomplete()) return lines;
		// The accepted word is finished, so no ghost competes with the space.
		if (this.provisionalSpace && this.isAt(this.provisionalSpace)) {
			return paintSpace(lines, { width, paddingX: this.getPaddingX() }).lines;
		}

		const { line, col } = this.getCursor();
		const suffix = this.provider.getWordCompletion(this.getLines(), line, col);
		if (!suffix) return lines;

		const result = paintGhost(lines, { suffix, width, paddingX: this.getPaddingX(), style: this.style });
		if (result.painted) this.shown = { suffix, text: this.getText(), line, col };
		return result.lines;
	}

	override handleInput(data: string): void {
		const space = this.provisionalSpace;
		this.provisionalSpace = undefined;
		if (space && this.isAt(space) && this.keepsSpace(data)) this.insertTextAtCursor(" ");

		const ghost = this.visibleGhost();
		if (ghost && this.isAcceptKey(data) && !this.isAppKey(data)) {
			// Extension shortcuts run first in CustomEditor too; a declined key reaches it again harmlessly.
			if (this.onExtensionShortcut?.(data)) return;
			this.acceptGhost(ghost);
			if (this.appKeybindings.matches(data, "tui.input.tab")) this.provisionalSpace = this.editorState();
			return;
		}
		const linesBefore = ghost ? this.getLines() : undefined;
		super.handleInput(data);
		if (ghost && linesBefore) this.rejectIfDiverged(ghost, linesBefore);
	}

	/** Sends negative feedback when the key typed text that leaves the ghost's word. */
	private rejectIfDiverged(ghost: ShownGhost, linesBefore: readonly string[]): void {
		// Read what the key typed from the text, so every key encoding pi accepts counts.
		const typed = this.typedSince(ghost, linesBefore);
		const overlap = Math.min(typed.length, ghost.suffix.length);
		if (typed.slice(0, overlap).toLowerCase() === ghost.suffix.slice(0, overlap).toLowerCase()) return;
		this.provider.wordCompletionFeedback(linesBefore, ghost.line, ghost.col, ghost.suffix, false);
	}

	/** Text inserted at the ghost's end-of-line cursor, or "" when the key did anything else. */
	private typedSince(ghost: ShownGhost, linesBefore: readonly string[]): string {
		const lines = this.getLines();
		const { line, col } = this.getCursor();
		const before = linesBefore[ghost.line];
		const after = lines[line];
		if (line !== ghost.line || lines.length !== linesBefore.length || before === undefined || after === undefined) return "";
		if (col !== after.length || !after.startsWith(before)) return "";
		return after.slice(before.length);
	}

	/** False for keys that make the provisional space after a Tab accept unwanted. */
	private keepsSpace(data: string): boolean {
		const keys = this.appKeybindings;
		const dropKeys = ["tui.input.newLine", "tui.input.submit", "tui.editor.undo"] as const;
		if (dropKeys.some((action) => keys.matches(data, action))) return false;
		return !REPLACES_SPACE.test(typedText(data));
	}

	private isAcceptKey(data: string): boolean {
		return (
			this.appKeybindings.matches(data, "tui.input.tab") || this.appKeybindings.matches(data, "tui.editor.cursorRight")
		);
	}

	/** True when CustomEditor would route the key to an app action instead of the text. */
	private isAppKey(data: string): boolean {
		const actions = [...this.actionHandlers.keys(), ...APP_KEYS];
		return actions.some((action) => this.appKeybindings.matches(data, action));
	}

	/** The ghost painted in the last render, if it still matches the editor state. */
	private visibleGhost(): ShownGhost | undefined {
		const shown = this.shown;
		if (!shown || this.isShowingAutocomplete() || !this.isAt(shown)) return undefined;
		return shown;
	}

	private editorState(): EditorState {
		const { line, col } = this.getCursor();
		return { text: this.getText(), line, col };
	}

	private isAt(state: EditorState): boolean {
		const { line, col } = this.getCursor();
		return state.text === this.getText() && state.line === line && state.col === col;
	}

	private acceptGhost(ghost: ShownGhost): void {
		const lines = this.getLines();
		this.shown = undefined;
		// One undo snapshot, and pi cancels its dropdown without reopening it.
		this.insertTextAtCursor(ghost.suffix);
		this.provider.wordCompletionFeedback(lines, ghost.line, ghost.col, ghost.suffix, true);
	}
}

/** What a key types, decoding the kitty and modifyOtherKeys encodings pi accepts; other input as is. */
function typedText(data: string): string {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	const match = MODIFY_OTHER_KEYS.exec(data);
	if (!match) return data;
	const modifier = Number(match[1]) - 1;
	const codepoint = Number(match[2]);
	// fromCodePoint throws past the Unicode range.
	if ((modifier & ~TYPING_MODIFIERS) !== 0 || codepoint > 0x10ffff) return "";
	return String.fromCodePoint(codepoint);
}
