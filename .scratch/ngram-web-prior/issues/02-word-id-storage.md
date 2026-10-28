# 02: Prefactor: store word counts by word id

**What to build:** The n-gram engine keeps its counts in arrays indexed by word id over a sorted vocabulary, instead of Maps keyed by word strings. Nothing the user sees changes: same ghosts, same snapshot format, same learning. This makes a static base vocabulary of about 150,000 words affordable in memory and keeps one-letter prefixes fast.

Reference: `docs/omp-word-completion.md`, Engines (omp ranks words by lexicographic id so a prefix is one id range).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Existing tests pass unchanged
- [x] A snapshot saved before the change loads and gives the same completions (test)
- [x] Words learned live keep the vocabulary sorted, so a prefix is still one contiguous range of ids in `order` (test)
- [x] The 10k-prompt benchmark is no slower at p50 and p99, and heap after training is no larger (numbers noted in ticket)

## Notes

Ids are stable, in the order words were first seen, not lexicographic ranks. A rank-based id would shift for every new word and force a rewrite of every count table. Decided with the user after review. A separate `order` array holds the ids sorted by word, so a prefix is one contiguous slice of `order`. Ticket 03 can give the static base words ids 0..N-1 in sorted order, which makes `order` start as the identity for them.

Unigram counts are an array indexed by id. Bigram and trigram tables stay sparse Maps, now keyed by numeric id instead of strings. The user accepted this after review, since dense per-context arrays would waste memory on a 150k vocabulary. A trigram context packs both ids into one number, so it no longer builds a `previous\0current` string per lookup. The snapshot still holds words, converted on save and load.

Benchmark: `node --expose-gc scripts/bench-ngram.ts`, 10k prompts, three runs each. The script now runs `gc()` before reading the heap when it is exposed, since without it the figure swung between 101 and 107 MiB.

| | Maps keyed by words | Arrays by word id |
|---|---|---|
| training | 1926 to 2159 ms | 1294 to 1320 ms |
| heap after training | +67.1 MiB | +56.2 MiB |
| `complete` p50 | 44.5 to 47.2 µs | 33.3 to 35.3 µs |
| `complete` p99 | 1591 to 1769 µs | 604 to 741 µs |
| ghosts shown | 84.9% | 84.9% |
