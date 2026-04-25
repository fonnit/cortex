/**
 * Stage 1 (relevance gate) consumer worker loop.
 *
 * Phase 7 Plan 02, Task 1. CONTEXT decisions enforced verbatim:
 *
 * D-process-layout:
 *   - STAGE1_LIMIT = 10 (per /api/queue?limit=10)
 *   - STAGE1_CONCURRENCY = 10 (Semaphore)
 *
 * D-poll-cadence:
 *   - Adaptive: when last poll returned ≥1 items → 5s sleep; 0 items → 30s.
 *
 * D-error-path:
 *   - invokeClaude parse_error / exit_error / timeout → POST classify with
 *     outcome:'error' and a structured short error_message.
 *   - postClassify 409 conflict → log Langfuse warning + move on (NO retry —
 *     stale-claim race; the API/queue will hand the item to a fresh consumer).
 *   - postClassify retries_exhausted → log + move on (item stays in
 *     processing_stage1; queue's stale-reclaim picks it up).
 *
 * D-langfuse-traces:
 *   - Each item gets a Langfuse trace named `consumer-stage1-item`. The
 *     parentTraceId is sourced from the X-Trace-Id surfaced on the queue
 *     response (recorded in metadata.inbound_trace_id when the SDK does not
 *     expose an explicit parent attribute).
 *
 * SCOPE BOUNDARY:
 *   - This worker NEVER touches taxonomy, NEVER references Stage 2.
 *   - This worker NEVER throws into the loop on per-item errors. Per-item
 *     try/catch wraps every step so one bad item leaves the rest unscathed.
 */

import { z } from 'zod'
import { Semaphore } from './semaphore.js'
import { invokeClaude } from './claude.js'
import { buildStage1Prompt } from './prompts.js'
import { getQueue, postClassify } from '../http/client.js'
import type { QueueItem, ClassifyRequest } from '../http/types.js'

/* ─────────────────────────────────────────────────────────────────────── */
/* Locked constants                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

export const STAGE1_LIMIT = 10
export const STAGE1_CONCURRENCY = 10

/** Adaptive cadence — items present in last poll. */
const POLL_INTERVAL_ITEMS_MS = 5_000
/** Adaptive cadence — empty queue (back off to ease /api/queue load). */
const POLL_INTERVAL_EMPTY_MS = 30_000

/* ─────────────────────────────────────────────────────────────────────── */
/* Schema                                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

const Stage1ResultSchema = z.object({
  decision: z.enum(['keep', 'ignore', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
})

/* ─────────────────────────────────────────────────────────────────────── */
/* Public API                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Minimal Langfuse contract — only `.trace({ name, metadata })` is exercised.
 * Typed nominally so tests can pass a plain stub without the full SDK shape.
 */
interface LangfuseLike {
  trace(input: { name: string; metadata?: Record<string, unknown> }): unknown
}

export interface Stage1Deps {
  langfuse: LangfuseLike
  /** DI seam for testing — defaults to the real getQueue. */
  getQueueImpl?: typeof getQueue
  /** DI seam for testing — defaults to the real postClassify. */
  postClassifyImpl?: typeof postClassify
  /** DI seam for testing — defaults to the real invokeClaude. */
  invokeClaudeImpl?: typeof invokeClaude
}

export interface Stage1Worker {
  /** Halt polling and await all in-flight items to drain. Idempotent. */
  stop(): Promise<void>
}

/**
 * Run the Stage 1 worker loop. Returns a handle whose `stop()` halts polling
 * and awaits all in-flight invocations to drain. The function returns
 * synchronously — the loop runs in the background as a Promise.
 */
