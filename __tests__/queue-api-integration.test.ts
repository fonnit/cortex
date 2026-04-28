/**
 * API-06 regression smoke: confirms v1.1 phase-5 changes did not alter v1.0 routes.
 * Imports the existing route handlers and verifies their signatures and basic auth shape.
 *
 * The directory snapshot below is LOCKED at plan-write time against the actual
 * filesystem state. v1.0 had 9 directories (no `admin` — that name is aspirational
 * text in REQUIREMENTS.md but the route never shipped). Phase 5 adds exactly three:
 * classify, ingest, queue. Total = 12 entries. If a future change adds a directory,
 * the executor must update the REQUIREMENTS.md / ROADMAP.md and update this snapshot
 * in a deliberate edit — never silently match the filesystem.
 */
// Stub OpenAI key BEFORE any import of lib/embed (cron/embed/route.ts → lib/embed.ts
// instantiates `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at module load
// and throws if undefined). This test never invokes the embedding path.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-openai-stub'

import * as fs from 'node:fs'
import * as path from 'node:path'

// Mock prisma + Clerk so we can import existing route handlers without a live
// DB or auth provider.
jest.mock('../lib/prisma', () => ({
  prisma: {
    item: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))
jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn() }))
// Mock langfuse — cron/embed instantiates one at request time. Stub keeps the
// auth-only assertions deterministic (auth fails before any langfuse call,
// but the import must succeed).
jest.mock('langfuse', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    trace: () => ({ id: 't_smoke', span: () => ({ end: jest.fn() }) }),
    flushAsync: jest.fn().mockResolvedValue(undefined),
  })),
}))

import { GET as triageGET } from '../app/api/triage/route'
import { POST as embedPOST } from '../app/api/cron/embed/route'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '../lib/prisma'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindMany = prisma.item.findMany as jest.MockedFunction<typeof prisma.item.findMany>

describe('API-06: v1.0 routes are unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('GET /api/triage still returns 401 without Clerk session', async () => {
    // @ts-ignore — mocking `auth()`'s ClerkSessionAuth shape
    mockAuth.mockResolvedValue({ userId: null })
    const res = await triageGET()
    expect(res.status).toBe(401)
  })

  it('GET /api/triage still uses Clerk auth (NOT CORTEX_API_KEY)', async () => {
    // @ts-ignore
    mockAuth.mockResolvedValue({ userId: 'user_test' })
    mockFindMany.mockResolvedValue([] as never)
    const res = await triageGET()
    expect(res.status).toBe(200)
    // Triage was called with Clerk auth, not CORTEX_API_KEY — header isn't even checked
    expect(mockAuth).toHaveBeenCalled()
    // Triage uses prisma.item.findMany, not raw SQL — confirms v1.0 path intact
    expect(mockFindMany).toHaveBeenCalled()
  })

  it('POST /api/cron/embed still returns 401 without CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'cron-secret-value'
    const req = new Request('http://localhost/api/cron/embed', { method: 'POST' })
    // @ts-ignore — Request → NextRequest cast at the test boundary
    const res = await embedPOST(req)
    expect(res.status).toBe(401)
  })

  it('POST /api/cron/embed still validates CRON_SECRET (not CORTEX_API_KEY)', async () => {
    process.env.CRON_SECRET = 'cron-secret-value'
    process.env.CORTEX_API_KEY = 'cortex-key-value' // distinct from CRON_SECRET
    // Wrong key — CORTEX_API_KEY value should NOT authorize cron route
    const req = new Request('http://localhost/api/cron/embed', {
      method: 'POST',
      headers: { authorization: 'Bearer cortex-key-value' },
    })
    // @ts-ignore
    const res = await embedPOST(req)
    expect(res.status).toBe(401) // proves cron does not accept CORTEX_API_KEY
  })

  it('app/api/ directory contains EXACTLY the post-lx4 entries (locked snapshot)', () => {
    const apiDir = path.join(__dirname, '..', 'app', 'api')
    const entries = fs.readdirSync(apiDir).sort()
    // LOCKED at plan-write time. Filesystem ground truth: v1.0 had 9 entries
    // (ask, cron, delete, identity, metrics, rules, status, taxonomy, triage).
    // Phase 5 adds exactly three: classify, ingest, queue. Total = 12.
    // h9w (260427) adds: paths. Total = 13.
    // lx4 (260428) adds: labels, path-feedback. Total = 15.
    // No `admin` directory — that name appears in REQUIREMENTS.md but never shipped.
    // If this assertion fails in the future, update the snapshot deliberately
    // alongside whatever phase added/removed a route. Do NOT silently rebase.
    expect(entries).toEqual([
      'ask',
      'classify',
      'cron',
      'delete',
      'identity',
      'ingest',
      'labels',
      'metrics',
      'path-feedback',
      'paths',
      'queue',
      'rules',
      'status',
      'taxonomy',
      'triage',
    ])
  })
})
