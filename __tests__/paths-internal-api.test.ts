/**
 * GET /api/paths/internal — quick task 260427-h9w, Task 1.
 *
 * Validates the parent-paths dump endpoint that Stage 2 fetches each batch:
 *   - 401 with empty body when Authorization is missing/wrong (mirrors
 *     /api/taxonomy/internal posture; see T-h9w-01).
 *   - 200 + { paths: [{ parent, count }] } sorted by count desc on success.
 *   - Filters: status='filed' AND confirmed_drive_path IS NOT NULL.
 *   - Top-N cap: at most MAX_PATHS_RETURNED (50) entries.
 *   - Cache-Control: no-store on success.
 *   - Module exports ONLY GET.
 *   - Empty result = { paths: [] }, 200.
 *   - 500 returns plain "Internal Server Error".
 *   - Where clause does NOT include user_id (matches taxonomy/internal posture
 *     for now; documented as v1.2 follow-up).
 */

// Mock prisma BEFORE importing the route. The paths route only uses
// prisma.item.findMany — stub just that.
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '../lib/prisma'
import { GET } from '../app/api/paths/internal/route'

const mockFindMany = prisma.item.findMany as jest.MockedFunction<
  typeof prisma.item.findMany
>

const ORIGINAL_KEY = process.env.CORTEX_API_KEY

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/paths/internal', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/paths/internal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CORTEX_API_KEY = 'sekret-token'
  })

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CORTEX_API_KEY
    } else {
      process.env.CORTEX_API_KEY = ORIGINAL_KEY
    }
  })

  it('Test 1: returns 401 with EMPTY body when Authorization header is missing — no DB call', async () => {
    const res = await GET(makeReq() as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 1b: returns 401 with EMPTY body when Bearer token is wrong — no DB call', async () => {
    const res = await GET(makeReq({ authorization: 'Bearer wrong-token' }) as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 2: bucketed parents (drop-after-last-/) with count, sorted desc', async () => {
    mockFindMany.mockResolvedValueOnce([
      { confirmed_drive_path: '/fonnit/invoices/2024/jan-acme.pdf' },
      { confirmed_drive_path: '/fonnit/invoices/2024/feb-acme.pdf' },
      { confirmed_drive_path: '/fonnit/invoices/2024/mar-acme.pdf' },
      { confirmed_drive_path: '/foo/file.pdf' },
      { confirmed_drive_path: '/file.pdf' },
    ] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      paths: [
        { parent: '/fonnit/invoices/2024/', count: 3 },
        { parent: '/foo/', count: 1 },
        { parent: '/', count: 1 },
      ],
    })
  })

  it('Test 3: filter — passes where: { status: "filed", confirmed_drive_path: { not: null } }', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const call = mockFindMany.mock.calls[0][0] as {
      where: { status: string; confirmed_drive_path: { not: null } }
    }
    expect(call.where).toEqual({
      status: 'filed',
      confirmed_drive_path: { not: null },
    })
  })

  it('Test 4: caps results at MAX_PATHS_RETURNED=50, dropping lower-count parents', async () => {
    // Build 60 unique parents with descending counts: parent_0 has 60 items,
    // parent_1 has 59, ..., parent_59 has 1. After cap+sort, only top 50 should
    // survive — i.e. parent_0..parent_49.
    const rows: Array<{ confirmed_drive_path: string }> = []
    for (let i = 0; i < 60; i++) {
      const count = 60 - i
      for (let j = 0; j < count; j++) {
        rows.push({ confirmed_drive_path: `/p${i}/f${j}.pdf` })
      }
    }
    mockFindMany.mockResolvedValueOnce(rows as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { paths: Array<{ parent: string; count: number }> }
    expect(body.paths).toHaveLength(50)
    // Sorted desc by count
    expect(body.paths[0]).toEqual({ parent: '/p0/', count: 60 })
    expect(body.paths[49]).toEqual({ parent: '/p49/', count: 11 })
    // Lower-count parents dropped
    const parentsReturned = new Set(body.paths.map((p) => p.parent))
    expect(parentsReturned.has('/p59/')).toBe(false)
  })

  it('Test 5: sets Cache-Control: no-store on success', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('Test 6: module exports ONLY a GET handler — no POST/PATCH/DELETE/PUT', async () => {
    const mod = await import('../app/api/paths/internal/route')
    const exports = Object.keys(mod).filter((k) => k !== 'default')
    expect(exports).toEqual(['GET'])
  })

  it('Test 7: returns 500 plain "Internal Server Error" on unexpected DB error', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('connection lost'))

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toBe('Internal Server Error')
  })

  it('Test 8: empty result → returns { paths: [] } with 200', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ paths: [] })
  })

  it('Test 9: where clause does NOT include user_id (matches taxonomy/internal posture for now)', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    const call = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(Object.prototype.hasOwnProperty.call(call.where, 'user_id')).toBe(false)
  })
})