export function runStage1Worker(deps: Stage1Deps): Stage1Worker {
  const sem = new Semaphore(STAGE1_CONCURRENCY)
  const getQueueFn = deps.getQueueImpl ?? getQueue
  const postClassifyFn = deps.postClassifyImpl ?? postClassify
  const invokeClaudeFn = deps.invokeClaudeImpl ?? invokeClaude
  const lf = deps.langfuse

  let stopped = false
  const inFlight = new Set<Promise<void>>()

  // Cancellable sleep — stop() resolves the current sleep early so the loop
  // exits within microseconds instead of waiting for the full 5s/30s tick.
  let wakeCurrentSleep: (() => void) | null = null
  const cancellableSleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeCurrentSleep = null
        resolve()
      }, ms)
      wakeCurrentSleep = () => {
        clearTimeout(timer)
        wakeCurrentSleep = null
        resolve()
      }
    })

  /* ── Per-item handler — must NEVER throw into the loop. ─────────────── */
  const handleOne = async (item: QueueItem, parentTraceId: string | null): Promise<void> => {
    const release = await sem.acquire()
    try {
      // Open the per-item trace so even prompt-build failures and unexpected
      // throws are observable in Langfuse.
      try {
        lf.trace({
          name: 'consumer-stage1-item',
          metadata: {
            item_id: item.id,
            source: item.source,
            inbound_trace_id: parentTraceId,
          },
        })
      } catch {
        /* trace open errors must never affect item processing */
      }

      // Build prompt — buildStage1Prompt throws on a downloads item with
      // null file_path (Phase 5/6 contract violation). Convert to error post.
      let prompt: string
      try {
        prompt = buildStage1Prompt(item)
      } catch (err) {
        await safePostClassify(postClassifyFn, lf, {
          item_id: item.id,
          stage: 1,
          outcome: 'error',
          error_message: `prompt_build_error: ${(err as Error).message}`,
        })
        return
      }

      // Invoke claude — wrapper never throws; it returns a typed outcome.
      const outcome = await invokeClaudeFn(prompt, Stage1ResultSchema)

      let payload: ClassifyRequest
      if (outcome.kind === 'ok') {
        payload = {
          item_id: item.id,
          stage: 1,
          outcome: 'success',
          decision: outcome.value.decision,
          confidence: outcome.value.confidence,
          ...(outcome.value.reason !== undefined ? { reason: outcome.value.reason } : {}),
        }
      } else if (outcome.kind === 'parse_error') {
        payload = {
          item_id: item.id,
          stage: 1,
          outcome: 'error',
          error_message: `parse_error: ${outcome.reason}`,
        }
      } else if (outcome.kind === 'exit_error') {
        payload = {
          item_id: item.id,
          stage: 1,
          outcome: 'error',
          error_message: `exit_error: code=${outcome.exitCode}`,
        }
      } else {
        // timeout
        payload = {
          item_id: item.id,
          stage: 1,
          outcome: 'error',
          error_message: 'timeout',
        }
      }

      await safePostClassify(postClassifyFn, lf, payload)
    } catch (err) {
      // Defensive: any unexpected throw must be logged + swallowed so the
      // loop's other in-flight items keep flowing. Mitigates T-07-11.
      try {
        lf.trace({
          name: 'consumer-stage1-unexpected',
          metadata: { item_id: item.id, error: String(err) },
        })
      } catch {
        /* ignore observability failures */
      }
    } finally {
      release()
    }
  }

  /* ── Loop body — single async function; cancelled by `stopped` flag. ── */
  const loop = async (): Promise<void> => {
    while (!stopped) {
      let queueRes: Awaited<ReturnType<typeof getQueueFn>>
      try {
        queueRes = await getQueueFn({ stage: 1, limit: STAGE1_LIMIT })
      } catch (err) {
        // getQueue throws synchronously only on misconfigured env; that's a
        // bootstrap bug. Log + treat as empty so the loop sleeps and retries.
        try {
          lf.trace({
            name: 'consumer-stage1-getqueue-error',
            metadata: { error: String(err) },
          })
        } catch {
          /* ignore */
        }
        await cancellableSleep(POLL_INTERVAL_EMPTY_MS)
        continue
      }

      // Skip outcomes (4xx / retries-exhausted) — log + back off.
      if ('kind' in queueRes) {
        const skip = queueRes
        try {
          lf.trace({
            name: 'consumer-stage1-getqueue-skip',
            metadata: {
              reason: skip.reason,
              ...('status' in skip && skip.status !== undefined ? { status: skip.status } : {}),
              ...('error' in skip && skip.error !== undefined ? { error: skip.error } : {}),
            },
          })
        } catch {
          /* ignore */
        }
        await cancellableSleep(POLL_INTERVAL_EMPTY_MS)
        continue
      }

      // Successful queue read — dispatch each item under the semaphore.
      const items = queueRes.items
      const traceId = queueRes.traceId

      for (const item of items) {
        const promise = handleOne(item, traceId)
        inFlight.add(promise)
        promise.finally(() => inFlight.delete(promise)).catch(() => {})
      }

      // Adaptive cadence: items present → fast poll; empty → back off.
      const sleepMs = items.length > 0 ? POLL_INTERVAL_ITEMS_MS : POLL_INTERVAL_EMPTY_MS
      await cancellableSleep(sleepMs)
    }
  }

  const loopPromise = loop().catch((err) => {
    // The loop itself should never throw, but defensively log if it does.
    try {
      lf.trace({
        name: 'consumer-stage1-loop-fatal',
        metadata: { error: String(err) },
      })
    } catch {
      /* ignore */
    }
  })

  return {
    async stop(): Promise<void> {
      stopped = true
      // Wake the current cadence sleep so the loop exits immediately rather
      // than waiting up to POLL_INTERVAL_EMPTY_MS for the next tick.
      if (wakeCurrentSleep) wakeCurrentSleep()
      await loopPromise.catch(() => {})
      // Drain any in-flight items before resolving so callers can rely on
      // "after stop() returns, no more outbound HTTP calls will happen".
      await Promise.allSettled([...inFlight])
    },
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Internal helpers                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Wrap postClassify so a 409 conflict is observed via Langfuse and a
 * retries-exhausted skip is logged — the worker MUST move on either way per
 * D-postClassify-no-retry-409.
 */
async function safePostClassify(
  postClassifyFn: typeof postClassify,
  lf: LangfuseLike,
  payload: ClassifyRequest,
): Promise<void> {
  try {
    const result = await postClassifyFn(payload)
    if (result.kind === 'conflict') {
      try {
        lf.trace({
          name: 'consumer-stage1-conflict',
          metadata: { item_id: payload.item_id, current_status: result.currentStatus },
        })
      } catch {
        /* ignore */
      }
      return
    }
    if (result.kind === 'skip') {
      try {
        lf.trace({
          name: 'consumer-stage1-classify-skip',
          metadata: {
            item_id: payload.item_id,
            reason: result.reason,
            ...(result.status !== undefined ? { status: result.status } : {}),
            ...(result.error !== undefined ? { error: result.error } : {}),
          },
        })
      } catch {
        /* ignore */
      }
      return
    }
    // kind === 'ok' — no-op, server has the verdict.
  } catch (err) {
    // postClassify only throws synchronously on misconfigured env. Log + move on.
    try {
      lf.trace({
        name: 'consumer-stage1-classify-throw',
        metadata: { item_id: payload.item_id, error: String(err) },
      })
    } catch {
      /* ignore */
    }
  }
}

