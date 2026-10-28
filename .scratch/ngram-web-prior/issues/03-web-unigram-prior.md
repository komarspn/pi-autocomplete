# 03: Web unigram prior: common words complete on a fresh install

**What to build:** Common English words get ghosts before the user has submitted anything. A build script turns the source chosen in ticket 01 into a compressed prior file that ships with the package. The engine loads it lazily, without blocking pi startup, and mixes it into the unigram level as a Dirichlet prior (omp: `p1(w) = (c(w) + mu1·p0(w)) / (N + mu1)` with `mu1 = 10,000`). The vocabulary becomes prior words plus learned words. Personal history outweighs the prior once it has enough counts. The prior is static and never written to the snapshot. The required attribution ships with the package.

Reference: `docs/omp-word-completion.md`, Engines; omp `crates/pi-predict/src/ngram/model.rs` and `scripts/build-web-prior.ts`.

**Blocked by:** 01, 02

**Status:** done

- [x] With no history, `becau` shows `se` (test)
- [x] A word the user types often wins over a more common web word under the same prefix (test)
- [x] The snapshot does not grow by the size of the prior (test)
- [x] If the prior file is missing or corrupt, completion falls back to learned words only, without error (test)
- [x] The build script is reproducible from the chosen source, and its usage is documented in its header
- [x] Benchmark for one-letter and two-letter prefixes, load time and heap with the prior noted in ticket
- [x] Live check: a fresh agent dir shows a ghost for a common word before any submit

## Notes

The prior is `data/web-prior.tsv.gz`: 150,000 words, 1,044,298 bytes, gzipped `word\tcount` lines sorted by word. `scripts/build-web-prior.ts` streams the 24 English 1-gram files (about 14 GB) from Google's bucket and wrote it in 9.6 minutes on 4 cores. Two runs differed only by the `n't` change made between them, which dropped `n't` and let `jagirdars` in at the cut. The 150,000th word has a count of 95,645.

Source findings that ticket 01 left open:

- Files 0 to 5 hold only numbers and tagged tokens. The files are split by token range, not by hash, so case variants of one word can land in different files.
- Books splits most contractions: `n't` has 4.6M, `don't` only 1.5M. The script drops `n't`. `don't`, `i'm`, `o'clock` and similar stay.
- OCR noise sits near the cut, for example `becaufe` (long s) at 286,855. Ticket 06 folds these.
- Each worker drops words under 100 in its file before the merge. A kept word can lose under 100 per file where its case variants fell below that, which can only move words near the cut.

`NgramBackend.usePrior` gives prior words ids with zero learned counts, so `snapshot` skips them. The unigram level is `(c(w) + 10,000 · p0(w)) / (N + 10,000)` and is the plain learned share when no prior is used. The extension reads the prior per engine, next to the snapshot load. A missing or corrupt file leaves completion on learned words.

Loading does not block pi. Gunzip runs on libuv's thread pool. Parsing, the sortedness check and interning yield every 2,000 entries. Prior words join `order` in one linear merge at the end, so `complete` sees no prior until it is fully in. `monitorEventLoopDelay` over load plus `usePrior`: longest block 12 to 19 ms. Slices of 10,000 gave 22 to 29 ms.

Benchmark, `node --expose-gc scripts/bench-ngram.ts [--prior]`, 10k prompts, three runs each:

| | ticket 02, no prior | with prior |
|---|---|---|
| prior load / `usePrior` | | 162 to 241 ms / 142 to 214 ms |
| training | 1329 to 1376 ms | 2576 to 2768 ms |
| heap after training | +56.4 MiB | +82.7 MiB |
| `complete` p50 / p99 | 35.6 to 40.5 µs / 800 to 861 µs | 61.1 to 69.6 µs / 2037 to 2432 µs |
| 1-letter prefix p50 / p99 | 141 to 165 µs / 1161 to 1306 µs | 671 to 753 µs / 2959 to 3068 µs |
| 2-letter prefix p50 / p99 | 31.4 to 36.3 µs / 208 to 242 µs | 61.0 to 68.6 µs / 607 to 660 µs |
| ghosts shown | 84.9% | 84.5% |

Training is slower because each new learned word is spliced into a 150,000-entry `order` array. One-letter prefixes scan up to about 15,000 prior words and stay under 7 ms at worst.

Live check, `scripts/live-check.sh "" "it was becau"`, shows `se`, and `"please expla"` shows `in`, on a fresh agent dir with no history.

Open: ticket 01 asks for `NOTICE` to be linked from the README. The repo has no README yet (`package.json` lists one in `files`). `NOTICE` ships in the package now. Add the link when the README is written.
