import { NextRequest } from 'next/server'
import { z } from 'zod'
import Langfuse from 'langfuse'
import { prisma } from '@/lib/prisma'
import { requireApiKey } from '@/lib/api-key'
import {
  RETRY_CAP,
  QUEUE_STATUSES,
  QUEUE_TRACE_KEY,
  TERMINAL_ERROR_STATUS,
} from '@/lib/queue-config'

/**
 * Confidence threshold for stage-2 axes. Mirrors the v1.0 threshold from
 * triage/route.ts buildProposals so the queue path and the user-facing triage
 * UI agree on what "confident" means.
 */
const CONFIDENCE_THRESHOLD = 0.75

/**
 * POST /api/classify body — discriminated union on outcome so success-only and
 * error-only fields cannot be mixed at the type level.
 */
const ClassifyBodySchema = z.discriminatedUnion('outcome', [
  z.object({
    item_id: z.string().min(1),
    stage: z.union([z.literal(1), z.literal(2)]),
    outcome: z.literal('success'),
    decision: z.enum(['keep', 'ignore', 'uncertain']).optional(),
    axes: z
      .record(
        z.enum(['type', 'from', 'context']),
        z.object({
          value: z.string().nullable(),
          confidence: z.number().min(0).max(1),
        }),
      )
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    reason: z.string().optional(),
    proposed_drive_path: z.string().optional(),
  }),
  z.object({
    item_id: z.string().min(1),
    stage: z.union([z.literal(1), z.literal(2)]),
    outcome: z.literal('error'),
    error_message: z.string().min(1),
  }),
])

