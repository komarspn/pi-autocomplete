import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { NgramBackend } from "../src/ngram-backend.ts";
import { NgramStore } from "../src/ngram-store.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";
import {
	isWordCompletionMethod,
	loadMethod,
	resolveMethod,
	saveMethod,
	WORD_COMPLETION_METHODS,
	type WordCompletionMethod,
} from "../src/word-completion-setting.ts";

/** An n-gram backend and the store that keeps its counts. */
interface Engine {
	backend: NgramBackend;
	store: NgramStore;
}

/** Pi extension factory: installs the word-completion editor when a session with a UI starts. */
export default function wordCompletion(pi: ExtensionAPI): void {
	let editor: WordCompletionEditor | undefined;
	// Undefined while off, so off learns nothing. Prompts sent meanwhile stay in the session files,
	// which the next engine reads.
	let engine: Engine | undefined;
	let method: WordCompletionMethod = "auto";

	const settingPath = () => join(getAgentDir(), "word-completion", "settings.json");

	/** Starts the engine when `method` needs one and stops it when off. Starting loads past counts in the background. */
	const applyMethod = (ctx: ExtensionContext) => {
		if (resolveMethod(method) === undefined) {
			// Closing also stops reading past sessions, and saves what was learned so far.
			engine?.store.close();
			engine = undefined;
			return;
		}
		if (engine) return;
		const agentDir = getAgentDir();
		// A fresh backend each time: restoring a snapshot adds its counts to what the backend holds.
		const backend = new NgramBackend();
		const started: Engine = { backend, store: new NgramStore(backend, join(agentDir, "word-completion", "ngram.json")) };
		engine = started;
		// The default sessions root, and the current session's directory in case `sessionDir` points elsewhere.
		const sessionDirs = [join(agentDir, "sessions"), ctx.sessionManager.getSessionDir()];
		void started.store.open(sessionDirs).then(() => {
			// Cached misses from before the load would hide the words it brought back.
			if (engine === started) editor?.resetWordCompletion();
		});
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		method = loadMethod(settingPath());
		applyMethod(ctx);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			// Read the theme on each paint so theme switches apply to the ghost.
			const style = (text: string) => ctx.ui.theme.fg("dim", text);
			editor = new WordCompletionEditor(tui, theme, keybindings, { backend: engine?.backend, style });
			return editor;
		});
	});

	pi.registerCommand("word-completion", {
		description: "Set word completion: off, auto or ngram",
		getArgumentCompletions: (prefix) => {
			const items = WORD_COMPLETION_METHODS.filter((value) => value.startsWith(prefix.trim()));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const picked = async () => {
				if (!ctx.hasUI) return undefined;
				return await ctx.ui.select(`Word completion (now ${method})`, [...WORD_COMPLETION_METHODS]);
			};
			const choice = args.trim() || (await picked());
			// The user closed the picker, or there is no UI to show it in.
			if (choice === undefined) return;
			if (!isWordCompletionMethod(choice)) {
				ctx.ui.notify(`Unknown word completion setting "${choice}". Use ${WORD_COMPLETION_METHODS.join(", ")}.`, "error");
				return;
			}
			method = choice;
			applyMethod(ctx);
			editor?.setWordCompletionBackend(engine?.backend);
			try {
				saveMethod(settingPath(), method);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Word completion: ${method}, for this run only. Saving failed: ${reason}`, "warning");
				return;
			}
			ctx.ui.notify(`Word completion: ${method}`, "info");
		},
	});

	// pi fires `input` for prompts, steering and follow-ups, but not for built-in or extension
	// commands or `!` shell lines. Skill and template commands arrive unexpanded; the prose gates skip them.
	pi.on("input", (event) => {
		if (event.source !== "interactive" || !engine) return;
		engine.store.observe(event.text);
		// Cached misses from before this prompt would hide the words it taught.
		editor?.resetWordCompletion();
	});

	// pi runs this handler before it appends the message to the session file. Marking every user
	// message, learned or not, keeps the next run from reading it there again.
	pi.on("message_end", (event) => {
		if (event.message.role !== "user" || !engine) return;
		engine.store.markSeen(event.message.timestamp);
	});

	pi.on("session_shutdown", () => {
		engine?.store.close();
		engine = undefined;
	});
}
