---
phase: 05-queue-api-surface
plan: 02
subsystem: api
tags: [api, ingest, classify, langfuse, zod, prisma, queue, state-machine]

# Dependency graph
requires:
  - phase: 05-queue-api-surface (plan 01)
    provides: requireApiKey helper, RETRY_CAP/QUEUE_STATUSES/TERMINAL_ERROR_STATUS constants, buildClaimParams
provides:
  - "POST /api/ingest: daemon entry-point with CORTEX_API_KEY auth, SHA-256 dedup, pending_stage1 writes"
  - "POST /api/classify: consumer feedback endpoint with state-machine transitions for stage 1 + 2 plus retry/error path"
  - "classification_trace.queue JSON shape: { stage1: { retries, last_claim_at?, last_error? }, stage2: {...} }"
  - "X-Trace-Id response header pattern (Langfuse trace propagation)"
affects: [05-03 queue endpoint, Phase 6 daemon, Phase 7 consumers]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — reused langfuse@3, zod@4, prisma@7, @neondatabase/serverless
  patterns:
    - "Per-route Bearer-secret auth via requireApiKey (Clerk untouched on these routes)"
    - "Zod discriminatedUnion('outcome') for tagged-union request bodies"
    - "Langfuse trace + spans wrapping every DB op; X-Trace-Id on every response"
    - "Additive JSON sibling key (classification_trace.queue) — no schema migration"

key-files:
  created:
    - app/api/ingest/route.ts
    - app/api/classify/route.ts
    - __tests__/ingest-api.test.ts
    - __tests__/classify-api.test.ts
  modified: []

key-decisions:
  - "OWNER_USER_ID env-overridable, defaults to 'cortex_owner' — single-operator constant honoring v1.1 non-goal"
  - "file_path persisted inside source_metadata.file_path (no Item column added)"
  - "CONFIDENCE_THRESHOLD=0.75 mirrors triage/route.ts buildProposals — single semantic source of truth"
  - "Discriminated union on outcome — success-only and error-only fields cannot coexist at the type level"
  - "Retries reset to 0 on success-path update (not just incremented on error)"
  - "Route handler covers BOTH branches in Task 2a; Task 2b is test-only (route untouched)"

patterns-established:
  - "API auth pattern: const unauthorized = requireApiKey(request); if (unauthorized) return unauthorized"
  - "Langfuse trace pattern: const lf = new Langfuse(); const trace = lf.trace({ name: ... }); ... await lf.flushAsync()"
  - "X-Trace-Id header set on every Response before return (success, validation, 404, 500)"
  - "Test mock pattern: jest.mock('../lib/prisma', ...) + jest.mock('langfuse', ...) with stable trace.id"

requirements-completed: [API-01, API-04, API-05, API-06, QUE-01, QUE-03, QUE-04, QUE-06]

# Metrics
duration: ~30min
completed: 2026-04-25
---

# Phase 5 Plan 2: Ingest & Classify Write-Path Endpoints Summary

**Two write-path Next.js Route Handlers (`POST /api/ingest`, `POST /api/classify`) with CORTEX_API_KEY Bearer auth, full Langfuse tracing, and a complete classify state machine — including retry counter and 5-attempt terminal cap stored in `classification_trace.queue`.**

## Performance

- **Duration:** ~30 min (across two sessions: Task 1 in first, Tasks 2a + 2b in second)
- **Tasks:** 3 (Task 1, Task 2a, Task 2b)
- **Files created:** 4
- **Files modified:** 0 (zero existing routes touched — API-06 invariant holds)
- **Commits:** 3 (one per task)

## Accomplishments

- **POST /api/ingest** ships: Bearer-secret auth, Zod validation of source/content_hash/optional metadata, SHA-256 dedup via `prisma.item.findUnique({ where: { content_hash } })`, dedup hit returns existing id WITHOUT calling create, new items written at `status='pending_stage1'`, file_path nested inside `source_metadata` (no schema migration).
- **POST /api/classify** ships: Bearer-secret auth, Zod discriminated union on `outcome`, item-not-found 404, full state-machine transitions for stage 1 + stage 2, error path with retry counter and terminal-cap promotion to `status='error'` at RETRY_CAP=5.
- **Langfuse traces** opened on every call (`api-ingest`, `api-classify`), with named spans around dedup checks, item lookups, and updates. `X-Trace-Id` header propagated on every response (200 / 400 / 401 / 404 / 500).
- **Test coverage:** 9 tests for `/api/ingest` (auth, validation, dedup hit/miss, error path) + 14 tests for `/api/classify` (9 success + 5 error). All 23 tests green; combined run takes ~6s.

