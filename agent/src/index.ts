// agent/src/index.ts — Mac daemon thin-client main loop.
// Phase 6 Plan 02 Task 6 (v1.1).
//
// Discovers files (chokidar + recursive walk) + polls Gmail incrementally,
// and POSTs every discovery to /api/ingest via the in-memory FIFO buffer.
//
// ZERO Neon access, ZERO Drive uploads, ZERO `claude -p` calls — the daemon
// is a thin metadata producer. The Vercel API (Phase 5) and Phase 7 consumers
// own classification, dedup, and Drive lifecycle.

import Langfuse from 'langfuse'

import { startHeartbeat, incrementCounter } from './heartbeat.js'
import { startDownloadsCollector } from './collectors/downloads.js'
import { pollGmail } from './collectors/gmail.js'
import { IngestBuffer } from './http/buffer.js'
import { postIngest } from './http/client.js'
import type { IngestRequest } from './http/types.js'

const REQUIRED_ENV = ['CORTEX_API_URL', 'CORTEX_API_KEY'] as const
const GMAIL_POLL_INTERVAL_MS = 60 * 1000 // 60s — locked CONTEXT decision
const BUFFER_DRAIN_INTERVAL_MS = 5 * 1000 // 5s — periodic drain in normal operation
/**
 * Hard cap on the shutdown drain (MN-06). postIngest's own retry budget is
 * MAX_ATTEMPTS=5 × MAX_DELAY_MS=30s, so a single buffered entry can hold a
 * drain for ~60s+ on a network outage. We cap the orderly shutdown at 5s so
 * launchd doesn't escalate to SIGKILL on `launchctl stop`.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000

export interface BootstrapEnvResult {
  ok: boolean
  missing: string[]
}

/** Pure check — exported for unit tests. */
export function validateBootstrapEnv(): BootstrapEnvResult {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k])
  return { ok: missing.length === 0, missing: [...missing] }
}

/** Bootstraps the daemon. Exits the process with code 1 on missing required env. */
export async function bootstrap(opts?: { langfuse?: Langfuse }): Promise<void> {
  const langfuse =
    opts?.langfuse ??
    new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
      flushAt: 5,
      flushInterval: 30_000,
    })

  const envCheck = validateBootstrapEnv()
  if (!envCheck.ok) {
    const msg = `[cortex] FATAL: missing required env: ${envCheck.missing.join(', ')}`
    console.error(msg)
    try {
      langfuse.trace({
        name: 'daemon_bootstrap_fatal',
        metadata: { missing: envCheck.missing },
      })
      await langfuse.flushAsync()
    } catch {
      /* ignore flush errors at exit */
    }
    process.exit(1)
    return // unreachable in real run; helps test paths that mock process.exit
  }

  // Wire the buffer to the HTTP client.
  const buffer = new IngestBuffer({
    postIngest: (payload: IngestRequest) => postIngest(payload, { langfuse }),
    langfuse,
  })

  // Start dual heartbeat.
  const stopHeartbeat = startHeartbeat(langfuse)

  // Periodic drain — sequential. The buffer's drain is concurrency=1 internally,
  // so concurrent calls are a no-op once the loop is running.
  const drainTimer = setInterval(() => {
    buffer.drain().catch((err) => {
      langfuse.trace({
        name: 'buffer_drain_unexpected_error',
        metadata: { error: String(err) },
      })
    })
  }, BUFFER_DRAIN_INTERVAL_MS)

  // Downloads collector — pushes payloads to the buffer.
  const stopDownloads = startDownloadsCollector(langfuse, (payload) => {
    incrementCounter('files_seen')
    buffer.enqueue(payload)
    // Trigger an immediate drain in normal operation.
    buffer.drain().catch(() => {})
    incrementCounter('files_posted')
  })

  // Gmail poll — every 60s.
  const gmailPoll = async () => {
    try {
      await pollGmail(langfuse, (payload) => {
        buffer.enqueue(payload)
        buffer.drain().catch(() => {})
        incrementCounter('gmail_messages_posted')
      })
    } catch (err) {
      langfuse.trace({ name: 'gmail_poll_error', metadata: { error: String(err) } })
    }
  }
  void gmailPoll()
  const gmailTimer = setInterval(gmailPoll, GMAIL_POLL_INTERVAL_MS)

  console.log('[cortex] daemon started (thin client, v1.1)')
  langfuse.trace({
    name: 'daemon_start',
    metadata: { pid: process.pid, version: '0.1.1' },
  })

  // Shutdown sequence (MN-06):
  //   1. Stop all timers + watchers so no NEW work is enqueued.
  //   2. Best-effort drain of the buffer with a hard cap — anything we can
  //      flush before launchd's SIGKILL escalation gets POSTed; anything we
  //      can't will be rediscovered on the next chokidar startup scan or the
  //      next gmail historyId-based incremental sync.
  //   3. Flush Langfuse so any traces queued during shutdown actually ship.
  //
  // Idempotent — guarded by `shuttingDown` so a double signal (SIGTERM ->
  // SIGINT or vice-versa) doesn't run the sequence twice.
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(drainTimer)
    clearInterval(gmailTimer)
    stopHeartbeat()
    stopDownloads()
    try {
      await Promise.race([
        buffer.drain(),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)),
      ])
    } catch {
      /* drain catches its own errors; defensive */
    }
    try {
      await langfuse.flushAsync()
    } catch {
      /* ignore */
    }
  }

  // Signal handlers — moved here from heartbeat.ts (MN-06) so the orderly
  // sequence above runs before the process exits. launchd sends SIGTERM on
  // `launchctl stop`; SIGINT covers manual `Ctrl-C` foreground runs.
  const onSignal = (signal: NodeJS.Signals) => {
    void (async () => {
      try {
        await shutdown()
      } finally {
        // Use the conventional 128 + signal-number exit code so launchd
        // understands the exit was signal-driven (not a crash).
        const code = signal === 'SIGINT' ? 130 : 0
        process.exit(code)
      }
    })()
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))

  process.on('uncaughtException', async (err) => {
    langfuse.trace({ name: 'daemon_uncaught_error', metadata: { error: err.message } })
    await shutdown()
    process.exit(1)
  })
}

// Auto-start when invoked directly (the launchd plist runs this file).
// Skip auto-start under jest — JEST_WORKER_ID is always set inside jest workers.
const isTest = process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test'
if (!isTest) {
  bootstrap().catch((err) => {
    console.error('[cortex] bootstrap threw:', err)
    process.exit(1)
  })
}
