# 04: Web bigram prior: context-aware completion on a fresh install

**What to build:** On a fresh install, the preceding word already shapes the suggestion. The prior file gains two-word counts, and the engine adds a web bigram level under the personal bigram level (omp: `q2(w|v) = λw·pw(w|v) + (1 − λw·S(v))·p1(w)`, where `S(v)` is the mass covered by the web bigram for `v`). Personal bigrams and trigrams still sit above it.

Reference: omp `crates/pi-predict/src/ngram/model.rs`, probability chain.

**Blocked by:** 03

**Status:** done

- [x] With no history, the same prefix gives different words after two different preceding words (test)
- [x] Learned bigrams still outweigh the web bigram where the user's history disagrees (test)
- [x] Sentence start is handled as a context, matching how the engine marks the start of a run (test)
- [x] Benchmark and heap noted in ticket, compared with ticket 03

## Notes

The prior file keeps its 150,000 word lines, then a `\tsentences` line, then 500,000 `context\tword\tcount` lines over 28,078 contexts, sorted by context then word. The empty context is the sentence start. The file is 4,818,151 bytes, up from 1,044,298. The word lines are byte for byte those of ticket 03.

`scripts/build-web-prior.ts` streamed all 589 2-gram files (about 324 GB) in 95 minutes with `--jobs 4`, reusing the word lines via `--unigrams`. It skips pairs with a tagged token, except `_START_` on the left. Every `_START_ x` line adds to the sentence count: 100,851,602,906. Workers drop pairs under 1,000 per file. The 500,000th pair has 213,786. The first run died at file 454: a V8 `Map` holds at most 2^24 entries, and the merge passed 16.7 million. The merge now spreads over 64 Maps and reached 25 million. A 4-file run gave the same output byte for byte before and after the change.

The engine follows omp with `λw = 1`: `q2(w|v) = pw(w|v) + (1 − S(v))·p1(w)`, `pw(w|v) = c(vw)/c(v)`, and `S(v)` is the sum of v's rows, capped at 1 because per-file pruning can push it a little over. The sentence-start rows use the sentence count as `c(v)`. `complete` finds the first row under the prefix by binary search and walks the rows in step with the candidates, since both are sorted by word. Rows are built aside and swapped in with the word merge, so `complete` never sees part of them.

Behavior change, agreed with the user: the sentence-start rows cover S = 0.738, so at sentence start a word learned only mid-sentence loses to common openers for longer. `flori` at sentence start needs 3 prompts of `the floriculture notes` to beat `florida` (ticket 03: 1). `ver` needs 30 prompts of `bump the version` to beat `very` (ticket 03: 12). After a context the user has typed, learned bigrams still win at once. omp offsets this with a prompt-local cache, which this package lacks. Two earlier tests now check their words where the web rows have no say: the ticket 03 test after `please `, the seeding test after `the `.

Loading the real prior first took 1.0 s plus 0.8 s for `usePrior`, from string lookups per pair row. `WebPrior.pairs` now holds typed arrays of word indexes, which the loader resolves once through a `Map` filled while it reads the words. The loader decodes 256 KB chunks rather than one 12 MB string and reads fields in place, without a slice per line. `usePrior` checks the pairs with integer compares.

The seeding test failed every time even after that. Earlier tests leave about 12 sessions loading the prior at once, each then takes about 5 s, and seeding waited for the prior through `started.opened`. Seeding now waits only for the store; the prior loads beside it. `usePrior` was already safe beside learning.

`monitorEventLoopDelay` over load plus `usePrior`: longest block 8 to 27 ms, against 9 to 10 ms for the ticket 03 build on the same machine. The long ones are full GC pauses of 13 to 23 ms on the larger heap. Writing rows into typed arrays as they are read gave no clear gain and was left out.

Benchmark, `node --expose-gc scripts/bench-ngram.ts --prior`, 10k prompts, three runs each on the same machine and day. Ticket 03's own figures are in its table; they were taken on another day, so the ticket 03 column here is that commit rerun.

| | ticket 03 build | with web pairs |
|---|---|---|
| prior load / `usePrior` | 101 to 146 ms / 109 to 177 ms | 563 to 581 ms / 180 to 203 ms |
| training | 1721 to 1748 ms | 1628 to 1783 ms |
| heap after training | +82.7 MiB | +90.4 MiB |
| `complete` p50 / p99 | 40.4 to 42.5 µs / 1164 to 1500 µs | 40.4 to 42.3 µs / 1440 to 1719 µs |
| 1-letter prefix p50 / p99 | 497 to 574 µs / 1504 to 1879 µs | 537 to 590 µs / 1854 to 2298 µs |
| 2-letter prefix p50 / p99 | 41.9 to 46.3 µs / 382 to 455 µs | 43.6 to 46.3 µs / 425 to 548 µs |
| ghosts shown | 84.5% | 84.4% |

The bench prompts rarely hit a context with web rows, so it now also times 5,000 queries right after one: 1-letter p50 387 to 416 µs, p99 986 to 1137 µs; 2-letter p50 56 to 58 µs, p99 263 to 295 µs.

Live check on a fresh agent dir: `of th` shows `e`, `I think th` shows `at`.
