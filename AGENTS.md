## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Live check

To check ghosts, commands or restarts in a real pi, run `scripts/live-check.sh` (usage in its header). It seeds a temp agent dir, skips the trust dialog, prints the ghost, and deletes the dir on exit.
