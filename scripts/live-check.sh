#!/usr/bin/env bash
# Runs the extension in a real pi inside tmux and prints the ghost shown after typing.
#
# Usage: scripts/live-check.sh [-d agent-dir] <past-prompt> <typed-text> [command ...]
#
#   past-prompt  Text of one user message in an old session, for the store to learn. "" seeds nothing.
#   typed-text   What to type in the editor once pi is up.
#   command      Slash commands to run first, in order, e.g. "/word-completion off".
#   -d dir       Use and keep this agent dir, to check what survives a restart. It is created if
#                missing and seeded only then. Without -d a temp dir is used and deleted on exit.
#
# Output: one line per command with pi's notice, then `ghost: <suffix>` or `ghost: (none)`.
# pi runs with -ne --offline and the project untrusted, so only this extension loads and no
# prompt is sent.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
agent_dir=""
keep=false
if [[ ${1:-} == "-d" ]]; then
	agent_dir=$2
	keep=true
	shift 2
fi
if [[ $# -lt 2 ]]; then
	sed -n '4,10p' "$0" >&2
	exit 2
fi
past_prompt=$1
typed=$2
shift 2

session="live-check-$$"
if [[ $keep == false ]]; then agent_dir=$(mktemp -d); fi
cleanup() {
	tmux kill-session -t "$session" 2>/dev/null || true
	if [[ $keep == false ]]; then rm -rf -- "$agent_dir"; fi
}
trap cleanup EXIT

if [[ ! -e $agent_dir/trust.json ]]; then
	mkdir -p "$agent_dir/sessions/--past--"
	# Saved "do not trust": pi skips the trust dialog and ignores the project's .pi resources.
	printf '{"%s": false}\n' "$repo" >"$agent_dir/trust.json"
	if [[ -n $past_prompt ]]; then
		node -e '
			const message = { role: "user", content: process.argv[1], timestamp: 1 };
			console.log(JSON.stringify({ type: "message", id: "a1", parentId: null, timestamp: "", message }));
		' "$past_prompt" >"$agent_dir/sessions/--past--/s.jsonl"
	fi
fi

pane() { tmux capture-pane -p -t "$session" "$@"; }

# Waits up to 20 s for pi's footer, which shows the working directory once the editor is up.
wait_ready() {
	for _ in $(seq 100); do
		if pane | tail -3 | grep -q -F -- "$(basename "$repo")"; then return 0; fi
		sleep 0.2
	done
	echo "pi did not start; last screen:" >&2
	pane >&2
	exit 1
}

tmux new-session -d -s "$session" -x 100 -y 30 \
	"cd '$repo' && PI_CODING_AGENT_DIR='$agent_dir' pi -ne --offline -e ./extensions/index.ts"
wait_ready
# Let the store finish loading the snapshot and past sessions.
sleep 1

for command in "$@"; do
	tmux send-keys -t "$session" C-c
	tmux send-keys -t "$session" -l "$command"
	sleep 0.4
	# Close the argument dropdown, so Enter runs the command as typed.
	tmux send-keys -t "$session" Escape
	sleep 0.2
	tmux send-keys -t "$session" Enter
	sleep 1
	echo "$command: $(pane | grep -a -o 'Word completion[^│]*' | tail -1 | sed 's/ *$//')"
done

tmux send-keys -t "$session" C-c
tmux send-keys -t "$session" -l "$typed"
sleep 1
# The ghost is whatever follows the typed text on its line. With no ghost, only the cursor cell remains.
line=$(pane | grep -a -F -- "$typed" | tail -1)
ghost=$(printf '%s' "${line#*"$typed"}" | sed 's/[[:space:]]*$//')
echo "ghost: ${ghost:-(none)}"
