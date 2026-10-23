# 03: Smooth async behavior

**What to build:** Fast typing never causes flicker or a pile of backend requests. The provider keeps one request in flight and only the newest queued miss. Answers, including null, are cached by method, prefix and context, with a size cap. When the user types the next letters of a shown ghost, the provider projects the rest of that word at once instead of blanking while the new query runs. A generation counter discards answers that arrive after the engine or method changed. A repaint is requested only when an answer belongs to the displayed query and changes what is on screen. The last query is memoized so repeated renders skip the gates.

Reference: `docs/word-completion-architecture.md`, section 7.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] With a slow fake backend, typing ten characters sends at most two requests (first and latest)
- [ ] Null answers are cached and not re-requested
- [ ] Cache stays within its cap
- [ ] Typing through a shown ghost keeps showing the remaining suffix with no blank frame (test)
- [ ] Answers from before a method change are neither cached nor shown
- [ ] No repaint request for answers that do not change the screen
