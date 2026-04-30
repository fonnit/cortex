/**
 * GET /api/taxonomy/internal — Phase 7 Plan 01, Task 3.
 *
 * Validates:
 *   - 401 with empty body when Authorization is missing/wrong (T-07-04).
 *   - 200 + { type, from } flat arrays bucketed by axis on success.
 *     SEED-v4-prod.md Decision 1 (260430-g6h) dropped the context axis.
 *   - Filters out deprecated labels (where: { deprecated: false }).
 *   - Cache-Control: no-store on the response (T-07-09).
 *   - Module exports ONLY GET (T-07-05).
 *   - No Clerk auth involved on this surface.
 */

// Mock prisma BEFORE importing the route. The taxonomy route only uses
// prisma.taxonomyLabel.findMany — stub just that.
jest.mock('../lib/prisma', () => ({
  prisma: {
    taxonomyLabel: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '../lib/prisma'
import { GET } from '../app/api/taxonomy/internal/route'

const mockFindMany = prisma.taxonomyLabel.findMany as jest.MockedFunction<
  typeof prisma.taxonomyLabel.findMany
>

const ORIGINAL_KEY = process.env.CORTEX_API_KEY

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/taxonomy/internal', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/taxonomy/internal', () => {
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

  it('returns 401 with EMPTY body when Authorization header is missing', async () => {
    // Cast: NextRequest is a superset of Request — the route only reads .headers
    const res = await GET(makeReq() as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns 401 with EMPTY body when Bearer token is wrong', async () => {
    const res = await GET(makeReq({ authorization: 'Bearer wrong-token' }) as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns 200 with bucketed type/from arrays on valid auth', async () => {
    // SEED-v4-prod.md Decision 1 (260430-g6h): context axis dropped from
    // runtime — old TaxonomyLabel rows with axis='context' are silently
    // filtered out (the route's bucket loop only handles type + from).
    mockFindMany.mockResolvedValueOnce([
      { axis: 'type', name: 'receipt' },
      { axis: 'type', name: 'contract' },
      { axis: 'from', name: 'BankOfAmerica' },
    ] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      type: ['receipt', 'contract'],
      from: ['BankOfAmerica'],
    })
    // Response no longer includes a `context` key.
    expect(body).not.toHaveProperty('context')
  })

  it('filters out deprecated labels via where: { deprecated: false }', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const call = mockFindMany.mock.calls[0][0] as { where: { deprecated: boolean } }
    expect(call.where).toEqual({ deprecated: false })
  })

  it('returns 200 with all empty arrays when no labels exist', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ type: [], from: [] })
  })

  it('sets Cache-Control: no-store on the success response', async () => {
    mockFindMany.mockResolvedValueOnce([] as never)

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 500 on unexpected DB error', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('connection lost'))

    const res = await GET(makeReq({ authorization: 'Bearer sekret-token' }) as never)

    expect(res.status).toBe(500)
    // Body is plain text, no schema hints / stack traces leaked.
    const text = await res.text()
    expect(text).toBe('Internal Server Error')
  })

  it('module exports ONLY a GET handler — no POST/PATCH/DELETE/PUT', async () => {
    const mod = await import('../app/api/taxonomy/internal/route')
    const exports = Object.keys(mod).filter((k) => k !== 'default')
    expect(exports).toEqual(['GET'])
  })
})
