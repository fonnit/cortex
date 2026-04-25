/**
 * agent/src/cursor/gmail-cursor.ts unit tests — Phase 6 Plan 02 Task 3
 *
 * Replaces v1.0's Neon "GmailCursor" table with a local file at
 * `${CORTEX_AGENT_STATE_DIR}/gmail-cursor.json` (defaults to
 * `~/.config/cortex/`).
 *
 * Tests use a per-test tmpdir for the state dir so they don't pollute
 * the developer's real `~/.config/cortex/`.
 */

import { mkdtemp, rm, writeFile, stat, readFile } from 'fs/promises'
import path from 'path'
import os from 'os'

import { readCursor, writeCursor } from '../src/cursor/gmail-cursor'

let stateDir = ''

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(os.tmpdir(), 'cortex-cursor-test-'))
  process.env.CORTEX_AGENT_STATE_DIR = stateDir
})

afterEach(async () => {
  delete process.env.CORTEX_AGENT_STATE_DIR
  await rm(stateDir, { recursive: true, force: true }).catch(() => {})
})

describe('agent/src/cursor/gmail-cursor', () => {
  it('Test 1: readCursor returns null when the cursor file does not exist', async () => {
    const c = await readCursor()
    expect(c).toBeNull()
  })

  it('Test 2: writeCursor then readCursor round-trips the historyId with a recent ISO timestamp', async () => {
    const before = Date.now()
    await writeCursor('123456')
    const c = await readCursor()
    expect(c).not.toBeNull()
    expect(c!.last_history_id).toBe('123456')
    expect(c!.last_successful_poll_at).toBeTruthy()
    const ts = Date.parse(c!.last_successful_poll_at!)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('Test 3: cursor file path uses CORTEX_AGENT_STATE_DIR + gmail-cursor.json with mode 0600', async () => {
    await writeCursor('hid-789')
    const expected = path.join(stateDir, 'gmail-cursor.json')
    const st = await stat(expected)
    expect(st.isFile()).toBe(true)
    // POSIX permission bits — strip the file-type bits, keep the lower 9.
    expect(st.mode & 0o777).toBe(0o600)
    const raw = await readFile(expected, 'utf8')
    expect(JSON.parse(raw).last_history_id).toBe('hid-789')
  })

  it('Test 4: writeCursor overwrites prior content atomically', async () => {
    await writeCursor('first')
    await writeCursor('second')
    const c = await readCursor()
    expect(c!.last_history_id).toBe('second')
  })

  it('Test 5: readCursor returns null on malformed JSON without throwing', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const cursorFile = path.join(stateDir, 'gmail-cursor.json')
    await writeFile(cursorFile, 'not json{{{', { mode: 0o600 })
    const c = await readCursor()
    expect(c).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
