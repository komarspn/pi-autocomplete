# 02: Prefactor: store word counts by word id

**What to build:** The n-gram engine keeps its counts in arrays indexed by word id over a sorted vocabulary, instead of Maps keyed by word strings. Nothing the user sees changes: same ghosts, same snapshot format, same learning. This makes a static base vocabulary of about 150,000 words affordable in memory and keeps one-letter prefixes fast.

Reference: `docs/omp-word-completion.md`, Engines (omp ranks words by lexicographic id so a prefix is one id range).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Existing tests pass unchanged
- [ ] A snapshot saved before the change loads and gives the same completions (test)
- [ ] Words learned live keep the vocabulary sorted, so a prefix is still one contiguous id range (test)
- [ ] The 10k-prompt benchmark is no slower at p50 and p99, and heap after training is no larger (numbers noted in ticket)
