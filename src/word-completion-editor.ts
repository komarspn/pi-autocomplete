import { CustomEditor, type CustomEditorOptions, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { paintGhost } from "./ghost-text.ts";
import { type WordPredictionBackend, WordCompletionProvider } from "./word-completion-provider.ts";

/** CustomEditor options plus the word source and ghost styling. */
export interface WordCompletionEditorOptions extends CustomEditorOptions {
	backend: WordPredictionBackend;
	/** Styles ghost text, usually the theme's dim color. */
	style: (text: string) => string;
}

// Keys CustomEditor.handleInput claims besides registered action handlers.
const APP_KEYS = ["app.clipboard.pasteImage", "app.interrupt", "tui.editor.historyPrevious", "tui.editor.historyNext"] as const;

/** A ghost painted in the last render, with the editor state it belongs to. */
interface ShownGhost {
	suffix: string;
	text: string;
	line: number;
	col: number;
}

/** pi's prompt editor plus word completion shown as ghost text at the end of a line. */
export class WordCompletionEditor extends CustomEditor {
	private readonly provider: WordCompletionProvider;
	private readonly style: (text: string) => string;
	private readonly appKeybindings: KeybindingsManager;
	private shown: ShownGhost | undefined;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: WordCompletionEditorOptions) {
		const { backend, style, ...editorOptions } = options;
		super(tui, theme, keybindings, editorOptions);
		this.appKeybindings = keybindings;
		this.style = style;
		this.provider = new WordCompletionProvider(backend, () => this.tui.requestRender());
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		this.shown = undefined;
		// Without focus pi emits no cursor marker, so there is nothing to anchor the ghost to.
		if (!this.focused || this.isShowingAutocomplete()) return lines;

		const { line, col } = this.getCursor();
		const suffix = this.provider.getWordCompletion(this.getLines(), line, col);
		if (!suffix) return lines;

		const result = paintGhost(lines, { suffix, width, paddingX: this.getPaddingX(), style: this.style });
		if (result.painted) this.shown = { suffix, text: this.getText(), line, col };
		return result.lines;
	}

	override handleInput(data: string): void {
		if (this.shown && this.appKeybindings.matches(data, "tui.input.tab") && !this.isAppKey(data)) {
			// Extension shortcuts run first in CustomEditor too; a declined key reaches it again harmlessly.
			if (this.onExtensionShortcut?.(data)) return;
			if (this.acceptGhost()) return;
		}
		super.handleInput(data);
	}

	/** True when CustomEditor would route the key to an app action instead of the text. */
	private isAppKey(data: string): boolean {
		const actions = [...this.actionHandlers.keys(), ...APP_KEYS];
		return actions.some((action) => this.appKeybindings.matches(data, action));
	}

	/** Inserts the ghost if the one on screen still matches the editor state. */
	private acceptGhost(): boolean {
		const shown = this.shown;
		if (!shown || this.isShowingAutocomplete()) return false;
		const { line, col } = this.getCursor();
		if (shown.text !== this.getText() || shown.line !== line || shown.col !== col) return false;

		const lines = this.getLines();
		this.shown = undefined;
		this.insertTextAtCursor(shown.suffix);
		this.provider.wordCompletionFeedback(lines, line, col, shown.suffix, true);
		return true;
	}
}
