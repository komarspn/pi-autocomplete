import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NgramBackend } from "../src/ngram-backend.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";

/** Pi extension factory: installs the word-completion editor when a session with a UI starts. */
export default function wordCompletion(pi: ExtensionAPI): void {
	const backend = new NgramBackend();
	let editor: WordCompletionEditor | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			// Read the theme on each paint so theme switches apply to the ghost.
			editor = new WordCompletionEditor(tui, theme, keybindings, { backend, style: (text) => ctx.ui.theme.fg("dim", text) });
			return editor;
		});
	});

	// pi fires `input` for prompts, steering and follow-ups, but not for built-in or extension
	// commands or `!` shell lines. Skill and template commands arrive unexpanded; the prose gates skip them.
	pi.on("input", (event) => {
		if (event.source !== "interactive") return;
		backend.observe(event.text);
		// Cached misses from before this prompt would hide the words it taught.
		editor?.resetWordCompletion();
	});
}
