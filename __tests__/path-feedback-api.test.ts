/**
 * GET /api/path-feedback — quick task 260428-lx4, Task 1.
 *
 * Validates the path-feedback endpoint (user-move signal derived from the
 * row-level diff between proposed_drive_path and confirmed_drive_path on
 * filed items). Per planner D1: no PathCorrection table, derive in JS.
 *   - 401 with empty body when Authorization is missing/wrong (T-lx4-03).
 *   - 400 when `since` is provided but un-parseable.
 *   - 200 + { feedback: [...] } sorted by ingested_at desc.
 *   - Default since = now - 30d, default limit = 20, hard cap 50.
 *   - Cache-Control: no-store on success.
 *   - Module exports ONLY GET.
 *   - 500 returns plain "Internal Server Error".
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '../lib/prisma'
import { GET } from '../app/api/path-feedback/route'

const mockFindMany = prisma.item.findMany as jest.MockedFunction<
  typeof prisma.item.findMany
>

const ORIGINAL_KEY = process.env.CORTEX_API_KEY

function makeReq(
  query: string = '',
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/path-feedback${query}`, {
    method: 'GET',
    headers,
  })
}

const AUTH_OK = { authorization: 'Bearer sekret-token' }

describe('GET /api/path-feedback', () => {
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

  it('Test 2: returns 401 with EMPTY body when Bearer token is wrong', async () => {
    const res = await GET(
      makeReq('', { authorization: 'Bearer wrong' }) as never,
    )
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 3: passes where { status: "filed", confirmed_drive_path: { not: null }, proposed_drive_path: { not: null }, ingested_at: { gte: <since> } }, orderBy desc, take = limit', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    const since = '2026-04-01T00:00:00.000Z'
    await GET(makeReq(`?since=${since}&limit=10`, AUTH_OK) as never)

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const call = mockFindMany.mock.calls[0]![0] as {
      where: {
        status: string
        confirmed_drive_path: { not: null }
        proposed_drive_path: { not: null }
        ingested_at: { gte: Date }
      }
      orderBy: { ingested_at: 'desc' }
      take: number
    }
    expect(call.where.status).toBe('filed')
    expect(call.where.confirmed_drive_path).toEqual({ not: null })
    expect(call.where.proposed_drive_path).toEqual({ not: null })
    expect(call.where.ingested_at.gte instanceof Date).toBe(true)
    expect(call.where.ingested_at.gte.toISOString()).toBe(since)
    expect(call.orderBy).toEqual({ ingested_at: 'desc' })
    expect(call.take).toBe(10)
  })

  it('Test 4: filters out rows where proposed === confirmed; returns { feedback: [{ from_path, to_path, item_filename, occurred_at }] }', async () => {
    const ingested = new Date('2026-04-20T00:00:00Z')
    mockFindMany.mockResolvedValueOnce([
      {
        filename: 'moved.pdf',
        proposed_drive_path: '/auto/moved.pdf',
        confirmed_drive_path: '/manual/moved.pdf',
        ingested_at: ingested,
      },
      {
        // identical → must be filtered out
        filename: 'same.pdf',
        proposed_drive_path: '/x/same.pdf',
        confirmed_drive_path: '/x/same.pdf',
        ingested_at: ingested,
      },
    ] as never)

    const res = await GET(makeReq('', AUTH_OK) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      feedback: [
        {
          from_path: '/auto/moved.pdf',
          to_path: '/manual/moved.pdf',
          item_filename: 'moved.pdf',
          occurred_at: ingested.toISOString(),
        },
      ],
    })
  })

  it('Test 5: default `since` = now - 30 days; default limit = 20; cap at 50', async () => {
    jest.useFakeTimers()
    const NOW = new Date('2026-04-28T12:00:00.000Z').getTime()
    jest.setSystemTime(NOW)
    try {
      mockFindMany.mockResolvedValueOnce([] as never)
      await GET(makeReq('', AUTH_OK) as never)

      const call = mockFindMany.mock.calls[0]![0] as {
        where: { ingested_at: { gte: Date } }
        take: number
      }
      const expectedSince = new Date(NOW - 30 * 86_400_000)
      expect(call.where.ingested_at.gte.getTime()).toBe(expectedSince.getTime())
      expect(call.take).toBe(20)

      // limit cap
      mockFindMany.mockResolvedValueOnce([] as never)
      await GET(makeReq('?limit=999', AUTH_OK) as never)
      const callCapped = mockFindMany.mock.calls[1]![0] as { take: number }
      expect(callCapped.take).toBe(50)
    } finally {
      jest.useRealTimers()
    }
  })

  it('Test 6: invalid `since` (un-parseable ISO) → 400', async () => {
    const res = await GET(makeReq('?since=not-a-date', AUTH_OK) as never)
    expect(res.status).toBe(400)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 7: sets Cache-Control: no-store on success', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    const res = await GET(makeReq('', AUTH_OK) as never)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('Test 8: module exports ONLY a GET handler', async () => {
    const mod = await import('../app/api/path-feedback/route')
    const exports = Object.keys(mod).filter((k) => k !== 'default')
    expect(exports).toEqual(['GET'])
  })

  it('Test 9: returns 500 plain "Internal Server Error" on Prisma throw', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('connection lost'))
    const res = await GET(makeReq('', AUTH_OK) as never)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('Test 10: returns { feedback: [] } when no rows match (200, not 204)', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    const res = await GET(makeReq('', AUTH_OK) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ feedback: [] })
  })
})
