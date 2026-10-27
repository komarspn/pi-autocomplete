# 04: Accept and reject details

**What to build:** Accepting and ignoring a ghost feels like omp. Right inserts the suffix with no space, so `'s` or `-based` can follow. Tab inserts the suffix plus a provisional space: a typed space right after is swallowed, a character from `- . , ; : ! ? ) ] }` replaces it, and Enter drops it before splitting the line. Accepts send positive feedback. Typing a character that diverges from the ghost (case-insensitive) sends negative feedback and clears projection. No ghost is shown while pi's autocomplete dropdown is open, and Tab or Right then keep their dropdown behavior. Accepting must not reopen the dropdown.

Reference: `docs/word-completion-architecture.md`, sections 5.3 and 11.

**Blocked by:** 01

**Status:** done

- [x] Right accept inserts suffix only; Right without a ghost moves the cursor as before
- [x] Tab accept then space yields a single space
- [x] Tab accept then `.` yields `word.`
- [x] Tab accept then Enter leaves no trailing space
- [x] Accept and diverge each call backend feedback with the right flag (test with fake backend)
- [x] With the dropdown open, no ghost renders and Tab selects the dropdown item
- [x] Undo after accept restores the pre-accept text in one step

## Comments

- The provisional space is virtual. pi has no public call that deletes one character, so Tab inserts the suffix only and `paintSpace` draws the space after the cursor. The next key inserts it for real unless it is a space, one of `- . , ; : ! ? ) ] }` (kitty and modifyOtherKeys encodings included), Enter, newline or Undo. While the space is pending no ghost is shown. The space is not drawn when the line has no free column, and `getText()` lacks it until the next key.
- Divergence is read from the text after pi handles the key, so any key encoding counts. Negative feedback also drops the provider's projection.
- `pnpm test` passes 88/88. Live check on 2026-10-27, `pi -ne --no-session -e ./extensions/index.ts` in tmux at 100 columns: `please becau` Tab `.` gives `please because.`; `al` Right `-x` gives `all-x`; `go wor` Tab paints `go work ` and Ctrl+_ restores `go wor`.
- Reviewed with openai-codex/gpt-6.1-sol. Fixed from review: modifyOtherKeys keys and multi-character input kept the space.
