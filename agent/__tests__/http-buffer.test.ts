/**
 * agent/src/http/buffer.ts unit tests
 *
 * Validates the daemon's in-memory FIFO buffer (Phase 6 Plan 01, Task 3).
 * Per CONTEXT decisions:
 * - Cap = 100. Overflow drops OLDEST entry + emits Langfuse warning.
 * - Drain runs sequentially (concurrency = 1) to avoid hammering the API.
 * - No persistence — chokidar / startup-scan rediscovery is the recovery path.
 *
 * Dependency injection: the buffer takes `{ postIngest, langfuse, now }` so we
 * never have to mock `globalThis.fetch` here.
 */

import { IngestBuffer, BUFFER_CAP } from '../src/http/buffer'
import type { IngestRequest, IngestOutcome } from '../src/http/types'

const makePayload = (suffix: string): IngestRequest => ({
  source: 'downloads',
  content_hash: `sha256_${suffix}`,
  filename: `${suffix}.pdf`,
})

const successOutcome: IngestOutcome = { kind: 'success', id: 'i_x', deduped: false }

// Mutable mock clock so we can advance time deterministically without jest fake timers.
let mockNow = 0
const now = () => mockNow

describe('agent/src/http/buffer', () => {
  beforeEach(() => {
    mockNow = 0
  })

  it('Test 1: enqueue then drain calls postIngest in FIFO order', async () => {
    const calls: string[] = []
    const postIngest = jest.fn(async (p: IngestRequest): Promise<IngestOutcome> => {
      calls.push(p.content_hash)
      return successOutcome
    })
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    buffer.enqueue(makePayload('a'))
    buffer.enqueue(makePayload('b'))
    buffer.enqueue(makePayload('c'))

    await buffer.drain()

    expect(postIngest).toHaveBeenCalledTimes(3)
    expect(calls).toEqual(['sha256_a', 'sha256_b', 'sha256_c'])
  })

  it('Test 2: cap=100 — 105 enqueues drop the 5 OLDEST and emit 5 Langfuse warnings', async () => {
    const postIngest = jest.fn(async (): Promise<IngestOutcome> => successOutcome)
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    for (let i = 1; i <= 105; i++) {
      buffer.enqueue(makePayload(String(i)))
    }

    expect(buffer.size()).toBe(100)
    expect(langfuse.trace).toHaveBeenCalledTimes(5)
    // Each warning carries the canonical metadata shape
    for (const call of langfuse.trace.mock.calls) {
      const arg = call[0] as { name: string; metadata: Record<string, unknown> }
      expect(arg.name).toBe('buffer_overflow')
      expect(arg.metadata.buffer_size).toBe(100)
      expect(typeof arg.metadata.dropped_content_hash).toBe('string')
      expect(typeof arg.metadata.dropped_age_seconds).toBe('number')
    }
    // First drop reports content_hash of payload #1
    const firstDrop = langfuse.trace.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect(firstDrop.metadata.dropped_content_hash).toBe('sha256_1')
  })

  it('Test 3: drain is sequential (concurrency = 1) — pending postIngest blocks the next call', async () => {
    // Manually-controlled deferred promises so we can observe drain pacing.
    const resolvers: Array<(v: IngestOutcome) => void> = []
    const postIngest = jest.fn((): Promise<IngestOutcome> => {
      return new Promise<IngestOutcome>((resolve) => {
        resolvers.push(resolve)
      })
    })
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    buffer.enqueue(makePayload('a'))
    buffer.enqueue(makePayload('b'))
    buffer.enqueue(makePayload('c'))

    const drainPromise = buffer.drain()

    // Allow the microtask queue to flush the first postIngest call.
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(1)

    // Resolve #1 → #2 should fire next.
    resolvers[0](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(2)

    // Resolve #2 → #3 should fire next.
    resolvers[1](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(3)

    // Resolve #3 → drain returns.
    resolvers[2](successOutcome)
    await drainPromise

    expect(buffer.size()).toBe(0)
  })

  it('Test 4: drain on empty buffer resolves cleanly with no postIngest call', async () => {
    const postIngest = jest.fn(async (): Promise<IngestOutcome> => successOutcome)
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    await expect(buffer.drain()).resolves.toBeUndefined()
    expect(postIngest).not.toHaveBeenCalled()
  })

  it('Test 5: drain treats skip outcomes as drained — does not throw, continues', async () => {
    const postIngest = jest
      .fn<Promise<IngestOutcome>, [IngestRequest]>()
      .mockResolvedValueOnce(successOutcome)
      .mockResolvedValueOnce({ kind: 'skip', reason: 'retries_exhausted', status: 500 })
      .mockResolvedValueOnce(successOutcome)
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    buffer.enqueue(makePayload('a'))
    buffer.enqueue(makePayload('b'))
    buffer.enqueue(makePayload('c'))

    await expect(buffer.drain()).resolves.toBeUndefined()
    expect(postIngest).toHaveBeenCalledTimes(3)
    expect(buffer.size()).toBe(0)
  })

  it('Test 6: dropped_age_seconds reflects time the dropped entry sat in the buffer', async () => {
    const postIngest = jest.fn(async (): Promise<IngestOutcome> => successOutcome)
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    // Enqueue item #1 at t=0.
    mockNow = 0
    buffer.enqueue(makePayload('1'))

    // Advance clock 30s, then enqueue 100 more — forces drop of #1.
    mockNow = 30_000
    for (let i = 2; i <= 101; i++) {
      buffer.enqueue(makePayload(String(i)))
    }

    expect(langfuse.trace).toHaveBeenCalledTimes(1)
    const arg = langfuse.trace.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect(arg.metadata.dropped_content_hash).toBe('sha256_1')
    expect(arg.metadata.dropped_age_seconds).toBeGreaterThanOrEqual(30)
  })

  it('Test 7: size() reports current buffer length (capped at BUFFER_CAP)', () => {
    const postIngest = jest.fn(async (): Promise<IngestOutcome> => successOutcome)
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    expect(buffer.size()).toBe(0)
    buffer.enqueue(makePayload('a'))
    expect(buffer.size()).toBe(1)
    buffer.enqueue(makePayload('b'))
    expect(buffer.size()).toBe(2)

    for (let i = 0; i < 200; i++) {
      buffer.enqueue(makePayload(`x${i}`))
    }
    expect(buffer.size()).toBe(BUFFER_CAP)
  })

  it('Test 8: FIFO is preserved across overflow — drain calls start from item #2 after dropping #1', async () => {
    const calls: string[] = []
    const postIngest = jest.fn(async (p: IngestRequest): Promise<IngestOutcome> => {
      calls.push(p.content_hash)
      return successOutcome
    })
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    // Enqueue 101 items — #1 should be dropped, #2..#101 remain.
    for (let i = 1; i <= 101; i++) {
      buffer.enqueue(makePayload(String(i)))
    }

    expect(buffer.size()).toBe(100)
    expect(langfuse.trace).toHaveBeenCalledTimes(1)

    await buffer.drain()

    expect(calls.length).toBe(100)
    expect(calls[0]).toBe('sha256_2') // FIFO head after dropping #1
    expect(calls[99]).toBe('sha256_101') // FIFO tail
  })

  it('Test 9: BUFFER_CAP constant equals 100', () => {
    expect(BUFFER_CAP).toBe(100)
  })

  it('Test 10: concurrent drain() calls are concurrency=1 — second drain returns immediately while first runs', async () => {
    // Manually-controlled deferred promises so we can hold the first drain mid-flight
    // while a second drain is invoked.
    const resolvers: Array<(v: IngestOutcome) => void> = []
    const callOrder: string[] = []
    const postIngest = jest.fn((p: IngestRequest): Promise<IngestOutcome> => {
      callOrder.push(p.content_hash)
      return new Promise<IngestOutcome>((resolve) => {
        resolvers.push(resolve)
      })
    })
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    buffer.enqueue(makePayload('a'))
    buffer.enqueue(makePayload('b'))
    buffer.enqueue(makePayload('c'))

    // Kick off two parallel drains. The second must NOT race the first.
    const drain1 = buffer.drain()
    const drain2 = buffer.drain()

    // Allow microtasks to flush. Only the FIRST postIngest call should be in-flight,
    // because drain2 saw `draining === true` and returned immediately.
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['sha256_a'])

    // drain2 should already be settled (it returned early); awaiting it must not
    // hang and must not have triggered any extra postIngest calls.
    await drain2
    expect(postIngest).toHaveBeenCalledTimes(1)

    // Resolve sequentially — drain1 owns the loop and processes b, then c, in order.
    resolvers[0](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(2)
    expect(callOrder).toEqual(['sha256_a', 'sha256_b'])

    resolvers[1](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(3)
    expect(callOrder).toEqual(['sha256_a', 'sha256_b', 'sha256_c'])

    resolvers[2](successOutcome)
    await drain1
    expect(buffer.size()).toBe(0)

    // After drain1 finishes, a fresh drain() should work normally (guard reset).
    buffer.enqueue(makePayload('d'))
    const drain3 = buffer.drain()
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(4)
    resolvers[3](successOutcome)
    await drain3
    expect(buffer.size()).toBe(0)
  })

  it('Test 11: items enqueued during an in-flight drain are picked up by the same drain — no work lost when concurrent caller is short-circuited', async () => {
    const resolvers: Array<(v: IngestOutcome) => void> = []
    const callOrder: string[] = []
    const postIngest = jest.fn((p: IngestRequest): Promise<IngestOutcome> => {
      callOrder.push(p.content_hash)
      return new Promise<IngestOutcome>((resolve) => {
        resolvers.push(resolve)
      })
    })
    const langfuse = { trace: jest.fn() }
    const buffer = new IngestBuffer({ postIngest, langfuse, now })

    buffer.enqueue(makePayload('a'))
    const drain1 = buffer.drain()
    await Promise.resolve()
    await Promise.resolve()
    expect(postIngest).toHaveBeenCalledTimes(1)

    // Mid-flight: enqueue more items + invoke drain() again. The second drain
    // returns immediately, but the first drain MUST notice the new items in its
    // while-loop check and process them — nothing is lost.
    buffer.enqueue(makePayload('b'))
    buffer.enqueue(makePayload('c'))
    await buffer.drain() // returns immediately due to in-flight guard

    // Allow drain1 to advance: a → b → c in FIFO order.
    resolvers[0](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(callOrder).toEqual(['sha256_a', 'sha256_b'])

    resolvers[1](successOutcome)
    await Promise.resolve()
    await Promise.resolve()
    expect(callOrder).toEqual(['sha256_a', 'sha256_b', 'sha256_c'])

    resolvers[2](successOutcome)
    await drain1
    expect(buffer.size()).toBe(0)
    expect(postIngest).toHaveBeenCalledTimes(3)
  })
})
