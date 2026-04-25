---
phase: 05-queue-api-surface
plan: 01
subsystem: api
tags: [api, queue, auth, foundation, tdd]
requires: []
provides:
  - "lib/api-key.ts:requireApiKey"
  - "lib/queue-config.ts:STALE_CLAIM_TIMEOUT_MS"
  - "lib/queue-config.ts:RETRY_CAP"
  - "lib/queue-config.ts:TERMINAL_ERROR_STATUS"
  - "lib/queue-config.ts:QUEUE_TRACE_KEY"
  - "lib/queue-config.ts:QUEUE_STATUSES"
  - "lib/queue-sql.ts:buildClaimParams"
  - "lib/queue-sql.ts:Stage"
affects:
  - "app/api/ingest/route.ts (future, plan 05-02)"
  - "app/api/queue/route.ts (future, plan 05-03)"
  - "app/api/classify/route.ts (future, plan 05-02)"
tech_stack_added:
  - "pg-mem@^3 (devDependency, used by 05-03 atomic-claim integration test)"
patterns_introduced:
  - "Per-route Bearer-secret auth helper (returns null|Response, never throws)"
  - "Param-builder helper for tagged-template SQL (validation + status-string resolution at the call site)"
  - "Single-source-of-truth queue tuning constants (no scattered magic numbers)"
key_files_created:
  - "lib/api-key.ts"
  - "lib/queue-config.ts"
  - "lib/queue-sql.ts"
  - "__tests__/api-key.test.ts"
  - "__tests__/queue-config.test.ts"
  - "__tests__/queue-sql.test.ts"
key_files_modified:
  - "package.json (added pg-mem devDependency)"
  - "package-lock.json (sync)"
key_decisions:
  - "Empty 401 body — leaks zero schema/Item info on auth failure"
  - "Fail-closed when CORTEX_API_KEY env var is unset (no empty-string match)"
  - "buildStaleReclaimParams not exported — cutoff calculation is one line, inlined in 05-03"
  - "Static SQL stays in route handlers because neon() requires tagged templates for parameter binding"
metrics:
  tasks_completed: 3
  tests_added: 18
  duration_seconds: 288
  duration_human: "4m 48s"
  completed_at: "2026-04-25T10:48:52Z"
---

# Phase 5 Plan 1: Queue & API Foundation Utilities — Summary

**Three small lib files (`lib/api-key.ts`, `lib/queue-config.ts`, `lib/queue-sql.ts`) plus 18 unit tests publish a stable contract that plans 05-02 and 05-03 can import without re-negotiation, and pre-install `pg-mem@^3` for 05-03's atomic-claim integration test.**

## Exported Signatures (copy-paste contract for 05-02 / 05-03)

### `lib/api-key.ts`

```ts
import type { NextRequest } from 'next/server'

export function requireApiKey(
  request: NextRequest | Request,
): Response | null
```

Returns `null` when `Authorization: Bearer ${process.env.CORTEX_API_KEY}` matches; returns a `new Response(null, { status: 401 })` (empty body) otherwise. **Fail-closed** when `CORTEX_API_KEY` is unset.

Usage at the top of every new route handler:

```ts
const unauthorized = requireApiKey(request)
if (unauthorized) return unauthorized
```

### `lib/queue-config.ts`

```ts
export const STALE_CLAIM_TIMEOUT_MS = 10 * 60 * 1000  // 600000
export const RETRY_CAP = 5
export const TERMINAL_ERROR_STATUS = 'error' as const
export const QUEUE_TRACE_KEY = 'queue' as const
export const QUEUE_STATUSES = {
  PENDING_STAGE_1: 'pending_stage1',
  PROCESSING_STAGE_1: 'processing_stage1',
  PENDING_STAGE_2: 'pending_stage2',
  PROCESSING_STAGE_2: 'processing_stage2',
  IGNORED: 'ignored',
  UNCERTAIN: 'uncertain',
  CERTAIN: 'certain',
  ERROR: TERMINAL_ERROR_STATUS,        // === 'error'
  LEGACY_PROCESSING: 'processing',     // v1.0 status, swept by stale-reclaim path
} as const
```

### `lib/queue-sql.ts`

```ts
import { QUEUE_STATUSES } from './queue-config'

export type Stage = 1 | 2

export function buildClaimParams(
  stage: Stage,
  limit: number,
): {
  pendingStatus: string         // QUEUE_STATUSES.PENDING_STAGE_{N}
  processingStatus: string      // QUEUE_STATUSES.PROCESSING_STAGE_{N}
  limit: number                 // echoed
  nowIso: string                // new Date().toISOString()
  stage: Stage                  // echoed
}
```

Throws on:
- `stage` outside `1 | 2` → `"Invalid stage: …. Must be 1 or 2."`
- `limit` not a positive integer (zero, negative, fractional, `NaN`, `Infinity`) → `"Invalid limit: …. Must be a positive integer."`

The route handler (plan 05-03) owns the static SQL because `@neondatabase/serverless`'s `neon()` requires tagged-template form for parameter binding. The full SQL skeleton — including the `jsonb_set` / `FOR UPDATE SKIP LOCKED` shape — is documented in the JSDoc of `buildClaimParams` for the 05-03 executor to copy.

