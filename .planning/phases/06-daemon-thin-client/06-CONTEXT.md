# Phase 6: Daemon Thin Client - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 2 grey areas, both accepted as-recommended; remaining decisions are infrastructure-only and at Claude's discretion

<domain>
## Phase Boundary

The Mac launchd daemon is a thin metadata producer. It discovers files via chokidar + a startup recursive scan, polls Gmail incrementally via historyId, and POSTs every discovery to the Vercel API at `POST /api/ingest` over a `CORTEX_API_KEY` Bearer header. It does **not** access Neon, classify items, or upload to Drive — those responsibilities belong to the API (Phase 5, shipped) and the consumer processes (Phase 7, next).

**In scope:**
- Refactor daemon to drop `DATABASE_URL`, the Prisma client, `claude -p` invocations, and Drive uploads
- Add HTTP client (`POST /api/ingest`) with `Authorization: Bearer ${CORTEX_API_KEY}`
- Apply new directory scan rules (skip trees containing `.git` / `node_modules`, skip hidden files, no depth limit)
- Refactor `gmail.ts` to POST email metadata to `/api/ingest` instead of writing to Neon
- Keep launchd plist, but trim env vars to: `CORTEX_API_URL`, `CORTEX_API_KEY`, `WATCH_PATHS`, Google OAuth creds, Langfuse keys
- Heartbeat: Langfuse trace every 5 min + `POST /api/ingest/heartbeat` no-op connectivity ping every poll cycle
- Delete v1.0 daemon code that moved to Phase 5/7: `agent/src/db.ts`, `agent/src/pipeline/{relevance,label,extractor,dedup,claude}.ts`, `agent/src/drive.ts`, `agent/src/metrics.ts`. Keep `agent/src/collectors/`, `agent/src/heartbeat.ts`, `agent/src/scan.ts`, `agent/src/auth/`, `agent/src/index.ts`

**Out of scope (deferred):**
- Stage 1 / Stage 2 consumer processes — Phase 7
- Operational acceptance / soak — Phase 8
- Local SQLite fallback queue (in-memory buffer is enough for v1.1)
- API key rotation
- New launchd plist file format changes (.env loading remains)

</domain>

<decisions>
## Implementation Decisions

### HTTP client behaviour
- **Library:** native `fetch` (Node 22 LTS includes it stable). Zero new deps.
- **Retry:** exponential backoff, base 1s, cap 30s, max 5 attempts. Retry only on transient failures (5xx, 429, network errors / DNS failures / connection refused). NEVER retry 4xx — those are caller errors and another retry won't help.
- **Idempotency:** rely on server-side SHA-256 dedup at `POST /api/ingest`. The server returns `{ id, deduped: true | false }`. No client-side `Idempotency-Key` header.
- **Terminal-state behaviour:** when 5 retries are exhausted, the daemon logs the failure to Langfuse (warning level, with content_hash, source, and error context), increments a daemon-side counter, and **skips the file**. The file will be rediscovered on the next chokidar event or startup scan because the daemon stores nothing locally. No SQLite, no on-disk queue.

### Gmail polling + heartbeat
- **Gmail poll interval:** 60 seconds. Matches v1.0 behaviour. Incremental sync via stored `historyId`. On `historyId` 404, fall back to a full sync (already implemented in v1.0 — preserve the logic).
- **Heartbeat (dual):**
  - Langfuse trace `name: 'daemon-heartbeat'` every 5 minutes with `{ uptime_seconds, files_seen, files_posted, gmail_messages_posted, http_failures }` metadata
  - `POST /api/ingest/heartbeat` no-op connectivity ping every poll cycle (60s) — server returns 204 No Content. Used by daemon to detect connectivity loss BEFORE buffering grows. NOTE: this requires a new endpoint or extension of `POST /api/ingest` accepting a `{ heartbeat: true }` shape — define during planning. Prefer extending `POST /api/ingest` since it's already authenticated.
