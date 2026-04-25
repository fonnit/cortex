/**
 * Daemon HTTP client — POSTs to `${CORTEX_API_URL}/api/ingest` with
 * `Authorization: Bearer ${CORTEX_API_KEY}`.
 *
 * Phase 6 Plan 01, Task 2. CONTEXT decisions enforced here:
 * - Native fetch (Node 22 LTS). No axios / undici / node-fetch.
 * - Exponential backoff: base 1s, cap 30s, max 5 attempts.
 * - Retry only on transient failures: 5xx, 429, network errors.
 * - NEVER retry 4xx — caller error, retry won't help.
 * - Terminal failure: emit Langfuse warning trace + return `{ kind: 'skip' }`.
 *   Never throws into the daemon main loop on transport errors.
 *
 * Misconfiguration (missing CORTEX_API_KEY / CORTEX_API_URL) IS thrown
 * synchronously — that's a fail-fast bootstrap bug, mirrors the server-side
 * `requireApiKey` posture.
 */

import type {
  IngestRequest,
  IngestOutcome,
  IngestSuccessResponse,
  QueueItem,
  QueueResponse,
  ClassifyRequest,
  ClassifyOutcome,
  TaxonomyInternalResponse,
} from './types'

// Minimal Langfuse contract — only `.trace({ name, metadata })` is exercised.
// We type it nominally to avoid pulling in the full langfuse module type and so
// tests can pass a plain stub.
interface LangfuseLike {
  trace(input: { name: string; metadata?: Record<string, unknown> }): unknown
}

/** Max retry attempts including the initial try (so 4 backoff sleeps in between). */
const MAX_ATTEMPTS = 5
/** Base delay in milliseconds for exponential backoff (attempt 1 → 1000ms wait). */
const BASE_DELAY_MS = 1000
/** Hard cap on a single backoff sleep — prevents 60s+ pauses on long outages. */
const MAX_DELAY_MS = 30_000

/** Promise-based sleep that defers to setTimeout so jest fake timers can advance it. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Compute the backoff delay for attempt N (1-indexed). Capped at MAX_DELAY_MS. */
function backoffDelay(attempt: number): number {
  const exp = BASE_DELAY_MS * Math.pow(2, attempt - 1)
  return Math.min(exp, MAX_DELAY_MS)
}

/**
 * 5xx and 429 are transient and worth retrying.
 * 4xx (excluding 429) is a caller error — never retry.
 */
function isRetryableStatus(status: number): boolean {
  if (status === 429) return true
  if (status >= 500 && status < 600) return true
  return false
}

interface PostOpts {
  langfuse?: LangfuseLike
}

/** Read env vars at call-time so tests can mutate process.env per test. */
function readEnv(): { url: string; key: string } {
  const url = process.env.CORTEX_API_URL
  const key = process.env.CORTEX_API_KEY
  if (!key) {
    throw new Error('CORTEX_API_KEY is not set — daemon cannot authenticate to /api/ingest')
  }
  if (!url) {
    throw new Error('CORTEX_API_URL is not set — daemon has no ingest endpoint to POST to')
  }
  return { url, key }
}

/**
 * Internal: drive the retry loop and return either a parsed success or skip outcome.
 * `body` is whatever JSON we want to send (IngestRequest or { heartbeat: true }).
 * `expectStatus` controls how we interpret 2xx: 'json' for { id, deduped }, 'empty' for 204.
 */
