#!/usr/bin/env bash
# Fails when a line in src/, extensions/ or test/ is wider than 130 columns, counting a tab as 4.
# Run: scripts/check-line-length.sh
set -euo pipefail
cd "$(dirname "$0")/.."

find src extensions test -name '*.ts' -print0 | xargs -0 awk -v max=130 '
	{
		line = $0
		gsub(/\t/, "    ", line)
		if (length(line) > max) {
			printf "%s:%d: %d columns, limit %d\n", FILENAME, FNR, length(line), max
			failed = 1
		}
	}
	END { exit failed }
'
