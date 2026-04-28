/**
 * Stage 2 (label classifier) consumer worker loop.
 *
 * Phase 7 Plan 02, Task 2. Mirror of stage1.ts with these differences:
 *
 *   - STAGE2_LIMIT = 2, STAGE2_CONCURRENCY = 2 (D-process-layout)
 *   - Fetches taxonomy via getTaxonomyInternal at the START of each
 *     non-empty batch (D-no-cache-taxonomy — never cached across cycles)
 *   - Builds Stage 2 prompts via buildStage2Prompt(item, taxonomy)
 *   - POSTs all-three-axes classify success bodies. The Phase 5 schema
 *     rejects partial axes — we never construct a partial body; if
 *     invokeClaude returns a payload that fails Stage2ResultSchema we
 *     POST `outcome:'error'` instead.
 *   - getTaxonomyInternal failure → SKIP the entire batch. Items stay in
 *     processing_stage2 and the queue's stale-reclaim path will return
 *     them to pending_stage2 on the next poll cycle.
 *
 * Quick task 260428-lx4 (Task 3): the worker no longer fetches the path
 * tree — Claude does that on demand via the cortex_paths_internal MCP tool
 * spawned by invokeClaude. The taxonomy fetch stays inline.
 *
 * Independence (T-07-10 mitigation): this worker runs alongside the Stage 1
 * worker but holds its own Semaphore — Stage 1 saturation cannot block
 * Stage 2 items from being claimed and classified.
 *
 * Closes CONS-05: a Gmail "keep" item moves Stage 1 → pending_stage2 →
 * Stage 2 in the same wall-clock run, eliminating the v1.0 stuck-keeps bug.
 */

import { z } from 'zod'
import { Semaphore } from './semaphore.js'
import { invokeClaude } from './claude.js'
import { buildStage2Prompt } from './prompts.js'
import {
  getQueue,
  postClassify,
  getTaxonomyInternal,
} from '../http/client.js'
import type {
  QueueItem,
  ClassifyRequest,
  TaxonomyInternalResponse,
} from '../http/types.js'

/* ─────────────────────────────────────────────────────────────────────── */
/* Locked constants                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

export const STAGE2_LIMIT = 2
export const STAGE2_CONCURRENCY = 2

const POLL_INTERVAL_ITEMS_MS = 5_000
const POLL_INTERVAL_EMPTY_MS = 30_000

/* ─────────────────────────────────────────────────────────────────────── */
/* Schema                                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

const AxisSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

/**
 * Stage 2 result — type/from/context all required (matches the Phase 5
 * /api/classify all-three-axes contract). If invokeClaude returns a payload
 * missing any axis, we treat it as parse_error and POST outcome:'error'.
 *
 * Per quick task 260426-u47 (D-auto-file, D-auto-ignore): the schema now
 * REQUIRES a `decision` field at the top level (sibling to axes +
 * proposed_drive_path — Claude's-discretion option per CONTEXT, sibling
 * layout matches how /api/classify ClassifyBodySchema layers `decision` +
 * `axes`). `confidence` is optional — used for the ignore path so the route
 * doesn't have to fall back to max(axis confidences).
 *
 * Per quick task 260427-h9w: the schema now REQUIRES `path_confidence`
 * (0..1) at the top level. The route gates auto_file on this value AND
 * parent-has-≥3-confirmed-siblings — replacing u47-3's allLabelsExist rule.
 * Missing/out-of-range path_confidence ⇒ schema parse fails ⇒ worker POSTs
 * outcome:'error' (T-h9w-03 mitigation: Zod clamps the value at the agent
 * boundary so Claude cannot bypass the threshold by emitting `9999`).
 */
const Stage2ResultSchema = z.object({
  // All-3-axes contract enforced inline so a static grep can pin it.
  axes: z.object({ type: AxisSchema, from: AxisSchema, context: AxisSchema }),
  proposed_drive_path: z.string(),
  decision: z.enum(['auto_file', 'ignore', 'uncertain']),
  path_confidence: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
})