async function postWithRetry(
  body: unknown,
  expectStatus: 'json' | 'empty',
  ctx: { content_hash: string | null; source: string },
  opts: PostOpts | undefined,
): Promise<IngestOutcome> {
  const { url, key } = readEnv()
  const endpoint = `${url}/api/ingest`

  let lastStatus: number | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | undefined
    try {
      res = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Network-level failure (DNS, ECONNREFUSED, ETIMEDOUT, TypeError 'fetch failed').
      // These are retryable.
      lastStatus = undefined
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt))
        continue
      }
      break
    }

    // 2xx — success path. The two shapes (heartbeat 204 vs ingest 200) are mutually
    // exclusive based on the request body, so the caller tells us via expectStatus.
    if (res.status >= 200 && res.status < 300) {
      if (expectStatus === 'empty') {
        return { kind: 'heartbeat_ack' }
      }
      const json = (await res.json()) as IngestSuccessResponse
      return { kind: 'success', id: json.id, deduped: json.deduped }
    }

    // 4xx (except 429) — caller error, never retry.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return { kind: 'skip', reason: 'client_error', status: res.status }
    }

    // 5xx or 429 — retryable.
    lastStatus = res.status
    lastError = `HTTP ${res.status}`
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt))
      continue
    }
    // Fell through to exhaustion.
  }

  // Retries exhausted — emit Langfuse warning if available, return skip outcome.
  if (opts?.langfuse) {
    opts.langfuse.trace({
      name: 'http_client_terminal_skip',
      metadata: {
        content_hash: ctx.content_hash,
        source: ctx.source,
        attempts: MAX_ATTEMPTS,
        last_status: lastStatus ?? null,
        last_error: lastError ?? null,
      },
    })
  }
  return {
    kind: 'skip',
    reason: 'retries_exhausted',
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastError !== undefined ? { error: lastError } : {}),
  }
}

/**
 * POST a standard ingest payload to `/api/ingest`. Resolves to a structured
 * outcome — never throws on transport / HTTP errors (only on misconfigured env).
 */
export async function postIngest(
  payload: IngestRequest,
  opts?: PostOpts,
): Promise<IngestOutcome> {
  return postWithRetry(
    payload,
    'json',
    { content_hash: payload.content_hash, source: payload.source },
    opts,
  )
}

/**
 * POST a heartbeat probe to `/api/ingest` ({ heartbeat: true }). Server returns
 * 204 No Content (Phase 6 Plan 01, Task 1). Same retry/auth machinery, but the
 * 2xx response is parsed as empty.
 */
export async function postHeartbeat(opts?: PostOpts): Promise<IngestOutcome> {
  return postWithRetry({ heartbeat: true }, 'empty', { content_hash: null, source: 'heartbeat' }, opts)
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 7 Plan 01, Task 3: getQueue / postClassify / getTaxonomyInternal     */
/*                                                                            */
/* Reuses the existing retry primitives (MAX_ATTEMPTS, BASE_DELAY_MS,          */
/* MAX_DELAY_MS, backoffDelay, isRetryableStatus, sleep, readEnv) so the new   */
/* helpers behave identically to postIngest on transport failures.             */
/*                                                                            */
/* Differences from postIngest:                                                */
/*   - getQueue / getTaxonomyInternal use GET, no body.                        */
/*   - postClassify short-circuits on 409 with kind:'conflict' BEFORE the      */
/*     generic retry-class check — stale-claim is never retried.               */
/*   - getQueue surfaces the X-Trace-Id response header so the consumer can    */
/*     chain Langfuse spans under the queue route's parent trace.              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Skip outcomes shared between getQueue/getTaxonomyInternal failures. */
type FetchSkip =
  | { kind: 'skip'; reason: 'client_error'; status: number }
  | { kind: 'skip'; reason: 'retries_exhausted'; status?: number; error?: string }

/**
 * Poll the queue route. Returns parsed items + reclaimed counter + the
 * Langfuse trace id for span chaining. On 4xx returns a skip outcome
 * (caller decides whether to log + back off); on retries-exhausted
 * returns a skip outcome with the last status/error.
 */
export async function getQueue(params: {
  stage: 1 | 2
  limit: number
}): Promise<QueueResponse | FetchSkip> {
  const { url, key } = readEnv()
  const endpoint = `${url}/api/queue?stage=${params.stage}&limit=${params.limit}`

  let lastStatus: number | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | undefined
    try {
      res = await globalThis.fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
      })
    } catch (err) {
      lastStatus = undefined
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt))
        continue
      }
      break
    }

    if (res.status >= 200 && res.status < 300) {
      const traceId = res.headers.get('X-Trace-Id')
      const json = (await res.json()) as { items: QueueItem[]; reclaimed: number }
      return { items: json.items, reclaimed: json.reclaimed, traceId }
    }

    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return { kind: 'skip', reason: 'client_error', status: res.status }
    }

    lastStatus = res.status
    lastError = `HTTP ${res.status}`
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt))
      continue
    }
  }

  return {
    kind: 'skip',
    reason: 'retries_exhausted',
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastError !== undefined ? { error: lastError } : {}),
  }
}

