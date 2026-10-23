# 06: Persistence and session bootstrap

**What to build:** The learned model survives pi restarts. The engine saves a versioned snapshot plus an ingest cursor, debounced after changes and also on shutdown, written to a temp file and renamed. A corrupt or incompatible snapshot is discarded and rebuilt. On first run with no snapshot, the engine bootstraps from user messages in pi's session JSONL files, handling message content as a string or as an array of parts, and skipping slash commands. Later runs ingest only sessions or messages past the cursor so nothing is counted twice. First confirm where pi extensions should store data on disk and record the finding.

Reference: `docs/word-completion-architecture.md`, sections 9 and 13.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Storage location finding recorded under Comments
- [ ] Words learned in one pi run are suggested after restart
- [ ] Fresh install with existing sessions shows ghosts from past prompts on first use
- [ ] Second bootstrap pass ingests nothing new (test)
- [ ] Both content shapes parse (test with fixture lines)
- [ ] Corrupt snapshot triggers rebuild, not a crash (test)
- [ ] Killing pi mid-session loses at most the unsaved window, never the snapshot
