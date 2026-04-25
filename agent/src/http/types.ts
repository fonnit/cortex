/**
 * Shared HTTP request/response shapes for the daemon's thin-client layer.
 *
 * These mirror `IngestBodySchema` in `app/api/ingest/route.ts` exactly. Keeping
 * the shapes in a tiny module (no runtime imports) lets both `client.ts` and
 * `buffer.ts` reference them without depending on each other, and makes it cheap
 * for Plan 02's collectors to import only what they need.
 */

/** The standard ingest payload — corresponds to `IngestBodySchema` (non-heartbeat shape). */
export interface IngestRequest {
  source: 'downloads' | 'gmail'
  content_hash: string
  filename?: string
  mime_type?: string
  size_bytes?: number
  source_metadata?: Record<string, unknown>
  file_path?: string
}

/** The heartbeat shape — mirrors the `heartbeat: z.literal(true)` branch of `IngestBodySchema`. */
export interface HeartbeatRequest {
  heartbeat: true
}

/** Server response on a successful 200 (both new-create and dedup paths). */
export interface IngestSuccessResponse {
  id: string
  deduped: boolean
}

/**
 * The terminal outcome of a single `postIngest` (or `postHeartbeat`) call.
 *
 * The client deliberately never throws into the daemon's main loop on transport
 * errors — instead it returns a `skip` outcome so the buffer drain can continue
 * with the next entry. Synchronous throws are reserved for misconfiguration
 * (missing CORTEX_API_KEY / CORTEX_API_URL) which are fail-fast bootstrap bugs.
 */
export type IngestOutcome =
  | { kind: 'success'; id: string; deduped: boolean }
  /** 204 No Content from the heartbeat short-circuit on `/api/ingest`. */
  | { kind: 'heartbeat_ack' }
  /** A 4xx response (caller error — never retried) or retries-exhausted on 5xx/429/network. */
  | {
      kind: 'skip'
      reason: 'client_error' | 'retries_exhausted'
      status?: number
      error?: string
    }

/** Convenience union for any request body the client can emit. */
export type IngestResponse = IngestSuccessResponse

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 7 Plan 01: queue-side types consumed by Stage 1 / Stage 2 workers.   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A single item returned by `GET /api/queue?stage=1|2` (Phase 5).
 * Mirrors the response item shape from `app/api/queue/route.ts` exactly.
 *
 * `file_path` is `null` for Gmail items and populated for downloads items
 * (the route already extracts it from `source_metadata.file_path`).
 */
export interface QueueItem {
  id: string
  source: 'downloads' | 'gmail'
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  content_hash: string
  source_metadata: Record<string, unknown> | null
  file_path: string | null
}

