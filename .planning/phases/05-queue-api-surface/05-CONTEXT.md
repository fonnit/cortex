# Phase 5: Queue & API Surface - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 grey areas, all accepted as-recommended

<domain>
## Phase Boundary

The Vercel API exposes a complete, authenticated ingest/queue/classify contract with an extended `Item.status` state machine that supports atomic claim, retry-on-failure, and stale-claim reclamation. All existing routes continue to work unchanged.

**In scope:**
- New routes: `POST /api/ingest`, `GET /api/queue?stage=1|2&limit=N`, `POST /api/classify`
- `requireApiKey()` helper for `CORTEX_API_KEY` shared-secret auth on the three new routes
- Atomic claim via raw SQL `UPDATE ... FOR UPDATE SKIP LOCKED` (uses existing `neon` adapter)
- Queue state stored in `Item.status` (5 new string values, no Prisma enum) and `Item.classification_trace.queue` (JSON — retry count, last claim time)
- Stale-claim reclaim during normal queue polls; one-shot legacy reclaim for v1.0 items stuck in plain `processing`

**Out of scope (deferred to later phases):**
- Daemon thin-client refactor (Phase 6)
- Stage 1 / Stage 2 consumer processes (Phase 7)
- Operational soak / acceptance auditing (Phase 8)
- Schema migrations beyond additive `Item.status` string values
- API key rotation tooling
- Drive upload-flow changes
- Any UI / triage / taxonomy / rules / admin / ask surface changes

</domain>

<decisions>
## Implementation Decisions

### Queue claim semantics
- **Atomic claim mechanism:** Raw SQL via the existing `@neondatabase/serverless` adapter (already used in `/api/cron/embed`): `UPDATE "Item" SET status='processing_stage{N}', "classification_trace" = jsonb_set(...) WHERE id IN (SELECT id FROM "Item" WHERE status='pending_stage{N}' ORDER BY ingested_at LIMIT $limit FOR UPDATE SKIP LOCKED) RETURNING *`. Two parallel callers can never receive the same item id.
- **Retry & claim metadata storage:** Inside `Item.classification_trace.queue = { stage1: { retries: N, last_claim_at: ISO }, stage2: { ... } }`. **No schema migration** — honours the v1.1 non-goal of "no schema changes beyond status values".
- **Stale-claim timeout:** **10 minutes**. Long enough for `claude -p` on large PDFs (size-band cap is 5 MB so reads finish well within), short enough that a consumer crash recovers within one poll cycle.
- **Retry hard cap:** **5 attempts** per stage. After 5 failed attempts, the item moves to `status='error'` (a new terminal value, additive — sits alongside `certain`/`uncertain`/`ignored`). The error message lives at `classification_trace.queue.stageN.last_error`.

### API contract shape
- **`POST /api/ingest` request body** (flat, mirrors Item columns):
  ```ts
  {
    source: 'downloads' | 'gmail',
    content_hash: string,        // SHA-256 hex
    filename?: string,
    mime_type?: string,
    size_bytes?: number,
    source_metadata?: Json,      // gmail headers, etc.
    file_path?: string           // downloads only — consumed by Stage 1/2 consumers
  }
  ```
- **Dedup response:** Always **HTTP 200** with `{ id: string, deduped: boolean }`. Caller never has to branch on status code.
- **`POST /api/classify` body** (single stage-tagged endpoint):
  ```ts
  {
    item_id: string,
    stage: 1 | 2,
    outcome: 'success' | 'error',
    // success-only fields
    decision?: 'keep' | 'ignore' | 'uncertain',         // stage 1
    axes?: Record<'type'|'from'|'context', { value: string|null, confidence: number }>,  // stage 2
    confidence?: number,
    reason?: string,
    proposed_drive_path?: string,                       // stage 2
    // error-only field
    error_message?: string
  }
  ```
- **`GET /api/queue?stage=1|2&limit=N` response:**
  ```ts
  {
    items: Array<{
      id: string,
      source: 'downloads' | 'gmail',
      filename: string|null,
      mime_type: string|null,
      size_bytes: number|null,
      content_hash: string,
      source_metadata: Json|null,
      file_path: string|null     // downloads only
    }>,
    reclaimed: number   // count of stale items moved back to pending in this call
  }
  ```

### Authentication
- **Daemon-side `CORTEX_API_KEY` storage:** Plain env var loaded via launchd plist `EnvironmentVariables`. Auditable in `launchctl print` output. Same surface as existing daemon vars.
- **Auth header format:** `Authorization: Bearer ${CORTEX_API_KEY}`. Mirrors the existing `/api/cron/embed` pattern verbatim — codebase consistency.
- **Validation location:** Per-route helper `requireApiKey(request: NextRequest): Response | null` (returns `null` on success, a 401 `Response` on failure). Called at top of `/api/ingest`, `/api/queue`, `/api/classify`. Keeps the existing Clerk-protected routes (and the `middleware.ts` config) untouched.
- **401 response body:** **Empty** (HTTP 401, no body, no Item data, no schema hints).

