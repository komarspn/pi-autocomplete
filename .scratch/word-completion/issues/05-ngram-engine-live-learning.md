# 05: n-gram engine learning from live prompts

**What to build:** Replace the built-in word list with a TypeScript word-trigram engine behind the same backend interface. It suggests the most likely completion of the prefix given the preceding words, returns null below a show threshold of 0.15, and treats the bare prefix as a candidate so a finished word is not over-completed. It learns each prompt the user submits interactively, received through pi's extension `input` event. Slash commands and non-prose text are filtered with the same gates as ticket 02 before learning. State is in memory only. First confirm which submissions fire `input` (interactive submit, steering while streaming, follow-ups) and record the finding.

Reference: `docs/word-completion-architecture.md`, sections 4, 6 and 13; `docs/omp-word-completion.md`, Engines.

**Blocked by:** 01

**Status:** done

- [x] Finding on which submissions fire `input` recorded under Comments
- [x] After submitting a prompt containing a new word, typing its prefix in a later prompt shows the ghost
- [x] Suggestions use preceding-word context (test: same prefix, different context, different answer)
- [x] Below-threshold candidates return null (test)
- [x] Slash commands and code inside submitted prompts are not learned (test)
- [x] `complete` does not change learned state (test)
- [x] `complete` on a model trained with 10k prompts stays under 1 ms median (benchmark noted in ticket)

## Comments

- Which submissions fire `input`, read from pi 1.4.0 `dist/core/agent-session.js` and `dist/modes/interactive/interactive-mode.js`:
  - Enter while idle: `AgentSession.prompt` fires `input` with `source: "interactive"` and no `streamingBehavior`. It fires before the model and auth checks, so a prompt that then fails is still seen.
  - Enter while streaming (steer) and Alt+Enter while streaming (follow-up): `prompt(text, { streamingBehavior })` fires `input` with `streamingBehavior` `"steer"` or `"followUp"`. `AgentSession.steer` and `followUp` fire it too, through `_queueUserInput`.
  - Prompts typed during compaction are queued and fire `input` later, when the queue is flushed after compaction.
  - The initial prompt from the command line fires `input` with `source: "interactive"`.
  - No `input` for built-in commands (`/model`, `/new`, `/compact` and the rest are handled in interactive mode before `prompt`), for `!`/`!!` shell lines, or for extension commands (`prompt` runs them and returns first).
  - Skill and prompt-template commands (`/skill:name args`, `/template args`) do fire `input`, with the text before expansion. `proseRuns` skips any prompt that starts with `/`.
  - `pi.sendUserMessage` from extensions fires `input` with `source: "extension"`; RPC prompts use `"rpc"`. The extension learns only `"interactive"`.
- Benchmark: `node scripts/bench-ngram.ts` trains on 10,000 synthetic prompts (Zipf over 20,000 words, 4 to 60 words each), then times 5,000 `complete` calls with 1 to 4 letter prefixes. On an i5-4310M with Node 24.16: `complete` p50 45 µs, p90 390 µs, p99 1.4 ms. Training takes 2.0 s and adds about 106 MiB of heap. The tail comes from one-letter prefixes, which score every word under the letter.
- Live check on 2026-10-27: `pi -ne --offline --no-session -e ./extensions/index.ts` in tmux at 100 columns, with an empty `PI_CODING_AGENT_DIR` and a cleared environment, so no model was available and nothing left the machine. Before any submit, `zygo` showed no ghost. After submitting `please look at the zygomorphic flower`, `a zygo` showed a dim `morphic`. A submitted `/skill:nothing quixotically` taught nothing: `a quix` stayed bare.
- The word list backend is gone, so a new session shows no ghosts until the user has submitted prompts. Ticket 06 adds persistence and bootstrap.
- Review with openai-codex gpt-6.1-sol (standards and spec reviewers). The spec reviewer found that learning skipped the open-code-span gate, so `run \`zygomorphic` taught `zygomorphic`. `proseRuns` now rejects words after an unclosed backtick in their paragraph, with a test. Standards fixes: `!` only after a check, `readonly` test parameter, `add` renamed `countContinuation`. Not changed: multi-line export doc comments, which match existing code such as `paintGhost`; the binary search duplicated in the benchmark script. `pnpm test` passes 91/91.