## Task Commits

1. **Task 1: Build POST /api/ingest with dedup and Zod validation** — `87e7f4a` (feat)
2. **Task 2a: Build POST /api/classify success-path state machine** — `64db576` (feat)
3. **Task 2b: Add POST /api/classify error-path tests (retry counter + terminal cap)** — `2c799c7` (test)

_Note: each task batched RED+GREEN into a single commit — both the test file and the implementation it tests are added together so reverting a task removes both halves cleanly._

## Files Created

- `app/api/ingest/route.ts` — POST handler with CORTEX_API_KEY auth, SHA-256 dedup, Item creation at pending_stage1
- `app/api/classify/route.ts` — POST handler with state machine: stage1 (keep/ignore/uncertain) + stage2 (certain/uncertain) + error path (retry counter, terminal cap)
- `__tests__/ingest-api.test.ts` — 9 tests covering auth, validation, dedup hit/miss, X-Trace-Id, error logging
- `__tests__/classify-api.test.ts` — 14 tests in two describe blocks (success path, error path)

## Final API Contracts

### POST /api/ingest

**Request body** (Zod-validated):
```ts
{
  source: 'downloads' | 'gmail',         // required
  content_hash: string,                  // required, SHA-256 hex
  filename?: string,
  mime_type?: string,
  size_bytes?: number,                   // nonneg int
  source_metadata?: Record<string, unknown>,
  file_path?: string                     // downloads only — nested into source_metadata.file_path
}
```

**Responses:**
- `200 { id, deduped: false }` — new content_hash, Item created at `status='pending_stage1'`
- `200 { id: <existing>, deduped: true }` — content_hash already present, NO `prisma.item.create` call
- `400 { error: 'validation_failed', issues: [...] }` — Zod failure or unparseable JSON
- `401` (empty body) — missing or wrong Bearer token
- `500` — internal error (Prisma threw); error logged via `console.error('[api/ingest] error:', err)`

**All responses set header `X-Trace-Id: <langfuse_trace_id>`.**

### POST /api/classify

**Request body** (Zod discriminated union on `outcome`):
```ts
// outcome === 'success'
{
  item_id: string,
  stage: 1 | 2,
  outcome: 'success',
  decision?: 'keep' | 'ignore' | 'uncertain',                // stage 1
  axes?: Record<'type'|'from'|'context', { value: string|null, confidence: number }>,  // stage 2
  confidence?: number,
  reason?: string,
  proposed_drive_path?: string                                // stage 2
}
// outcome === 'error'
{
  item_id: string,
  stage: 1 | 2,
  outcome: 'error',
  error_message: string                                       // required, min length 1
}
```

**Responses:**
- `200 { ok: true, status: <new_status>, retries: <number> }` — state transition applied
- `400 { error: 'validation_failed', issues: [...] }`
- `401` (empty body)
- `404 { error: 'item_not_found' }` — item_id does not exist
- `500` — internal error

**All responses set header `X-Trace-Id: <langfuse_trace_id>`.**

## State-Machine Transition Table (as implemented)

### Success path
| stage | outcome | decision/axes              | resulting `status`  | retries |
|-------|---------|----------------------------|---------------------|---------|
| 1     | success | decision=keep              | `pending_stage2`    | reset to 0 |
| 1     | success | decision=ignore            | `ignored`           | reset to 0 |
| 1     | success | decision=uncertain         | `uncertain`         | reset to 0 |
| 2     | success | all axes confidence ≥ 0.75 | `certain`           | reset to 0 |
| 2     | success | any axis confidence < 0.75 | `uncertain`         | reset to 0 |

### Error path
| stage | outcome | prev retries     | new retries | resulting `status`  |
|-------|---------|------------------|-------------|---------------------|
| 1     | error   | < 4 (RETRY_CAP-1)| prev + 1    | `pending_stage1`    |
| 1     | error   | ≥ 4              | RETRY_CAP=5 | `error` (terminal)  |
| 2     | error   | < 4              | prev + 1    | `pending_stage2`    |
| 2     | error   | ≥ 4              | RETRY_CAP=5 | `error` (terminal)  |

