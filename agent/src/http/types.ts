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

/**
 * The full response from `GET /api/queue`. `traceId` is the Langfuse parent
 * trace surfaced via the `X-Trace-Id` header — consumers chain their own
 * spans under it for end-to-end traceability (daemon → API → consumer).
 */
export interface QueueResponse {
  items: QueueItem[]
  reclaimed: number
  traceId: string | null
}

/**
 * One axis of a Stage 2 classification. AxisSchema in app/api/classify/route.ts
 * refines `value:null` ⇒ confidence < 0.75; consumers should respect that.
 */
export interface ClassifyAxis {
  value: string | null
  confidence: number
}

/**
 * The body the consumer POSTs to `/api/classify`. Discriminated on outcome
 * so success-only and error-only fields cannot be mixed at the type level.
 *
 * Mirrors `ClassifyBodySchema` in app/api/classify/route.ts.
 *
 * `decision` semantics (per quick task 260426-u47):
 *   - Stage 1 success: 'keep' | 'ignore' | 'uncertain' (relevance gate; required
 *     by the route).
 *   - Stage 2 success: 'auto_file' | 'ignore' | 'uncertain' (terminal action;
 *     required by the route per D-auto-file / D-auto-ignore). When 'auto_file'
 *     fires AND both axes (type, from) are ≥ AUTO_FILE_THRESHOLD AND
 *     `path_confidence` ≥ 0.85 AND the parent of `proposed_drive_path` already
 *     has ≥3 confirmed-filed siblings, the route transitions status='filed'.
 *     When 'ignore' fires AND confidence ≥ AUTO_IGNORE_THRESHOLD,
 *     status='ignored'.
 *
 * `confidence` (optional, top-level): Stage 2 may emit it explicitly for the
 * ignore path so the route doesn't have to fall back to max(axis confidences).
 *
 * `path_confidence` (optional, top-level — quick task 260427-h9w): Stage 2
 * emits per-path confidence (0..1) so the route can gate auto-file on
 * `path_confidence ≥ 0.85` AND parent-has-≥3-confirmed-siblings (replaces
 * u47-3's allLabelsExist rule). Optional at the type level so older agent
 * builds during rollout don't break the route — auto_file just won't fire
 * without it (the route logs autoFileBlockedReason='missing_path_confidence').
 */
export type ClassifyRequest =
  | {
      item_id: string
      stage: 1 | 2
      outcome: 'success'
      decision?: 'keep' | 'ignore' | 'uncertain' | 'auto_file'
      axes?: {
        type: ClassifyAxis
        from: ClassifyAxis
      }
      confidence?: number
      reason?: string
      proposed_drive_path?: string
      path_confidence?: number
    }
  | {
      item_id: string
      stage: 1 | 2
      outcome: 'error'
      error_message: string
    }

/**
 * The terminal outcome of a single `postClassify` call.
 *
 * - `ok`: 2xx — server accepted; record retries from response body.
 * - `conflict`: 409 — stale-claim race; the item is no longer ours. The
 *   consumer must NOT retry; the item will come back via the queue's stale-
 *   reclaim path.
 * - `skip`: either a 4xx (other than 409) or retries exhausted on 5xx/429/
 *   network errors. Consumer drops this attempt; item stays in
 *   `processing_*` and the queue's stale-reclaim picks it up.
 */
export type ClassifyOutcome =
  | { kind: 'ok'; status: string; retries: number }
  | { kind: 'conflict'; currentStatus: string }
  | {
      kind: 'skip'
      reason: 'client_error' | 'retries_exhausted'
      status?: number
      error?: string
    }

/**
 * Response shape from `GET /api/taxonomy/internal` — the requireApiKey-
 * guarded surface that Stage 2 consumers fetch each batch (no Clerk).
 *
 * Each axis is a flat array of NON-deprecated label names. The web app's
 * existing Clerk-protected `/api/taxonomy` route is untouched.
 */
export interface TaxonomyInternalResponse {
  type: string[]
  from: string[]
}

/**
 * Response shape from `GET /api/paths/internal` (quick task 260427-h9w) — the
 * requireApiKey-guarded surface that Stage 2 consumers fetch each batch.
 *
 * `paths` is a list of confirmed parent directories with file counts, sorted
 * by `count` descending and capped at 50. Computed from
 *   `SELECT confirmed_drive_path FROM Item WHERE status='filed' AND
 *    confirmed_drive_path IS NOT NULL` then bucketed by parent (everything
 * before the last `/`).
 */
export interface PathsInternalResponse {
  paths: Array<{ parent: string; count: number }>
}

