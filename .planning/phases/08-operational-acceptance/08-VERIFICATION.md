---
phase: 08-operational-acceptance
verified: 2026-04-25T15:30:00Z
status: human_needed
score: 8/8 toolkit must-haves verified; 5/5 ROADMAP SCs require live operator runs
overrides_applied: 0
re_verification: null
human_verification:
  - test: "ACC-01 — 1-hour daemon soak"
    expected: "PASS ACC-01 (soak-daemon) — zero error lines in 3600s"
    why_human: "Requires live launchd-loaded daemon + 1h wall-clock wait; script ships, run is operator-driven per CONTEXT D-01"
  - test: "ACC-02 — Gmail 6-month backfill drains"
    expected: "PASS ACC-02 (gmail-backfill) — consumer log idle for 5 minutes"
    why_human: "Requires live Gmail OAuth + Stage1/2 consumer + multi-hour drain observation; only operator can run"
  - test: "ACC-03 — Items surface in /triage UI without manual intervention"
    expected: "Visual confirmation in browser; Stage 1/2 processed Items appear in v1.0 triage queue"
    why_human: "Visual UI checkpoint — runbook §E explicitly delegates to operator (no browser automation)"
  - test: "ACC-04a — Daemon runtime env has no DATABASE_URL; required keys present"
    expected: "PASS ACC-04 (daemon-env) — DATABASE_URL absent; required keys present"
    why_human: "Requires daemon loaded under launchd with production-shaped plist (CORTEX_API_URL, CORTEX_API_KEY, WATCH_PATHS); operator runs after §B bootstrap"
  - test: "ACC-04b — Live consumer argv contains no file content"
    expected: "PASS ACC-04 (consumer-argv) — N 'claude -p' invocations sampled, all clean"
    why_human: "Requires live Stage 1/2 consumer cycle to fire during sampling window; operator drops a real PDF and runs the audit"
  - test: "ACC-05 — Langfuse trace chain reconstructable"
    expected: "PASS ACC-05 (langfuse-trace) — chain: api-ingest → api-queue → consumer-stage1-item → api-classify"
    why_human: "Requires live Langfuse credentials + a real item ID from a recent end-to-end pipeline run; operator runs from RUNBOOK §F"
---

# Phase 8: Operational Acceptance Verification Report

**Phase Goal:** The rearchitected pipeline runs unattended for the published soak periods with zero errors, every operational invariant from the brief is independently auditable, end-to-end traceability is reconstructable in Langfuse — v1.1 is shippable.

**Verified:** 2026-04-25T15:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Phase Boundary (per CONTEXT D-01)

Phase 8 ships the **acceptance toolkit** (scripts + RUNBOOK + ACCEPTANCE.md skeleton). The **live runs** (1h soak, 6-month Gmail backfill, end-to-end Langfuse trace, UI flow) are the operator's responsibility post-phase. Verification accepts "scripts exist + dry-run passes + RUNBOOK is complete + tests pass" as PASS for the toolkit; live observations are gated to `human_needed`.

This is by design — the phase is observability-only and cannot self-validate live runtime behavior without live infrastructure.

### Observable Truths — Toolkit (programmatically verifiable)

