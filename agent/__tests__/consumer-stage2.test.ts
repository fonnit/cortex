/**
 * Stage 2 worker loop unit tests — Phase 7 Plan 02, Task 2.
 *
 * Validates the labelling-pool consumer loop:
 *   - Polls /api/queue?stage=2&limit=2 with adaptive cadence (5s/30s).
 *   - Caps in-flight invokeClaude at STAGE2_CONCURRENCY=2 via Semaphore.
 *   - Fetches taxonomy via getTaxonomyInternal EXACTLY ONCE per non-empty batch
 *     (never cached across cycles — D-no-cache-taxonomy).
 *   - Posts ONE classify per item (success: all-3-axes; error mapping otherwise).
 *   - 409 conflict logged + skipped (D-postClassify-no-retry-409).
 *   - Stage 1 saturation does NOT block Stage 2 throughput (CONS-05).
 *   - Taxonomy fetch failure → batch is skipped (items stay in processing_stage2,
 *     queue's stale-reclaim returns them).
 */

import { runStage1Worker } from '../src/consumer/stage1'
import { runStage2Worker, STAGE2_LIMIT, STAGE2_CONCURRENCY } from '../src/consumer/stage2'
import type {
  QueueItem,
  ClassifyRequest,
  ClassifyOutcome,
  QueueResponse,
  TaxonomyInternalResponse,
  PathsInternalResponse,
} from '../src/http/types'
import type { ClaudeOutcome } from '../src/consumer/claude'

/* ────────────────────────────────────────────────────────────────────── */
/* Fixtures                                                                */
/* ────────────────────────────────────────────────────────────────────── */

