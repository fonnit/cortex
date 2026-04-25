---
phase: 08-operational-acceptance
plan: 01
subsystem: operational-acceptance
tags: [acceptance, audit-scripts, runbook, observability, milestone-v1.1]
dependency-graph:
  requires:
    - phase-05-api-isolation       # API routes the audit traces walk
    - phase-06-daemon-thin-client  # daemon plist + cursor file shape
    - phase-07-stage-1-2-consumers # consumer plist + claude execFile contract
  provides:
    - acc-04-daemon-env-audit      # scripts/acc/audit-daemon-env.sh
    - acc-04-consumer-argv-audit   # scripts/acc/audit-consumer-argv.sh
    - acc-05-trace-chain-audit     # scripts/acc/audit-langfuse-trace.mjs
    - acc-01-soak-orchestrator     # scripts/acc/soak-daemon.sh
    - acc-02-backfill-orchestrator # scripts/acc/gmail-backfill.mjs
    - operator-runbook             # .planning/phases/08-operational-acceptance/RUNBOOK.md
    - operator-acceptance-form     # .planning/phases/08-operational-acceptance/ACCEPTANCE.md
  affects: []                      # observability-only; sealed phases 5/6/7 untouched
tech-stack:
  added: []                        # zero new top-level deps (CONTEXT D-08)
  patterns:
    - pure-logic-lib-plus-cli      # lib/*.mjs exports + --check stdin mode
    - shell-orchestration-node-decision  # bash for launchctl/ps/file ops; node for SDK/JSON
    - dry-run-everywhere           # every script supports --dry-run for CI
    - audit-boundary-no-mutations  # scripts read process state; never write to Vercel/Neon
key-files:
  created:
    - scripts/acc/audit-daemon-env.sh
    - scripts/acc/audit-consumer-argv.sh
    - scripts/acc/audit-langfuse-trace.mjs
    - scripts/acc/soak-daemon.sh
    - scripts/acc/gmail-backfill.mjs
    - scripts/acc/lib/argv-heuristics.mjs
    - scripts/acc/lib/trace-walker.mjs
    - scripts/acc/__tests__/argv-heuristics.test.mjs
    - scripts/acc/__tests__/trace-walker.test.mjs
    - .planning/phases/08-operational-acceptance/RUNBOOK.md
    - .planning/phases/08-operational-acceptance/ACCEPTANCE.md
  modified: []
decisions:
  - "Tests run via node:test (built-in) rather than jest — root jest config matches *.test.ts only and adding *.mjs would mean modifying jest.config.js which is out of scope for an observability phase."
  - "Trace-walker default mode picks stage1 if present, falls back to stage2; --require-stage2 forces strict (Gmail keep flow). This makes a single audit invocation work for both ignore and keep paths without two separate scripts."
  - "audit-langfuse-trace.mjs uses lf.api.traceList (singular) — the SDK type definition shows traceList, not the speculative tracesList in the plan; the plan was speculative on that name."
  - "argv-heuristics CLI mode uses isMain detection so the lib stays cleanly importable from tests (no side effects on import)."
  - "soak-daemon.sh deliberately does NOT bootstrap launchd — the operator owns launchd state. The script verifies a daemon is loaded, truncates the error log, waits, then greps. Clean audit boundary."
  - "gmail-backfill.mjs reproduces the Phase 6 cursor JSON shape directly (atomic tmp+rename, mode 0600 over dir 0700) — does NOT import agent/src/cursor/gmail-cursor.ts so Phase 6 stays sealed."
metrics:
  duration: ~8m
  completed: 2026-04-25
  tasks: 3
  files_created: 11
  tests_written: 14
  tests_passing: 14
  commits: 7
---

# Phase 8 Plan 01: Operational Acceptance Toolkit Summary

Delivered the v1.1 operational-acceptance toolkit: five executable scripts under `scripts/acc/` (three audits + two orchestrators), two pure-logic libraries with 14 passing unit tests, an operator RUNBOOK (~384 lines, §A–§I), and an ACCEPTANCE.md result skeleton with TBD placeholders. Phase 8 ships the artifacts; the live runs (1h soak, 6-month Gmail backfill, end-to-end trace walk) happen post-phase under operator drive per CONTEXT D-01.

## What was built

### Audit scripts (3)

