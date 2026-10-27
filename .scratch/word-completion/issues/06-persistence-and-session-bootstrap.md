# 06: Persistence and session bootstrap

**What to build:** The learned model survives pi restarts. The engine saves a versioned snapshot plus an ingest cursor, debounced after changes and also on shutdown, written to a temp file and renamed. A corrupt or incompatible snapshot is discarded and rebuilt. On first run with no snapshot, the engine bootstraps from user messages in pi's session JSONL files, handling message content as a string or as an array of parts, and skipping slash commands. Later runs ingest only sessions or messages past the cursor so nothing is counted twice. First confirm where pi extensions should store data on disk and record the finding.

Reference: `docs/word-completion-architecture.md`, sections 9 and 13.

**Blocked by:** 05

**Status:** done

- [x] Storage location finding recorded under Comments
- [x] Words learned in one pi run are suggested after restart
- [x] Fresh install with existing sessions shows ghosts from past prompts on first use
- [x] Second bootstrap pass ingests nothing new (test)
- [x] Both content shapes parse (test with fixture lines)
- [x] Corrupt snapshot triggers rebuild, not a crash (test)
- [x] Killing pi mid-session loses at most the unsaved window, never the snapshot

## Comments

- Storage location, read from pi 1.4.0 `docs/configuration.md`, `docs/extensions.md` ("State") and `dist/config.js`: pi has no per-extension data directory. Its docs send state that outlives one session to "External storage". `getAgentDir()` is exported from the package root and returns `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The extension stores `<agentDir>/word-completion/ngram.json`. It avoids `<agentDir>/extensions/`, where pi discovers extensions. Sessions live in `<agentDir>/sessions/--<cwd>--/*.jsonl`, or flat in a custom `sessionDir`; the extension scans both, through `ctx.sessionManager.getSessionDir()`.
- Session contents: user messages have `content` as a string or as an array of `text`/`image` parts. pi stores `/skill:name args` already expanded as a `<skill name=... location=...>` block (`parseSkillBlock`, exported). Bootstrap skips those messages, matching live learning, which skips every `/` prompt. Prompt templates are stored expanded and cannot be told apart from typed text, so bootstrap learns them. Messages from `pi.sendUserMessage` and RPC look the same as typed ones in the file, so bootstrap learns them too.
- Design: the snapshot is a cache over the session files. `ngram.json` holds a version, the n-gram counts, a byte offset per session file (always at a line end), and the timestamps of every user message already learned. Each start loads the snapshot, reads every session file from its offset, and skips messages whose timestamp is already learned. `message_end` for a user message adds its timestamp. pi runs extension handlers before it appends the message, so a prompt learned live through `input` is not read again. A file shorter than its offset was rewritten; it is read again from the start. A line pi has not finished writing is left for the next run.
- Why a timestamp set and not a newest-timestamp mark per file (changed after review): pi stamps a follow-up when it is queued (`agent-session.js` `_queueFollowUp`), so a steer sent later can be written first, and a per-file mark would skip the follow-up. `/fork` copies the branch's entries, timestamps included, into a new file (`session-manager.js` `createBranchedSession`), and a per-file mark would count that history again. The set costs about 14 bytes per prompt and never shrinks.
- Message parts are joined with newlines before learning, as one typed prompt, so a `/` command or code fence split across parts is still caught by the prose gates.
- Saves: 5 minutes after the last change and at most 15 minutes after the first unsaved one, like omp, plus on `session_shutdown`. The file is written to `ngram.json.<pid>.tmp` and renamed. Timers are unref'd. A corrupt, malformed or other-version snapshot is ignored, rebuilt from the sessions, and replaced by the next save.
- Real data (this machine, i5-4310M, Node 24.16, 448 MB in 1,064 session files): first bootstrap 1.4 s, a second start 176 ms, snapshot 1.6 MB with 4,247 words, save 40 ms. After the timestamp-set change, with the machine at load average 2 to 3: first bootstrap 1.9 to 2.4 s, second start 234 ms, snapshot still 1.6 MB with 2,759 learned timestamps across 889 files.
- Live check on 2026-10-27, `pi -ne --offline -e ./extensions/index.ts` in tmux with a temp `PI_CODING_AGENT_DIR` holding one old session that said "zygomorphic": first use showed `zygo` + dim `morphic`. Submitted "check the floriculture notes", `/quit`, restarted: `flori` showed `culture`. A submit followed by `kill -9` of the pi node process left `ngram.json` byte-identical and valid, with no temp file, and lost only that prompt. Offline pi wrote no session file, so the restart check exercised the snapshot path alone. An idle save landed 5 minutes after a submit.
- Known limits, accepted after review:
  - Two pi processes share one snapshot and the last save wins. The other process's prompts are still in its session file past the saved offset, so the next start learns them again. Only `--no-session` prompts are lost.
  - Closing before the snapshot finishes loading skips the save. Prompts typed in that window are relearned from the session file next time, except with `--no-session`.
  - `input` carries no timestamp, so a queued prompt is learned at `input` but marked at `message_end`. A save between the two, then a crash before the next save, counts it twice.
