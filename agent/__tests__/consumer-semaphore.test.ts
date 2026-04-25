/**
 * Semaphore tests — Phase 7 Plan 01, Task 1.
 *
 * Mirrors the bullets in the plan's <behavior> block:
 *   - new Semaphore(2): two acquires resolve immediately, third pends.
 *   - release() is idempotent.
 *   - FIFO ordering preserved across the queue.
 *   - Constructor rejects bad capacity.
 */

import { Semaphore } from '../src/consumer/semaphore'

describe('Semaphore', () => {
  describe('constructor', () => {
    it('rejects zero capacity', () => {
      expect(() => new Semaphore(0)).toThrow(/positive integer/)
    })
    it('rejects negative capacity', () => {
      expect(() => new Semaphore(-1)).toThrow(/positive integer/)
    })
    it('rejects NaN / Infinity', () => {
      expect(() => new Semaphore(NaN)).toThrow(/positive integer/)
      expect(() => new Semaphore(Infinity)).toThrow(/positive integer/)
    })
    it('floors fractional capacity', () => {
      const s = new Semaphore(2.9)
      expect(s.available).toBe(2)
    })
  })

  it('Semaphore(2): two acquires resolve immediately, third pends until release', async () => {
    const sem = new Semaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    expect(sem.available).toBe(0)

    let acquired3 = false
    const p3 = sem.acquire().then((r) => {
      acquired3 = true
      return r
    })

    // Yield once; the third acquire must NOT have resolved yet.
    await Promise.resolve()
    expect(acquired3).toBe(false)
    expect(sem.pending).toBe(1)

    // Release the first slot — the third acquire should resolve.
    r1()
    const r3 = await p3
    expect(acquired3).toBe(true)
    expect(sem.pending).toBe(0)
    r2()
    r3()
  })

  it('release is idempotent — second call does NOT inflate capacity', async () => {
    const sem = new Semaphore(1)
    const release = await sem.acquire()
    release()
    release()
    release()
    expect(sem.available).toBe(1)
  })

  it('release from a rejected handler still frees the slot', async () => {
    const sem = new Semaphore(1)
    const release = await sem.acquire()

    // Simulate using the slot inside a try/finally that throws.
    await Promise.resolve()
      .then(() => {
        throw new Error('work failed')
      })
      .catch(() => {
        // finally analogue
        release()
      })

    // Slot must now be free for a fresh acquire.
    const r2 = await sem.acquire()
    expect(sem.available).toBe(0)
    r2()
    expect(sem.available).toBe(1)
  })

  it('preserves FIFO ordering for queued waiters', async () => {
    const sem = new Semaphore(1)
    const r1 = await sem.acquire()

    const order: number[] = []
    const p2 = sem.acquire().then((r) => {
      order.push(2)
      return r
    })
    const p3 = sem.acquire().then((r) => {
      order.push(3)
      return r
    })
    const p4 = sem.acquire().then((r) => {
      order.push(4)
      return r
    })

    r1()
    const r2 = await p2
    r2()
    const r3 = await p3
    r3()
    const r4 = await p4
    r4()

    expect(order).toEqual([2, 3, 4])
  })

  it('caps concurrency under heavy parallel load', async () => {
    const sem = new Semaphore(3)
    let active = 0
    let max = 0

    const work = async () => {
      const release = await sem.acquire()
      try {
        active += 1
        max = Math.max(max, active)
        await new Promise((r) => setTimeout(r, 5))
      } finally {
        active -= 1
        release()
      }
    }

    await Promise.all(Array.from({ length: 20 }, () => work()))
    expect(max).toBe(3)
  })
})
