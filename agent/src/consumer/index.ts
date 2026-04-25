// agent/src/consumer/index.ts — Cortex consumer process entry point.
// Phase 7 Plan 02 Task 3 (v1.1).
//
// SEPARATE process from agent/src/index.ts (the daemon). Started by
// agent/launchd/com.cortex.consumer.plist. Runs Stage 1 (limit=10,
// concurrency=10) and Stage 2 (limit=2, concurrency=2) worker loops in
// parallel, draining /api/queue end-to-end.
//
// ZERO Neon access (HTTP only via /api/queue + /api/classify), ZERO Drive
// calls. Two-pool architecture per CONTEXT D-process-layout.
//
// Bootstrap contract (D-claude-not-on-path-exit-1):
//   1. validate required env vars (CORTEX_API_URL, CORTEX_API_KEY,
//      LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY) — exit 1 if any missing.
//   2. assertClaudeOnPath() — exit 1 if claude CLI is not resolvable.
//   3. Start Stage 1 + Stage 2 workers (independent loops).
//   4. Install SIGTERM / SIGINT handlers — orderly drain on shutdown.

import Langfuse from 'langfuse'
import { assertClaudeOnPath } from './claude.js'
import { runStage1Worker } from './stage1.js'
import { runStage2Worker } from './stage2.js'

const REQUIRED_ENV = [
  'CORTEX_API_URL',
  'CORTEX_API_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
] as const

/**
 * Hard cap on the shutdown drain. Stage 1's invokeClaude has its own 120s
 * timeout, so a single in-flight item can hold the drain for that long. We
 * cap orderly shutdown at 5s so launchd's SIGKILL escalation never fires
 * during normal restarts (in-flight items will be reclaimed by the queue's
 * stale-claim path on next poll cycle).
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000

export interface BootstrapEnvResult {
  ok: boolean
  missing: string[]
}

/** Pure check — exported for unit tests. */
export function validateConsumerEnv(): BootstrapEnvResult {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k])
  return { ok: missing.length === 0, missing: [...missing] }
}

export interface BootstrapOpts {
  langfuse?: Langfuse
  /** DI seam — defaults to runStage1Worker. */
  runStage1?: typeof runStage1Worker
  /** DI seam — defaults to runStage2Worker. */
  runStage2?: typeof runStage2Worker
  /** DI seam — defaults to assertClaudeOnPath. */
  assertClaudeOnPathImpl?: typeof assertClaudeOnPath
}

/**
 * Bootstraps the consumer process. Exits with code 1 on missing required env
 * or if `claude` is not on PATH. Otherwise starts both worker loops and
 * installs signal handlers, then resolves.
 */
export async function bootstrapConsumer(opts?: BootstrapOpts): Promise<void> {
  const langfuse =
    opts?.langfuse ??
    new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
      flushAt: 5,
      flushInterval: 30_000,
    })

  // ── 1) Required env ────────────────────────────────────────────────────
  const envCheck = validateConsumerEnv()
  if (!envCheck.ok) {
    const msg = `[cortex-consumer] FATAL: missing required env: ${envCheck.missing.join(', ')}`
    console.error(msg)
    try {
      langfuse.trace({
        name: 'consumer_bootstrap_fatal',
        metadata: { reason: 'missing_env', missing: envCheck.missing },
      })
      await langfuse.flushAsync()
    } catch {
      /* ignore */
    }
    process.exit(1)
    return // unreachable; helps test paths that mock process.exit
  }

  // ── 2) `claude` on PATH ────────────────────────────────────────────────
  try {
    await (opts?.assertClaudeOnPathImpl ?? assertClaudeOnPath)()
  } catch (err) {
    const msg = `[cortex-consumer] FATAL: ${(err as Error).message}`
    console.error(msg)
    try {
      langfuse.trace({
        name: 'consumer_bootstrap_fatal',
        metadata: { reason: 'claude_cli_missing', error: String(err) },
      })
      await langfuse.flushAsync()
    } catch {
      /* ignore */
    }
    process.exit(1)
    return
  }

  // ── 3) Start both worker loops ─────────────────────────────────────────
  const stage1 = (opts?.runStage1 ?? runStage1Worker)({ langfuse })
  const stage2 = (opts?.runStage2 ?? runStage2Worker)({ langfuse })

  langfuse.trace({
    name: 'consumer_start',
    metadata: { pid: process.pid, version: '0.1.1' },
  })
  console.log('[cortex-consumer] started (Stage 1 + Stage 2 pools running)')

  // ── 4) Signal handlers — orderly drain on SIGTERM/SIGINT ───────────────
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await Promise.race([
        Promise.all([stage1.stop(), stage2.stop()]),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)),
      ])
    } catch {
      /* defensive — stop() catches its own errors */
    }
    try {
      await langfuse.flushAsync()
    } catch {
      /* ignore */
    }
  }

  const onSignal = (signal: NodeJS.Signals): void => {
    void (async () => {
      try {
        await shutdown()
      } finally {
        const code = signal === 'SIGINT' ? 130 : 0
        process.exit(code)
      }
    })()
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('uncaughtException', (err: Error) => {
    void (async () => {
      try {
        langfuse.trace({
          name: 'consumer_uncaught_error',
          metadata: { error: err.message },
        })
      } catch {
        /* ignore */
      }
      await shutdown()
      process.exit(1)
    })()
  })
}

// Auto-start when invoked directly (the launchd plist runs this file).
// Skip auto-start under jest — JEST_WORKER_ID is always set inside jest workers.
const isTest = process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test'
if (!isTest) {
  bootstrapConsumer().catch((err) => {
    console.error('[cortex-consumer] bootstrap threw:', err)
    process.exit(1)
  })
}
