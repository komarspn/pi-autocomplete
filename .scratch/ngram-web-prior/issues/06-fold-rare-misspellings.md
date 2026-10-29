# 06: Fold rare misspellings into a real word one edit away

**What to build:** Typing slips are learned as the word the user meant. At learn time, a word that is not a real spelling and has been seen fewer than 3 times (omp `canon_max_count`) counts as an edit-distance-1 neighbour, when that neighbour is a web word or one the user has typed at least 3 times as often (omp `canon_ratio`). Neighbours follow omp's Damerau rules: deletes, adjacent transposes, substitutions and inserts over a to z, except edits of the last letter (inflections), edits of the first letter other than a transposition, and edits touching an apostrophe. The snapshot version is bumped, since the meaning of the counts changes, so old snapshots are rebuilt from session files. The port keeps omp's MIT copyright notice.

Reference: omp `crates/pi-predict/src/ngram/hygiene.rs` and `model.rs`.

**Blocked by:** 05

**Status:** done

- [x] `isntead` and `cannonical` learned once count as `instead` and `canonical`, and are never suggested (test)
- [x] `oauth` does not fold into `auth`, `subagents` not into `subagent`, `we're` not into `were` (test)
- [x] A word the user types often stops folding once it reaches `canon_max_count` (test)
- [x] An old-version snapshot is discarded and rebuilt from session files (test)
- [x] omp's copyright notice is kept with the ported code

## Comments

### Fold rules (agreed with the user, 2026-10-29)

A real spelling is a dictionary word or a prior word with a web count of at least 2,000,000, not omp's 200,000 (`TRUSTED_WEB_COUNT`, set for Web 1T). On Books counts, 21 of 53 common misspellings checked reach 200,000, among them `occured` (1,065,180), `untill` (1,123,204), `seperate` (255,620) and `thier` (271,840). A real spelling never folds, so these would stay as typed. None of the 53 reach 2,000,000. 2,148 prior words outside the dictionary do, with some OCR noise such as `diflicult`, which matters only if typed. A web neighbour is a prior word that is a real spelling.

The user first chose the dictionary alone. Run over this repo's docs and tickets, that folded `neighbour` (9,522,322) into `neighbor`, `acknowledgement` into `acknowledgment` and `const` into `cost` for their first 3 uses, so the user moved to the 2,000,000 cut.

Of omp's rules the ticket leaves out, the port keeps one: words under 5 characters never fold (`HYGIENE_MIN_CHARS`). It drops two. A typed neighbour needs only the 3x ratio, not also a dictionary entry or 10 uses. A typed neighbour that misses the ratio does not stop a web neighbour from winning. As in omp, a typed neighbour beats a web one, and among each kind the higher count wins. omp's shadowing of habitual slips (`SHADOWED`, `for_each_slip`) is not part of this ticket.

Tests sit at `NgramBackend` (observe, complete, snapshot) and `NgramStore.open`.

### Review (2026-10-29)

Reviewed with openai-codex gpt-6.1-sol on two axes. Fixed: the README said a fold never changes the first or last letter, but an adjacent transpose at either end is allowed (`htere` folds into `there`). Also fixed: `ALPHABET` is a string, and an unused test helper parameter was removed. Declined: counting a word's folded-in occurrences toward its typed count, because omp's `learn` adds to `raw[target]` on a fold too.

Left as a follow-up, agreed with the user: a misspelling that is itself a prior word, such as `seperate` (255,620) or `occured` (1,065,180), is still suggested from its prior count, even under `seper` on a fresh install. Folding only stops learned typos from adding to it. omp hides such words by shadowing (`SHADOWED`), which this ticket leaves out.

## Notes

`NgramBackend.observe` folds each word through `canonical` before counting it. The folded spelling's unigram, bigram and trigram counts go to the real word, as in omp. A real spelling is a dictionary word or a prior word whose web share is at least 2,000,000 out of the prior total. Words under 5 characters never fold. `src/slip-neighbours.ts` ports omp's `for_each_neighbour`, with omp's MIT notice in its header and in `NOTICE`.

A spelling's typed count is its own unigram count plus `folded`, the times it was learned as another word. The snapshot saves `folded`, so a spelling typed 3 times stops folding after a restart too. `NgramStore` is at version 2 and rebuilds version 1 files from the sessions.

Cost: 1,950 paragraphs from this repo's docs and tickets, 54,500 words, learned in 368 ms with the shipped prior and dictionary (6.8 µs a word, 8.2 µs before this ticket). The slowest paragraph took 8.9 ms. Eight spellings folded: `backend` into `backed`, `lookups`, `unported`, `gzipped`, `actioned`, `stdout`, `debounce`, `debounced`. Each folds for its first 3 uses only. `scripts/bench-ngram.ts` uses random words and no dictionary, so every word of 5 or more letters takes the check. Its training time went from 3.5 s to 92 s for 10,000 prompts; its `complete` times did not change.

Live check not run: `tmux` is missing on this machine, and `scripts/live-check.sh` needs it.
