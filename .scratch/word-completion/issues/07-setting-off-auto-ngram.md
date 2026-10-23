# 07: Setting: off / auto / ngram

**What to build:** The user can turn word completion on or off and pick the engine, and the choice persists across restarts. Values are `off`, `auto` and `ngram`; `auto` resolves to `ngram`. Switching methods takes effect at once: the provider clears its cache, queue and projection, and answers from the old method are dropped. `off` shows no ghost and sends no requests, but Tab and Right behave as in stock pi.

Reference: `docs/word-completion-architecture.md`, section 10.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] User can change the setting from inside pi (command or settings UI)
- [ ] Setting persists across restarts
- [ ] `off` shows no ghost and makes no backend calls (test)
- [ ] Switching method mid-typing never shows a stale answer (test)
- [ ] `auto` resolves to `ngram`
