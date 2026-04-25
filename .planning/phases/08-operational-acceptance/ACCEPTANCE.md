---
phase: 08-operational-acceptance
milestone: v1.1
run_by: TBD                # operator name + date
run_started: TBD           # ISO timestamp when §B begins
run_completed: TBD         # ISO timestamp when §G ends
overall_result: PENDING    # PASS | FAIL | PARTIAL
---

# v1.1 Operational Acceptance Report

Filled in by Daniel after running [`RUNBOOK.md`](./RUNBOOK.md) end-to-end. Each row below: PASS/FAIL/SKIP, command output excerpt, observation notes.

The runbook is the authoritative procedure; this file is the result record. ACC-04 is split into two rows (a/b) because the audit covers two distinct invariants (daemon env vs consumer argv).

---

## Results

| Req     | Description                                                  | Script                                              | Result | Captured Output / Notes                          |
| ------- | ------------------------------------------------------------ | --------------------------------------------------- | ------ | ------------------------------------------------ |
| ACC-04a | Daemon env has no DATABASE_URL; required keys present        | `scripts/acc/audit-daemon-env.sh`                   | TBD    | `<paste PASS/FAIL line + path to /tmp capture>`  |
| ACC-02  | Gmail backfill drains without hanging (5min idle threshold)  | `scripts/acc/gmail-backfill.mjs --clear --watch`    | TBD    | `<observed total duration + final queue depth>`  |
| ACC-04b | Consumer argv contains no file content (size + null-byte)    | `scripts/acc/audit-consumer-argv.sh --watch-for=120`| TBD    | `<paste PASS line + sample count>`               |
| ACC-03  | Items surface in /triage UI without intervention             | (visual)                                            | TBD    | `<screenshot path or item IDs observed>`         |
| ACC-05  | Langfuse trace chain reconstructable for one item            | `scripts/acc/audit-langfuse-trace.mjs --item-id ID` | TBD    | `<paste PASS line with full chain>`              |
| ACC-01  | Daemon 1-hour soak with zero error lines                     | `scripts/acc/soak-daemon.sh`                        | TBD    | `<paste PASS line + log path>`                   |

---

## Observations

<!--
  Free-form notes from the operator. Examples:
   - "ACC-02 took 47 minutes to drain (inbox: ~3,400 messages over 6 months)."
   - "ACC-01 saw 12 heartbeat_ping_unexpected_error allow-list hits — within
     expected band for the timezone (commute hours, Wi-Fi roaming)."
   - "ACC-05 retry attempt 3/12 succeeded — Langfuse cloud propagation took ~15s."
   - "Drove keep flow through ACC-05 with --require-stage2 — also passed."
-->

<!-- TBD -->

---

## v1.1 Ship Decision

<!--
  One paragraph. Examples:

  "v1.1 SHIPS — all six acceptance rows passed on 2026-04-26. Daemon is
  isolated from Neon, consumer argv is clean, end-to-end tracing is
  reconstructable, and the 1h soak ran clean. Proceed with milestone close."

  OR

  "v1.1 BLOCKED on ACC-02 — Gmail backfill hung at 6,200 items in
  pending_stage2 for 30+ minutes; Stage 2 consumer is rate-limited by
  Anthropic's per-minute cap. Spawn Phase 9 plan to gate Stage 2 throughput."
-->

<!-- TBD -->
