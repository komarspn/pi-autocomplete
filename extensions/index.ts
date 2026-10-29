import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { foreignHistoryFiles, loadSeedingAnswer, readForeignPrompts, saveSeedingAnswer } from "../src/foreign-history.ts";
import { NgramBackend } from "../src/ngram-backend.ts";
import { NgramStore } from "../src/ngram-store.ts";
import { loadWebPrior } from "../src/web-prior.ts";
import { WordCompletionEditor } from "../src/word-completion-editor.ts";
import {
	isWordCompletionMethod,
	loadMethod,
	resolveMethod,
	saveMethod,
	WORD_COMPLETION_METHODS,
	type WordCompletionMethod,
} from "../src/word-completion-setting.ts";

/** An n-gram backend, the store that keeps its counts, and the store's background load. */
interface Engine {
	backend: NgramBackend;
	store: NgramStore;
	opened: Promise<void>;
}

/** Pi extension factory: installs the word-completion editor when a session with a UI starts. */
export default function wordCompletion(pi: ExtensionAPI): void {
	let editor: WordCompletionEditor | undefined;
	// Undefined while off, so off learns nothing. Prompts sent meanwhile stay in the session files,
	// which the next engine reads.
	let engine: Engine | undefined;
	let method: WordCompletionMethod = "auto";
	// Set while the seeding question is open. Aborted on shutdown, which dismisses the dialog unanswered.
	let asking: AbortController | undefined;

	const settingPath = () => join(getAgentDir(), "word-completion", "settings.json");
	const answerPath = () => join(getAgentDir(), "word-completion", "foreign-history.json");

	/**
	 * Seeds the running engine from Claude Code and Codex history once the user agrees. Asks once, and
	 * only when one of the files exists; nothing in them is read before a yes. Never rejects.
	 * Call it after the editor is installed: installing an editor closes any open dialog.
	 */
	const offerSeeding = async (ctx: ExtensionContext) => {
		const started = engine;
		if (!started) return;
		let answer = loadSeedingAnswer(answerPath());
		if (answer === "declined" || asking) return;
		const files = foreignHistoryFiles(process.env, homedir());
		if (answer === undefined) {
			// Checks only that the files exist, which is no read of what the user wrote.
			const present = files.filter((file) => existsSync(file));
			// Without a UI, confirm answers no on its own, which must not count as the user declining.
			if (present.length === 0 || !ctx.hasUI) return;
			const controller = new AbortController();
			asking = controller;
			let agreed: boolean;
			try {
				agreed = await ctx.ui.confirm(
					"Learn words from Claude Code and Codex?",
					`Word completion can read the prompts in ${present.join(" and ")} once, to suggest the words you use. ` +
						"Nothing is read before you agree, and nothing leaves this machine.",
					{ signal: controller.signal },
				);
			} catch {
				// No dialog could be shown. Ask again next session.
				return;
			} finally {
				if (asking === controller) asking = undefined;
			}
			// The session ended before the user answered.
			if (controller.signal.aborted) return;
			answer = agreed ? "accepted" : "declined";
			try {
				saveSeedingAnswer(answerPath(), answer);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Word completion could not save your answer and will ask again: ${reason}`, "warning");
			}
			if (answer === "declined") return;
		}
		await started.opened;
		if (engine !== started) return;
		// False when this snapshot already holds the history, or the store closed meanwhile.
		if (!(await started.store.seed(() => readForeignPrompts(files)))) return;
		// Cached misses from before seeding would hide the words it taught.
		if (engine === started) editor?.resetWordCompletion();
	};

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
		const store = new NgramStore(backend, join(agentDir, "word-completion", "ngram.json"));
		// The default sessions root, and the current session's directory in case `sessionDir` points elsewhere.
		const sessionDirs = [join(agentDir, "sessions"), ctx.sessionManager.getSessionDir()];
		// Cached misses from before a load would hide the words it brought.
		const loaded = () => {
			if (engine === started) editor?.resetWordCompletion();
		};
		const started: Engine = { backend, store, opened: store.open(sessionDirs).then(loaded) };
		engine = started;
		// Read per engine, not kept: the parsed file is garbage once the backend holds it. Without it,
		// a missing or corrupt file, completion uses learned words alone. Seeding does not wait for it:
		// usePrior is safe beside learning, and the 500,000 pairs take a while.
		void loadWebPrior().then(async (prior) => {
			if (!prior || engine !== started) return;
			// The shipped file is sorted and this backend is new, so this does not reject.
			await backend.usePrior(prior);
			loaded();
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
		void offerSeeding(ctx);
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
			void offerSeeding(ctx);
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
		asking?.abort();
		asking = undefined;
		engine?.store.close();
		engine = undefined;
	});
}