`buildStaleReclaimParams` is **NOT** exported. The stale-reclaim cutoff (`new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS).toISOString()`) is a single line that 05-03 inlines directly.

## Tasks

### Task 1: requireApiKey helper + pg-mem devDep (commit `198c1d2`)

- Wrote 6 RED tests covering valid token, missing header, wrong token, wrong scheme, unset env var, and the empty-Bearer-token defense-in-depth case.
- Implemented `lib/api-key.ts` mirroring the `/api/cron/embed` Bearer pattern but with empty 401 body and fail-closed env-var handling.
- Installed `pg-mem@^3.0.14` as a devDependency (lazy-loaded at test time only — does not bloat the production bundle).
- All 6 tests green.

### Task 2: Queue config constants (commit `d47a016`)

- Wrote 6 RED tests locking `STALE_CLAIM_TIMEOUT_MS = 600000`, `RETRY_CAP = 5`, `TERMINAL_ERROR_STATUS = 'error'`, `QUEUE_TRACE_KEY = 'queue'`, the full `QUEUE_STATUSES` literal-string map (including the legacy `'processing'` v1.0 status), and the `QUEUE_STATUSES.ERROR === TERMINAL_ERROR_STATUS` invariant.
- Implemented `lib/queue-config.ts` with `as const` on every literal so downstream `import { QUEUE_STATUSES } from '...'` gives narrow types, not `string`.
- All 6 tests green.

### Task 3: Atomic-claim SQL param builder (commit `1d3b95b`)

- Wrote 6 RED tests covering the stage-1/stage-2 happy paths, invalid-stage rejection (`3`, `0`, `'1'`), invalid-limit rejection (zero, negative, fractional, `NaN`, `Infinity`), and the `nowIso` round-trip property (`new Date(nowIso).toISOString() === nowIso`).
- Implemented `lib/queue-sql.ts` with `buildClaimParams` only — the explicit JSDoc names the omitted `buildStaleReclaimParams` helper and explains the cutoff is inlined in 05-03.
- All 6 tests green.

## Confirmations

| Check | Result |
| --- | --- |
| All 18 tests pass (`npx jest __tests__/api-key.test.ts __tests__/queue-config.test.ts __tests__/queue-sql.test.ts`) | PASS |
| `lib/queue-sql.ts` does NOT export `buildStaleReclaimParams` | PASS (`grep -n` returns nothing) |
| `lib/queue-sql.ts` does NOT call `neon(...)` at module load | PASS (no `neon(` reference) |
| `lib/api-key.ts` does NOT import `@clerk/*` or reference `middleware.ts` | PASS |
| No Prisma migration files created (`prisma/migrations/` does not exist) | PASS — honors CLAUDE.md "migrations through Vercel build, never locally" |
| No existing route handlers modified (`app/api/triage/`, `app/api/cron/`, `app/api/taxonomy/` clean) | PASS — `git diff --name-only main..HEAD` shows only the six plan files + `package.json` + `package-lock.json` |
| `package.json` devDependencies includes `pg-mem@^3.0.14` | PASS |

## Vercel & Local Env Var Setup

`CORTEX_API_KEY` must be added before plan 05-02's routes ship. The helper itself is now installed and read from `process.env.CORTEX_API_KEY` at request time.

```bash
# Generate locally
openssl rand -hex 32

# Vercel project env (Production + Preview + Development)
# Settings → Environment Variables → CORTEX_API_KEY = <generated>

# Local for `next dev`
echo "CORTEX_API_KEY=<generated>" >> .env.local
```

The same value will later be added to the launchd plist's `EnvironmentVariables` block by Phase 6 (daemon refactor) — out of scope for this plan.

## Deviations from Plan

**One minor test-file fix during Task 3 (Rule 3 — blocking issue):**

The plan's example tests used `// @ts-expect-error` to flag the invalid-stage cases. With `tsconfig.test.json` in non-strict mode (`strict: false`), the type error never fires, which makes `@ts-expect-error` itself an unused-directive error (TS2578) and blocks the test from compiling. Switched to `as any` casts on the invalid arguments — same intent, compiles under the project's existing test config. Documented inline in `__tests__/queue-sql.test.ts` so a future strict-mode toggle can revisit.

No other deviations — plan executed as written. No auth gates, no architectural changes, no out-of-scope discoveries.

## Files Created / Modified

**Created:**
- `lib/api-key.ts`
- `lib/queue-config.ts`
- `lib/queue-sql.ts`
- `__tests__/api-key.test.ts`
- `__tests__/queue-config.test.ts`
- `__tests__/queue-sql.test.ts`

**Modified:**
- `package.json` (`pg-mem@^3.0.14` added to devDependencies)
- `package-lock.json` (regenerated)

## Self-Check: PASSED

All claimed files exist on disk:
- `FOUND: lib/api-key.ts`
- `FOUND: lib/queue-config.ts`
- `FOUND: lib/queue-sql.ts`
- `FOUND: __tests__/api-key.test.ts`
- `FOUND: __tests__/queue-config.test.ts`
- `FOUND: __tests__/queue-sql.test.ts`

All claimed commits exist in `git log`:
- `FOUND: 198c1d2` (Task 1: requireApiKey + pg-mem)
- `FOUND: d47a016` (Task 2: queue-config constants)
- `FOUND: 1d3b95b` (Task 3: buildClaimParams)
