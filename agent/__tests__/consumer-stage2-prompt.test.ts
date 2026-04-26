/**
 * Stage 2 prompt + worker `decision` field tests — quick task 260426-u47.
 *
 * Validates the agent-side changes per CONTEXT D-auto-file / D-auto-ignore:
 *   - buildStage2Prompt now instructs Claude to emit a `decision` field
 *     ('auto_file' | 'ignore' | 'uncertain') alongside axes + proposed_drive_path.
 *   - Stage2ResultSchema requires `decision`; rejects responses missing it.
 *   - Stage 2 worker forwards `decision` in the classify payload (ok branch only —
 *     parse_error / exit_error / timeout paths still POST outcome:'error' unchanged).
 *
 * Mirrors agent/__tests__/consumer-stage1.test.ts dependency-injection style.
 */

import { runStage2Worker } from '../src/consumer/stage2'
import {
  buildStage2Prompt,
  type TaxonomyContext,
} from '../src/consumer/prompts'
import type {
  QueueItem,
  ClassifyRequest,
  ClassifyOutcome,
  QueueResponse,
  TaxonomyInternalResponse,
} from '../src/http/types'
import type { ClaudeOutcome } from '../src/consumer/claude'

/* ───────────────────────────────── Fixtures ───────────────────────────────── */

const FILE_ITEM: QueueItem = {
  id: 'i_u47_file',
  source: 'downloads',
  filename: 'invoice.pdf',
  mime_type: 'application/pdf',
  size_bytes: 100,
  content_hash: 'sha_u47',
  source_metadata: { file_path: '/Users/d/Downloads/invoice.pdf' },
  file_path: '/Users/d/Downloads/invoice.pdf',
}

const TAXONOMY_CTX: TaxonomyContext = {
  type: ['invoice', 'receipt'],
  from: ['acme'],
  context: ['paid'],
}

const TAXONOMY: TaxonomyInternalResponse = {
  type: ['invoice', 'receipt'],
  from: ['acme'],
  context: ['paid'],
}

const okClassify: ClassifyOutcome = { kind: 'ok', status: 'filed', retries: 0 }

type LfStub = { trace: jest.Mock }
const makeLfStub = (): LfStub => ({ trace: jest.fn() })

const okStage2Outcome = (
  override?: Partial<{
    decision: 'auto_file' | 'ignore' | 'uncertain'
    confidence: number
    axes: {
      type: { value: string | null; confidence: number }
      from: { value: string | null; confidence: number }
      context: { value: string | null; confidence: number }
    }
    proposed_drive_path: string
  }>,
): ClaudeOutcome<{
  axes: {
    type: { value: string | null; confidence: number }
    from: { value: string | null; confidence: number }
    context: { value: string | null; confidence: number }
  }
  proposed_drive_path: string
  decision: 'auto_file' | 'ignore' | 'uncertain'
  confidence?: number
}> => {
  const decision = override?.decision ?? 'auto_file'
  const value: {
    axes: {
      type: { value: string | null; confidence: number }
      from: { value: string | null; confidence: number }
      context: { value: string | null; confidence: number }
    }
    proposed_drive_path: string
    decision: 'auto_file' | 'ignore' | 'uncertain'
    confidence?: number
  } = {
    axes: override?.axes ?? {
      type: { value: 'invoice', confidence: 0.9 },
      from: { value: 'acme', confidence: 0.9 },
      context: { value: 'paid', confidence: 0.9 },
    },
    proposed_drive_path: override?.proposed_drive_path ?? '/invoice/acme/paid/x.pdf',
    decision,
  }
  if (override?.confidence !== undefined) {
    value.confidence = override.confidence
  }
  return {
    kind: 'ok',
    value,
    durationMs: 10,
    exitCode: 0,
    stdoutFirst200: '{}',
  }
}

/* ───────────────────────────────── Prompt tests ────────────────────────────── */

describe('buildStage2Prompt — decision field instructions (u47)', () => {
  it('Test 1: prompt mentions decision field shape (auto_file, ignore, uncertain)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('decision')
    expect(p).toContain('auto_file')
    expect(p).toContain('ignore')
    expect(p).toContain('uncertain')
  })

  it('Test 2: prompt instructs Claude that ignore is allowed for junk (spam / marketing / automated)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    // Per plan action: copy mentions junk categories — at least one of these
    // signal phrases must appear in the prompt body.
    const lower = p.toLowerCase()
    const matches =
      lower.includes('spam') ||
      lower.includes('marketing') ||
      lower.includes('automated') ||
      lower.includes('junk')
    expect(matches).toBe(true)
  })

  it('Test 3: prompt still mentions confidence ≥ 0.85 (closed-vocab line stays per CONTEXT)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('0.85')
  })
})

/* ───────────────────────────────── Schema tests ────────────────────────────── */
// We exercise Stage2ResultSchema indirectly through the worker — invokeClaude
// receives the schema and Claude's pretend-payload. A schema rejection is
// observable as a parse_error outcome → worker POSTs outcome:'error'.

describe('Stage2ResultSchema (via worker) — decision required (u47)', () => {
  let worker: { stop: () => Promise<void> } | null = null
  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('Test 4: parses a valid response with decision="auto_file"', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    // invokeClaudeImpl is given the Zod schema by the worker — we run it
    // ourselves to mimic Claude's stdout being parsed against the schema.
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
      const candidate = {
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
        decision: 'auto_file',
      }
      const r = schema.safeParse(candidate)
      parsed = r
      return okStage2Outcome({ decision: 'auto_file' })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(true)
  })

  it('Test 5: parses a valid ignore response with all-null axes (low confidence)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
      const candidate = {
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
        decision: 'ignore',
      }
      const r = schema.safeParse(candidate)
      parsed = r
      return okStage2Outcome({
        decision: 'ignore',
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(true)
  })

  it('Test 6: rejects a response missing the decision field (decision is REQUIRED)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
      const candidate = {
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
        // decision intentionally OMITTED — must fail schema parse
      }
      const r = schema.safeParse(candidate)
      parsed = r
      // Doesn't matter what we return for this test — we're asserting the schema parse result.
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })
})

/* ───────────────────────────── Worker behavior tests ───────────────────────── */

describe('runStage2Worker — forwards decision in classify payload (u47)', () => {
  let worker: { stop: () => Promise<void> } | null = null
  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('Test 7: ok payload with decision=auto_file → postClassify body includes decision:"auto_file"', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome({ decision: 'auto_file' }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    if (payload.outcome !== 'success' || payload.stage !== 2) {
      throw new Error('expected stage 2 success payload')
    }
    expect((payload as ClassifyRequest & { decision?: string }).decision).toBe('auto_file')
    // Axes + proposed_drive_path still present
    expect(payload.axes).toBeDefined()
    expect(payload.proposed_drive_path).toBe('/invoice/acme/paid/x.pdf')
  })

  it('Test 8: ok payload with decision=ignore + null axes → forwards null axes unchanged + decision:"ignore"', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(async () =>
      okStage2Outcome({
        decision: 'ignore',
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
      }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    if (payload.outcome !== 'success' || payload.stage !== 2) {
      throw new Error('expected stage 2 success payload')
    }
    expect((payload as ClassifyRequest & { decision?: string }).decision).toBe('ignore')
    // Null axes forwarded unchanged — the route trusts the ignore signal
    // and does not need axis values to commit auto-ignore.
    expect(payload.axes!.type.value).toBeNull()
    expect(payload.axes!.from.value).toBeNull()
    expect(payload.axes!.context.value).toBeNull()
    expect(payload.axes!.type.confidence).toBe(0.1)
  })
})
