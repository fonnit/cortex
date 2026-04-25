/**
 * Inline counting semaphore — caps concurrent async operations.
 *
 * Phase 7 Plan 01, Task 1. CONTEXT decisions enforced:
 *   - No new deps (~30 lines).
 *   - acquire() resolves to a release function.
 *   - release is idempotent (calling twice is a no-op) so a try/finally that
 *     also runs in a rejected handler can't double-free.
 *   - Pending acquires are served FIFO so a flood of waiters doesn't starve
 *     the earliest caller.
 *
 * Usage:
 *   const sem = new Semaphore(3);
 *   const release = await sem.acquire();
 *   try {
 *     // critical section: at most 3 concurrent here
 *   } finally {
 *     release();
 *   }
 */
export class Semaphore {
  private free: number
  private waiters: Array<() => void> = []

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new Error(`Semaphore capacity must be a positive integer, got ${capacity}`)
    }
    this.free = Math.floor(capacity)
  }

  /**
   * Acquire one permit. Resolves immediately if a permit is free, otherwise
   * queues until one is released. The returned release function is idempotent.
   */
  async acquire(): Promise<() => void> {
    if (this.free > 0) {
      this.free -= 1
      return this.makeRelease()
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(this.makeRelease()))
    })
  }

  private makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next) {
        // Hand the permit straight to the next waiter (no free-then-grab race).
        next()
      } else {
        this.free += 1
      }
    }
  }

  /** Number of permits not currently held. Test-only observability. */
  get available(): number {
    return this.free
  }

  /** Number of acquires waiting on a permit. Test-only observability. */
  get pending(): number {
    return this.waiters.length
  }
}
