# 08: Opt-in seeding from Claude Code and Codex history

**What to build:** An empty model can be seeded from the user's Claude Code and Codex prompt history, but only after the user explicitly agrees. Reads `~/.claude/history.jsonl` (field `display`, or `text` in older versions) and `~/.codex/history.jsonl` (`text`). Skips slash commands and strips Claude Code placeholders like `[Pasted text #n]` and `[Image #n]`. Seeding runs once; declining is remembered and not asked again.

Reference: `docs/omp-word-completion.md`, end-to-end flow step 9.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] No foreign file is read before the user agrees
- [ ] After agreeing, prompts from both files are learned (test with fixtures)
- [ ] Missing files are skipped without error
- [ ] Placeholders and slash commands are not learned (test)
- [ ] Seeding happens at most once; declining is persisted
