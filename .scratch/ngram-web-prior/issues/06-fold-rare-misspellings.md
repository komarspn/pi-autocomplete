# 06: Fold rare misspellings into a real word one edit away

**What to build:** Typing slips are learned as the word the user meant. At learn time, a word that is not a real spelling and has been seen fewer than 3 times (omp `canon_max_count`) counts as an edit-distance-1 neighbour, when that neighbour is a web word or one the user has typed at least 3 times as often (omp `canon_ratio`). Neighbours follow omp's Damerau rules: deletes, adjacent transposes, substitutions and inserts over a to z, except edits of the last letter (inflections), edits of the first letter other than a transposition, and edits touching an apostrophe. The snapshot version is bumped, since the meaning of the counts changes, so old snapshots are rebuilt from session files. The port keeps omp's MIT copyright notice.

Reference: omp `crates/pi-predict/src/ngram/hygiene.rs` and `model.rs`.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `isntead` and `cannonical` learned once count as `instead` and `canonical`, and are never suggested (test)
- [ ] `oauth` does not fold into `auth`, `subagents` not into `subagent`, `we're` not into `were` (test)
- [ ] A word the user types often stops folding once it reaches `canon_max_count` (test)
- [ ] An old-version snapshot is discarded and rebuilt from session files (test)
- [ ] omp's copyright notice is kept with the ported code