/** Existing classification_trace shape — additive `queue` sibling alongside v1.0 stage1/stage2. */
type ExistingTrace = {
  stage1?: Record<string, unknown>
  stage2?: Record<string, unknown>
  queue?: {
    stage1?: { retries?: number; last_claim_at?: string; last_error?: string }
    stage2?: { retries?: number; last_claim_at?: string; last_error?: string }
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request)
  if (unauthorized) return unauthorized

  const lf = new Langfuse()
  const trace = lf.trace({ name: 'api-classify' })

  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      const res = Response.json(
        { error: 'validation_failed', issues: ['invalid_json'] },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const parsed = ClassifyBodySchema.safeParse(body)
    if (!parsed.success) {
      const res = Response.json(
        { error: 'validation_failed', issues: parsed.error.issues },
        { status: 400 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const data = parsed.data

    const findSpan = trace.span({ name: 'item-find', input: { item_id: data.item_id } })
    const item = await prisma.item.findUnique({ where: { id: data.item_id } })
    findSpan.end({ output: { found: !!item } })

    if (!item) {
      const res = Response.json({ error: 'item_not_found' }, { status: 404 })
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    const existingTrace = (item.classification_trace as ExistingTrace | null) ?? {}
    const stageKey: 'stage1' | 'stage2' = data.stage === 1 ? 'stage1' : 'stage2'

    // ─── SUCCESS PATH ───────────────────────────────────────────────────────
    if (data.outcome === 'success') {
      const updateData: Record<string, unknown> = {}
      const newTrace: ExistingTrace = { ...existingTrace }
      let newStatus: string

      if (data.stage === 1) {
        if (!data.decision) {
          const res = Response.json(
            { error: 'validation_failed', issues: ['stage1_success_requires_decision'] },
            { status: 400 },
          )
          res.headers.set('X-Trace-Id', trace.id)
          await lf.flushAsync()
          return res
        }
        newTrace.stage1 = {
          ...(existingTrace.stage1 ?? {}),
          decision: data.decision,
          confidence: data.confidence,
          reason: data.reason,
        }
        if (data.decision === 'keep') newStatus = QUEUE_STATUSES.PENDING_STAGE_2
        else if (data.decision === 'ignore') newStatus = QUEUE_STATUSES.IGNORED
        else newStatus = QUEUE_STATUSES.UNCERTAIN
      } else {
        if (!data.axes) {
          const res = Response.json(
            { error: 'validation_failed', issues: ['stage2_success_requires_axes'] },
            { status: 400 },
          )
          res.headers.set('X-Trace-Id', trace.id)
          await lf.flushAsync()
          return res
        }
        const tConf = data.axes.type?.confidence ?? 0
        const fConf = data.axes.from?.confidence ?? 0
        const cConf = data.axes.context?.confidence ?? 0
        const allConfident =
          tConf >= CONFIDENCE_THRESHOLD &&
          fConf >= CONFIDENCE_THRESHOLD &&
          cConf >= CONFIDENCE_THRESHOLD
        newStatus = allConfident ? QUEUE_STATUSES.CERTAIN : QUEUE_STATUSES.UNCERTAIN
        newTrace.stage2 = {
          ...(existingTrace.stage2 ?? {}),
          axes: data.axes,
          proposed_drive_path: data.proposed_drive_path,
        }
        if (data.axes.type?.value) updateData.axis_type = data.axes.type.value
        if (data.axes.from?.value) updateData.axis_from = data.axes.from.value
        if (data.axes.context?.value) updateData.axis_context = data.axes.context.value
        updateData.axis_type_confidence = tConf
        updateData.axis_from_confidence = fConf
        updateData.axis_context_confidence = cConf
        if (data.proposed_drive_path) updateData.proposed_drive_path = data.proposed_drive_path
      }

      // Reset queue retries for this stage on success — item is no longer pending here.
      const queue = { ...(existingTrace.queue ?? {}) }
      queue[stageKey] = { ...(queue[stageKey] ?? {}), retries: 0 }
      newTrace[QUEUE_TRACE_KEY] = queue

      updateData.status = newStatus
      updateData.classification_trace = newTrace as unknown as object

      const updateSpan = trace.span({ name: 'item-update-success', input: { stage: data.stage } })
      await prisma.item.update({ where: { id: item.id }, data: updateData })
      updateSpan.end({ output: { status: newStatus } })

      const res = Response.json({ ok: true, status: newStatus, retries: 0 })
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

    // ─── ERROR PATH ─────────────────────────────────────────────────────────
    const queue = { ...(existingTrace.queue ?? {}) }
    const stageQueue = { ...(queue[stageKey] ?? {}) } as {
      retries?: number
      last_claim_at?: string
      last_error?: string
    }
    const prevRetries = typeof stageQueue.retries === 'number' ? stageQueue.retries : 0
    const newRetries = prevRetries + 1
    stageQueue.retries = newRetries
    stageQueue.last_error = data.error_message
    queue[stageKey] = stageQueue
    const newTrace: ExistingTrace = { ...existingTrace, [QUEUE_TRACE_KEY]: queue }

    let newStatus: string
    if (newRetries >= RETRY_CAP) {
      newStatus = TERMINAL_ERROR_STATUS
    } else {
      newStatus = data.stage === 1 ? QUEUE_STATUSES.PENDING_STAGE_1 : QUEUE_STATUSES.PENDING_STAGE_2
    }

    const updateSpan = trace.span({
      name: 'item-update-error',
      input: { stage: data.stage, prevRetries, newRetries, terminal: newRetries >= RETRY_CAP },
    })
    await prisma.item.update({
      where: { id: item.id },
      data: { status: newStatus, classification_trace: newTrace as unknown as object },
    })
    updateSpan.end({ output: { status: newStatus, retries: newRetries } })

    const res = Response.json({ ok: true, status: newStatus, retries: newRetries })
    res.headers.set('X-Trace-Id', trace.id)
    await lf.flushAsync()
    return res
  } catch (err) {
    console.error('[api/classify] error:', err)
    try {
      await lf.flushAsync()
    } catch {
      /* noop — never let flush errors mask the original error */
    }
    const res = new Response('Internal Server Error', { status: 500 })
    res.headers.set('X-Trace-Id', trace.id)
    return res
  }
}
