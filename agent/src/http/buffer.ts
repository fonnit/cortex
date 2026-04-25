/**
 * Daemon in-memory FIFO buffer (Phase 6 Plan 01, Task 3).
 *
 * Connectivity-loss resilience: when the daemon can't reach `/api/ingest`, new
 * discoveries land here instead of being dropped. The buffer drains in FIFO
 * order on the next successful POST.
 *
 * CONTEXT decisions enforced:
 * - Cap = 100. On overflow, drop the OLDEST entry + emit Langfuse warning
 *   (`buffer_overflow` with `buffer_size`, `dropped_content_hash`,
 *   `dropped_age_seconds`).
 * - Drain is sequential (concurrency = 1) — avoid hammering the API on reconnect.
 * - No persistence. Discoveries dropped here will be rediscovered via chokidar
 *   re-watch or the startup recursive scan; that's the recovery model.
 *
 * Dependency injection: `postIngest` and `langfuse` are passed in by the caller
 * (Plan 02's main loop). The buffer never imports the real client module so
 * unit tests can stay pure.
 */

import type { IngestRequest, IngestOutcome } from './types'

/** Maximum number of pending entries. Locked at 100 per CONTEXT D-buffer-overflow. */
export const BUFFER_CAP = 100

/** Minimal Langfuse contract — only `.trace()` is called. */
interface LangfuseLike {
  trace(input: { name: string; metadata?: Record<string, unknown> }): unknown
}

/** A queued ingest payload paired with the wall-clock time it landed in the buffer. */
export interface BufferEntry {
  payload: IngestRequest
  enqueued_at_ms: number
}

export interface IngestBufferDeps {
  /** Function the buffer will call sequentially on each entry during drain. */
  postIngest: (payload: IngestRequest) => Promise<IngestOutcome>
  /** Langfuse instance used for overflow + drain-error warnings. */
  langfuse: LangfuseLike
  /** Optional injectable clock for deterministic testing. Defaults to `Date.now`. */
  now?: () => number
}

/**
 * In-memory FIFO buffer of pending `IngestRequest` payloads.
 *
 * Threading note: this is single-process JS, so "concurrency = 1" simply means
 * we await each `postIngest` call before pulling the next entry. There's no
 * mutex needed.
 */
export class IngestBuffer {
  private queue: BufferEntry[] = []
  /**
   * In-flight guard for `drain()` — enforces concurrency = 1 across overlapping
   * callers. The 5s drain timer, downloads `add` callback, and gmail message
   * callback all invoke `buffer.drain()` independently; without this guard two
   * drains could shift entries off the queue interleaved and issue parallel
   * `postIngest` calls, violating the documented "1 POST at a time" contract
   * (CONTEXT D-buffer-overflow). Mirrors the `pingInFlight` pattern in
   * heartbeat.ts.
   */
  private draining = false

  constructor(private deps: IngestBufferDeps) {}

  /** Current pending count, capped at BUFFER_CAP. */
  size(): number {
    return this.queue.length
  }

  /**
   * Add an ingest payload to the tail of the queue.
   *
   * If the queue is already at BUFFER_CAP, the OLDEST entry (head) is dropped
   * to make room — and a Langfuse warning is emitted with telemetry about the
   * dropped entry's age. The new payload always lands at the tail.
   */
  enqueue(payload: IngestRequest): void {
    if (this.queue.length >= BUFFER_CAP) {
      const dropped = this.queue.shift()!
      const dropped_age_seconds = Math.floor((this.now() - dropped.enqueued_at_ms) / 1000)
      this.deps.langfuse.trace({
        name: 'buffer_overflow',
        metadata: {
          buffer_size: BUFFER_CAP,
          dropped_content_hash: dropped.payload.content_hash,
          dropped_age_seconds,
        },
      })
    }
    this.queue.push({ payload, enqueued_at_ms: this.now() })
  }

  /**
   * Drain the queue sequentially, one POST at a time.
   *
   * - Each entry is awaited before the next one is started (concurrency = 1).
   * - `postIngest` is expected to never throw on transport errors (the client
   *   returns `{ kind: 'skip' }` instead). If it does throw defensively, we
   *   emit a `buffer_drain_error` Langfuse warning and continue with the next
   *   entry — never let a single bad payload stall the loop.
   * - Both `success` and `skip` outcomes are treated as "drained": the entry
   *   is removed from the queue and we move on. The client owns its own
   *   terminal-skip telemetry (`http_client_terminal_skip`).
   */
  async drain(): Promise<void> {
    // Concurrency-1 guard: if a previous `drain()` invocation is still running
    // we return immediately so the active drain processes the queue (including
    // anything newly enqueued while it was running). This is safe because the
    // active drain re-checks `this.queue.length > 0` on every iteration.
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift()!
        try {
          await this.deps.postIngest(entry.payload)
        } catch (err) {
          // Defensive: client should not throw, but if it does, log and continue.
          this.deps.langfuse.trace({
            name: 'buffer_drain_error',
            metadata: {
              content_hash: entry.payload.content_hash,
              error: err instanceof Error ? err.message : String(err),
            },
          })
        }
      }
    } finally {
      this.draining = false
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
