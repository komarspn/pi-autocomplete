# 03: Web unigram prior: common words complete on a fresh install

**What to build:** Common English words get ghosts before the user has submitted anything. A build script turns the source chosen in ticket 01 into a compressed prior file that ships with the package. The engine loads it lazily, without blocking pi startup, and mixes it into the unigram level as a Dirichlet prior (omp: `p1(w) = (c(w) + mu1·p0(w)) / (N + mu1)` with `mu1 = 10,000`). The vocabulary becomes prior words plus learned words. Personal history outweighs the prior once it has enough counts. The prior is static and never written to the snapshot. The required attribution ships with the package.

Reference: `docs/omp-word-completion.md`, Engines; omp `crates/pi-predict/src/ngram/model.rs` and `scripts/build-web-prior.ts`.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] With no history, `becau` shows `se` (test)
- [ ] A word the user types often wins over a more common web word under the same prefix (test)
- [ ] The snapshot does not grow by the size of the prior (test)
- [ ] If the prior file is missing or corrupt, completion falls back to learned words only, without error (test)
- [ ] The build script is reproducible from the chosen source, and its usage is documented in its header
- [ ] Benchmark for one-letter and two-letter prefixes, load time and heap with the prior noted in ticket
- [ ] Live check: a fresh agent dir shows a ghost for a common word before any submit