Stage isolation verified: a stage 2 error increments only `classification_trace.queue.stage2.retries`; the stage 1 counter is preserved verbatim.

## classification_trace JSON Shape (now in production)

```jsonc
{
  // Existing v1.0 keys — UNCHANGED
  "stage1": { "decision": "keep" | "ignore" | "uncertain", "confidence": number, "reason": string },
  "stage2": {
    "axes": { "type": {...}, "from": {...}, "context": {...} },
    "proposed_drive_path": string
  },
  // NEW v1.1 sibling — additive JSON, no schema migration
  "queue": {
    "stage1": {
      "retries": number,                  // 0 after a successful stage1 run; incremented on error
      "last_claim_at"?: string,           // ISO — written by /api/queue (plan 05-03)
      "last_error"?: string               // last error_message from /api/classify
    },
    "stage2": { /* same shape */ }
  }
}
```

## Decisions Made

- **OWNER_USER_ID locked to env (`CORTEX_OWNER_USER_ID`) with `'cortex_owner'` fallback.** Single-operator tool — multi-user is a v1.x non-goal. Tenancy schema (the `user_id` column) is preserved so a future migration can populate per-tenant ids without backfilling rows.
- **`file_path` lives in `source_metadata.file_path`, not a new column.** CONTEXT decision: no schema changes beyond additive `Item.status` string values this phase.
- **`CONFIDENCE_THRESHOLD = 0.75` is duplicated** between `/api/classify` and `/api/triage/route.ts buildProposals`. Both files cite each other in comments. Promoting to a shared `lib/` constant was deferred — touching `triage/route.ts` would breach the API-06 "no existing route modified" invariant.
- **Discriminated-union body schema.** `z.discriminatedUnion('outcome', [success-shape, error-shape])` prevents callers from sending `{ outcome: 'error', decision: 'keep' }` and getting a strange state — Zod rejects mixed bodies at parse time.
- **Reset retries on success.** When a stage finally succeeds, the new write sets `classification_trace.queue.<stageN>.retries = 0`. This means a stage 1 retry that eventually succeeds will not poison stage 2's counter.
- **Route handler covers both branches in Task 2a.** Task 2b is intentionally test-only — the implementation was finalized in 2a and its `git diff` between Task 2b's start and end is empty (verified: 0 lines).

## Deviations from Plan

None — plan executed exactly as written. The skeleton in the PLAN was filled in verbatim; no new dependencies, no schema changes, no out-of-scope edits.

## Issues Encountered

- **Pre-existing TS errors in `__tests__/triage-api.test.ts` and other test files.** Documented in `.planning/phases/05-queue-api-surface/deferred-items.md` before this plan started. Out of scope for 05-02 — all test files in the repo have the same `Cannot find name 'jest'` class of errors under `tsc --noEmit` because the global `tsconfig.json` does not include `@types/jest`; Jest itself uses `tsconfig.test.json` and runs cleanly. Test execution is the source of truth (`npx jest __tests__/classify-api.test.ts` exits 0 with 14/14 passing).

## API-06 Invariant Check

- `git diff HEAD~3 HEAD app/api/triage/route.ts` — empty
- `git diff HEAD~3 HEAD app/api/cron/embed/route.ts` — empty
- `git diff HEAD~3 HEAD app/api/ask/route.ts` — empty
- `git diff HEAD~3 HEAD -- app/api/taxonomy app/api/rules` — empty
- `git status prisma/migrations/` — directory does not exist (no migration created)
- `grep -rn "auth()" app/api/ingest/ app/api/classify/` — empty (no Clerk on new routes)

## User Setup Required

None — `CORTEX_API_KEY` was already declared in 05-01's USER-SETUP. No new environment variables introduced this plan.

## Next Phase Readiness

- **Ready for 05-03** (`GET /api/queue`): the `classification_trace.queue.stageN` JSON shape these endpoints write is exactly the shape that 05-03's atomic claim SQL will read for stale-claim detection (`last_claim_at`) and retry-count-aware reclaim.
- **Ready for Phase 6** (daemon): the `/api/ingest` contract is final. Daemon can SHA-256 a download or gmail item and POST it; the server handles dedup transparently.
- **Ready for Phase 7** (consumers): the `/api/classify` contract is final. Stage 1 / Stage 2 consumers can POST success or error outcomes without server-side branching tweaks.
- **No blockers carried forward.**

