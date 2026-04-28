/**
 * GET /api/labels/samples — quick task 260428-lx4, Task 1.
 *
 * Validates the label-samples endpoint that the Stage 2 MCP tool proxies to:
 *   - 401 with empty body when Authorization is missing/wrong (mirrors
 *     /api/paths/internal posture; T-lx4-03).
 *   - 400 when `axis` or `label` is missing/invalid.
 *   - 200 + { samples: [...] } sorted by ingested_at desc, capped at limit (≤20).
 *   - Cache-Control: no-store on success.
 *   - Module exports ONLY GET.
 *   - 500 returns plain "Internal Server Error".
 */

// Mock prisma BEFORE importing the route.
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '../lib/prisma'
import { GET } from '../app/api/labels/samples/route'

const mockFindMany = prisma.item.findMany as jest.MockedFunction<
  typeof prisma.item.findMany
>

const ORIGINAL_KEY = process.env.CORTEX_API_KEY

function makeReq(
  query: string = '',
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/labels/samples${query}`, {
    method: 'GET',
    headers,
  })
}

const AUTH_OK = { authorization: 'Bearer sekret-token' }

describe('GET /api/labels/samples', () => {
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
    const res = await GET(makeReq('?axis=type&label=invoice') as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 2: returns 401 with EMPTY body when Bearer token is wrong', async () => {
    const res = await GET(
      makeReq('?axis=type&label=invoice', { authorization: 'Bearer wrong' }) as never,
    )
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 3: 400 when `label` query param is missing or empty', async () => {
    const res1 = await GET(makeReq('?axis=type', AUTH_OK) as never)
    expect(res1.status).toBe(400)
    const res2 = await GET(makeReq('?axis=type&label=', AUTH_OK) as never)
    expect(res2.status).toBe(400)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 4: 400 when `axis` query param is missing OR not one of type|from|context', async () => {
    const res1 = await GET(makeReq('?label=invoice', AUTH_OK) as never)
    expect(res1.status).toBe(400)
    const res2 = await GET(
      makeReq('?axis=bogus&label=invoice', AUTH_OK) as never,
    )
    expect(res2.status).toBe(400)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('Test 5: passes where { status: "filed", axis_<axis>: <label> } and orderBy ingested_at desc, take = limit', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    await GET(
      makeReq('?axis=type&label=invoice&limit=5', AUTH_OK) as never,
    )

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const call = mockFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
      orderBy: { ingested_at: 'desc' }
      take: number
    }
    expect(call.where).toEqual({ status: 'filed', axis_type: 'invoice' })
    expect(call.orderBy).toEqual({ ingested_at: 'desc' })
    expect(call.take).toBe(5)
  })

  it('Test 5b: axis=from filters on axis_from', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    await GET(makeReq('?axis=from&label=acme', AUTH_OK) as never)
    const call = mockFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(call.where).toEqual({ status: 'filed', axis_from: 'acme' })
  })

  it('Test 5c: axis=context filters on axis_context', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    await GET(makeReq('?axis=context&label=tax', AUTH_OK) as never)
    const call = mockFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(call.where).toEqual({ status: 'filed', axis_context: 'tax' })
  })

  it('Test 6: returns { samples: [...] } in the order Prisma returned', async () => {
    const ingestedA = new Date('2026-04-20T00:00:00Z')
    const ingestedB = new Date('2026-04-19T00:00:00Z')
    mockFindMany.mockResolvedValueOnce([
      {
        id: 'a',
        filename: 'a.pdf',
        confirmed_drive_path: '/x/a.pdf',
        axis_type: 'invoice',
        axis_from: 'acme',
        axis_context: 'finance',
        ingested_at: ingestedA,
      },
      {
        id: 'b',
        filename: 'b.pdf',
        confirmed_drive_path: '/x/b.pdf',
        axis_type: 'invoice',
        axis_from: 'beta',
        axis_context: null,
        ingested_at: ingestedB,
      },
    ] as never)

    const res = await GET(makeReq('?axis=type&label=invoice', AUTH_OK) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      samples: [
        {
          id: 'a',
          filename: 'a.pdf',
          confirmed_drive_path: '/x/a.pdf',
          axis_type: 'invoice',
          axis_from: 'acme',
          axis_context: 'finance',
          ingested_at: ingestedA.toISOString(),
        },
        {
          id: 'b',
          filename: 'b.pdf',
          confirmed_drive_path: '/x/b.pdf',
          axis_type: 'invoice',
          axis_from: 'beta',
          axis_context: null,
          ingested_at: ingestedB.toISOString(),
        },
      ],
    })
  })

  it('Test 7: sets Cache-Control: no-store on success', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    const res = await GET(makeReq('?axis=type&label=invoice', AUTH_OK) as never)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('Test 8: module exports ONLY a GET handler', async () => {
    const mod = await import('../app/api/labels/samples/route')
    const exports = Object.keys(mod).filter((k) => k !== 'default')
    expect(exports).toEqual(['GET'])
  })

  it('Test 9: limit=999 is clamped to 20 (token-budget cap)', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    await GET(
      makeReq('?axis=type&label=invoice&limit=999', AUTH_OK) as never,
    )
    const call = mockFindMany.mock.calls[0]![0] as { take: number }
    expect(call.take).toBe(20)
  })

  it('Test 9b: missing limit defaults to 5', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)
    await GET(makeReq('?axis=type&label=invoice', AUTH_OK) as never)
    const call = mockFindMany.mock.calls[0]![0] as { take: number }
    expect(call.take).toBe(5)
  })

  it('Test 10: returns 500 plain "Internal Server Error" on Prisma throw', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('connection lost'))
    const res = await GET(makeReq('?axis=type&label=invoice', AUTH_OK) as never)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })
})
