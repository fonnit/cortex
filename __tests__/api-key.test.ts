/**
 * requireApiKey helper tests
 *
 * Validates the CORTEX_API_KEY shared-secret Bearer auth helper used by
 * /api/ingest, /api/queue, and /api/classify in plans 05-02 / 05-03.
 *
 * Locked decisions (per 05-CONTEXT.md):
 * - Authorization: Bearer ${CORTEX_API_KEY}
 * - Returns null on success, a Response with status 401 + EMPTY body on failure
 * - Fail-closed: 401 when CORTEX_API_KEY is unset (never authorize empty string)
 */

import { requireApiKey, safeEqual } from '../lib/api-key'

const ORIGINAL_KEY = process.env.CORTEX_API_KEY

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers,
  })
}

describe('requireApiKey', () => {
  beforeEach(() => {
    delete process.env.CORTEX_API_KEY
  })

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CORTEX_API_KEY
    } else {
      process.env.CORTEX_API_KEY = ORIGINAL_KEY
    }
  })

  it('returns null when Authorization: Bearer ${CORTEX_API_KEY} matches', () => {
    process.env.CORTEX_API_KEY = 'sekret-token'
    const req = makeRequest({ authorization: 'Bearer sekret-token' })
    expect(requireApiKey(req)).toBeNull()
  })

  it('returns a 401 Response with empty body when Authorization header is missing', async () => {
    process.env.CORTEX_API_KEY = 'sekret-token'
    const req = makeRequest()
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.text()
    expect(body).toBe('')
  })

  it('returns a 401 Response with empty body when token does not match', async () => {
    process.env.CORTEX_API_KEY = 'sekret-token'
    const req = makeRequest({ authorization: 'Bearer wrong-token' })
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.text()
    expect(body).toBe('')
  })

  it('returns a 401 Response when scheme is wrong (Basic instead of Bearer)', async () => {
    process.env.CORTEX_API_KEY = 'sekret-token'
    const req = makeRequest({ authorization: 'Basic sekret-token' })
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.text()
    expect(body).toBe('')
  })

  it('returns a 401 Response when CORTEX_API_KEY env var is unset (fail-closed)', async () => {
    // env var explicitly cleared in beforeEach
    const req = makeRequest({ authorization: 'Bearer anything' })
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.text()
    expect(body).toBe('')
  })

  it('does not authorize an empty Bearer token even if CORTEX_API_KEY is unset', () => {
    // Defense-in-depth: ensure the empty-string trap (`Bearer ` === `Bearer ${''}`) cannot bypass.
    const req = makeRequest({ authorization: 'Bearer ' })
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it('returns 401 for a wrong token of EQUAL length (review fix [4])', async () => {
    // Pre-fix used `!==` which short-circuits on first byte mismatch — leaking
    // length information via timing. After the timingSafeEqual swap, a wrong
    // token of equal length must still 401. Pinning behavior, not timing.
    process.env.CORTEX_API_KEY = 'sekret-token' // 12 chars
    const req = makeRequest({ authorization: 'Bearer wrong-token1' }) // also 12 chars after Bearer
    // Sanity check: payload lengths match
    expect('wrong-token1'.length).toBe('sekret-token'.length)
    const res = requireApiKey(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    expect(await res!.text()).toBe('')
  })
})

describe('safeEqual (constant-time string comparison)', () => {
  // These tests pin BEHAVIOR, not timing — measuring nanosecond-level timing
  // differences inside Jest is unreliable. The point is to confirm the
  // helper still returns the right boolean for the matrix of inputs that
  // matter to auth: equal/unequal, same-length/different-length, empty.

  it('returns true for identical non-empty strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('Bearer sekret-token', 'Bearer sekret-token')).toBe(true)
  })

  it('returns false for different strings of equal length', () => {
    expect(safeEqual('abc', 'xyz')).toBe(false)
    expect(safeEqual('Bearer aaa', 'Bearer bbb')).toBe(false)
  })

  it('returns false for strings of different length (no early-exit timing)', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('Bearer x', 'Bearer xy')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    // Edge case: both inputs empty. This shouldn't happen in the auth path
    // (CORTEX_API_KEY is required), but the helper must behave consistently.
    expect(safeEqual('', '')).toBe(true)
  })

  it('handles UTF-8 multi-byte characters by byte length, not char length', () => {
    // 'é' is 2 bytes in UTF-8; 'a' is 1 byte. Different byte lengths must
    // return false even though both inputs are 1 character.
    expect(safeEqual('é', 'a')).toBe(false)
    // Same multi-byte content compares equal.
    expect(safeEqual('é', 'é')).toBe(true)
  })
})
