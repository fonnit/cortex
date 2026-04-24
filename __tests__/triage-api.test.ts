/**
 * Triage API route tests — RED phase
 * Tests for GET /api/triage and POST /api/triage
 */

// Mock Prisma before importing route
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))

// Mock Clerk auth
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
}))

import { prisma } from '../lib/prisma'
import { auth } from '@clerk/nextjs/server'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindMany = prisma.item.findMany as jest.MockedFunction<typeof prisma.item.findMany>
const mockUpdate = prisma.item.update as jest.MockedFunction<typeof prisma.item.update>

// Helper to import route handlers after mocks are set up
async function importRoute() {
  jest.resetModules()
  // Re-apply mocks after reset
  jest.mock('../lib/prisma', () => ({
    prisma: {
      item: {
        findMany: mockFindMany,
        update: mockUpdate,
      },
    },
  }))
  jest.mock('@clerk/nextjs/server', () => ({
    auth: mockAuth,
  }))
  const { GET, POST } = await import('../app/api/triage/route')
  return { GET, POST }
}

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/triage', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/triage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: null })
    const { GET } = await importRoute()
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns only the authenticated user\'s uncertain items', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    const fakeItems = [
      {
        id: 'item_1',
        user_id: 'user_abc',
        status: 'uncertain',
        source: 'gmail',
        classification_trace: null,
        ingested_at: new Date(),
      },
    ]
    // @ts-ignore
    mockFindMany.mockResolvedValue(fakeItems)

    const { GET } = await importRoute()
    const res = await GET()
    expect(res.status).toBe(200)

    // Verify query filtered by user_id and status
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user_abc',
          status: 'uncertain',
        }),
      })
    )

    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
  })

  it('derives stage=label when classification_trace.stage2.proposals exists', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    const itemWithProposals = {
      id: 'item_label',
      user_id: 'user_abc',
      status: 'uncertain',
      source: 'gmail',
      classification_trace: {
        stage2: {
          proposals: { type: [{ value: 'Invoice', conf: 0.9 }] },
          confident: ['type'],
        },
      },
      ingested_at: new Date(),
    }
    // @ts-ignore
    mockFindMany.mockResolvedValue([itemWithProposals])

    const { GET } = await importRoute()
    const res = await GET()
    const json = await res.json()
    expect(json[0].stage).toBe('label')
  })

  it('derives stage=relevance when no classification_trace.stage2.proposals', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    const itemNoProposals = {
      id: 'item_rel',
      user_id: 'user_abc',
      status: 'uncertain',
      source: 'downloads',
      classification_trace: { stage1: { reason: 'uncertain' } },
      ingested_at: new Date(),
    }
    // @ts-ignore
    mockFindMany.mockResolvedValue([itemNoProposals])

    const { GET } = await importRoute()
    const res = await GET()
    const json = await res.json()
    expect(json[0].stage).toBe('relevance')
  })
})

describe('POST /api/triage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: null })
    const { POST } = await importRoute()
    const req = makeRequest('POST', { itemId: 'item_1', type: 'keep' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST keep updates status to certain', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'certain' })

    const { POST } = await importRoute()
    const req = makeRequest('POST', { itemId: 'item_1', type: 'keep' })
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item_1', user_id: 'user_abc' }),
        data: expect.objectContaining({ status: 'certain' }),
      })
    )

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('certain')
  })

  it('POST skip returns 200 without DB write', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })

    const { POST } = await importRoute()
    const req = makeRequest('POST', { itemId: 'item_1', type: 'skip' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('POST ignore updates status to ignored', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'ignored' })

    const { POST } = await importRoute()
    const req = makeRequest('POST', { itemId: 'item_1', type: 'ignore' })
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: 'user_abc' }),
        data: expect.objectContaining({ status: 'ignored' }),
      })
    )

    const json = await res.json()
    expect(json.status).toBe('ignored')
  })

  it('POST with invalid type returns 400', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })

    const { POST } = await importRoute()
    const req = makeRequest('POST', { itemId: 'item_1', type: 'invalid_type' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST confirm with picks writes axis fields and sets status certain', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'certain' })

    const { POST } = await importRoute()
    const req = makeRequest('POST', {
      itemId: 'item_1',
      type: 'confirm',
      picks: { Type: 'Financial / Invoice', From: 'Acme Co.', Context: 'FonnIT/Clients' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item_1', user_id: 'user_abc' }),
        data: expect.objectContaining({
          status: 'certain',
          axis_type: 'Financial / Invoice',
          axis_from: 'Acme Co.',
          axis_context: 'FonnIT/Clients',
        }),
      })
    )
  })
})
