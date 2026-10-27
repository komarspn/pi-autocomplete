import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { NgramBackend } from "../src/ngram-backend.ts";
import { NgramStore } from "../src/ngram-store.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";

/** Pi extension factory: installs the word-completion editor when a session with a UI starts. */
export default function wordCompletion(pi: ExtensionAPI): void {
	const backend = new NgramBackend();
	let editor: WordCompletionEditor | undefined;
	let store: NgramStore | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			// Read the theme on each paint so theme switches apply to the ghost.
			editor = new WordCompletionEditor(tui, theme, keybindings, { backend, style: (text) => ctx.ui.theme.fg("dim", text) });
			return editor;
		});
		if (store) return;
		const agentDir = getAgentDir();
		const opened = new NgramStore(backend, join(agentDir, "word-completion", "ngram.json"));
		store = opened;
		// The default sessions root, and the current session's directory in case `sessionDir` points elsewhere.
		const sessionDirs = [join(agentDir, "sessions"), ctx.sessionManager.getSessionDir()];
		void opened.open(sessionDirs).then(() => {
			// Cached misses from before the load would hide the words it brought back.
			if (store === opened) editor?.resetWordCompletion();
		});
	});

	// pi fires `input` for prompts, steering and follow-ups, but not for built-in or extension
	// commands or `!` shell lines. Skill and template commands arrive unexpanded; the prose gates skip them.
	pi.on("input", (event) => {
		if (event.source !== "interactive" || !store) return;
		store.observe(event.text);
		// Cached misses from before this prompt would hide the words it taught.
		editor?.resetWordCompletion();
	});

	// pi runs this handler before it appends the message to the session file. Marking every user
	// message, learned or not, keeps the next run from reading it there again.
	pi.on("message_end", (event) => {
		if (event.message.role !== "user" || !store) return;
		store.markSeen(event.message.timestamp);
	});

	pi.on("session_shutdown", () => {
		store?.close();
		store = undefined;
	});
}