### Migration & rollout
- **New `status` values:** Just write the strings — `Item.status` is `String` (no enum). Values added: `pending_stage1`, `processing_stage1`, `pending_stage2`, `processing_stage2`, `error`. Existing values (`certain`, `uncertain`, `ignored`, `filed`, `resolved`) preserved verbatim.
- **Schema deployment:** **No schema change at all this phase.** `prisma generate` runs on Vercel build but no `db push` is needed. CLAUDE.md "migrations through Vercel build, never locally" constraint satisfied trivially.
- **Legacy `processing` items (v1.0 broken runs):** One-shot reclaim folded into the normal stale-claim path of `GET /api/queue` — items with `status='processing'` (no stage suffix) older than the timeout are moved to `pending_stage1` if their `classification_trace` lacks a `stage2`, else `pending_stage2`. No separate cron required.
- **API key rotation:** Out of scope this phase. Single shared key lives in Vercel project env + the launchd plist (Phase 6). A rotation runbook will be noted in CONTEXT.md only — no code.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/prisma.ts` — already exports the typed Prisma client (used by every existing route)
- `@neondatabase/serverless` — already in deps; `/api/cron/embed/route.ts` shows the canonical pattern for raw `neon` SQL (used here for `FOR UPDATE SKIP LOCKED` since Prisma cannot natively express it)
- `langfuse@3.38.20` — already in deps; cron embed pattern shows `lf.trace(...)` + `trace.span(...)` + `flushAsync()` — reuse verbatim around ingest/queue/classify
- `app/api/cron/embed/route.ts` lines 8-14 — the **exact** pattern for `Bearer` shared-secret validation (`CRON_SECRET`) — copy and parameterize for `CORTEX_API_KEY`
- `app/api/triage/route.ts` — shows how Item rows are read and how `classification_trace` is parsed (Stage 1 / Stage 2 nested object); the queue mutations need to **preserve** existing trace structure and only nest a new `queue` sibling key

### Established Patterns
- Route handlers as `app/api/<surface>/route.ts` with named `GET`/`POST` exports returning `Response` or `Response.json()`
- Authentication is per-route, not in `middleware.ts` (Clerk's `auth()` for user routes; `Authorization: Bearer ...` shared secrets for cron). New `requireApiKey` follows the cron pattern.
- Errors: `console.error('[surface] error:', err)` + `return new Response('Internal Server Error', { status: 500 })` (cron embed line 62-64)
- Item.status is a free-form `String` — extending with new values requires zero schema work
- `classification_trace` is `Json?` and already structured as `{ stage1: {...}, stage2: {...} }` — adding `queue: {...}` sibling is a non-breaking JSON write

### Integration Points
- `Item.classification_trace.queue` JSON field — new sibling alongside existing `stage1` / `stage2`
- Vercel project env: `CORTEX_API_KEY` will be added (paired with existing `CRON_SECRET`, `CLERK_SECRET_KEY`, etc.)
- The Phase 6 daemon will produce `POST /api/ingest` calls; the Phase 7 consumers will call `GET /api/queue` + `POST /api/classify`. Phase 5 must publish a contract that those phases can implement against without re-negotiation.

</code_context>

<specifics>
## Specific Ideas

- The 5-attempt retry cap and 10-min stale timeout are **starting values**. Plan-phase should make them constants in a single shared file (e.g. `lib/queue-config.ts`) so a future tuning pass can adjust without code-archaeology.
- The `requireApiKey` helper should return `null | Response` (not throw) so route code stays explicit — `const unauthorized = requireApiKey(request); if (unauthorized) return unauthorized;`.
- Langfuse: every API call (`ingest`, `queue`, `classify`) must open a trace; the `trace_id` should be returned to the client in the response so consumers can chain their own spans under the same trace.
- Queue claim must update `classification_trace.queue.stageN.last_claim_at` in the same SQL statement that flips `status` — otherwise stale-detection has no signal.

</specifics>

<deferred>
## Deferred Ideas

- API key rotation tooling — out of scope this phase, runbook-only
- Per-tenant queue depth limits — single-operator tool, not needed yet
- Dead-letter inspection UI for `status='error'` items — Phase 8 may surface in /admin if useful, but not built here
- Real Prisma migration to add `retry_count` / `last_claim_at` columns — explicitly chosen JSON-field path instead, to honour the v1.1 "no schema changes" non-goal

</deferred>