- **Connectivity loss behaviour:** daemon keeps the chokidar watcher and Gmail poller running. New file/email discoveries are buffered in an in-memory FIFO list (cap = 100 entries). When the next POST succeeds (heartbeat or otherwise), the buffer drains in order. On overflow, drop the OLDEST entry with a Langfuse warning — relying on chokidar/startup-scan rediscovery to recover. No persistence to disk.
- **v1.0 code cleanup:** clean delete (no compatibility shim).
  - **Delete:** `agent/src/db.ts`, `agent/src/pipeline/relevance.ts`, `agent/src/pipeline/relevance.js`, `agent/src/pipeline/label.ts`, `agent/src/pipeline/label.js`, `agent/src/pipeline/extractor.ts`, `agent/src/pipeline/extractor.js`, `agent/src/pipeline/dedup.ts`, `agent/src/pipeline/dedup.js`, `agent/src/pipeline/claude.ts`, `agent/src/pipeline/identity.ts`, `agent/src/drive.ts`, `agent/src/drive.js`, `agent/src/metrics.ts`, `agent/src/metrics.js`. Pipeline/dedup logic lives in the API now; pipeline/claude logic moves to Phase 7 consumers.
  - **Refactor (keep but rewrite):** `agent/src/collectors/downloads.ts`, `agent/src/collectors/gmail.ts`, `agent/src/scan.ts`, `agent/src/heartbeat.ts`, `agent/src/index.ts`. They currently call `db.ts` and `pipeline/*.ts` — replace those imports with calls to the new HTTP client.
  - **Add:** `agent/src/http/client.ts` (fetch wrapper with retry + auth header), `agent/src/http/buffer.ts` (in-memory FIFO buffer with overflow handling).
  - **Keep as-is:** `agent/src/auth/google.ts` (Google OAuth for Gmail), `agent/src/auth/setup.ts`.
  - **Update:** `agent/launchd/com.cortex.daemon.plist` — remove `DATABASE_URL` from `EnvironmentVariables`, add `CORTEX_API_URL` and `CORTEX_API_KEY`. Note: this file already shows uncommitted modifications from a prior session — reconcile carefully.
  - **Update:** `agent/package.json` — remove `@prisma/client`, `@neondatabase/serverless` (no longer needed; HTTP only). Keep `chokidar`, `googleapis`, `keytar`, `langfuse`. Drop `@anthropic-ai/sdk` and `openai` (those move to Phase 7 consumers).

### Scan rules (SCAN-01..03)
- **Recurse:** no depth limit. Each subdirectory checked.
- **Skip rule:** if a directory contains `.git` OR `node_modules` as a direct child entry, skip the **entire subtree** (do not enqueue any file under it). Other VCS markers (`.svn`, `.hg`) are out of scope this phase — `.git` and `node_modules` are the named requirements.
- **Hidden files:** skip any file whose basename starts with `.` (covers `.DS_Store`, dotfiles, lock files like `.git*` if encountered at file level). Do not enqueue.
- **Implementation:** these rules live in `agent/src/scan.ts` (already exists) — refactor to apply the rules; chokidar `ignored` option handles fsevents-time filtering, and the startup recursive scan applies the same rules manually.

### HTTP retry & buffer interaction
- The retry loop runs **inside** the buffer drain — the buffer represents discoveries waiting to be POSTed; each entry triggers a retry-loop POST when its turn comes. The buffer is FIFO and the drain runs sequentially (one POST at a time) to avoid hammering the API on reconnection. Concurrency limit at the buffer drain level is 1; in normal connectivity each discovery POSTs immediately.

### Authentication
- **`CORTEX_API_KEY` storage:** plain env var loaded by launchd via the plist `EnvironmentVariables` section. Same pattern as existing daemon vars. Auditable via `launchctl print gui/$(id -u)/com.cortex.daemon`.
- **Header:** `Authorization: Bearer ${CORTEX_API_KEY}`. Mirrors the API server's `requireApiKey` helper exactly (Phase 5).
- **Key absence behaviour:** if `CORTEX_API_KEY` is unset at daemon startup, log a fatal error to stderr/Langfuse and exit 1. Do not run with no auth.

</decisions>

<canonical_refs>
## Canonical References

