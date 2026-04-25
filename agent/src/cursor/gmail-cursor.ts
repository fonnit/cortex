// agent/src/cursor/gmail-cursor.ts — Phase 6 Plan 02 Task 3
// Local-file replacement for the v1.0 Neon "GmailCursor" table.
// Daemon must not touch Neon (DAEMON-01) — cursor lives on the agent's
// filesystem instead, defaulting to `~/.config/cortex/gmail-cursor.json`.
//
// Storage format:
//   {
//     "last_history_id": "12345",
//     "last_successful_poll_at": "2026-04-25T12:34:56.789Z"
//   }
//
// Path can be overridden via env `CORTEX_AGENT_STATE_DIR` (used by tests).

import { mkdir, readFile, writeFile, rename } from 'fs/promises'
import path from 'path'
import os from 'os'

export interface GmailCursor {
  last_history_id: string | null
  last_successful_poll_at: string | null // ISO timestamp
}

function stateDir(): string {
  const fromEnv = process.env.CORTEX_AGENT_STATE_DIR
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.config', 'cortex')
}

function cursorPath(): string {
  return path.join(stateDir(), 'gmail-cursor.json')
}

export async function readCursor(): Promise<GmailCursor | null> {
  try {
    const raw = await readFile(cursorPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      last_history_id:
        typeof parsed.last_history_id === 'string' ? parsed.last_history_id : null,
      last_successful_poll_at:
        typeof parsed.last_successful_poll_at === 'string'
          ? parsed.last_successful_poll_at
          : null,
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.error('[gmail-cursor] read failed:', (err as Error).message)
    return null
  }
}

export async function writeCursor(last_history_id: string): Promise<void> {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 })
  const payload: GmailCursor = {
    last_history_id,
    last_successful_poll_at: new Date().toISOString(),
  }
  const target = cursorPath()
  const tmp = target + '.tmp'
  await writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 })
  await rename(tmp, target)
}
