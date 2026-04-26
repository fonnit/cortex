import { NextRequest } from 'next/server'
import { z } from 'zod'
import Langfuse from 'langfuse'
import type { Prisma } from '@prisma/client'
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
 * A single axis value is either:
 *   - { value: <string>, confidence: <0..1> }     (resolved axis)
 *   - { value: null,    confidence: < CONFIDENCE_THRESHOLD } (unresolved — must be below threshold)
 *
 * Rejecting `value: null, confidence: >= 0.75` at the API boundary is the
 * fix for review finding [2]: a null axis value cannot semantically be
 * "confident" — accepting that combination would let a row transition to
 * status='certain' while its axis_* column is stale/null.
 */
const AxisSchema = z
  .object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine((v) => !(v.value === null && v.confidence >= CONFIDENCE_THRESHOLD), {
    message:
      'axis with value=null cannot have confidence >= CONFIDENCE_THRESHOLD (0.75); a null value is by definition unresolved',
  })

/**
 * POST /api/classify body — discriminated union on outcome so success-only and
 * error-only fields cannot be mixed at the type level.
 *
 * Stage 2 success requires ALL THREE axes (type, from, context) per review
 * finding [1]: a partial axes object would cause confidence columns for
 * omitted axes to be silently overwritten with 0, drifting them out of sync
 * with the (still-present) value columns. The contract is "all three axes
 * or none" — runtime validators with sparse axes should fail at this seam.
 *
 * Per quick task 260426-u47:
 *   - Stage 1 success: `decision` enum is {keep, ignore, uncertain} (relevance
 *     gate). Required by the inline check below (line ~166).
 *   - Stage 2 success: `decision` enum is {auto_file, ignore, uncertain}
 *     (terminal action). Required at the schema level via .refine(). The two
 *     enums are deliberately disjoint — Stage 1 cannot return 'auto_file'
 *     (it has no axes to file with), Stage 2 cannot return 'keep' (the
 *     keep-vs-skip decision was already made at Stage 1).
 *   - Optional top-level `confidence: number (0..1)` on the Stage 2 success
 *     branch is used by the auto-ignore path (see Step 4 below).
 */
const ClassifyBodySchema = z.discriminatedUnion('outcome', [
  z
    .object({
      item_id: z.string().min(1),
      stage: z.union([z.literal(1), z.literal(2)]),
      outcome: z.literal('success'),
      // Wider enum at parse time — refined per stage below. Stage 1 cannot
      // emit 'auto_file' and Stage 2 cannot emit 'keep'.
      decision: z.enum(['keep', 'ignore', 'uncertain', 'auto_file']).optional(),
      axes: z
        .object({
          type: AxisSchema,
          from: AxisSchema,
          context: AxisSchema,
        })
        .optional(),
      confidence: z.number().min(0).max(1).optional(),
      reason: z.string().optional(),
      proposed_drive_path: z.string().optional(),
    })
    // Stage 2 success: `decision` is REQUIRED and limited to the Stage 2 enum.
    .refine(
      (b) => b.stage !== 2 || (b.decision !== undefined && b.decision !== 'keep'),
      {
        message: "stage 2 success requires decision in {'auto_file','ignore','uncertain'}",
        path: ['decision'],
      },
    )
    // Stage 1 success: `decision`, when provided, must NOT be 'auto_file'
    // (the route's inline check enforces required-ness too — see line ~166).
    .refine((b) => b.stage !== 1 || b.decision !== 'auto_file', {
      message: "stage 1 success cannot use decision='auto_file' (Stage 2 enum)",
      path: ['decision'],
    }),
  z.object({
    item_id: z.string().min(1),
    stage: z.union([z.literal(1), z.literal(2)]),
    outcome: z.literal('error'),
    error_message: z.string().min(1),
  }),
])

/* ───────────────────────────────────────────────────────────────────────────
 * Auto-action thresholds — quick task 260426-u47.
 *
 * AUTO_FILE_THRESHOLD: minimum confidence on EVERY axis before Stage 2 may
 *   transition status='filed'. Matches the existing STAGE2_CONFIDENT_MATCH
 *   constant in the prompt (0.85).
 *
 * AUTO_IGNORE_THRESHOLD: minimum confidence on the ignore signal (either
 *   the explicit top-level `confidence` field or, when absent, the max of
 *   the 3 axis confidences) before status='ignored'.
 * ───────────────────────────────────────────────────────────────────────── */