| #   | Truth                                                                                                | Status     | Evidence                                                                  |
| --- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| 1   | Each ACC-* requirement maps to a concrete script artifact                                            | ✓ VERIFIED | ACC-01→soak-daemon.sh, ACC-02→gmail-backfill.mjs, ACC-03→RUNBOOK §E, ACC-04→audit-daemon-env.sh + audit-consumer-argv.sh, ACC-05→audit-langfuse-trace.mjs |
| 2   | All scripts have proper shebangs and `chmod +x`                                                      | ✓ VERIFIED | 5/5 scripts: `-rwxr-xr-x`; shell scripts → `#!/usr/bin/env bash`, mjs → `#!/usr/bin/env node` |
| 3   | RUNBOOK.md is self-contained and ≥120 lines                                                          | ✓ VERIFIED | 384 lines, §A–§I covering prerequisites, all 5 ACC audits, soak, cleanup, troubleshooting |
| 4   | ACCEPTANCE.md skeleton has placeholder rows for each ACC-* with operator action description         | ✓ VERIFIED | 6 result rows (ACC-04 split a/b), all `Result=TBD`, frontmatter has `run_by/run_started/run_completed/overall_result=PENDING` |
| 5   | No source code modifications outside `scripts/acc/` and the phase planning dir                       | ✓ VERIFIED | `git diff HEAD~7 HEAD --name-only` lists only the 12 expected files; no `app/`, `lib/`, `prisma/`, `agent/src/` |
| 6   | No new top-level deps                                                                                | ✓ VERIFIED | `git diff HEAD~7 HEAD -- package.json agent/package.json` is empty |
| 7   | Pure-logic library tests pass                                                                        | ✓ VERIFIED | `node --test scripts/acc/__tests__/*.test.mjs` → 14/14 pass, ~55ms total |
| 8   | Anti-patterns absent (no forbidden SDK calls, no DB writes, no hardcoded URL/key)                    | ✓ VERIFIED | `grep -rE "@anthropic-ai\|@prisma/client\|@neondatabase/serverless" scripts/acc/` is empty; only DATABASE_URL refs are in `audit-daemon-env.sh` (it's checking for its absence) |

**Score (toolkit):** 8/8 truths verified.

### Observable Truths — ROADMAP Success Criteria (require human)

| #   | Truth (from ROADMAP)                                                                                                                | Status      | Evidence / Why human                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| R1  | Daemon scans Downloads + Documents continuously for 1h with zero errors                                                              | ? UNCERTAIN | Toolkit ready (`soak-daemon.sh`); requires operator wall-clock run              |
| R2  | Gmail 6-month backfill completes; every message ingests or is explicitly rejected                                                    | ? UNCERTAIN | Toolkit ready (`gmail-backfill.mjs --clear --watch`); requires live mailbox run |
| R3  | Items dropped via Downloads/Gmail flow through Stage 1+2 and appear in /triage without manual intervention                          | ? UNCERTAIN | RUNBOOK §E delegates to operator (visual checkpoint, no browser automation)     |
| R4  | Runtime audit confirms `DATABASE_URL` absent from daemon env; consumer argv never contains file content                              | ? UNCERTAIN | Toolkit ready (audit-daemon-env.sh + audit-consumer-argv.sh); requires live processes |
| R5  | Single ingested item reconstructable end-to-end in Langfuse: daemon ingest → API → consumer queue → `claude -p` → API classify       | ? UNCERTAIN | Toolkit ready (`audit-langfuse-trace.mjs`); requires Langfuse creds + real item |

**Score (live runs):** 0/5 — gated to operator drive per CONTEXT D-01.

### Required Artifacts

| Artifact                                            | Expected                                            | Status     | Details                                                                 |
| --------------------------------------------------- | --------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `scripts/acc/audit-daemon-env.sh`                   | ACC-04a check; ≤5s; PASS/FAIL exit                  | ✓ VERIFIED | 92 lines; bash; FORBIDDEN/REQUIRED arrays; awk-extracts launchctl env block; dry-run prints OK |
| `scripts/acc/audit-consumer-argv.sh`                | ACC-04b sampling; --watch-for=N                     | ✓ VERIFIED | 86 lines; bash; samples ps -wwo every 1s, pipes to `lib/argv-heuristics.mjs --check`; dry-run prints OK |
| `scripts/acc/audit-langfuse-trace.mjs`              | ACC-05 chain walker; --item-id; 60s retries         | ✓ VERIFIED | 160 lines; node; lazy-imports `langfuse`; uses `lf.api.traceList`; 12×5s retry loop; dry-run prints OK |
| `scripts/acc/soak-daemon.sh`                        | ACC-01 1h soak; allow-list                          | ✓ VERIFIED | 93 lines; bash; truncates `/tmp/cortex-daemon-error.log`, waits, greps; dry-run prints OK |
| `scripts/acc/gmail-backfill.mjs`                    | ACC-02 cursor manipulation + drain watcher          | ✓ VERIFIED | 149 lines; node; --clear/--history-id/--watch/--rewind=6mo; atomic write tmp→rename mode 0600; dry-run prints OK |
| `scripts/acc/lib/argv-heuristics.mjs`               | Pure parsing logic; --check CLI gated by isMain     | ✓ VERIFIED | 108 lines; exports parseArgvLine, isSuspiciousArgv, extractClaudeInvocations, ARGV_SIZE_LIMIT |
| `scripts/acc/lib/trace-walker.mjs`                  | Pure span-chain walker; frozen REQUIRED_SPAN_NAMES  | ✓ VERIFIED | 88 lines; exports walkSpanChain, REQUIRED_SPAN_NAMES (frozen)           |
| `scripts/acc/__tests__/argv-heuristics.test.mjs`    | node:test for argv lib                              | ✓ VERIFIED | 84 lines; 7 tests pass                                                  |
| `scripts/acc/__tests__/trace-walker.test.mjs`       | node:test for trace-walker lib                      | ✓ VERIFIED | 127 lines; 7 tests pass                                                 |
| `.planning/phases/08-operational-acceptance/RUNBOOK.md`    | Operator instructions; ≥120 lines; §A–§I    | ✓ VERIFIED | 384 lines; covers prerequisites, all 5 ACC audits, cleanup, troubleshooting, fill-in table |
| `.planning/phases/08-operational-acceptance/ACCEPTANCE.md` | Result skeleton with TBD rows               | ✓ VERIFIED | 62 lines; 6 rows (ACC-04 split a/b); Observations + Ship Decision sections |

### Key Link Verification

| From                          | To                                | Via                                          | Status     | Details                                                                       |
| ----------------------------- | --------------------------------- | -------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `audit-consumer-argv.sh`      | `lib/argv-heuristics.mjs`         | `node {SCRIPT_DIR}/lib/argv-heuristics.mjs --check` (line 83) | ✓ WIRED  | Shell pipes captured ps output via stdin; lib's --check mode reads + exits 0/1 |
| `audit-langfuse-trace.mjs`    | `lib/trace-walker.mjs`            | `import { walkSpanChain, REQUIRED_SPAN_NAMES } from './lib/trace-walker.mjs'` (line 16) | ✓ WIRED | walkSpanChain called inside retry loop (line 64); chain printed on success |
| `audit-langfuse-trace.mjs`    | `langfuse` SDK                    | `await import('langfuse')` (line 44)         | ✓ WIRED    | Lazy-imported so dry-run/help work without dep; `lf.api.traceList` + `traceGet` |
| `gmail-backfill.mjs`          | Phase 6 cursor file shape         | `~/.config/cortex/gmail-cursor.json` write (lines 71-77) | ✓ WIRED | Reproduces `{last_history_id, last_successful_poll_at}` shape; atomic tmp+rename mode 0600 over dir 0700 |
| `RUNBOOK.md` §B–§G            | All 5 acc scripts                 | inline command examples + expected PASS lines | ✓ WIRED   | Each section names its script with full bash command; expected-output table in §A.6 |
| `RUNBOOK.md` placeholders     | `ACCEPTANCE.md` rows              | "Record this PASS/FAIL line in ACCEPTANCE.md row ACC-XX" | ✓ WIRED | Each §B–§G section ends with a "Record outcome in row ACC-XX" instruction |

### Data-Flow Trace (Level 4)

| Artifact                          | Data Variable                  | Source                                                | Produces Real Data | Status     |
| --------------------------------- | ------------------------------ | ----------------------------------------------------- | ------------------ | ---------- |
| `audit-daemon-env.sh`             | `$BLOCK` (env table)           | `launchctl print` stdout (live process state)         | Live (operator)    | ⚠️ STATIC at dry-run; FLOWS at live run (intended) |
| `audit-consumer-argv.sh`          | `$SAMPLE_FILE` (ps samples)    | `ps -wwo pid,command` repeated 1s polling              | Live (operator)    | ⚠️ STATIC at dry-run; FLOWS at live run (intended) |
| `audit-langfuse-trace.mjs`        | `traces` array                 | `lf.api.traceList` + `lf.api.traceGet`                | Live (operator)    | ⚠️ STATIC at dry-run; FLOWS at live run (intended) |
| `soak-daemon.sh`                  | `$LOG` content                 | `/tmp/cortex-daemon-error.log` (daemon stderr)         | Live (operator)    | ⚠️ STATIC at dry-run; FLOWS at live run (intended) |
| `gmail-backfill.mjs --watch`      | `s.mtimeMs`                    | `/tmp/cortex-consumer.log` mtime                      | Live (operator)    | ⚠️ STATIC at dry-run; FLOWS at live run (intended) |

All five scripts are designed to be data-bearing only at live runtime; dry-run mode by design produces deterministic [DRY-RUN] output without live I/O. This matches CONTEXT D-08 ("dry-run-everywhere" pattern).

### Behavioral Spot-Checks

| Behavior                                                | Command                                                              | Result                                                              | Status |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| Unit tests pass for both libraries                      | `node --test scripts/acc/__tests__/*.test.mjs`                       | `# tests 14 / # pass 14 / # fail 0 / # duration_ms 55`              | ✓ PASS |
| `audit-daemon-env.sh --dry-run` deterministic OK         | `bash scripts/acc/audit-daemon-env.sh --dry-run`                     | Prints 6 [DRY-RUN] lines ending in OK; exits 0                      | ✓ PASS |
| `audit-consumer-argv.sh --dry-run` deterministic OK      | `bash scripts/acc/audit-consumer-argv.sh --dry-run`                  | Prints 7 [DRY-RUN] lines ending in OK; exits 0                      | ✓ PASS |
| `soak-daemon.sh --dry-run` deterministic OK              | `bash scripts/acc/soak-daemon.sh --dry-run`                          | Prints 6 [DRY-RUN] lines ending in OK; exits 0                      | ✓ PASS |
| `audit-langfuse-trace.mjs --dry-run` deterministic OK    | `node scripts/acc/audit-langfuse-trace.mjs --dry-run`                | Prints 5 [DRY-RUN] lines ending in OK; exits 0                      | ✓ PASS |
| `gmail-backfill.mjs --dry-run` deterministic OK          | `node scripts/acc/gmail-backfill.mjs --dry-run`                      | Prints 6 [DRY-RUN] lines ending in OK; exits 0                      | ✓ PASS |

All 6 spot-checks pass. The scripts are runnable, dry-run mode is deterministic across all 5 entry points, and tests pass cleanly under Node 22's built-in runner.

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                  | Status                | Evidence                                                                       |
| ----------- | ----------- | -------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| ACC-01      | 08-01-PLAN  | Daemon 1h soak with zero errors                                                              | ⚠️ TOOLKIT_READY      | `scripts/acc/soak-daemon.sh` ships; live run gated to operator (RUNBOOK §G)   |
| ACC-02      | 08-01-PLAN  | Gmail 6-month backfill completes without hanging                                             | ⚠️ TOOLKIT_READY      | `scripts/acc/gmail-backfill.mjs` ships; live drain run gated to operator (§C) |
| ACC-03      | 08-01-PLAN  | Items flow through Stage 1+2 and appear in triage UI without manual intervention             | ⚠️ TOOLKIT_READY      | RUNBOOK §E delegates to visual operator check (no UI automation by design)    |
| ACC-04      | 08-01-PLAN  | Daemon env has no DATABASE_URL; consumer argv has no file content                            | ⚠️ TOOLKIT_READY      | `audit-daemon-env.sh` + `audit-consumer-argv.sh` ship; live audits gated (§B + §D) |
| ACC-05      | 08-01-PLAN  | Single ingested item reconstructable end-to-end in Langfuse                                  | ⚠️ TOOLKIT_READY      | `audit-langfuse-trace.mjs` ships; live trace walk gated to operator (§F)      |

**Coverage analysis:** All 5 ACC-* requirements have a concrete artifact (script + RUNBOOK section + ACCEPTANCE.md row). The phase ships the toolkit; the live observations move to ACCEPTANCE.md under operator drive — exactly the boundary CONTEXT D-01 establishes.

No orphaned requirements found.

### Anti-Patterns Found

| File                          | Line | Pattern                | Severity | Impact                                                                                |
| ----------------------------- | ---- | ---------------------- | -------- | ------------------------------------------------------------------------------------- |
| (none)                        | -    | -                      | -        | Clean scan: no `@anthropic-ai`, `@prisma/client`, `@neondatabase/serverless` imports under `scripts/acc/`. `DATABASE_URL` references are scoped exclusively to `audit-daemon-env.sh` (the script that's checking for its absence). No TODO/FIXME/PLACEHOLDER markers. No empty implementations or hardcoded URLs/keys (Vercel + Langfuse hosts come from env vars; placeholders in plists are documented in RUNBOOK §I). |

**Guards verified:**
- `grep -rE "@anthropic-ai|@prisma/client|@neondatabase/serverless" scripts/acc/` → empty
- `git diff HEAD~7 HEAD -- package.json agent/package.json` → empty (zero new deps)
- `git diff HEAD~7 HEAD --name-only` → only 12 expected files (5 scripts + 2 libs + 2 tests + 3 docs); no `app/`, `lib/`, `prisma/`, `agent/src/`
- `DATABASE_URL` literal scoped to `audit-daemon-env.sh` only (FORBIDDEN check + log message)

### Human Verification Required

Phase 8 inherently requires operator drive for the live observations. Each item below maps to a row in `ACCEPTANCE.md` and a section in `RUNBOOK.md`.

#### 1. ACC-04a — Daemon runtime env audit

**Test:** Bootstrap the daemon plist (RUNBOOK §B), then run `bash scripts/acc/audit-daemon-env.sh`.
**Expected:** `PASS ACC-04 (daemon-env) — DATABASE_URL absent; required keys present`
**Why human:** Requires daemon loaded under launchd with production-shaped plist (CORTEX_API_URL, CORTEX_API_KEY, WATCH_PATHS) and Vercel-issued credentials.

#### 2. ACC-02 — Gmail 6-month backfill drains

**Test:** Stop daemon → `node scripts/acc/gmail-backfill.mjs --clear` → restart daemon → `node scripts/acc/gmail-backfill.mjs --watch` (RUNBOOK §C).
**Expected:** `PASS ACC-02 (gmail-backfill) — consumer log idle for 5 minutes` (after multi-minute to multi-hour drain depending on inbox size).
**Why human:** Requires live Gmail OAuth (`security find-generic-password -s cortex-gmail`), a live Stage 1/2 consumer pipeline, and operator-grade observation of the drain.

#### 3. ACC-04b — Live consumer argv audit

**Test:** Bootstrap the consumer plist (RUNBOOK §D), drop a real PDF in `~/Downloads`, run `bash scripts/acc/audit-consumer-argv.sh --watch-for=120`.
**Expected:** `PASS ACC-04 (consumer-argv) — N 'claude -p' invocations sampled, all clean`
**Why human:** Requires a live consumer cycle to fire during the 120s sampling window; the operator must drop a PDF immediately before running the audit so a `claude -p` invocation is captured.

#### 4. ACC-03 — Triage UI flow

**Test:** Open `https://<vercel-host>/triage` after items have flowed through §C (Gmail) and §D (Downloads). Confirm items surface without manual queue intervention.
**Expected:** PDF and Gmail items both appear in the relevance- and/or label-triage queue.
**Why human:** Visual UI checkpoint — RUNBOOK §E explicitly delegates to operator (no browser automation in scope).

#### 5. ACC-05 — End-to-end Langfuse trace

**Test:** Pick an item ID from §E. Export `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`. Run `node scripts/acc/audit-langfuse-trace.mjs --item-id <ID>`.
**Expected:** `PASS ACC-05 (langfuse-trace) — chain: api-ingest → api-queue → consumer-stage1-item → api-classify`
**Why human:** Requires live Langfuse credentials and an item that has fully traversed the pipeline; the SDK call hits the Langfuse cloud API with eventual consistency. Also rerun with `--require-stage2` for a Gmail keep flow per RUNBOOK §F.4.

#### 6. ACC-01 — 1-hour daemon soak

**Test:** With both daemon and consumer loaded, run `bash scripts/acc/soak-daemon.sh` and let it block for 3600 seconds.
**Expected:** `PASS ACC-01 (soak-daemon) — zero error lines in 3600s`
**Why human:** Requires 1 wall-clock hour of live daemon runtime against a production-shaped API surface. Allow-list (`heartbeat_ping_unexpected_error|http_client_terminal_skip`) is documented; if persistent matches occur, that's a Phase 9 signal — not an ACC-01 fail.

After all 6 are PASS, the operator writes the **v1.1 Ship Decision** paragraph at the bottom of `ACCEPTANCE.md` to close the milestone.

### Gaps Summary

**No toolkit gaps.** The acceptance toolkit ships exactly per the plan and CONTEXT decisions:

- 5 executable scripts (3 audits + 2 orchestrators), all `chmod +x` with proper shebangs, all dry-run-runnable in <1s
- 2 pure-logic libraries with 14 passing unit tests under Node 22's built-in test runner
- A 384-line self-contained operator RUNBOOK with §A–§I covering prerequisites, all 5 ACC audits, troubleshooting, and a placeholder-fill-in table
- A 62-line ACCEPTANCE.md skeleton with 6 result rows (ACC-04 split a/b), TBD placeholders, and a Ship Decision section
- Zero new dependencies, zero source code modifications outside `scripts/acc/`, zero forbidden SDK imports

**Live runs deferred to operator** per CONTEXT D-01 ("audit scripts are the deliverable, not the live runs"). This is the intended boundary for Phase 8 — automated verification cannot self-validate live runtime behavior without live infrastructure (launchd, OAuth, Langfuse cloud, Vercel-deployed API).

The phase status is `human_needed`: toolkit complete and dry-run-clean; live operator runs pending against a real production-shaped deployment. Once Daniel works through `RUNBOOK.md` end-to-end and fills in `ACCEPTANCE.md`, the v1.1 milestone closes.

---

_Verified: 2026-04-25T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