- `app/api/ingest/route.ts` (Phase 5) — daemon's primary target; the request body Zod schema lives there
- `lib/api-key.ts` (Phase 5) — the validation pattern the daemon must satisfy
- `app/api/cron/embed/route.ts` — existing Bearer-secret pattern (Phase 4)
- `INGEST-REARCHITECT-BRIEF.md` (root) — original brief
- CLAUDE.md — project constraints (Node 22 LTS, no migrations locally)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets (keep & adapt)
- `agent/src/index.ts` (9.4K) — main loop with chokidar + Gmail poll + heartbeat. Refactor: replace direct DB/pipeline calls with HTTP POSTs.
- `agent/src/scan.ts` (5.5K) — already does recursive scanning. Update the directory filter logic for `.git` / `node_modules` skip and hidden-file skip.
- `agent/src/heartbeat.ts` (717 bytes) — small heartbeat helper. Update to also POST `/api/ingest/heartbeat` and emit a richer Langfuse trace.
- `agent/src/collectors/downloads.ts`, `agent/src/collectors/gmail.ts` — existing collectors. Refactor: emit metadata to the HTTP buffer instead of calling pipeline.
- `agent/src/auth/google.ts`, `agent/src/auth/setup.ts` — OAuth flow. Keep as-is.

### Established patterns (mirror)
- ESM modules (`"type": "module"` in agent/package.json) — keep
- `googleapis@171.4.0` — keep for Gmail incremental sync
- `chokidar@5.0.0` — keep for fsevents
- `keytar@7.9.0` — keep for Google OAuth credential storage in macOS Keychain
- `langfuse@3.38.20` — keep for traces; same pattern as Phase 5 routes (`new Langfuse()` then `lf.trace(...).span(...).end()` and `flushAsync()`)
- TS strict — verify compile passes after refactor

### Integration points
- The daemon's `POST /api/ingest` will be authenticated via the same `requireApiKey` helper Phase 5 ships
- Server response `{ id, deduped: boolean }` — daemon can log `deduped` count for telemetry but does not need to react beyond that
- `POST /api/ingest/heartbeat` extension — define server contract during planning; planner should propose extending the existing route's Zod schema with a `heartbeat: true` discriminator (returns 204) OR adding a parallel `POST /api/ingest/heartbeat` route. Lean toward the route extension for fewer files.

</code_context>

<specifics>
## Specific Ideas

- **Daemon's runtime audit obligation:** ACC-04 (Phase 8) will check that `DATABASE_URL` is absent from the daemon process environment via `launchctl print`. Phase 6 must remove the var from the plist file and from any `.env` file loaded by the daemon. The plist file at `agent/launchd/com.cortex.daemon.plist` shows pending uncommitted modifications from a prior session — those edits need reconciling: discard if they re-add `DATABASE_URL`, keep if they remove it.
- **Heartbeat extension on /api/ingest:** the cleanest design is to add a `heartbeat: z.literal(true).optional()` field to the existing `IngestBodySchema` and short-circuit the route when `heartbeat === true` — return 204, no body, no Item write, no Langfuse trace. This avoids a new route file and keeps the auth surface minimal. This requires touching `app/api/ingest/route.ts` from Phase 5; the planner must decide whether that violates "no new schema changes / no existing route modifications". The non-goals only block changes to UI / triage / taxonomy / rules / admin / ask routes — `/api/ingest` is a Phase 5 route this milestone owns, so extension is in-scope.
- **Buffer overflow telemetry:** when the FIFO buffer drops the oldest entry, the daemon should emit a Langfuse warning trace with `{ buffer_size: 100, dropped_content_hash, dropped_age_seconds }`. This is observable evidence of connectivity issues that ACC-05 (end-to-end traceability) wants visible.

</specifics>

<deferred>
## Deferred Ideas

- Local SQLite fallback queue — explicitly chosen against (in-memory is enough for single-operator MVP)
- API key rotation — out of scope; runbook only
- TypeScript strict-mode bumps for `agent/` — that package may have lighter tsconfig; planner should not fight it
- chokidar v4 fallback (CJS) — only needed if v5 ESM has launchd-context issues; not yet observed, defer
- Multi-user support — single operator, schema is tenancy-ready but daemon stays single-user

</deferred>
