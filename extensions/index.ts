import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";
import { WordListBackend } from "../src/word-list-backend.ts";

/** Pi extension factory: installs the word-completion editor when a session with a UI starts. */
export default function wordCompletion(pi: ExtensionAPI): void {
	const backend = new WordListBackend();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) =>
				// Read the theme on each paint so theme switches apply to the ghost.
				new WordCompletionEditor(tui, theme, keybindings, { backend, style: (text) => ctx.ui.theme.fg("dim", text) }),
		);
	});
}
