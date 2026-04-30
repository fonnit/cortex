/**
 * Triage API route tests
 * Tests for GET /api/triage and POST /api/triage
 */

// Mock Prisma and Clerk before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
}))

import { GET, POST } from '../app/api/triage/route'
import { prisma } from '../lib/prisma'
import { auth } from '@clerk/nextjs/server'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindMany = prisma.item.findMany as jest.MockedFunction<typeof prisma.item.findMany>
const mockUpdate = prisma.item.update as jest.MockedFunction<typeof prisma.item.update>

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/triage', {
    method: 'POST',
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
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('queries only the authenticated user\'s uncertain items', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockFindMany.mockResolvedValue([
      {
        id: 'item_1',
        user_id: 'user_abc',
        status: 'uncertain',
        source: 'gmail',
        classification_trace: null,
        ingested_at: new Date(),
      },
    ])

    const res = await GET()
    expect(res.status).toBe(200)

    // Verify user_id scoping (T-02-07)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user_abc',
          status: 'uncertain',
        }),
      })
    )
  })

  it('derives stage=label when classification_trace.stage2.proposals exists', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockFindMany.mockResolvedValue([
      {
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
      },
    ])

    const res = await GET()
    const json = await res.json()
    expect(json[0].stage).toBe('label')
  })

  it('derives stage=relevance when no stage2 proposals', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockFindMany.mockResolvedValue([
      {
        id: 'item_rel',
        user_id: 'user_abc',
        status: 'uncertain',
        source: 'downloads',
        classification_trace: { stage1: { reason: 'uncertain' } },
        ingested_at: new Date(),
      },
    ])

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
    const req = makeRequest({ itemId: 'item_1', type: 'keep' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST keep updates status to certain', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'certain' })

    const req = makeRequest({ itemId: 'item_1', type: 'keep' })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // Verify user_id scoping on write (T-02-06)
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

    const req = makeRequest({ itemId: 'item_1', type: 'skip' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('POST ignore updates status to ignored', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'ignored' })

    const req = makeRequest({ itemId: 'item_1', type: 'ignore' })
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

    const req = makeRequest({ itemId: 'item_1', type: 'invalid_type' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST confirm with picks writes axis fields and sets status filed', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })
    // @ts-ignore
    mockUpdate.mockResolvedValue({ id: 'item_1', status: 'filed' })

    const req = makeRequest({
      itemId: 'item_1',
      type: 'confirm',
      picks: { Type: 'Financial / Invoice', From: 'Acme Co.' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item_1', user_id: 'user_abc' }),
        data: expect.objectContaining({
          status: 'filed',
          axis_type: 'Financial / Invoice',
          axis_from: 'Acme Co.',
        }),
      })
    )
  })

  it('POST confirm rejects picks.Context (axis dropped per SEED-v4 Decision 1)', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_abc' })

    // The route's DecisionSchema picks now uses .strict(); an unknown key
    // 'Context' triggers Zod parse failure → 400 Bad Request before any DB
    // touch. Belt-and-suspenders: even if the schema accepted the key, the
    // route's archive/confirm branch never sets data.axis_context.
    const req = makeRequest({
      itemId: 'item_1',
      type: 'confirm',
      // @ts-ignore Context is no longer part of the picks shape — Zod strict rejects at runtime.
      picks: { Context: 'FonnIT/Clients' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
