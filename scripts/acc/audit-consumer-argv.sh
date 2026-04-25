#!/usr/bin/env bash
# scripts/acc/audit-consumer-argv.sh — Phase 8 Plan 01 Task 1
#
# ACC-04 second half: during a live consumer cycle, sample `ps -ww` and
# confirm no `claude -p` invocation has argv > 16KB or contains NUL bytes
# — i.e. file content is never passed as an argument.
#
# Default --watch-for=60s. Polls once per second. The captured samples are
# piped to scripts/acc/lib/argv-heuristics.mjs for the actual decision —
# the shell script is only orchestration glue (CONTEXT D-02).
#
# Usage:
#   bash scripts/acc/audit-consumer-argv.sh [--watch-for=N] [--dry-run | --help]

set -euo pipefail

WATCH_SECONDS=60
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --watch-for=*) WATCH_SECONDS="${arg#--watch-for=}" ;;
    --dry-run)     DRY_RUN=1 ;;
    --help)
      cat <<'EOF'
Usage: bash audit-consumer-argv.sh [--watch-for=SECONDS] [--dry-run | --help]

ACC-04 second half: sample `ps -wwo pid,command` for SECONDS seconds and
assert every captured `claude -p` invocation is ≤ 16KB AND contains no
NUL bytes (i.e. file content was never injected into argv).

  --watch-for=N   poll ps every 1s for N seconds (default 60)
  --dry-run       print what would happen, no sampling
  --help          show this help

PASS = zero suspicious invocations across all samples.
FAIL = any suspicious invocation (size > 16KB OR NUL byte present).
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ $DRY_RUN -eq 1 ]]; then
  cat <<EOF
[DRY-RUN] Would poll: ps -wwo pid,command
[DRY-RUN] Watch duration: ${WATCH_SECONDS}s, interval 1s
[DRY-RUN] Per-sample filter: argv begins with 'claude -p' (or '.../claude -p')
[DRY-RUN] Per-invocation check: size <= 16384 AND no NUL byte
[DRY-RUN] PASS = zero suspicious invocations across all samples
[DRY-RUN] FAIL = any suspicious invocation
[DRY-RUN] OK
EOF
  exit 0
fi

NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then
  echo "FAIL: 'node' not on PATH (needed by argv-heuristics.mjs)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLE_FILE="$(mktemp -t cortex-acc-argv.XXXXXX)"
trap 'rm -f "$SAMPLE_FILE"' EXIT

echo "Sampling ps -wwo pid,command for ${WATCH_SECONDS}s …"
END=$(( $(date +%s) + WATCH_SECONDS ))
SAMPLES=0
while [[ $(date +%s) -lt $END ]]; do
  SAMPLES=$((SAMPLES+1))
  ps -wwo pid,command >> "$SAMPLE_FILE" || true
  printf -- '---SAMPLE---\n' >> "$SAMPLE_FILE"
  sleep 1
done

echo "Captured ${SAMPLES} samples; running heuristics check …"

# Hand off to the pure-logic checker (D-05). The lib's --check mode reads
# stdin, prints PASS/FAIL, and exits 0/1 accordingly.
set +e
"$NODE_BIN" "${SCRIPT_DIR}/lib/argv-heuristics.mjs" --check < "$SAMPLE_FILE"
RC=$?
set -e
exit $RC