## Self-Check: PASSED

- `app/api/ingest/route.ts` exists — verified
- `app/api/classify/route.ts` exists — verified
- `__tests__/ingest-api.test.ts` exists — verified
- `__tests__/classify-api.test.ts` exists with 14 `it(` blocks across 2 describe blocks — verified
- Commit `87e7f4a` (Task 1) found in `git log` — verified
- Commit `64db576` (Task 2a) found in `git log` — verified
- Commit `2c799c7` (Task 2b) found in `git log` — verified
- `npx jest __tests__/classify-api.test.ts` → 14 passed, 0 failed — verified
- No files under `app/api/queue/` (out of scope, belongs to 05-03) — verified
- No `prisma/migrations/` directory created — verified

## Code-Review Fixes (2026-04-25, post-review)

After 05-VERIFICATION ran, gsd-code-reviewer flagged 11 findings in `05-REVIEW.md`. The following from the 02-deliverables (`app/api/classify/route.ts` and the auth helper that gates it) were fixed:

### Critical fixes applied

- **CR-01 — Stage 2 success with partial axes silently zeroed confidence columns.** Tightened the Zod schema so `axes` requires all three keys (`type`, `from`, `context`); a sparse axes payload now 400s before any DB write. Commit `d3c7d9b`.
- **CR-02 — Stage 2 axis with `value: null, confidence ≥ 0.75` flipped status to `certain` while leaving the column null.** Added a Zod refinement on the per-axis schema that rejects this contradiction at the API boundary. Commit `d3c7d9b`.
- **CR-03 — Slow consumer's POST /api/classify could overwrite a re-claimer's already-completed work after stale-reclaim.** Added a TOCTOU race guard: in-memory `item.status === expectedStatus` check after `findUnique`, plus a compound `where: { id, status: expectedStatus }` in `prisma.item.updateMany`. Returns `409 item_no_longer_claimed` when stale (both success and error paths). Commit `d3c7d9b`.
- **CR-04 — Non-constant-time API key comparison leaked length information.** Replaced the JS `!==` in `lib/api-key.ts` with `crypto.timingSafeEqual` and exported a `safeEqual` helper. Length-mismatch path self-compares to avoid early-exit timing channels. Commit `8e8670a`.

### Major fixes applied

- **MR-07 — Stage 1 trace's optional fields (`confidence`, `reason`) were spread as `undefined` and clobbered prior values.** The trace patch is now built conditionally; omitted optional fields preserve any prior values written by an earlier attempt. Commit `d3c7d9b`.
- **MR-08 — Two `as unknown as object` double-casts on `classification_trace` writes bypassed Prisma's `InputJsonValue` typing.** Replaced with `as Prisma.InputJsonValue` (single cast through the proper type). Commit `d3c7d9b`.

### Test changes

- `__tests__/classify-api.test.ts`: 14 → 24 tests. Added a third `describe` block ("review fix coverage") with 10 tests pinning each fix above. The default fixture's `status` flipped from `pending_stage1` to `processing_stage1` (the realistic state when a consumer POSTs). All `update` mock references migrated to `updateMany` with `{count: 1}` defaults.
- `__tests__/api-key.test.ts`: 6 → 12 tests. Added a wrong-token-of-equal-length pin and a `safeEqual` describe block (5 tests covering equal/unequal × same-length/different-length × empty + UTF-8 multi-byte).

### Skipped / deferred findings (out of scope per fix brief)

- IN-09 (ingest dedup ignores `user_id`): tenancy concern; single-operator MVP. Documented in REVIEW; defer to v1.2 tenancy migration.
- IN-10 (`OWNER_USER_ID` resolved at module load): test-ergonomics only; defer.
- IN-11 (bare `!` on `process.env.DATABASE_URL`): opaque 500 on misconfig; defer.

### Net test count after fixes

Phase 5 sweep: **80/80** tests green (was 64/64; +16 from review-fix coverage).

---
*Phase: 05-queue-api-surface*
*Completed: 2026-04-25*
