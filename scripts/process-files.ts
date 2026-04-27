/**
 * Manual one-shot file processor.
 *
 * Drives the existing daemon + consumer pipeline against an ad-hoc list of
 * file paths, end-to-end (ingest → Stage 1 → Stage 2 → terminal status), then
 * exits. Useful for bootstrapping a base taxonomy without standing up the
 * long-running daemon.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/process-files.ts <file> [<file> ...]
 *   cat /tmp/picks.txt | npx tsx --env-file=.env.local scripts/process-files.ts -
 *
 * Reuses (no service-layer duplication):
 *   - buildPayload  from agent/src/collectors/downloads.ts (sha256 + mime + IngestRequest)
 *   - postIngest    from agent/src/http/client.ts          (retry/backoff to /api/ingest)
 *   - runStage1Worker / runStage2Worker from agent/src/consumer/{stage1,stage2}.ts
 *   - prisma        from lib/prisma.ts                     (status polling)
 *
 * Exits cleanly when every ingested item reaches a terminal status. Non-zero
 * exit if any item ends in 'error' or hits the wall-clock timeout.
 */

import { readFile, stat as fsStat } from 'fs/promises'
import { resolve } from 'path'

import { buildPayload } from '../agent/src/collectors/downloads.js'
import { postIngest } from '../agent/src/http/client.js'
import { runStage1Worker } from '../agent/src/consumer/stage1.js'
import { runStage2Worker } from '../agent/src/consumer/stage2.js'
import { prisma } from '../lib/prisma'
import { QUEUE_STATUSES } from '../lib/queue-config'

/** Statuses that mean "no further work" — Stage 1+2 will not advance them. */
const TERMINAL_STATUSES = new Set<string>([
  QUEUE_STATUSES.IGNORED,
  QUEUE_STATUSES.UNCERTAIN,
  QUEUE_STATUSES.CERTAIN,
  QUEUE_STATUSES.FILED,
  QUEUE_STATUSES.ERROR,
])

/** Hard wall-clock cap so a stuck item can't hang the script forever. */
const WALL_CLOCK_TIMEOUT_MS = 30 * 60 * 1000 // 30 min
/** Status-poll cadence — independent from the worker loops' adaptive 5s/30s. */
const STATUS_POLL_INTERVAL_MS = 5_000

/** Minimal Langfuse stub — workers only use `.trace({ name, metadata })`. */
const lfStub = {
  trace: (_input: { name: string; metadata?: Record<string, unknown> }) => {
    /* no-op — observability runs through the production daemon, not this CLI */
  },
}

async function readPaths(): Promise<string[]> {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    console.error('usage: tsx scripts/process-files.ts <file> [<file> ...]')
    console.error('       tsx scripts/process-files.ts - < paths.txt')
    process.exit(2)
  }
  if (argv.length === 1 && argv[0] === '-') {
    const raw = await readStdin()
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
  }
  return argv
}

function readStdin(): Promise<string> {
  return new Promise((resolveStdin, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (c) => chunks.push(c as Buffer))
    process.stdin.on('end', () => resolveStdin(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

interface IngestResult {
  path: string
  itemId: string | null
  deduped?: boolean
  reason?: string
}

async function ingestOne(filePath: string): Promise<IngestResult> {
  const absolute = resolve(filePath)
  try {
    const st = await fsStat(absolute)
    if (!st.isFile()) {
      return { path: absolute, itemId: null, reason: 'not_a_file' }
    }
  } catch (err) {
    return { path: absolute, itemId: null, reason: `stat_failed: ${(err as Error).message}` }
  }
  const payload = await buildPayload(absolute)
  if (!payload) {
    return { path: absolute, itemId: null, reason: 'buildPayload_returned_null' }
  }
  const outcome = await postIngest(payload)
  if (outcome.kind === 'success') {
    return { path: absolute, itemId: outcome.id, deduped: outcome.deduped }
  }
  if (outcome.kind === 'heartbeat_ack') {
    return { path: absolute, itemId: null, reason: 'unexpected_heartbeat_ack' }
  }
  return {
    path: absolute,
    itemId: null,
    reason: `ingest_skip: ${outcome.reason}${outcome.status ? ` status=${outcome.status}` : ''}`,
  }
}

interface ItemSnapshot {
  id: string
  status: string
  filename: string | null
  axis_type: string | null
  axis_from: string | null
  axis_context: string | null
  proposed_drive_path: string | null
  confirmed_drive_path: string | null
}

async function pollStatuses(ids: string[]): Promise<Map<string, ItemSnapshot>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      filename: true,
      axis_type: true,
      axis_from: true,
      axis_context: true,
      proposed_drive_path: true,
      confirmed_drive_path: true,
    },
  })
  return new Map(rows.map((r) => [r.id, r as ItemSnapshot]))
}