const AUTO_FILE_THRESHOLD = 0.85
const AUTO_IGNORE_THRESHOLD = 0.85

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

    // ─── STALE-CLAIM RACE GUARD (review fix [3]) ────────────────────────────
    // The consumer's claim is only valid if the item is still in
    // processing_stage{N}. If a slow consumer's POST arrives after the queue's
    // stale-reclaim path moved the item back to pending and another consumer
    // re-claimed (or completed) it, accepting the write would silently
    // overwrite the re-claimer's correct decision.
    //
    // We capture the expected status here and assert it inside the update
    // statement (via updateMany's compound where + count check) so the
    // pre-flight check and the actual mutation cannot diverge between the two
    // statements (TOCTOU). The `findUnique` above is kept so the 404 path
    // continues to fire for nonexistent items.
    const expectedStatus =
      data.stage === 1 ? QUEUE_STATUSES.PROCESSING_STAGE_1 : QUEUE_STATUSES.PROCESSING_STAGE_2
    if (item.status !== expectedStatus) {
      const res = Response.json(
        { error: 'item_no_longer_claimed', current_status: item.status },
        { status: 409 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

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
        // Build stage1 patch conditionally so omitted optional fields don't
        // overwrite prior values with undefined/null (review fix [7]).
        const stage1Patch: Record<string, unknown> = {
          ...(existingTrace.stage1 ?? {}),
          decision: data.decision,
        }
        if (data.confidence !== undefined) stage1Patch.confidence = data.confidence
        if (data.reason !== undefined) stage1Patch.reason = data.reason
        newTrace.stage1 = stage1Patch
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
        // All three axes are guaranteed present by the Zod schema (review fix [1]).
        // The AxisSchema refinement guarantees value=null implies confidence < 0.75
        // (review fix [2]), so a null-value axis can never count as confident here.
        const tAxis = data.axes.type
        const fAxis = data.axes.from
        const cAxis = data.axes.context
        const tConf = tAxis.confidence
        const fConf = fAxis.confidence
        const cConf = cAxis.confidence
        const allConfident =
          tConf >= CONFIDENCE_THRESHOLD &&
          fConf >= CONFIDENCE_THRESHOLD &&
          cConf >= CONFIDENCE_THRESHOLD

        // ─── COLD-START GUARD LOAD (quick task 260426-u47, D-cold-start) ──
        // Read TaxonomyLabel rows once for this user. The guard prevents
        // auto-file from acting on labels that don't exist in the closed
        // vocabulary (currently trivially satisfied — the prompt forbids
        // invented labels — but future-proofs against the sibling Task #2
        // which lets Claude propose new labels).
        //
        // The lookup is read-only and runs at the route — the boundary that
        // already validates Stage 2 payloads. Per CONTEXT, auto-IGNORE skips
        // this guard (no labels are committed; vocabulary doesn't matter).
        //
        // TOCTOU safety: a stale read here is harmless because updateMany's
        // compound-where (id + expectedStatus) catches concurrent races.
        const coldStartSpan = trace.span({
          name: 'cold-start-guard-load',
          input: { user_id: item.user_id },
        })
        const labels = await prisma.taxonomyLabel.findMany({
          where: { user_id: item.user_id, deprecated: false },
          select: { axis: true, name: true },
        })
        coldStartSpan.end({ output: { label_count: labels.length } })
        const labelSet = new Set(
          labels.map((l: { axis: string; name: string }) => `${l.axis}:${l.name}`),
        )
        const isExistingLabel = (axis: 'type' | 'from' | 'context', value: string | null) =>
          value !== null && labelSet.has(`${axis}:${value}`)

        // ─── AUTO-FILE BRANCH (quick task 260426-u47, D-auto-file) ────────
        // Preconditions (ALL must hold):
        //   - decision === 'auto_file'
        //   - All 3 axis confidences ≥ AUTO_FILE_THRESHOLD (0.85)
        //   - All 3 axis values are non-null
        //   - All 3 axis values exist in TaxonomyLabel for that axis (cold-start)
        // When fired: status='filed' (terminal). axis_* + proposed_drive_path
        // STILL written (reversibility — triage UI can override). Plus
        // confirmed_drive_path = proposed_drive_path so the file's drive
        // location is committed without human review.
        const allHighConf =
          tConf >= AUTO_FILE_THRESHOLD &&
          fConf >= AUTO_FILE_THRESHOLD &&
          cConf >= AUTO_FILE_THRESHOLD
        const allValuesPresent =
          tAxis.value !== null && fAxis.value !== null && cAxis.value !== null
        const allLabelsExist =
          isExistingLabel('type', tAxis.value) &&
          isExistingLabel('from', fAxis.value) &&
          isExistingLabel('context', cAxis.value)
        const canAutoFile =
          data.decision === 'auto_file' &&
          allHighConf &&
          allValuesPresent &&
          allLabelsExist

        // ─── AUTO-IGNORE BRANCH (quick task 260426-u47, D-auto-ignore) ─────
        // Read confidence from the explicit top-level field if Claude
        // provided it (the Stage 2 prompt allows this for ignore); else
        // fall back to max(axis confidences). When ≥ AUTO_IGNORE_THRESHOLD
        // and decision==='ignore', status='ignored' (terminal) — cold-start
        // guard does NOT apply because no labels are committed.
        const ignoreConfidence =
          data.confidence ?? Math.max(tConf, fConf, cConf)
        const canAutoIgnore =
          data.decision === 'ignore' && ignoreConfidence >= AUTO_IGNORE_THRESHOLD

        // ─── DECIDE newStatus — auto-file → auto-ignore → existing logic ──
        // Order matters: auto-file is the most specific, then auto-ignore,
        // then the existing CERTAIN/UNCERTAIN fallback. Document the
        // blocked-by reason via Langfuse for observability.
        let autoFileBlockedReason: string | null = null
        if (data.decision === 'auto_file' && !canAutoFile) {
          if (!allHighConf) autoFileBlockedReason = 'low_conf'
          else if (!allValuesPresent) autoFileBlockedReason = 'null_axis'
          else if (!allLabelsExist) autoFileBlockedReason = 'unknown_label'
        } else if (data.decision !== 'auto_file') {
          autoFileBlockedReason = 'wrong_decision'
        }
        const autoFileSpan = trace.span({
          name: 'auto-file',
          input: { item_id: item.id, decision: data.decision },
        })
        autoFileSpan.end({
          output: { fired: canAutoFile, blocked_by: autoFileBlockedReason },
        })

        const autoIgnoreSpan = trace.span({
          name: 'auto-ignore',
          input: { item_id: item.id, decision: data.decision },
        })
        autoIgnoreSpan.end({
          output: { fired: canAutoIgnore, confidence: ignoreConfidence },
        })

        if (canAutoFile) {
          newStatus = QUEUE_STATUSES.FILED
        } else if (canAutoIgnore) {
          newStatus = QUEUE_STATUSES.IGNORED
        } else {
          newStatus = allConfident ? QUEUE_STATUSES.CERTAIN : QUEUE_STATUSES.UNCERTAIN
        }

        const stage2Patch: Record<string, unknown> = {
          ...(existingTrace.stage2 ?? {}),
          axes: data.axes,
        }
        if (data.proposed_drive_path !== undefined) {
          stage2Patch.proposed_drive_path = data.proposed_drive_path
        }
        // Persist the decision (and overall confidence when present) so a
        // post-hoc audit can reconstruct WHY an item was auto-filed/ignored.
        if (data.decision !== undefined) stage2Patch.decision = data.decision
        if (data.confidence !== undefined) stage2Patch.confidence = data.confidence
        newTrace.stage2 = stage2Patch

        // Auto-ignore: skip axis_* writes — they're null + low confidence on
        // the ignore path and writing them would be misleading.
        if (canAutoIgnore) {
          // Intentionally omit axis_*, proposed_drive_path, confirmed_drive_path.
          // status='ignored' is terminal; no further data is needed.
        } else {
          if (tAxis.value) updateData.axis_type = tAxis.value
          if (fAxis.value) updateData.axis_from = fAxis.value
          if (cAxis.value) updateData.axis_context = cAxis.value
          updateData.axis_type_confidence = tConf
          updateData.axis_from_confidence = fConf
          updateData.axis_context_confidence = cConf
          if (data.proposed_drive_path) updateData.proposed_drive_path = data.proposed_drive_path
          // Auto-file confirms the proposed path — commit it as confirmed
          // so downstream code (Drive sync, UI badges) treats it as final.
          if (canAutoFile && data.proposed_drive_path) {
            updateData.confirmed_drive_path = data.proposed_drive_path
          }
        }
      }

      // Reset queue retries for this stage on success — item is no longer pending here.
      const queue = { ...(existingTrace.queue ?? {}) }
      queue[stageKey] = { ...(queue[stageKey] ?? {}), retries: 0 }
      newTrace[QUEUE_TRACE_KEY] = queue

      updateData.status = newStatus
      // Cast directly through Prisma's JSON input type (review fix [8]).
      // ExistingTrace shape is structurally JSON-compatible (string/number/object only),
      // so this single cast is the safe form rather than an `as unknown as object` escape hatch.
      updateData.classification_trace = newTrace as Prisma.InputJsonValue

      const updateSpan = trace.span({ name: 'item-update-success', input: { stage: data.stage } })
      // Compound where { id, status: expectedStatus } is the TOCTOU guard for
      // review fix [3]: if another consumer reclaimed and updated this item
      // between our findUnique and this update, count will be 0 and we 409.
      const updateResult = await prisma.item.updateMany({
        where: { id: item.id, status: expectedStatus },
        data: updateData as Prisma.ItemUpdateManyMutationInput,
      })
      updateSpan.end({ output: { status: newStatus, matched: updateResult.count } })

      if (updateResult.count === 0) {
        const res = Response.json(
          { error: 'item_no_longer_claimed', current_status: 'changed' },
          { status: 409 },
        )
        res.headers.set('X-Trace-Id', trace.id)
        await lf.flushAsync()
        return res
      }

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
    // Same TOCTOU race-guard as the success path (review fix [3]) — the
    // error path also commits state-machine changes (retries++, possibly
    // status='error'), so a stale consumer must not be allowed to advance
    // the retry counter on an item another consumer already finished.
    const updateResult = await prisma.item.updateMany({
      where: { id: item.id, status: expectedStatus },
      data: {
        status: newStatus,
        classification_trace: newTrace as Prisma.InputJsonValue,
      },
    })
    updateSpan.end({ output: { status: newStatus, retries: newRetries, matched: updateResult.count } })

    if (updateResult.count === 0) {
      const res = Response.json(
        { error: 'item_no_longer_claimed', current_status: 'changed' },
        { status: 409 },
      )
      res.headers.set('X-Trace-Id', trace.id)
      await lf.flushAsync()
      return res
    }

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
