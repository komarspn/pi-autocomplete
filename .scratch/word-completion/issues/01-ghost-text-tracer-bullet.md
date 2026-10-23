# 01: Ghost text tracer bullet

**What to build:** Installing the extension replaces pi's prompt editor with a subclass of pi's `CustomEditor` that keeps all app shortcuts. When the cursor sits at the end of a line after a partial word, the editor shows the rest of the word in dim text after the cursor. Suggestions come from a small built-in word list served through the async backend interface from the architecture doc (`complete(before, prefix)` resolving to a suffix or null, plus fire-and-forget `feedback`). A minimal provider asks the backend on a cache miss, never blocks render, and requests a repaint when the answer arrives. Tab inserts the suffix. This ticket also settles how the ghost is painted: find the cursor position in the rendered line, keep line width and padding correct, and hide the ghost when it would overflow the content width.

Reference: `docs/word-completion-architecture.md`, sections 4, 5 and 13.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Loading the extension in pi swaps in the new editor; existing app shortcuts still work
- [ ] Typing a known word prefix at end of line shows the dim suffix after the cursor
- [ ] No ghost when the cursor is not at end of its line
- [ ] Tab inserts the suffix; without a ghost, Tab keeps pi's normal behavior
- [ ] Rendered lines keep their exact width with and without a ghost; a ghost that would overflow is hidden (unit test on render output)
- [ ] Ghost appears without a keystroke when the async answer arrives (repaint requested)
- [ ] Findings on cursor-marker placement (focused, scrolled, paste markers) recorded in the ticket under Comments
