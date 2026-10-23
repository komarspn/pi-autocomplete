# 04: Accept and reject details

**What to build:** Accepting and ignoring a ghost feels like omp. Right inserts the suffix with no space, so `'s` or `-based` can follow. Tab inserts the suffix plus a provisional space: a typed space right after is swallowed, a character from `- . , ; : ! ? ) ] }` replaces it, and Enter drops it before splitting the line. Accepts send positive feedback. Typing a character that diverges from the ghost (case-insensitive) sends negative feedback and clears projection. No ghost is shown while pi's autocomplete dropdown is open, and Tab or Right then keep their dropdown behavior. Accepting must not reopen the dropdown.

Reference: `docs/word-completion-architecture.md`, sections 5.3 and 11.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Right accept inserts suffix only; Right without a ghost moves the cursor as before
- [ ] Tab accept then space yields a single space
- [ ] Tab accept then `.` yields `word.`
- [ ] Tab accept then Enter leaves no trailing space
- [ ] Accept and diverge each call backend feedback with the right flag (test with fake backend)
- [ ] With the dropdown open, no ghost renders and Tab selects the dropdown item
- [ ] Undo after accept restores the pre-accept text in one step
