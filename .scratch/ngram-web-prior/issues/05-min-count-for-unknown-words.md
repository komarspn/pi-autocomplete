# 05: `min_count`: an unknown word needs two uses before it is suggested

**What to build:** A word the user types once by mistake does not come back as a ghost. A word outside the web prior and the dictionary is suggested only after it has been learned at least twice (omp `min_count = 2`). A real spelling is suggested after one use. A word counts as real when it is in the dictionary chosen in ticket 01, or its web count is at least 200,000 (omp `TRUSTED_WEB_COUNT`). The rule only hides words from suggestions; their counts still feed context. If ticket 01 chose a dictionary, it ships here with its attribution.

Reference: omp `crates/pi-predict/src/ngram/mod.rs`, Hygiene.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] An unknown word learned once shows no ghost; learned twice, it does (test)
- [ ] A dictionary or frequent web word learned once shows a ghost (test)
- [ ] A hidden word still acts as context for the word after it (test)
- [ ] Counts from seeding and session bootstrap count toward `min_count` the same as live prompts (test)
