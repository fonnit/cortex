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

import { requireApiKey } from '../lib/api-key'

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
})
