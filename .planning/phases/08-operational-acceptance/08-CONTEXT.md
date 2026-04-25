# Phase 8: Operational Acceptance - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — infrastructure phase, decisions trivially derived from CONTEXT decisions of prior phases

<domain>
## Phase Boundary

Verify the v1.1 ingest pipeline is shippable end-to-end. Each ACC-* requirement maps to either an automated audit script (ACC-04, ACC-05) or a live operator run with a documented runbook (ACC-01, ACC-02, ACC-03).

**In scope:**
- `scripts/acc/` directory with shell + node scripts that automate the auditable invariants:
  - `audit-daemon-env.sh` — `launchctl print gui/$(id -u)/com.cortex.daemon` filtered for `DATABASE_URL`/`@prisma`/`@neondatabase`; pass = absent
  - `audit-consumer-argv.sh` — `ps -wwo pid,command` during a live consumer run; assert no `claude -p` argv contains anything that looks like file content (heuristic: argv >50KB or contains null bytes)
  - `audit-langfuse-trace.mjs` — Langfuse SDK call that fetches a recent trace by id and walks: `daemon.ingest_post → api.ingest → api.queue → consumer.classify_cycle → api.classify`. Asserts span chain present.
  - `soak-daemon.sh` — wrapper that loads daemon plist, runs for 1h, captures stderr/stdout to a log file, exits non-zero on any error log line
  - `gmail-backfill.mjs` — script that resets daemon Gmail historyId to 6 months back (writes the local cursor file with computed historyId), tails consumer logs, exits when no Gmail items in queue for 5 consecutive minutes
- `.planning/phases/08-operational-acceptance/RUNBOOK.md` — operator instructions for the manual portions
- `.planning/phases/08-operational-acceptance/ACCEPTANCE.md` — final report documenting which ACC-* are verified vs deferred to live operator action

**Out of scope:**
- Any code changes to phases 5/6/7 surfaces (those are sealed)
- New features
- Schema changes

</domain>

<decisions>
## Implementation Decisions

### Audit scripts are the deliverable, not the live runs
Phase 8's CODE artifact is the scripts + runbook. The live runs themselves (1h soak, 6-month backfill) are the operator's responsibility — Daniel runs them after this phase ships and reports results back. The phase verification will accept "scripts exist + dry-run passes + RUNBOOK is complete" as PASS for Phase 8 itself; the live observations move to a Phase 8 ACCEPTANCE.md update by Daniel.

### Script language choice
- Shell (bash) for orchestration that wraps `launchctl`, `ps`, `git`, file ops
- Node (`.mjs`) for anything touching Langfuse SDK, Gmail historyId calc, or JSON parsing complexity
- All scripts shebang `#!/usr/bin/env bash` or `#!/usr/bin/env node` and have `chmod +x`

### Trace reconstruction
- Use `langfuse@3.38.20` already in deps
- The script accepts a `--item-id` arg, queries the daemon ingest log for the matching content_hash, finds the trace_id, fetches the trace via Langfuse API, walks the span tree, and prints PASS/FAIL with the chain
- Fail mode: any required span (daemon.ingest_post, api.ingest, api.queue, consumer.stage1/2.cycle, api.classify) missing or unlinked

### Acceptance documentation
- `RUNBOOK.md` — step-by-step what the operator does (load plists, run audit-* scripts, run soak-daemon.sh, run gmail-backfill.mjs, fill in ACCEPTANCE.md)
- `ACCEPTANCE.md` — checklist with results columns; starts with placeholder values, operator fills in observed values during their run

### What this phase does NOT auto-prove
- That the daemon actually ran for 1h without errors (operator runs `soak-daemon.sh` and observes)
- That Gmail's 6-month backfill completes (operator runs `gmail-backfill.mjs` and observes)
- That items appear in triage UI for an end-to-end flow (operator visually checks)

These are documented in RUNBOOK.md with explicit acceptance criteria the operator records in ACCEPTANCE.md.

</decisions>

<canonical_refs>
- All Phase 5/6/7 routes and code (the surfaces under audit)
- `agent/launchd/com.cortex.daemon.plist` (Phase 6)
- `agent/launchd/com.cortex.consumer.plist` (Phase 7)
- `agent/src/cursor/gmail-cursor.ts` (Phase 6) — gmail-backfill script writes this file
- `INGEST-REARCHITECT-BRIEF.md` (root) — original ACC-* expectations

</canonical_refs>

<code_context>
## Existing Code Insights

### What audit scripts can rely on
- `launchctl print` is available on macOS Sequoia (the target platform)
- `ps -ww` likewise
- Langfuse SDK is already a dep — scripts can import it
- `@anthropic-ai/sdk` is NOT in agent/package.json anymore (deleted in Phase 6); audit scripts that need to call Anthropic should not need to (only Langfuse fetches)
- `keytar` is in agent/package.json; gmail-backfill may or may not need it depending on whether Gmail OAuth tokens are still in keytar (likely)

### What audit scripts must NOT do
- Modify any source code
- Push migrations
- Touch production Vercel env vars
- Use Clerk (use `requireApiKey` for any API calls — same Bearer pattern as consumers)

</code_context>

<specifics>
## Specific Ideas

- The `audit-daemon-env.sh` script is the single most important artifact: it directly verifies ACC-04 ("a runtime audit of the daemon process confirms `DATABASE_URL` is not in its environment"). This must be runnable in <5 seconds and produce an unambiguous PASS/FAIL.

- The `audit-consumer-argv.sh` script needs to attach during a live consumer Stage 1 or Stage 2 run. It should support a `--watch-for=N` mode that polls `ps -ww` for N seconds, capturing every `claude -p` invocation, and asserts none has argv > a sane size limit (say 16KB) or contains null bytes. This is the second half of ACC-04.

- For ACC-05 (end-to-end traceability), the script should be smart enough to handle the case where Langfuse's API doesn't yet have the trace (eventual consistency on flush). Retry with backoff for up to 60s.

- RUNBOOK.md should be structured so a future Daniel rereading it in 6 months can perform acceptance without consulting any other doc. Include sample command outputs, expected timings, fallback steps if a script fails.

</specifics>

<deferred>
## Deferred Ideas

- Continuous integration of the audit scripts in Vercel preview builds — out of scope; v1.1 is single-operator
- Slack/email notification on soak failure — out of scope
- Replay tooling for failed items — Phase 9+ if needed
- Tracing of agent/heartbeat → no trace_id chain expected from heartbeat path (deliberately, per Phase 6 CONTEXT)

</deferred>
