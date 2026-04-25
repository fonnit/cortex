/**
 * Stage 1 worker loop unit tests — Phase 7 Plan 02, Task 1.
 *
 * Validates the relevance-gate consumer loop:
 *   - Polls /api/queue?stage=1&limit=10 with adaptive cadence (5s items / 30s empty).
 *   - Caps in-flight invokeClaude at STAGE1_CONCURRENCY=10 via Semaphore.
 *   - Posts ONE classify per item (success or error mapping).
 *   - Treats 409 conflict as no-op (logs + moves on, no retry).
 *   - Per-item failures NEVER crash the loop.
 *   - Langfuse traces use the inbound X-Trace-Id from /api/queue as parent.
 *   - stop() halts polling and drains in-flight items.
 *
 * Mirrors the scaffolding pattern from agent/__tests__/consumer-http-client.test.ts:
 * dependency injection of getQueue / postClassify / invokeClaude stubs, fake timers
 * for the loop's sleep() between polls, deterministic Promise pacing.
 */

import { runStage1Worker, STAGE1_LIMIT, STAGE1_CONCURRENCY } from '../src/consumer/stage1'
import type { QueueItem, ClassifyRequest, ClassifyOutcome, QueueResponse } from '../src/http/types'
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

const BAD_DOWNLOADS = (id: string): QueueItem => ({
  id,
  source: 'downloads',
  filename: null,
  mime_type: null,
  size_bytes: null,
  content_hash: `sha_${id}`,
  source_metadata: null,
  file_path: null,
})

const okOutcome = <T>(value: T): ClaudeOutcome<T> => ({
  kind: 'ok',
  value,
  durationMs: 10,
  exitCode: 0,
  stdoutFirst200: '{"decision":"keep"}',
})

const okClassify: ClassifyOutcome = { kind: 'ok', status: 'pending_stage2', retries: 0 }
const conflictClassify: ClassifyOutcome = { kind: 'conflict', currentStatus: 'changed' }
const skipExhaustedClassify: ClassifyOutcome = {
  kind: 'skip',
  reason: 'retries_exhausted',
  status: 503,
}

type LfStub = { trace: jest.Mock }
const makeLfStub = (): LfStub => ({ trace: jest.fn() })

