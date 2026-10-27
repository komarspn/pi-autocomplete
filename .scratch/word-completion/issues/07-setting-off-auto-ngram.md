# 07: Setting: off / auto / ngram

**What to build:** The user can turn word completion on or off and pick the engine, and the choice persists across restarts. Values are `off`, `auto` and `ngram`; `auto` resolves to `ngram`. Switching methods takes effect at once: the provider clears its cache, queue and projection, and answers from the old method are dropped. `off` shows no ghost and sends no requests, but Tab and Right behave as in stock pi.

Reference: `docs/word-completion-architecture.md`, section 10.

**Blocked by:** 05

**Status:** done

- [x] User can change the setting from inside pi (command or settings UI)
- [x] Setting persists across restarts
- [x] `off` shows no ghost and makes no backend calls (test)
- [x] Switching method mid-typing never shows a stale answer (test)
- [x] `auto` resolves to `ngram`

## Comments

- Command: `/word-completion off|auto|ngram`. Without an argument it opens a picker titled with the current value. The argument completes from the three values. An unknown value is reported as an error and changes nothing. pi 1.4.0 has no settings UI that extensions can add to, so the command is the only way to change it.
- Storage: `<agentDir>/word-completion/settings.json`, `{"method": "..."}`, next to `ngram.json`, written to a temp file and renamed. A missing, corrupt or unknown value reads as `auto`. If the save fails, the new value applies for that run only, and a warning says so.
- `auto` resolves to `ngram` in `resolveMethod`. It is the only engine.
- `off` means the provider has no backend. It returns no ghost and sends no `complete` or `feedback`, so Tab and Right fall through to pi.
- Decided with the user: `off` learns nothing either. Turning it off closes the n-gram store, which saves what it has learned and stops reading past sessions. Prompts typed while off stay in pi's session files, and the next store reads them from its saved offsets. Each store gets a fresh `NgramBackend`, because `restore` adds the snapshot's counts to what the backend already holds.
- Switching: `WordCompletionEditor.setWordCompletionBackend` calls `provider.setBackend`, which bumps the generation and clears the cache, queue, projection and displayed state. It also drops the ghost painted in the last render, so a Tab before the next repaint cannot accept the old answer, and requests a repaint. Switching between `auto` and `ngram` keeps the engine and clears the provider state.
- Review (openai-codex gpt-6.1-sol, standards and spec run as two headless `pi -p` processes, because the subagent tool did not load): fixed the ingestion that kept running after `off`, the missing repaint, the `hasUI` guard on the picker, and a duplicated test helper.
- Live check on 2026-10-27, `pi -ne --offline -e ./extensions/index.ts` in tmux with a temp `PI_CODING_AGENT_DIR` holding one session that said "zygomorphic". `auto` showed `zygo` + dim `morphic`. After `/word-completion off` there was no ghost, Tab left `the zygo` as it was, and `settings.json` held `off`. After a restart it was still off. The picker switched back to `auto` and the ghost returned. After the review fix, `off` and then `ngram` showed the ghost again from the reloaded snapshot.
