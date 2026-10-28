# 08: Opt-in seeding from Claude Code and Codex history

**What to build:** A model not yet seeded, empty or not, can be seeded from the user's Claude Code and Codex prompt history, but only after the user explicitly agrees. Reads `~/.claude/history.jsonl` (field `display`, or `text` in older versions) and `~/.codex/history.jsonl` (`text`). Skips slash commands and strips Claude Code placeholders like `[Pasted text #n]` and `[Image #n]`. Seeding runs once; declining is remembered and not asked again.

Reference: `docs/omp-word-completion.md`, end-to-end flow step 9.

**Blocked by:** 06

**Status:** done

- [x] No foreign file is read before the user agrees
- [x] After agreeing, prompts from both files are learned (test with fixtures)
- [x] Missing files are skipped without error
- [x] Placeholders and slash commands are not learned (test)
- [x] Seeding happens at most once; declining is persisted

## Comments

- When it asks: on session start, and after `/word-completion` turns an engine on, while no answer is saved and at least one history file exists. Only `existsSync` touches the files before a yes. It never asks while off or without a UI; in print mode `confirm` answers no on its own, which must not be saved as a decline.
- The question opens after `setEditorComponent`. pi's `setCustomEditorComponent` calls `disposeActiveSelector()` and clears the editor container, so a dialog opened first is destroyed without an answer (seen in the live check).
- The answer is saved in `<agentDir>/word-completion/foreign-history.json` as `{"answer":"accepted"}` or `{"answer":"declined"}`. Escape counts as declined. Ending the session while the dialog is open aborts it through its `signal` and saves nothing, so the next session asks again.
- "At most once" is per snapshot: `ngram.json` gains an optional `seeded` flag. A snapshot rebuilt after corruption lost the seeded counts, so with an accepted answer it is seeded again. Snapshots from before this change have no flag and are seeded once; no version bump.
- Paths follow each tool's config variable: `$CLAUDE_CONFIG_DIR/history.jsonl` or `~/.claude/history.jsonl`, and `$CODEX_HOME/history.jsonl` or `~/.codex/history.jsonl`. Claude Code lines use `display` (older ones `text`), Codex lines `text`. Lines whose prompt starts with `/` after leading spaces are skipped, and `[Pasted text #n ...]` and `[Image #n]` are removed. Foreign prompts are not added to the learned timestamp set, since their timestamps are unrelated to pi's.
- Live check on 2026-10-28 with fixture history files: the dialog listed both paths, Yes made `zygo` show `morphic` and saved `seeded: true`; the placeholder taught nothing. A restart did not ask and left the counts unchanged. With a fresh agent dir, No saved `declined` and `zygo` showed no ghost.
- Review on 2026-10-28 (openai-codex gpt 6.1 sol, standards and spec axes):
  - Fixed: `seed()` set the saved `seeded` flag before the read finished, so a `close()` during the read saved `seeded: true` without the counts and the import never ran again. The in-flight guard is now a separate unsaved `isSeeding`; `seeded` is set after learning. Regression test added.
  - Fixed: multi-line JSDoc on exported functions in `foreign-history.ts`, against the one-line rule.
  - Decided: seeding is offered to any model not yet seeded, not only an empty one, so users with an existing snapshot are asked once too. The spec line above was amended.
  - Left as is: `saveSeedingAnswer` repeats the temp-file-and-rename write of `saveMethod`. Two small copies; extract a helper if a third appears.
