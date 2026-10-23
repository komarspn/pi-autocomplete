# 02: Prose gating

**What to build:** Ghost text appears only for prose words. Port omp's query builder, per-line prose check, whole-buffer prose source and markdown masking. No ghost inside fenced code (including fences spanning lines), inline code, or HTML/XML; none for tokens containing `\ / @ _ = : { } [ ] < >`, camelCase or digits; none on lines starting with `/`, `->` or `=>`; none in the middle of a word; none when the buffer exceeds 20,000 or the line exceeds 1,000 UTF-16 units. The context sent to the backend is the text before the word, capped at 2,000 UTF-16 units without splitting a surrogate pair.

Reference: `docs/word-completion-architecture.md`, section 6. omp code is MIT; keep the copyright notice on ported files.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Unit tests cover each gate rule listed above, positive and negative
- [ ] Multi-line fenced code blocks suppress the ghost on every line inside them
- [ ] Masking returns text of identical length; text with no backtick, `<` or `~~~` is returned unchanged
- [ ] Context cap never starts on a low surrogate (test)
- [ ] Whole-buffer mask is recomputed only when the text changes
- [ ] In pi, typing a path, code span or slash command shows no ghost
