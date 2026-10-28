# 01: Choose a licensed source for the web prior and the dictionary

**What to build:** A recorded decision on where the n-gram engine's built-in word knowledge comes from, so the package can ship it legally. Two sources are needed: word and two-word counts for the web prior, and a dictionary of real spellings for the `min_count` rule and misspelling folding.

Candidates:

- Norvig's `count_1w.txt` and `count_2w.txt`, which omp uses. Norvig's page licenses only his code as MIT. The data is derived from the Google Web Trillion Word Corpus (Web 1T 5-gram), distributed by the Linguistic Data Consortium, and the page gives no license for it.
- Google Books Ngram datasets, believed to be CC BY 3.0. Not yet verified. The raw files are very large.
- For the dictionary: SCOWL, or no dictionary, treating a word as real when its web count is at least 200,000 (omp's `TRUSTED_WEB_COUNT`). omp reads `/usr/share/dict/words` at build time, which is absent on the maintainer's machine.

Reference: `docs/omp-word-completion.md`, Engines; `docs/word-completion-architecture.md`, open questions.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [ ] License terms of each candidate quoted from the primary source, with links, under Comments
- [ ] Chosen word-count source recorded, including whether it covers two-word counts
- [ ] Chosen dictionary source recorded, or the decision to use the web-count rule alone
- [ ] Attribution text the package must ship written down
