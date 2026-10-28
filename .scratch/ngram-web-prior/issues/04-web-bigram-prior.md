# 04: Web bigram prior: context-aware completion on a fresh install

**What to build:** On a fresh install, the preceding word already shapes the suggestion. The prior file gains two-word counts, and the engine adds a web bigram level under the personal bigram level (omp: `q2(w|v) = λw·pw(w|v) + (1 − λw·S(v))·p1(w)`, where `S(v)` is the mass covered by the web bigram for `v`). Personal bigrams and trigrams still sit above it.

Reference: omp `crates/pi-predict/src/ngram/model.rs`, probability chain.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] With no history, the same prefix gives different words after two different preceding words (test)
- [ ] Learned bigrams still outweigh the web bigram where the user's history disagrees (test)
- [ ] Sentence start is handled as a context, matching how the engine marks the start of a run (test)
- [ ] Benchmark and heap noted in ticket, compared with ticket 03
