# 03: Smooth async behavior

**What to build:** Fast typing never causes flicker or a pile of backend requests. The provider keeps one request in flight and only the newest queued miss. Answers, including null, are cached by method, prefix and context, with a size cap. When the user types the next letters of a shown ghost, the provider projects the rest of that word at once instead of blanking while the new query runs. A generation counter discards answers that arrive after the engine or method changed. A repaint is requested only when an answer belongs to the displayed query and changes what is on screen. The last query is memoized so repeated renders skip the gates.

Reference: `docs/word-completion-architecture.md`, section 7.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] With a slow fake backend, typing ten characters sends at most two requests (first and latest)
- [x] Null answers are cached and not re-requested
- [x] Cache stays within its cap
- [x] Typing through a shown ghost keeps showing the remaining suffix with no blank frame (test)
- [x] Answers from before a method change are neither cached nor shown
- [x] No repaint request for answers that do not change the screen

## Comments

- The engine switch is `WordCompletionProvider.setBackend(backend)`. Ticket 07 maps a method to a backend and calls it, so the cache key holds no method. A request still in flight from the old backend keeps the single slot until it settles, and its answer is dropped.
- Clearing projection on negative feedback moves to ticket 04 with the rest of reject handling.
- Open from review: when the editor skips the provider (no focus, dropdown open), the provider still treats the last query as displayed, so an answer for it can request one repaint that changes nothing. Also, projection compares by slicing before lowercasing, so letters whose lowercase form is longer (`İ`) do not project.
