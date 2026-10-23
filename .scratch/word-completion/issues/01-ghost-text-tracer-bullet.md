# 01: Ghost text tracer bullet

**What to build:** Installing the extension replaces pi's prompt editor with a subclass of pi's `CustomEditor` that keeps all app shortcuts. When the cursor sits at the end of a line after a partial word, the editor shows the rest of the word in dim text after the cursor. Suggestions come from a small built-in word list served through the async backend interface from the architecture doc (`complete(before, prefix)` resolving to a suffix or null, plus fire-and-forget `feedback`). A minimal provider asks the backend on a cache miss, never blocks render, and requests a repaint when the answer arrives. Tab inserts the suffix. This ticket also settles how the ghost is painted: find the cursor position in the rendered line, keep line width and padding correct, and hide the ghost when it would overflow the content width.

Reference: `docs/word-completion-architecture.md`, sections 4, 5 and 13.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Loading the extension in pi swaps in the new editor; existing app shortcuts still work
- [x] Typing a known word prefix at end of line shows the dim suffix after the cursor
- [x] No ghost when the cursor is not at end of its line
- [x] Tab inserts the suffix; without a ghost, Tab keeps pi's normal behavior
- [x] Rendered lines keep their exact width with and without a ghost; a ghost that would overflow is hidden (unit test on render output)
- [x] Ghost appears without a keystroke when the async answer arrives (repaint requested)
- [x] Findings on cursor-marker placement (focused, scrolled, paste markers) recorded in the ticket under Comments

## Comments

### Cursor-marker placement findings (pi-tui 1.4.0)

- **Focused, cursor at end of line.** `Editor.render` emits `CURSOR_MARKER` + `renderFakeCursor(" ")` followed by padding spaces only (`pi-tui/dist/components/editor.js:455`). `paintGhost` (`src/ghost-text.ts`) anchors on that exact sequence. It replaces the space with `renderFakeCursor(dim(first grapheme)) + dim(rest)` and removes `suffixWidth - 1` padding spaces. When the hardware cursor is on, `TUI.resolveFakeCursors` (`tui.js:1087`) strips the fake-cursor wrappers after the marker but keeps the text, so the first ghost character shows under the terminal cursor.
- **Not focused.** pi emits no `CURSOR_MARKER`, only the fake cursor. No anchor means no ghost. The editor also skips the provider when `focused` is false.
- **Cursor mid-line.** The fake cursor wraps a real character, so the anchor does not match. The provider also returns null unless `cursorCol === line.length`.
- **Wrapped lines.** The cursor at the end of a logical line sits on the last chunk, so the anchor works there. With `paddingX > 0`, pi lets the end cursor overflow into the right padding and trims one padding column. The ghost is then hidden, because the free columns (`tail spaces - paddingX`) go negative. With `paddingX = 0`, layout reserves one column for the cursor. A cursor in the trimmed whitespace of a non-last chunk can render `" "` at the chunk end, and the provider's end-of-line check rejects that case.
- **Scrolled view.** `render` moves `scrollOffset` so the cursor line is always visible. The anchor is present and the ghost renders (test "scrolled").
- **Paste markers.** `[paste #N +M lines]` appears literally in the rendered text and segments as one grapheme. The cursor can't sit inside it. A word typed after it gets a ghost, and widths stay exact (test "paste marker"). A cursor directly after `]` has no word prefix and gets no ghost. Ticket 02's gates will cover tokens glued to a marker.
- **Dropdown open.** No ghost while `isShowingAutocomplete()` is true, so Tab keeps pi's dropdown behavior.
- **Overflow rule.** The ghost is hidden when `visibleWidth(suffix) - 1` exceeds the content-padding columns after the cursor. Wide characters count by display width.

### Live check

- `pi -ne --no-session -e ./extensions/index.ts` in tmux at 100 columns: typing `please becau` shows a dim `se` with the cursor on `s`. Tab gives `please because`.
- **Editor slot conflict.** With the user's normal extension set, no ghost appears. `pi-prompt-reviewer`, `@xynogen/pix-pretty` (chips) and `pi-shell-autocomplete` also call `ctx.ui.setEditorComponent`, and the last one wins. pi has a single editor slot, so the editors cannot be composed. This needs a decision, such as load order, an opt-out, or upstream hooks.
