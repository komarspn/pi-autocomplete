# 05: `min_count`: an unknown word needs two uses before it is suggested

**What to build:** A word the user types once by mistake does not come back as a ghost. A word outside the web prior and the dictionary is suggested only after it has been learned at least twice (omp `min_count = 2`). A real spelling is suggested after one use. A word counts as real when it is in the dictionary chosen in ticket 01, or its web count is at least 200,000 (omp `TRUSTED_WEB_COUNT`). The rule only hides words from suggestions; their counts still feed context. If ticket 01 chose a dictionary, it ships here with its attribution.

Reference: omp `crates/pi-predict/src/ngram/mod.rs`, Hygiene.

**Blocked by:** 03

**Status:** done

- [x] An unknown word learned once shows no ghost; learned twice, it does (test)
- [x] A dictionary or frequent web word learned once shows a ghost (test)
- [x] A hidden word still acts as context for the word after it (test)
- [x] Counts from seeding and session bootstrap count toward `min_count` the same as live prompts (test)

## Comments

### Which words pass the gate (agreed with the user, 2026-10-29)

The ticket defines a real word as a dictionary word or one with a web count of at least 200,000, and it also says a word outside the web prior and the dictionary needs two uses. omp's `Model::eligible` (`crates/pi-predict/src/ngram/model.rs`, commit `0b5c27ab`) takes the second reading: a word may be suggested when it is in the web vocabulary, in the dictionary, or typed at least `min_count` times. `TRUSTED_WEB_COUNT` (in `web.rs`) only decides which words shadow habitual slips, which is ticket 06. This ticket follows omp, so every prior word passes and fresh-install ghosts are unchanged. The 200,000 threshold is left for ticket 06 to measure on Books counts, as ticket 01 asked. For scale: 42,218 of the 150,000 prior words are under 200,000 and not in the dictionary.

As in omp (`query.rs`), a hidden word still adds its score to the posterior sum, so it can hold back a weak ghost. It is skipped only as the pick.

## Notes

`NgramBackend.complete` picks the best word among those that may be suggested: a prior word, a dictionary word, or a word with a learned count of at least `MIN_COUNT = 2`. The learned count is the unigram count, so live prompts, past sessions, seeding and restored snapshots all add to it alike. Bigrams and trigrams of hidden words are kept and used as context. Nothing in the snapshot changes.

The dictionary is `data/dictionary.txt.gz`: 107,225 lowercase words, 283,417 bytes. It comes from ESDB commit `1e5b7d3a72f47a71da5d28686c1dd4b397178485`, `./scowl --db scowl.db word-list 60 A 1`, which gave 109,143 entries. `scripts/build-dictionary.ts` lowercases them, keeps those that are words as the engine reads one, which drops dotted abbreviations and hyphenated words, and writes them sorted after the ESDB notice in `#` lines. Its header lists the build steps. Two runs gave the same bytes. 40,711 of the words are not in the prior, for example `aardvarks`, `cosmologist`, `candyfloss`.

`loadDictionary` reads it per engine beside the prior and never rejects. A missing or corrupt file leaves the gate on prior words and counts. `NgramBackend.useDictionary` takes the set; it adds no word to the vocabulary. `NOTICE` now holds ticket 01's full text, with the ESDB notice and "word and two-word counts". The README names the dictionary and the two-use rule.

`node --expose-gc`, three runs: load 69 to 74 ms, longest event-loop block 6 to 8 ms, heap +6.4 MiB.

Tests that learned a word once and expected a ghost now learn it twice or give the backend a small dictionary, depending on what they test. The store tests use a dictionary backend by default. Negative tests that learned a word once now learn it twice, so a leak would still show.

Live check not run: `tmux` is missing on this machine, and `scripts/live-check.sh` needs it.
