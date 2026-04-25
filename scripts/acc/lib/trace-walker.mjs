// scripts/acc/lib/trace-walker.mjs — Phase 8 Plan 01 Task 2
//
// Pure span-chain walker used by audit-langfuse-trace.mjs. Decoupled
// from the Langfuse SDK so it can be unit-tested with mock trace
// objects and so the script entry point stays thin.
//
// Required span chain (per 08-CONTEXT D-05/D-06 and the brief's ACC-05):
//   api-ingest → api-queue → consumer-stage{1|2}-item → api-classify
//
// The walker accepts an array of trace summaries with shape:
//   { id: string, name: string, metadata?: { inbound_trace_id?: string, ... } }
// and asserts every required name is present AND any consumer-stage* trace's
// metadata.inbound_trace_id resolves to a known api-queue trace id.

export const REQUIRED_SPAN_NAMES = Object.freeze({
  apiIngest: 'api-ingest',
  apiQueue: 'api-queue',
  apiClassify: 'api-classify',
  stage1Item: 'consumer-stage1-item',
  stage2Item: 'consumer-stage2-item',
})

/**
 * Walk a flat array of trace summaries and decide whether the canonical
 * end-to-end chain is reconstructable.
 *
 * Mode selection:
 *   - opts.requireStage2 = true  → require consumer-stage2-item (Gmail keep flow)
 *   - opts.requireStage2 falsy + stage1 present → use stage1 (file ignore/keep, Gmail ignore)
 *   - opts.requireStage2 falsy + stage1 absent  → fall back to stage2 (so missing-stage1
 *     in a green-keep flow still resolves; explicit --require-stage2 is the strict variant)
 *
 * @param {Array<{id: string, name: string, metadata?: Record<string, any>}>} traces
 * @param {{ requireStage2?: boolean }} [opts]
 * @returns {{ ok: boolean, chain: string[], missing: string[], broken: string[] }}
 */
export function walkSpanChain(traces, opts = {}) {
  const byName = new Map()
  for (const tr of traces || []) {
    if (!tr || typeof tr.name !== 'string') continue
    if (!byName.has(tr.name)) byName.set(tr.name, [])
    byName.get(tr.name).push(tr)
  }
  const have = (n) => byName.has(n) && byName.get(n).length > 0

  // Decide which consumer-stage trace to require.
  const stage = opts.requireStage2
    ? REQUIRED_SPAN_NAMES.stage2Item
    : have(REQUIRED_SPAN_NAMES.stage1Item)
      ? REQUIRED_SPAN_NAMES.stage1Item
      : REQUIRED_SPAN_NAMES.stage2Item

  // Canonical order: ingest → queue → stage* → classify
  const required = [
    REQUIRED_SPAN_NAMES.apiIngest,
    REQUIRED_SPAN_NAMES.apiQueue,
    stage,
    REQUIRED_SPAN_NAMES.apiClassify,
  ]

  const missing = required.filter((n) => !have(n))
  const chain = required.filter((n) => have(n))
  const broken = []

  // Verify every consumer-stage* trace's metadata.inbound_trace_id resolves
  // to a known api-queue trace id. Missing inbound_trace_id is also broken.
  const queueIds = new Set(
    (byName.get(REQUIRED_SPAN_NAMES.apiQueue) ?? []).map((tr) => tr.id),
  )
  const stageTraces = byName.get(stage) ?? []
  for (const st of stageTraces) {
    const inbound = st.metadata?.inbound_trace_id
    if (!inbound) {
      broken.push(`${stage}->queue:no_inbound_trace_id`)
      continue
    }
    if (!queueIds.has(inbound)) {
      broken.push(`${stage}->queue:dangling_inbound`)
    }
  }

  return {
    ok: missing.length === 0 && broken.length === 0,
    chain,
    missing,
    broken,
  }
}