/**
 * POST a classification verdict to /api/classify. **409 returns kind:'conflict'
 * IMMEDIATELY without retry** — the item is no longer ours (stale-claim race);
 * the queue's stale-reclaim path will hand it to a fresh consumer. Any other
 * 4xx returns kind:'skip' (client_error). 5xx/429/network retried with the
 * shared exp-backoff up to MAX_ATTEMPTS, then kind:'skip' (retries_exhausted).
 */
export async function postClassify(payload: ClassifyRequest): Promise<ClassifyOutcome> {
  const { url, key } = readEnv()
  const endpoint = `${url}/api/classify`

  let lastStatus: number | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | undefined
    try {
      res = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      lastStatus = undefined
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt))
        continue
      }
      break
    }

    // ── 409 stale-claim race: NEVER retry. ──
    // The compound where { id, status: expectedStatus } in /api/classify's
    // updateMany returned count=0, OR the pre-flight check returned 409.
    // Either way, another consumer has the item now.
    if (res.status === 409) {
      let currentStatus = 'unknown'
      try {
        const body = (await res.json()) as { current_status?: string }
        if (body && typeof body.current_status === 'string') {
          currentStatus = body.current_status
        }
      } catch {
        // Body wasn't JSON — fall back to 'unknown'.
      }
      return { kind: 'conflict', currentStatus }
    }

    if (res.status >= 200 && res.status < 300) {
      const body = (await res.json()) as { ok: boolean; status: string; retries: number }
      return { kind: 'ok', status: body.status, retries: body.retries }
    }

    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return { kind: 'skip', reason: 'client_error', status: res.status }
    }

    lastStatus = res.status
    lastError = `HTTP ${res.status}`
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt))
      continue
    }
  }

  return {
    kind: 'skip',
    reason: 'retries_exhausted',
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastError !== undefined ? { error: lastError } : {}),
  }
}

/**
 * Fetch the internal-only taxonomy snapshot for Stage 2. Throws on 4xx so the
 * Stage 2 worker treats it as "skip this batch" — taxonomy without auth is a
 * configuration error, not a transient failure. Throws on retries-exhausted
 * with `cause` set to the last status/error.
 */
export async function getTaxonomyInternal(): Promise<TaxonomyInternalResponse> {
  const { url, key } = readEnv()
  const endpoint = `${url}/api/taxonomy/internal`

  let lastStatus: number | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | undefined
    try {
      res = await globalThis.fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
      })
    } catch (err) {
      lastStatus = undefined
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt))
        continue
      }
      break
    }

    if (res.status >= 200 && res.status < 300) {
      return (await res.json()) as TaxonomyInternalResponse
    }

    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new Error(`taxonomy fetch failed: ${res.status}`)
    }

    lastStatus = res.status
    lastError = `HTTP ${res.status}`
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt))
      continue
    }
  }

  const err = new Error(
    `taxonomy fetch failed after ${MAX_ATTEMPTS} attempts (lastStatus=${lastStatus ?? 'network'}, lastError=${lastError ?? 'unknown'})`,
  )
  // Standard Error.cause for downstream handlers.
  ;(err as Error & { cause?: unknown }).cause = { lastStatus, lastError }
  throw err
}

// Re-export the shared types so callers can `import { postIngest, IngestRequest } from './client'`.
export type {
  IngestRequest,
  IngestOutcome,
  IngestSuccessResponse,
  QueueItem,
  QueueResponse,
  ClassifyRequest,
  ClassifyOutcome,
  TaxonomyInternalResponse,
} from './types'
