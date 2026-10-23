# 05: n-gram engine learning from live prompts

**What to build:** Replace the built-in word list with a TypeScript word-trigram engine behind the same backend interface. It suggests the most likely completion of the prefix given the preceding words, returns null below a show threshold of 0.15, and treats the bare prefix as a candidate so a finished word is not over-completed. It learns each prompt the user submits interactively, received through pi's extension `input` event. Slash commands and non-prose text are filtered with the same gates as ticket 02 before learning. State is in memory only. First confirm which submissions fire `input` (interactive submit, steering while streaming, follow-ups) and record the finding.

Reference: `docs/word-completion-architecture.md`, sections 4, 6 and 13; `docs/omp-word-completion.md`, Engines.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Finding on which submissions fire `input` recorded under Comments
- [ ] After submitting a prompt containing a new word, typing its prefix in a later prompt shows the ghost
- [ ] Suggestions use preceding-word context (test: same prefix, different context, different answer)
- [ ] Below-threshold candidates return null (test)
- [ ] Slash commands and code inside submitted prompts are not learned (test)
- [ ] `complete` does not change learned state (test)
- [ ] `complete` on a model trained with 10k prompts stays under 1 ms median (benchmark noted in ticket)