async function waitForTerminal(ids: string[]): Promise<Map<string, ItemSnapshot>> {
  const start = Date.now()
  let lastReport = 0
  while (Date.now() - start < WALL_CLOCK_TIMEOUT_MS) {
    const snap = await pollStatuses(ids)
    const counts: Record<string, number> = {}
    let allTerminal = true
    for (const id of ids) {
      const item = snap.get(id)
      const status = item?.status ?? 'missing'
      counts[status] = (counts[status] ?? 0) + 1
      if (!item || !TERMINAL_STATUSES.has(item.status)) allTerminal = false
    }
    const now = Date.now()
    if (allTerminal || now - lastReport > 15_000) {
      const summary = Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join(' ')
      const elapsed = Math.round((now - start) / 1000)
      console.log(`[process-files]  t+${elapsed}s  ${summary}`)
      lastReport = now
    }
    if (allTerminal) return snap
    await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS))
  }
  console.warn('[process-files] WALL CLOCK TIMEOUT — returning latest snapshot')
  return pollStatuses(ids)
}

async function main(): Promise<void> {
  const paths = await readPaths()
  console.log(`[process-files] ingesting ${paths.length} file(s)…`)

  const ingestResults: IngestResult[] = []
  for (const p of paths) {
    const r = await ingestOne(p)
    ingestResults.push(r)
    if (r.itemId) {
      console.log(`[process-files]   ✓ ${r.deduped ? 'DEDUP' : 'NEW  '} ${r.itemId}  ${r.path}`)
    } else {
      console.log(`[process-files]   ✗ skip       ${r.reason ?? 'unknown'}  ${r.path}`)
    }
  }

  const ids = ingestResults.map((r) => r.itemId).filter((id): id is string => id !== null)
  if (ids.length === 0) {
    console.error('[process-files] no items ingested — exiting')
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log(`[process-files] starting Stage 1 + Stage 2 workers (${ids.length} items in flight)`)
  const stage1 = runStage1Worker({ langfuse: lfStub })
  const stage2 = runStage2Worker({ langfuse: lfStub })

  let snap: Map<string, ItemSnapshot>
  try {
    snap = await waitForTerminal(ids)
  } finally {
    console.log('[process-files] stopping workers…')
    await Promise.allSettled([stage1.stop(), stage2.stop()])
  }

  // Final report.
  console.log('\n[process-files] FINAL STATUSES')
  console.log(
    'id'.padEnd(34) +
      'status'.padEnd(12) +
      'type'.padEnd(20) +
      'from'.padEnd(20) +
      'context'.padEnd(20) +
      'path',
  )
  console.log('-'.repeat(140))
  let errorCount = 0
  for (const id of ids) {
    const item = snap.get(id)
    if (!item) {
      console.log(`${id.padEnd(34)}MISSING`)
      errorCount++
      continue
    }
    if (item.status === QUEUE_STATUSES.ERROR) errorCount++
    console.log(
      id.padEnd(34) +
        item.status.padEnd(12) +
        (item.axis_type ?? '-').padEnd(20) +
        (item.axis_from ?? '-').padEnd(20) +
        (item.axis_context ?? '-').padEnd(20) +
        (item.confirmed_drive_path ?? item.proposed_drive_path ?? '-'),
    )
  }
  console.log('-'.repeat(140))
  console.log(`[process-files] ${ids.length} processed, ${errorCount} in error state`)

  await prisma.$disconnect()
  process.exit(errorCount > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('[process-files] FATAL:', err)
  try {
    await prisma.$disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
