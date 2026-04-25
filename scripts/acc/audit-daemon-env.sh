#!/usr/bin/env bash
# scripts/acc/audit-daemon-env.sh — Phase 8 Plan 01 Task 1
#
# ACC-04 first half: confirm DATABASE_URL is NOT in the daemon's
# RUNTIME environment, and that CORTEX_API_URL/CORTEX_API_KEY/WATCH_PATHS
# ARE present. Verifies against `launchctl print` (the loaded env), not
# the plist source — the plist is the design intent; the audit checks
# what's actually in the running process.
#
# Runs in <5s. Exit 0 = PASS, exit 1 = FAIL, exit 2 = setup error.
#
# Usage: bash scripts/acc/audit-daemon-env.sh [--dry-run | --help]

set -euo pipefail

DRY_RUN=0
LABEL="com.cortex.daemon"

case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --help)
    cat <<EOF
Usage: $0 [--dry-run | --help]

Audits the running daemon's environment for ACC-04 first half.

PASS: DATABASE_URL absent AND (CORTEX_API_URL, CORTEX_API_KEY, WATCH_PATHS) all present.
FAIL: any forbidden key present OR any required key absent.

Source of truth: launchctl print gui/\$(id -u)/${LABEL}
Captured copy:    /tmp/cortex-acc-daemon-env.block.txt
EOF
    exit 0
    ;;
  "") ;;  # no arg → run live
  *)
    echo "Unknown arg: ${1}" >&2
    exit 2
    ;;
esac

if [[ $DRY_RUN -eq 1 ]]; then
  cat <<'EOF'
[DRY-RUN] Would run: launchctl print gui/$(id -u)/com.cortex.daemon
[DRY-RUN] Forbidden keys checked: DATABASE_URL
[DRY-RUN] Required keys checked:  CORTEX_API_URL, CORTEX_API_KEY, WATCH_PATHS
[DRY-RUN] PASS = forbidden absent AND required present
[DRY-RUN] FAIL = any forbidden present OR any required absent
[DRY-RUN] OK
EOF
  exit 0
fi

UID_NUM="$(id -u)"
CAPTURE="/tmp/cortex-acc-daemon-env.txt"
BLOCK="/tmp/cortex-acc-daemon-env.block.txt"

if ! launchctl print "gui/${UID_NUM}/${LABEL}" >"$CAPTURE" 2>&1; then
  echo "FAIL: daemon not loaded under launchd (gui/${UID_NUM}/${LABEL})"
  echo "      Hint: launchctl bootstrap gui/${UID_NUM} ~/Library/LaunchAgents/${LABEL}.plist"
  exit 2
fi

# `launchctl print` emits an `environment = { ... }` block listing the
# actually-loaded env. Extract just that block.
awk '/^[[:space:]]*environment = \{/,/^[[:space:]]*\}/' "$CAPTURE" >"$BLOCK"

FORBIDDEN=("DATABASE_URL")
REQUIRED=("CORTEX_API_URL" "CORTEX_API_KEY" "WATCH_PATHS")
FAIL=0

for key in "${FORBIDDEN[@]}"; do
  if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$BLOCK"; then
    echo "FAIL: forbidden key present in daemon env: ${key}"
    FAIL=1
  fi
done

for key in "${REQUIRED[@]}"; do
  if ! grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$BLOCK"; then
    echo "FAIL: required key missing from daemon env: ${key}"
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "PASS ACC-04 (daemon-env) — DATABASE_URL absent; required keys present"
  echo "      Source:   launchctl print gui/${UID_NUM}/${LABEL}"
  echo "      Captured: ${BLOCK}"
  exit 0
fi
exit 1
