#!/usr/bin/env bash
# scripts/acc/soak-daemon.sh — Phase 8 Plan 01 Task 2
#
# ACC-01: 1-hour soak of the daemon scanning ~/Downloads + ~/Documents
# with zero error-log lines.
#
# Audit boundary: this script does NOT bootstrap launchd itself — the
# operator owns launchd state per CONTEXT. The script verifies the daemon
# is loaded, truncates the error log so only THIS run's lines count,
# waits for the duration, then greps the error log.
#
# An "error" is a line matching the ERROR_REGEX AND not matching the
# allow-list ALLOW_REGEX (the allow-listed strings are the daemon's
# known transient-warning paths — heartbeat ping recovery and HTTP
# terminal-skip — both are recorded as warnings in Langfuse, not hard
# errors).
#
# Usage: bash scripts/acc/soak-daemon.sh [--duration=SECONDS] [--dry-run | --help]

set -euo pipefail

DURATION=3600
DRY_RUN=0
LABEL="com.cortex.daemon"
LOG="/tmp/cortex-daemon-error.log"
ALLOW_REGEX='heartbeat_ping_unexpected_error|http_client_terminal_skip'
ERROR_REGEX='error|Error|FATAL|fatal|EBADF|EMFILE|ENOMEM|UNHANDLED'

for arg in "$@"; do
  case "$arg" in
    --duration=*) DURATION="${arg#--duration=}" ;;
    --dry-run)    DRY_RUN=1 ;;
    --help)
      cat <<EOF
Usage: bash soak-daemon.sh [--duration=SECONDS] [--dry-run | --help]

ACC-01: monitor the daemon for SECONDS seconds (default 3600 = 1 hour) and
verify zero error-log lines were emitted.

Error log: ${LOG}
Error regex: ${ERROR_REGEX}
Allow regex (warnings, not errors): ${ALLOW_REGEX}

PASS = zero matching lines after duration.
FAIL = at least one matching line.

Precondition: daemon must already be loaded under launchd. The operator
runs the bootstrap step (see RUNBOOK §B); this script does not.
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ $DRY_RUN -eq 1 ]]; then
  cat <<EOF
[DRY-RUN] Would soak daemon (${LABEL}) for ${DURATION}s.
[DRY-RUN] Error log: ${LOG}
[DRY-RUN] Error regex: ${ERROR_REGEX}
[DRY-RUN] Allow regex (warnings): ${ALLOW_REGEX}
[DRY-RUN] PASS = zero matching lines after duration
[DRY-RUN] OK
EOF
  exit 0
fi

UID_NUM="$(id -u)"
echo "Soak start: ${LABEL} for ${DURATION}s …"

if ! launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  echo "FAIL: ${LABEL} not loaded; bootstrap it first per RUNBOOK §B" >&2
  exit 2
fi

# Truncate the error log so this run is the sole contributor.
: > "$LOG"

END=$(( $(date +%s) + DURATION ))
while [[ $(date +%s) -lt $END ]]; do
  sleep 30
done

echo "Soak end. Scanning error log …"
MATCHES="$(grep -E "$ERROR_REGEX" "$LOG" | grep -vE "$ALLOW_REGEX" || true)"
if [[ -z "$MATCHES" ]]; then
  echo "PASS ACC-01 (soak-daemon) — zero error lines in ${DURATION}s"
  echo "      Log: ${LOG}"
  exit 0
fi
echo "FAIL ACC-01 (soak-daemon): error lines found:"
echo "$MATCHES" | head -20
exit 1