/* ─────────────────────────────────────────────────────────────────────── */
/* Public API                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

interface LangfuseLike {
  trace(input: { name: string; metadata?: Record<string, unknown> }): unknown
}

export interface Stage2Deps {
  langfuse: LangfuseLike
  getQueueImpl?: typeof getQueue
  postClassifyImpl?: typeof postClassify
  invokeClaudeImpl?: typeof invokeClaude
  getTaxonomyInternalImpl?: typeof getTaxonomyInternal
}

export interface Stage2Worker {
  stop(): Promise<void>
}

export function runStage2Worker(deps: Stage2Deps): Stage2Worker {
  const sem = new Semaphore(STAGE2_CONCURRENCY)
  const getQueueFn = deps.getQueueImpl ?? getQueue
  const postClassifyFn = deps.postClassifyImpl ?? postClassify
  const invokeClaudeFn = deps.invokeClaudeImpl ?? invokeClaude
  const getTaxonomyInternalFn = deps.getTaxonomyInternalImpl ?? getTaxonomyInternal
  const lf = deps.langfuse

  let stopped = false
  const inFlight = new Set<Promise<void>>()

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

  /* ── Per-item handler ───────────────────────────────────────────────── */
  const handleOne = async (
    item: QueueItem,
    taxonomy: TaxonomyInternalResponse,
    parentTraceId: string | null,
  ): Promise<void> => {
    const release = await sem.acquire()
    try {
      try {
        lf.trace({
          name: 'consumer-stage2-item',
          metadata: {
            item_id: item.id,
            source: item.source,
            inbound_trace_id: parentTraceId,
          },
        })
      } catch {
        /* ignore */
      }

      let prompt: string
      try {
        prompt = buildStage2Prompt(item, {
          type: taxonomy.type,
          from: taxonomy.from,
          context: taxonomy.context,
        })
      } catch (err) {
        await safePostClassify(postClassifyFn, lf, {
          item_id: item.id,
          stage: 2,
          outcome: 'error',
          error_message: `prompt_build_error: ${(err as Error).message}`,
        })
        return
      }

      const outcome = await invokeClaudeFn(prompt, Stage2ResultSchema)

      let payload: ClassifyRequest
      if (outcome.kind === 'ok') {
        // Normalise each axis so `value` is exactly string | null (Zod
        // inference can yield string | null | undefined; the API contract
        // requires string | null). When decision='ignore', preserve null
        // axis values exactly as Claude returned them (don't normalize to a
        // default — the route needs to see null + low confidence to apply
        // auto-ignore semantics correctly). Per quick task 260426-u47
        // (D-auto-file, D-auto-ignore).
        const axes = {
          type: {
            value: outcome.value.axes.type.value ?? null,
            confidence: outcome.value.axes.type.confidence,
          },
          from: {
            value: outcome.value.axes.from.value ?? null,
            confidence: outcome.value.axes.from.confidence,
          },
          context: {
            value: outcome.value.axes.context.value ?? null,
            confidence: outcome.value.axes.context.confidence,
          },
        }
        payload = {
          item_id: item.id,
          stage: 2,
          outcome: 'success',
          axes,
          proposed_drive_path: outcome.value.proposed_drive_path,
          // Forward the decision unchanged — the route enforces auto-action
          // preconditions (path-based gate, confidence threshold) server-side.
          decision: outcome.value.decision,
          // Forward path_confidence — the route gates auto_file on
          // path_confidence ≥ 0.85 AND parent-has-≥3-confirmed-siblings.
          // Always present here because Stage2ResultSchema requires it.
          path_confidence: outcome.value.path_confidence,
          // Forward optional top-level confidence when present (used by the
          // route's auto-ignore path; falls back to max(axis confidences)
          // when omitted).
          ...(outcome.value.confidence !== undefined
            ? { confidence: outcome.value.confidence }
            : {}),
        }
      } else if (outcome.kind === 'parse_error') {
        payload = {
          item_id: item.id,
          stage: 2,
          outcome: 'error',
          error_message: `parse_error: ${outcome.reason}`,
        }
      } else if (outcome.kind === 'exit_error') {
        payload = {
          item_id: item.id,
          stage: 2,
          outcome: 'error',
          error_message: `exit_error: code=${outcome.exitCode}`,
        }
      } else {
        payload = {
          item_id: item.id,
          stage: 2,
          outcome: 'error',
          error_message: 'timeout',
        }
      }

      await safePostClassify(postClassifyFn, lf, payload)
    } catch (err) {
      try {
        lf.trace({
          name: 'consumer-stage2-unexpected',
          metadata: { item_id: item.id, error: String(err) },
        })
      } catch {
        /* ignore */
      }
    } finally {
      release()
    }
  }

  /* ── Loop body ──────────────────────────────────────────────────────── */
  const loop = async (): Promise<void> => {
    while (!stopped) {
      let queueRes: Awaited<ReturnType<typeof getQueueFn>>
      try {
        queueRes = await getQueueFn({ stage: 2, limit: STAGE2_LIMIT })
      } catch (err) {
        try {
          lf.trace({
            name: 'consumer-stage2-getqueue-error',
            metadata: { error: String(err) },
          })
        } catch {
          /* ignore */
        }
        await cancellableSleep(POLL_INTERVAL_EMPTY_MS)
        continue
      }

      if ('kind' in queueRes) {
        const skip = queueRes
        try {
          lf.trace({
            name: 'consumer-stage2-getqueue-skip',
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

      const items = queueRes.items
      const traceId = queueRes.traceId

      if (items.length === 0) {
        await cancellableSleep(POLL_INTERVAL_EMPTY_MS)
        continue
      }

      // Fetch taxonomy ONCE per non-empty batch — never cache across cycles.
      let taxonomy: TaxonomyInternalResponse
      try {
        taxonomy = await getTaxonomyInternalFn()
      } catch (err) {
        try {
          lf.trace({
            name: 'consumer-stage2-taxonomy-fetch-failed',
            metadata: { error: String(err), batch_size: items.length },
          })
        } catch {
          /* ignore */
        }
        // Skip the entire batch; items stay in processing_stage2 and the
        // queue's stale-reclaim returns them on the next poll cycle.
        await cancellableSleep(POLL_INTERVAL_ITEMS_MS)
        continue
      }

      // lx4 Task 3: paths fetch removed — Claude calls cortex_paths_internal
      // via the MCP tool when it needs the path tree.

      for (const item of items) {
        const promise = handleOne(item, taxonomy, traceId)
        inFlight.add(promise)
        promise.finally(() => inFlight.delete(promise)).catch(() => {})
      }

      await cancellableSleep(POLL_INTERVAL_ITEMS_MS)
    }
  }

  const loopPromise = loop().catch((err) => {
    try {
      lf.trace({
        name: 'consumer-stage2-loop-fatal',
        metadata: { error: String(err) },
      })
    } catch {
      /* ignore */
    }
  })

  return {
    async stop(): Promise<void> {
      stopped = true
      if (wakeCurrentSleep) wakeCurrentSleep()
      await loopPromise.catch(() => {})
      await Promise.allSettled([...inFlight])
    },
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Internal helpers                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

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
          name: 'consumer-stage2-conflict',
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
          name: 'consumer-stage2-classify-skip',
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
    // kind === 'ok' — server has the verdict.
  } catch (err) {
    try {
      lf.trace({
        name: 'consumer-stage2-classify-throw',
        metadata: { item_id: payload.item_id, error: String(err) },
      })
    } catch {
      /* ignore */
    }
  }
}