const FILE_ITEM = (id: string): QueueItem => ({
  id,
  source: 'downloads',
  filename: `${id}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 100,
  content_hash: `sha_${id}`,
  source_metadata: { file_path: `/Users/d/Downloads/${id}.pdf` },
  file_path: `/Users/d/Downloads/${id}.pdf`,
})

const GMAIL_ITEM = (id: string): QueueItem => ({
  id,
  source: 'gmail',
  filename: null,
  mime_type: null,
  size_bytes: null,
  content_hash: `sha_${id}`,
  source_metadata: {
    subject: 'March statement',
    from: 'no-reply@bofa.com',
    snippet: 'Statement available',
    headers: { 'Message-ID': '<x@bofa>' },
  },
  file_path: null,
})

const TAXONOMY: TaxonomyInternalResponse = {
  type: ['invoice', 'receipt', 'statement'],
  from: ['acme', 'bofa'],
  context: ['finance', 'tax'],
}

const EMPTY_TAXONOMY: TaxonomyInternalResponse = { type: [], from: [], context: [] }

// h9w: Stage 2 worker now also fetches the confirmed-path tree once per
// non-empty batch. Tests inject a small fixture so the worker doesn't try to
// hit the real network.
const PATHS_RESPONSE: PathsInternalResponse = {
  paths: [{ parent: '/invoice/acme/finance/', count: 5 }],
}

const okStage2Outcome = (): ClaudeOutcome<{
  axes: { type: { value: string | null; confidence: number }; from: { value: string | null; confidence: number }; context: { value: string | null; confidence: number } }
  proposed_drive_path: string
  decision: 'auto_file' | 'ignore' | 'uncertain'
  path_confidence: number
}> => ({
  kind: 'ok',
  value: {
    axes: {
      type: { value: 'invoice', confidence: 0.9 },
      from: { value: 'acme', confidence: 0.8 },
      context: { value: 'finance', confidence: 0.85 },
    },
    proposed_drive_path: '/invoice/acme/finance/x.pdf',
    // h9w: schema requires path_confidence + decision at the top level. Use
    // 'uncertain' here so the existing Test 2 assertion (which doesn't include
    // a decision in the expected payload) doesn't get a noisy diff — toEqual
    // ignores undefined fields, but explicit 'uncertain' matches the legacy
    // CERTAIN/UNCERTAIN fallback flow these tests exercise.
    decision: 'uncertain',
    path_confidence: 0.5,
  },
  durationMs: 12,
  exitCode: 0,
  stdoutFirst200: '{}',
})

const okClassify: ClassifyOutcome = { kind: 'ok', status: 'certain', retries: 0 }
const conflictClassify: ClassifyOutcome = { kind: 'conflict', currentStatus: 'changed' }

type LfStub = { trace: jest.Mock }
const makeLfStub = (): LfStub => ({ trace: jest.fn() })

/* ────────────────────────────────────────────────────────────────────── */
/* Tests                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

describe('runStage2Worker', () => {
  let worker: { stop: () => Promise<void> } | null = null
  let stage1Worker: { stop: () => Promise<void> } | null = null

  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    if (stage1Worker) {
      await stage1Worker.stop().catch(() => {})
      stage1Worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('Test 1: caps in-flight invokeClaude at STAGE2_CONCURRENCY (2)', async () => {
    const items = Array.from({ length: 4 }, (_, i) => FILE_ITEM(`s2_${i}`))
    let pollCount = 0
    const getQueueImpl = jest.fn(async () => {
      pollCount += 1
      if (pollCount === 1) {
        return { items, reclaimed: 0, traceId: null } as QueueResponse
      }
      return { items: [], reclaimed: 0, traceId: null } as QueueResponse
    })
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)

    let inFlight = 0
    let maxInFlight = 0
    const releasers: Array<() => void> = []
    const invokeClaudeImpl = jest.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((r) => releasers.push(r))
      inFlight -= 1
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(invokeClaudeImpl).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(2)

    while (releasers.length > 0) {
      releasers.shift()!()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
  })

  it('Test 2: happy path (downloads) — POST stage:2 success with all 3 axes + proposed_drive_path', async () => {
    const item = FILE_ITEM('s2_happy')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome())
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    // u47: decision is now part of the success payload. h9w: path_confidence
    // is also part of the success payload. Use toEqual with the full shape.
    expect(payload).toEqual({
      item_id: 's2_happy',
      stage: 2,
      outcome: 'success',
      axes: {
        type: { value: 'invoice', confidence: 0.9 },
        from: { value: 'acme', confidence: 0.8 },
        context: { value: 'finance', confidence: 0.85 },
      },
      proposed_drive_path: '/invoice/acme/finance/x.pdf',
      decision: 'uncertain',
      path_confidence: 0.5,
    })
  })

  it('Test 3: gmail item — prompt has Subject:, no /path/ filename', async () => {
    const item = GMAIL_ITEM('s2_gmail')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    let capturedPrompt = ''
    const invokeClaudeImpl = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(capturedPrompt).toContain('Subject:')
    expect(capturedPrompt).not.toMatch(/\/Users\//)
  })

  it('Test 4: getTaxonomyInternal called EXACTLY ONCE per non-empty batch, NEVER cached across cycles', async () => {
    jest.useFakeTimers()

    let pollCount = 0
    const getQueueImpl = jest.fn(async () => {
      pollCount += 1
      if (pollCount === 1) {
        return {
          items: [FILE_ITEM('a'), FILE_ITEM('b')],
          reclaimed: 0,
          traceId: null,
        } as QueueResponse
      }
      if (pollCount === 2) {
        return { items: [FILE_ITEM('c')], reclaimed: 0, traceId: null } as QueueResponse
      }
      return { items: [], reclaimed: 0, traceId: null } as QueueResponse
    })

    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome())
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    // First poll resolves and dispatches.
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(getTaxonomyInternalImpl).toHaveBeenCalledTimes(1)

    // Advance past the 5s items-cadence sleep → second poll fires.
    await jest.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 30; i++) await Promise.resolve()
    // Second non-empty poll → second taxonomy fetch.
    expect(getTaxonomyInternalImpl).toHaveBeenCalledTimes(2)

    // Now an empty poll — taxonomy MUST NOT be re-fetched.
    await jest.advanceTimersByTimeAsync(6_000)
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(getTaxonomyInternalImpl).toHaveBeenCalledTimes(2)
  })

  it('Test 5: empty taxonomy renders "(none yet)" in prompt', async () => {
    const item = FILE_ITEM('s2_empty_tax')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => EMPTY_TAXONOMY)
    let capturedPrompt = ''
    const invokeClaudeImpl = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(capturedPrompt).toContain('(none yet)')
    // Three axes each render "(none yet)".
    const matches = capturedPrompt.match(/\(none yet\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('Test 6: getTaxonomyInternal throws → batch SKIPPED (no postClassify), loop continues', async () => {
    const items = [FILE_ITEM('s2_a'), FILE_ITEM('s2_b')]
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => {
      throw new Error('taxonomy fetch failed: 401')
    })
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome())
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // No invokeClaude, no postClassify — items stay in processing_stage2.
    expect(invokeClaudeImpl).not.toHaveBeenCalled()
    expect(postClassifyImpl).not.toHaveBeenCalled()
    // A failure trace was emitted.
    const traceNames = lf.trace.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(traceNames.some((n: string) => n.includes('taxonomy'))).toBe(true)
  })

  it('Test 7: invokeClaude parse_error / exit_error / timeout → outcome:error stage:2', async () => {
    const items = [FILE_ITEM('s2_p'), FILE_ITEM('s2_e'), FILE_ITEM('s2_t')]
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest
      .fn()
      .mockImplementationOnce(async () => ({
        kind: 'parse_error',
        reason: 'no_json',
        stdoutFirst200: '',
        exitCode: 0,
        durationMs: 5,
      }))
      .mockImplementationOnce(async () => ({
        kind: 'exit_error',
        exitCode: 127,
        stderrFirst200: 'nope',
        durationMs: 5,
      }))
      .mockImplementationOnce(async () => ({ kind: 'timeout', durationMs: 120_000 }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(3)
    const payloads = postClassifyImpl.mock.calls.map((c) => c[0] as ClassifyRequest)
    const errorMessages = payloads
      .filter((p): p is ClassifyRequest & { outcome: 'error' } => p.outcome === 'error')
      .map((p) => p.error_message)
    expect(errorMessages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^parse_error:/),
        'exit_error: code=127',
        'timeout',
      ]),
    )
    payloads.forEach((p) => expect(p.stage).toBe(2))
  })

  it('Test 8: postClassify 409 conflict → log + move on', async () => {
    const item = FILE_ITEM('s2_409')
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome())
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => conflictClassify)

    worker = runStage2Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const traceNames = lf.trace.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(traceNames.some((n: string) => n.includes('conflict'))).toBe(true)
  })

  it('Test 9: adaptive cadence — 0 items → 30s; ≥1 → 5s', async () => {
    jest.useFakeTimers()
    let pollCount = 0
    const getQueueImpl = jest.fn(async () => {
      pollCount += 1
      if (pollCount === 1) return { items: [], reclaimed: 0, traceId: null } as QueueResponse
      if (pollCount === 2) {
        return { items: [FILE_ITEM('x')], reclaimed: 0, traceId: null } as QueueResponse
      }
      return { items: [], reclaimed: 0, traceId: null } as QueueResponse
    })
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome())
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(pollCount).toBe(1)

    await jest.advanceTimersByTimeAsync(20_000)
    expect(pollCount).toBe(1)

    await jest.advanceTimersByTimeAsync(11_000)
    expect(pollCount).toBeGreaterThanOrEqual(2)

    await jest.advanceTimersByTimeAsync(6_000)
    expect(pollCount).toBeGreaterThanOrEqual(3)
  })

  it('Test 10 (CONS-05): Stage 1 saturation does NOT block Stage 2 throughput', async () => {
    // Two workers running in the same process. Stage 1 has 10 items in flight
    // (all paused on releasers); Stage 2 has 1 item — it must process and
    // postClassify even while Stage 1 is fully saturated.

    const stage1Items = Array.from({ length: 10 }, (_, i) => FILE_ITEM(`s1_${i}`))
    const stage1GetQueue = jest.fn(async () => {
      // First call returns the batch; subsequent calls empty so the loop
      // doesn't try to re-poll while items are pending.
      const c = stage1GetQueue.mock.calls.length
      if (c === 1) return { items: stage1Items, reclaimed: 0, traceId: null } as QueueResponse
      return { items: [], reclaimed: 0, traceId: null } as QueueResponse
    })
    const stage1Releasers: Array<() => void> = []
    const stage1Invoke = jest.fn(async () => {
      await new Promise<void>((r) => stage1Releasers.push(r))
      return {
        kind: 'ok',
        value: { decision: 'keep', confidence: 0.9 },
        durationMs: 10,
        exitCode: 0,
        stdoutFirst200: '',
      } as ClaudeOutcome<{ decision: 'keep'; confidence: number }>
    })
    const stage1Post = jest.fn(async (_p: ClassifyRequest) => okClassify)

    stage1Worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: stage1GetQueue as never,
      invokeClaudeImpl: stage1Invoke as never,
      postClassifyImpl: stage1Post as never,
    })

    // Let Stage 1 saturate (all 10 acquired, paused on releasers).
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(stage1Invoke).toHaveBeenCalledTimes(10)

    // Now spin up Stage 2 — it should process its item even though Stage 1
    // is saturated (independent semaphore).
    const stage2Item = FILE_ITEM('s2_independent')
    const stage2GetQueue = jest
      .fn()
      .mockResolvedValueOnce({ items: [stage2Item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const stage2Tax = jest.fn(async () => TAXONOMY)
    const stage2Invoke = jest.fn(async () => okStage2Outcome())
    const stage2Post = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: stage2GetQueue as never,
      invokeClaudeImpl: stage2Invoke as never,
      postClassifyImpl: stage2Post as never,
      getTaxonomyInternalImpl: stage2Tax as never,
      // h9w: stub the new path-tree fetch.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // Stage 1 still saturated…
    expect(stage1Post).not.toHaveBeenCalled()
    // …but Stage 2 made progress.
    expect(stage2Invoke).toHaveBeenCalledTimes(1)
    expect(stage2Post).toHaveBeenCalledTimes(1)

    // Drain Stage 1.
    while (stage1Releasers.length > 0) {
      stage1Releasers.shift()!()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
  })

  it('Test 11: stop() halts polling and drains in-flight invocations', async () => {
    const items = [FILE_ITEM('s2_drain_a'), FILE_ITEM('s2_drain_b')]
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    let resolved = 0
    const invokeClaudeImpl = jest.fn(async () => {
      await Promise.resolve()
      resolved += 1
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      // h9w: stub the new path-tree fetch so the worker doesn't reach the real network.
      getPathsInternalImpl: jest.fn(async () => PATHS_RESPONSE) as never,
    })

    for (let i = 0; i < 5; i++) await Promise.resolve()
    await worker.stop()
    worker = null

    expect(resolved).toBe(2)
    expect(postClassifyImpl).toHaveBeenCalledTimes(2)
  })

  it('Constants exported with locked values', () => {
    expect(STAGE2_LIMIT).toBe(2)
    expect(STAGE2_CONCURRENCY).toBe(2)
  })
})