| Script                              | Requirement | Verifies                                                          |
| ----------------------------------- | ----------- | ----------------------------------------------------------------- |
| `scripts/acc/audit-daemon-env.sh`   | ACC-04a     | `launchctl print` confirms `DATABASE_URL` absent, `CORTEX_API_URL`/`CORTEX_API_KEY`/`WATCH_PATHS` present (<5s, exit 0/1/2) |
| `scripts/acc/audit-consumer-argv.sh`| ACC-04b     | `ps -wwo pid,command` sampled over `--watch-for=N` seconds; piped to `lib/argv-heuristics.mjs --check`; flags any `claude -p` argv > 16KB or with NUL bytes |
| `scripts/acc/audit-langfuse-trace.mjs` | ACC-05   | `lf.api.traceList` + `traceGet`, walks `api-ingest → api-queue → consumer-stage{1,2}-item → api-classify` chain; retries 12 × 5s = 60s for Langfuse eventual consistency |

### Orchestration scripts (2)

| Script                           | Requirement | Behaviour                                                                                         |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `scripts/acc/soak-daemon.sh`     | ACC-01      | Verifies daemon loaded, truncates `/tmp/cortex-daemon-error.log`, waits N seconds (default 3600), greps error regex minus allow-list (`heartbeat_ping_unexpected_error|http_client_terminal_skip`) |
| `scripts/acc/gmail-backfill.mjs` | ACC-02      | `--clear` (delete cursor → daemon full-syncs via ING-06), `--history-id N` (explicit rewind), `--watch` (idle-5min-on-consumer-log = drain done), `--rewind=6mo` returns guidance (Gmail historyIds are opaque) |

### Pure-logic libraries (2) with 14 tests

| Library                              | Exports                                        | Tests |
| ------------------------------------ | ---------------------------------------------- | ----- |
| `scripts/acc/lib/argv-heuristics.mjs` | `parseArgvLine`, `isSuspiciousArgv`, `extractClaudeInvocations`, `ARGV_SIZE_LIMIT`, `--check` CLI mode | 7 ✅ |
| `scripts/acc/lib/trace-walker.mjs`   | `walkSpanChain`, `REQUIRED_SPAN_NAMES` (frozen) | 7 ✅ |

Tests run via `node --test` (built-in to Node 22). Total runtime: ~110ms across both suites.

### Documentation (2)

| File          | Purpose                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `RUNBOOK.md`  | 384-line self-contained operator guide; §A prerequisites, §B daemon boot/audit, §C Gmail backfill, §D consumer + argv audit, §E triage UI, §F Langfuse trace, §G 1h soak, §H cleanup, §I troubleshooting + placeholder fill-in table |
| `ACCEPTANCE.md` | 62-line result skeleton with frontmatter (run_by, run_started, run_completed, overall_result), 6 result rows (ACC-04 split a/b), Observations + v1.1 Ship Decision sections, all values TBD |

## The 8 sealed-phase invariants the toolkit audits

1. **DATABASE_URL absent from daemon runtime env** (DAEMON-01) — `audit-daemon-env.sh`
2. **CORTEX_API_URL/CORTEX_API_KEY/WATCH_PATHS present** (DAEMON-06) — `audit-daemon-env.sh`
3. **No `claude -p` argv > 16KB** (CONS-03 size invariant) — `audit-consumer-argv.sh` + `lib/argv-heuristics.mjs`
4. **No `claude -p` argv with NUL byte** (CONS-03 binary-safe invariant) — same
5. **Span chain `api-ingest → api-queue → consumer-stage{1,2}-item → api-classify` reconstructable** (CONS-06 + ACC-05) — `audit-langfuse-trace.mjs` + `lib/trace-walker.mjs`
6. **`metadata.inbound_trace_id` on consumer-stage* traces resolves to a known api-queue trace** (cross-trace linkage) — same
7. **`gmail-cursor.json` shape preserved** (Phase 6 contract) — `gmail-backfill.mjs` writes the exact JSON shape without importing the Phase 6 module
8. **Daemon error log clean over a 1h soak** (ACC-01 baseline) — `soak-daemon.sh`

## Key decisions

- **Tests use `node --test`, not jest.** Root `jest.config.js` matches `*.test.ts` only. Adding `.test.mjs` would require config changes (out of scope for observability-only Phase 8). Node 22's built-in test runner needs zero config and ships with the runtime.
- **Trace-walker exposes both modes via one entry point.** Default picks stage1 when present, falls back to stage2 — handles ignore items (stage1 only) and Gmail keep items (stage1 + stage2) without separate scripts. `--require-stage2` flag forces strict for the Gmail keep certification.
- **`audit-langfuse-trace.mjs` uses `lf.api.traceList` (singular).** The plan speculatively wrote `tracesList`; the actual SDK type signature in `node_modules/langfuse/lib/index.d.ts` line 2460 confirms `traceList`. Caught during implementation.
- **CLI mode in `argv-heuristics.mjs` is gated by `isMain` detection.** Keeps the lib cleanly importable from tests with no side effects on import.
- **`soak-daemon.sh` does NOT bootstrap launchd itself.** The operator owns launchd state per CONTEXT. The script verifies the daemon is loaded, truncates the error log so only THIS run's lines count, then waits + greps. Clean audit boundary.
- **`gmail-backfill.mjs` reproduces the Phase 6 cursor JSON shape directly.** Atomic `tmp + rename`, mode 0600 file under 0700 dir. Does NOT import `agent/src/cursor/gmail-cursor.ts` because Phase 6 is sealed (CONTEXT D-01).
- **Every script supports `--dry-run` and `--help`.** Dry-run prints a deterministic "OK" line so the verification harness can confirm script correctness without live infrastructure (CONTEXT D-08).