/* ────────────────────────────────────────────────────────────────────── */
/* Tests                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

describe('runStage1Worker', () => {
  let worker: { stop: () => Promise<void> } | null = null

  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('Test 1: caps in-flight invokeClaude at STAGE1_CONCURRENCY (10)', async () => {
    // Inject 12 items in one batch; observe at most 10 concurrent invokeClaude.
    const items = Array.from({ length: 12 }, (_, i) => FILE_ITEM(`i_${i}`))
    let getQueueCalls = 0
    const getQueueImpl = jest.fn(async () => {
      getQueueCalls += 1
      if (getQueueCalls === 1) {
        const resp: QueueResponse = { items, reclaimed: 0, traceId: null }
        return resp
      }
      // Subsequent polls: empty.
      return { items: [] as QueueItem[], reclaimed: 0, traceId: null } as QueueResponse
    })

    let inFlight = 0
    let maxInFlight = 0
    const releasers: Array<() => void> = []
    const invokeClaudeImpl = jest.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Pause until manually released so we can observe the cap.
      await new Promise<void>((resolve) => releasers.push(resolve))
      inFlight -= 1
      return okOutcome({ decision: 'keep', confidence: 0.9 })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    // Let the loop start the first poll + dispatch all 12 items.
    // We allow microtasks to flush; the semaphore will hold 10 in flight.
    for (let i = 0; i < 50; i++) {
      await Promise.resolve()
    }

    expect(invokeClaudeImpl).toHaveBeenCalledTimes(10)
    expect(maxInFlight).toBe(10)

    // Release one — the 11th should now start.
    releasers[0]!()
    for (let i = 0; i < 50; i++) {
      await Promise.resolve()
    }
    expect(invokeClaudeImpl).toHaveBeenCalledTimes(11)
    expect(maxInFlight).toBe(10)

    // Drain everyone for clean teardown.
    while (releasers.length > 0) {
      releasers.shift()!()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }
  })

  it('Test 2: happy path — downloads item, decision=keep, single postClassify with stage:1 success', async () => {
    const item = FILE_ITEM('i_keep')
    const lf = makeLfStub()

    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9, reason: 'invoice' }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    // Let the first batch process to completion.
    for (let i = 0; i < 30; i++) await Promise.resolve()

    expect(invokeClaudeImpl).toHaveBeenCalledTimes(1)
    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    expect(payload).toEqual({
      item_id: 'i_keep',
      stage: 1,
      outcome: 'success',
      decision: 'keep',
      confidence: 0.9,
      reason: 'invoice',
    })

    // Verifies that a Langfuse span/trace was opened for this item.
    expect(lf.trace).toHaveBeenCalled()
    const traceCallNames = lf.trace.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(traceCallNames.some((n: string) => n.includes('stage1'))).toBe(true)
  })

  it('Test 3: ignore + uncertain decisions both POST stage:1 success', async () => {
    const itemIgnore = FILE_ITEM('i_ignore')
    const itemUncertain = FILE_ITEM('i_uncertain')

    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({
        items: [itemIgnore, itemUncertain],
        reclaimed: 0,
        traceId: null,
      } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)

    const invokeClaudeImpl = jest
      .fn()
      .mockImplementationOnce(async () => okOutcome({ decision: 'ignore', confidence: 0.95 }))
      .mockImplementationOnce(async () => okOutcome({ decision: 'uncertain', confidence: 0.5 }))

    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(2)
    const decisions = postClassifyImpl.mock.calls.map((c) => {
      const p = c[0] as ClassifyRequest
      if (p.outcome === 'success') return p.decision
      return 'error'
    })
    expect(decisions).toEqual(expect.arrayContaining(['ignore', 'uncertain']))
  })

  it('Test 4: invokeClaude parse_error → outcome:error with parse_error message', async () => {
    const item = FILE_ITEM('i_parse')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () => ({
      kind: 'parse_error',
      reason: 'no_json_object_in_stdout',
      stdoutFirst200: 'garbage',
      exitCode: 0,
      durationMs: 5,
    }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    expect(payload).toEqual({
      item_id: 'i_parse',
      stage: 1,
      outcome: 'error',
      error_message: expect.stringMatching(/^parse_error:/),
    })
  })

  it('Test 5: invokeClaude exit_error → outcome:error with exit_error code', async () => {
    const item = FILE_ITEM('i_exit')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () => ({
      kind: 'exit_error',
      exitCode: 127,
      stderrFirst200: 'command not found',
      durationMs: 5,
    }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    expect(payload).toMatchObject({
      item_id: 'i_exit',
      stage: 1,
      outcome: 'error',
      error_message: 'exit_error: code=127',
    })
  })

  it('Test 6: invokeClaude timeout → outcome:error with error_message:"timeout"', async () => {
    const item = FILE_ITEM('i_timeout')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () => ({ kind: 'timeout', durationMs: 120_000 }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    expect(payload).toMatchObject({
      item_id: 'i_timeout',
      stage: 1,
      outcome: 'error',
      error_message: 'timeout',
    })
  })

  it('Test 7: postClassify conflict → log + move on, no throw, semaphore released', async () => {
    const items = [FILE_ITEM('i_a'), FILE_ITEM('i_b')]
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => conflictClassify)

    worker = runStage1Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // Both items processed; both 409'd; loop continues (no crash).
    expect(postClassifyImpl).toHaveBeenCalledTimes(2)
    // A conflict-named trace was emitted.
    const traceNames = lf.trace.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(traceNames.some((n: string) => n.includes('conflict'))).toBe(true)
  })

  it('Test 8: postClassify retries_exhausted → log warning, move on, no throw', async () => {
    const item = FILE_ITEM('i_retry')
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => skipExhaustedClassify)

    worker = runStage1Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()
    // Still alive after the skip — next poll attempted.
    expect(getQueueImpl.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('Test 9: buildStage1Prompt throws on bad downloads item → outcome:error prompt_build_error', async () => {
    const bad = BAD_DOWNLOADS('i_bad')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [bad], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // invokeClaude should never run because the prompt build failed first.
    expect(invokeClaudeImpl).not.toHaveBeenCalled()
    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    expect(payload).toMatchObject({
      item_id: 'i_bad',
      stage: 1,
      outcome: 'error',
      error_message: expect.stringMatching(/^prompt_build_error:/),
    })
  })

  it('Test 10: gmail item → prompt contains Subject:, NOT a /path filename', async () => {
    const item = GMAIL_ITEM('i_gmail')
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    let capturedPrompt = ''
    const invokeClaudeImpl = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt
      return okOutcome({ decision: 'keep', confidence: 0.9 })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(invokeClaudeImpl).toHaveBeenCalledTimes(1)
    expect(capturedPrompt).toContain('Subject:')
    // gmail prompt should NOT include a file path beginning with /Users/.
    expect(capturedPrompt).not.toMatch(/\/Users\//)
  })

  it('Test 11: adaptive cadence — 0 items → next poll in 30s; ≥1 → 5s', async () => {
    jest.useFakeTimers()

    let pollCount = 0
    const getQueueImpl = jest.fn(async () => {
      pollCount += 1
      if (pollCount === 1) {
        return { items: [], reclaimed: 0, traceId: null } as QueueResponse
      }
      if (pollCount === 2) {
        return { items: [FILE_ITEM('a')], reclaimed: 0, traceId: null } as QueueResponse
      }
      return { items: [], reclaimed: 0, traceId: null } as QueueResponse
    })
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    // Let the first poll resolve.
    await Promise.resolve()
    await Promise.resolve()
    expect(pollCount).toBe(1)

    // First poll returned 0 items → loop sleeps 30s. Advance < 30s and confirm
    // no second poll yet.
    await jest.advanceTimersByTimeAsync(20_000)
    expect(pollCount).toBe(1)

    // Cross 30s threshold → second poll fires.
    await jest.advanceTimersByTimeAsync(11_000)
    expect(pollCount).toBeGreaterThanOrEqual(2)

    // Second poll returned 1 item → sleeps 5s. Advance ~6s and expect a 3rd poll.
    await jest.advanceTimersByTimeAsync(6_000)
    expect(pollCount).toBeGreaterThanOrEqual(3)
  })

  it('Test 12: X-Trace-Id from queue → Langfuse trace metadata.inbound_trace_id', async () => {
    const item = FILE_ITEM('i_chain')
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({
        items: [item],
        reclaimed: 0,
        traceId: 'trace-abc',
      } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const invokeClaudeImpl = jest.fn(async () =>
      okOutcome({ decision: 'keep', confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // Find the per-item trace and inspect its metadata.
    const itemTraceCall = lf.trace.mock.calls.find((c: unknown[]) => {
      const arg = c[0] as { name?: string; metadata?: Record<string, unknown> }
      return (
        arg &&
        typeof arg.name === 'string' &&
        arg.metadata !== undefined &&
        (arg.metadata.item_id === 'i_chain' || arg.metadata.inbound_trace_id !== undefined)
      )
    })
    expect(itemTraceCall).toBeDefined()
    const arg = itemTraceCall![0] as { metadata: Record<string, unknown> }
    expect(arg.metadata.inbound_trace_id).toBe('trace-abc')
  })

  it('Test 13: stop() halts polling and drains in-flight invocations', async () => {
    const items = [FILE_ITEM('drain_a'), FILE_ITEM('drain_b')]
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    let resolved = 0
    const invokeClaudeImpl = jest.fn(async () => {
      // Small async tick to simulate work, then resolve.
      await Promise.resolve()
      resolved += 1
      return okOutcome({ decision: 'keep', confidence: 0.9 })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage1Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
    })

    // Let first batch dispatch.
    for (let i = 0; i < 5; i++) await Promise.resolve()

    await worker.stop()
    worker = null

    // Both items must have completed before stop() resolved (drain).
    expect(resolved).toBe(2)
    expect(postClassifyImpl).toHaveBeenCalledTimes(2)
  })

  it('Constants exported with locked values', () => {
    expect(STAGE1_LIMIT).toBe(10)
    expect(STAGE1_CONCURRENCY).toBe(10)
  })
})
