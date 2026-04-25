#!/usr/bin/env node
// scripts/acc/gmail-backfill.mjs — Phase 8 Plan 01 Task 2
//
// ACC-02: rewind the Gmail historyId so the daemon backfills ~6 months
// of email; watch the consumer log drain. Writes the cursor file
// directly at ~/.config/cortex/gmail-cursor.json (or wherever
// CORTEX_AGENT_STATE_DIR points). Reproduces the Phase 6 cursor JSON
// shape — we do NOT import agent/src/cursor/gmail-cursor.ts so Phase 6
// stays sealed (CONTEXT D-01).
//
// Usage:
//   node scripts/acc/gmail-backfill.mjs --clear            # delete cursor → daemon full-syncs (ING-06)
//   node scripts/acc/gmail-backfill.mjs --history-id N     # explicit rewind
//   node scripts/acc/gmail-backfill.mjs --clear --watch    # then tail consumer log until 5min idle
//   node scripts/acc/gmail-backfill.mjs --rewind=6mo       # prints guidance, exits 2
//   node scripts/acc/gmail-backfill.mjs --dry-run
//   node scripts/acc/gmail-backfill.mjs --help

import { mkdir, writeFile, unlink, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  printHelp()
  process.exit(0)
}
if (args.dryRun) {
  console.log('[DRY-RUN] Would manipulate ~/.config/cortex/gmail-cursor.json')
  console.log('[DRY-RUN] Mode options:')
  console.log('[DRY-RUN]   --clear         delete cursor → daemon full-sync fallback (ING-06)')
  console.log('[DRY-RUN]   --history-id N  explicit rewind to a known older historyId')
  console.log('[DRY-RUN]   --watch         after write, tail /tmp/cortex-consumer.log until 5min idle')
  console.log('[DRY-RUN] After write: Gmail backfill drains through consumer; PASS = idle 5min consecutively')
  console.log('[DRY-RUN] OK')
  process.exit(0)
}

const stateDir =
  process.env.CORTEX_AGENT_STATE_DIR ??
  path.join(os.homedir(), '.config', 'cortex')
const cursorPath = path.join(stateDir, 'gmail-cursor.json')

if (args.rewind === '6mo') {
  console.error(
    '--rewind=6mo: Gmail historyIds are opaque monotonic counters; the API does NOT compute "6 months ago".',
  )
  console.error(
    'Use --clear (full-sync fallback per ING-06) or --history-id N (look up an old id manually — see RUNBOOK §C).',
  )
  process.exit(2)
}

if (args.clear) {
  try {
    await unlink(cursorPath)
    console.log(
      `Cleared cursor at ${cursorPath}; next daemon poll will full-sync (ING-06).`,
    )
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`No cursor at ${cursorPath} — already clear.`)
    } else {
      throw err
    }
  }
} else if (args.historyId) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  // Phase 6 cursor JSON shape (agent/src/cursor/gmail-cursor.ts):
  //   { last_history_id: string, last_successful_poll_at: string }
  const payload = {
    last_history_id: String(args.historyId),
    last_successful_poll_at: new Date().toISOString(),
  }
  const tmp = cursorPath + '.tmp'
  await writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 })
  await rename(tmp, cursorPath)
  console.log(
    `Wrote ${cursorPath} with last_history_id=${args.historyId} (mode 0600)`,
  )
} else if (!args.watch) {
  console.error('Pass --clear, --history-id N, --watch, --rewind=6mo, --dry-run, or --help.')
  process.exit(2)
}

if (args.watch) {
  console.log(
    'Watching /tmp/cortex-consumer.log for Gmail drain (5min idle = done) …',
  )
  await watchDrain('/tmp/cortex-consumer.log', 5 * 60 * 1000)
  console.log('PASS ACC-02 (gmail-backfill) — consumer log idle for 5 minutes')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help') out.help = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--clear') out.clear = true
    else if (a === '--watch') out.watch = true
    else if (a === '--history-id') out.historyId = argv[++i]
    else if (a.startsWith('--rewind=')) out.rewind = a.slice('--rewind='.length)
  }
  return out
}

function printHelp() {
  console.log(
    'Usage: gmail-backfill.mjs [--clear | --history-id N | --rewind=6mo] [--watch] [--dry-run | --help]',
  )
  console.log('')
  console.log('  --clear         delete cursor; daemon full-syncs on next poll (ING-06)')
  console.log('  --history-id N  explicit rewind to a known older historyId')
  console.log('  --rewind=6mo    prints why this is not API-computable; exits 2')
  console.log('  --watch         tail /tmp/cortex-consumer.log; exit when idle 5 min')
  console.log('  --dry-run       print what would happen, no FS changes')
  console.log('')
  console.log('Cursor file shape (matches agent/src/cursor/gmail-cursor.ts):')
  console.log('  { "last_history_id": "12345", "last_successful_poll_at": "<ISO>" }')
  console.log('Path: $CORTEX_AGENT_STATE_DIR/gmail-cursor.json (default ~/.config/cortex/)')
}

/**
 * Cheap operator-grade drain detector: poll the log mtime; if mtime
 * hasn't advanced for `idleMs` consecutively, we declare drain.
 */
async function watchDrain(logPath, idleMs) {
  while (true) {
    try {
      const s = await stat(logPath)
      const sinceWrite = Date.now() - s.mtimeMs
      if (sinceWrite > idleMs) return
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      // No log yet — wait and try again.
    }
    await sleep(30_000)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