## Deviations from Plan

None — plan executed exactly as written, with two implementation-time corrections that are not architectural changes:

1. **`tracesList` → `traceList` (Rule 3 - Bug-fix)** The plan's `<action>` block called `lf.api.tracesList`. The actual SDK exposes `lf.api.traceList` (singular). Verified against `node_modules/langfuse/lib/index.d.ts` line 2460. Fixed inline; no behaviour change since it's the same endpoint.
2. **NUL-byte literal stored as `\0` escape (cleanup)** Initial Write of `argv-heuristics.{mjs,test.mjs}` left literal NUL bytes in the source files (because the agent's text editor preserves whatever byte is in the literal). Replaced with the two-char escape `\0` sequence post-hoc so source is clean and grep-able. No test behaviour change — the runtime string is identical.

## Verification snapshot

```
$ node --test scripts/acc/__tests__/*.test.mjs
# tests 14
# pass 14
# fail 0
# duration_ms 56

$ git diff HEAD~7 HEAD --name-only
.planning/phases/08-operational-acceptance/ACCEPTANCE.md
.planning/phases/08-operational-acceptance/RUNBOOK.md
scripts/acc/__tests__/argv-heuristics.test.mjs
scripts/acc/__tests__/trace-walker.test.mjs
scripts/acc/audit-consumer-argv.sh
scripts/acc/audit-daemon-env.sh
scripts/acc/audit-langfuse-trace.mjs
scripts/acc/gmail-backfill.mjs
scripts/acc/lib/argv-heuristics.mjs
scripts/acc/lib/trace-walker.mjs
scripts/acc/soak-daemon.sh

$ git diff HEAD~7 HEAD -- package.json agent/package.json
(empty — zero new deps)

$ grep -rE "@anthropic-ai|@prisma/client|@neondatabase/serverless" scripts/acc/
(empty — zero forbidden SDK imports)
```

## Operator next steps

1. Read [`RUNBOOK.md`](./RUNBOOK.md) end-to-end (~10 min).
2. Walk §A prerequisites (~30 min one-time).
3. Run §B → §G in sequence (~2 hours total, mostly the 1h soak).
4. Fill in [`ACCEPTANCE.md`](./ACCEPTANCE.md) row-by-row as you go.
5. Write the v1.1 Ship Decision paragraph at the bottom.

After ACCEPTANCE.md is complete with all six rows passing, v1.1 (the ingest pipeline rearchitecture milestone) ships.

## Self-Check: PASSED

Verified 2026-04-25T14:50Z.

**Files verified (12/12 found):**
- 5 scripts: `audit-daemon-env.sh`, `audit-consumer-argv.sh`, `audit-langfuse-trace.mjs`, `soak-daemon.sh`, `gmail-backfill.mjs`
- 2 libs: `lib/argv-heuristics.mjs`, `lib/trace-walker.mjs`
- 2 test files: `__tests__/argv-heuristics.test.mjs`, `__tests__/trace-walker.test.mjs`
- 3 docs: `RUNBOOK.md`, `ACCEPTANCE.md`, `08-01-SUMMARY.md`

**Commits verified (7/7 found):** e98bfe1, 270fe8a, 8fb0455, 4570955, ac39939, b918dd4, 00ce2d9

**Tests verified:** `node --test scripts/acc/__tests__/*.test.mjs` → 14 pass, 0 fail.

**Guards verified:**
- No `app/`, `lib/`, `prisma/`, `agent/src/` modifications by this plan's commits
- No new top-level deps (zero diff in `package.json` and `agent/package.json`)
- No forbidden SDKs in `scripts/acc/` (no `@anthropic-ai`, `@prisma/client`, `@neondatabase/serverless`)
- `DATABASE_URL` references in `scripts/acc/` are scoped to `audit-daemon-env.sh` only — the script that's checking FOR it.

## Threat Flags

None — all new surface is observability-only. No new network endpoints, no auth paths, no DB access. The single scripted FS write (`gmail-backfill.mjs` cursor file) reproduces an existing Phase 6 contract and is covered by threat T-08-03 in the plan's threat register.
