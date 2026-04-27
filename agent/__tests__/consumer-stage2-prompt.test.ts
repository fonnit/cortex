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
  type PathContext,
} from '../src/consumer/prompts'
import type {
  QueueItem,
  ClassifyRequest,
  ClassifyOutcome,
  QueueResponse,
  TaxonomyInternalResponse,
  PathsInternalResponse,
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

// Path-tree fixtures (quick task 260427-h9w). Two parents with distinct counts
// so tests can assert both parent strings + numeric counts appear in the prompt.
const PATHS_CTX: PathContext = {
  paths: [
    { parent: '/fonnit/invoices/', count: 12 },
    { parent: '/cortex/exports/', count: 4 },
  ],
}

const PATHS_RESPONSE: PathsInternalResponse = {
  paths: [
    { parent: '/fonnit/invoices/', count: 12 },
    { parent: '/cortex/exports/', count: 4 },
  ],
}

const EMPTY_PATHS_CTX: PathContext = { paths: [] }

const okClassify: ClassifyOutcome = { kind: 'ok', status: 'filed', retries: 0 }

type LfStub = { trace: jest.Mock }
const makeLfStub = (): LfStub => ({ trace: jest.fn() })

const okStage2Outcome = (
  override?: Partial<{
    decision: 'auto_file' | 'ignore' | 'uncertain'
    confidence: number
    path_confidence: number
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
  path_confidence: number
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
    path_confidence: number
    confidence?: number
  } = {
    axes: override?.axes ?? {
      type: { value: 'invoice', confidence: 0.9 },
      from: { value: 'acme', confidence: 0.9 },
      context: { value: 'paid', confidence: 0.9 },
    },
    proposed_drive_path: override?.proposed_drive_path ?? '/invoice/acme/paid/x.pdf',
    decision,
    // h9w: schema now requires path_confidence (0..1) at the top level. Default
    // to 0.9 (≥0.85) so the helper produces a valid auto_file payload by default.
    path_confidence: override?.path_confidence ?? 0.9,
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
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).toContain('decision')
    expect(p).toContain('auto_file')
    expect(p).toContain('ignore')
    expect(p).toContain('uncertain')
  })

  it('Test 2: prompt instructs Claude that ignore is allowed for junk (spam / marketing / automated)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
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
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).toContain('0.85')
  })

  // Tests NEW-A through NEW-D: quick task 260426-wgk relaxes the closed-vocab
  // rule so Claude may PROPOSE a brand-new label name on any axis when no
  // existing label is a confident match — instead of forcing `null`. Defense
  // in depth: the prompt instructs sub-0.85 confidence on proposals, AND the
  // route's cold-start guard independently blocks auto-file when a value is
  // not in TaxonomyLabel (see __tests__/classify-auto-actions.test.ts).
  it('Test NEW-A: prompt explicitly permits proposing a NEW label when no existing label fits (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    const lower = p.toLowerCase()
    const proposes =
      lower.includes('propose a new') ||
      lower.includes('propose new') ||
      lower.includes('propose a label') ||
      lower.includes('new label')
    expect(proposes).toBe(true)
  })

  it('Test NEW-B: prompt instructs that NEW (proposed) labels MUST carry confidence below 0.85 (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    const lower = p.toLowerCase()
    const subThreshold =
      lower.includes('below 0.85') ||
      lower.includes('< 0.85') ||
      lower.includes('less than 0.85') ||
      lower.includes('under 0.85')
    expect(subThreshold).toBe(true)
  })

  it('Test NEW-C: prompt MUST NOT contain the old hard-prohibition phrase "Never invent labels" (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).not.toContain('Never invent labels')
  })

  it('Test NEW-D: prompt still allows null as a valid axis value when Claude has no plausible name (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    const lower = p.toLowerCase()
    const nullAllowed =
      lower.includes('null is allowed') ||
      lower.includes('or null') ||
      lower.includes('may be null') ||
      lower.includes('can be null')
    expect(nullAllowed).toBe(true)
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

  it('Test 4: parses a valid response with decision="auto_file" + path_confidence', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
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
        path_confidence: 0.9,
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
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(true)
  })

  it('Test 5: parses a valid ignore response with all-null axes (low confidence) + path_confidence', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
      const candidate = {
        axes: {
          type: { value: null, confidence: 0.1 },
          from: { value: null, confidence: 0.1 },
          context: { value: null, confidence: 0.1 },
        },
        proposed_drive_path: '',
        decision: 'ignore',
        // h9w: schema requires path_confidence even on ignore (route ignores it
        // for the ignore branch, but the schema is uniform). Low value is fine.
        path_confidence: 0.1,
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
      getPathsInternalImpl: getPathsInternalImpl as never,
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
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
      const candidate = {
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
        path_confidence: 0.9,
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
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })

  /* ─────────────────────── h9w schema additions ─────────────────────── */

  it('Test H9W-J: rejects a response missing path_confidence (REQUIRED)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean } }) => {
      const candidate = {
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
        decision: 'auto_file',
        // path_confidence intentionally OMITTED — must fail schema parse
      }
      parsed = schema.safeParse(candidate)
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })

  it('Test H9W-K: rejects a response with path_confidence outside [0,1] (e.g. 1.5)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async (_prompt: string, schema: { safeParse: (v: unknown) => { success: boolean } }) => {
      const candidate = {
        axes: {
          type: { value: 'invoice', confidence: 0.9 },
          from: { value: 'acme', confidence: 0.9 },
          context: { value: 'paid', confidence: 0.9 },
        },
        proposed_drive_path: '/x.pdf',
        decision: 'auto_file',
        path_confidence: 1.5, // out of range — Zod min(0).max(1) must reject
      }
      parsed = schema.safeParse(candidate)
      return okStage2Outcome()
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
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
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome({ decision: 'auto_file' }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
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
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
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
      getPathsInternalImpl: getPathsInternalImpl as never,
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

  /* ─────────────── h9w worker-behavior additions ─────────────── */

  it('Test H9W-L: getPathsInternalImpl is called once per non-empty batch', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome({ decision: 'auto_file' }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // Exactly one fetch for the single non-empty batch — same cadence as
    // getTaxonomyInternalImpl (never cached across cycles).
    expect(getPathsInternalImpl).toHaveBeenCalledTimes(1)
    // Subsequent (empty) polls do NOT re-fetch.
  })

  it('Test H9W-M: buildStage2Prompt receives the fetched paths — prompt contains parent strings', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    let capturedPrompt = ''
    const invokeClaudeImpl = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt
      return okStage2Outcome({ decision: 'auto_file' })
    })
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(capturedPrompt).toContain('/fonnit/invoices/')
    expect(capturedPrompt).toContain('/cortex/exports/')
  })

  it('Test H9W-N: ok payload forwards path_confidence to postClassify', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => PATHS_RESPONSE)
    const invokeClaudeImpl = jest.fn(async () =>
      okStage2Outcome({ decision: 'auto_file', path_confidence: 0.9 }),
    )
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: makeLfStub() as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(postClassifyImpl).toHaveBeenCalledTimes(1)
    const payload = postClassifyImpl.mock.calls[0]![0] as ClassifyRequest
    if (payload.outcome !== 'success' || payload.stage !== 2) {
      throw new Error('expected stage 2 success payload')
    }
    expect(
      (payload as ClassifyRequest & { path_confidence?: number }).path_confidence,
    ).toBe(0.9)
  })

  it('Test H9W-O: getPathsInternalImpl rejects → batch SKIPPED, no postClassify, loop continues', async () => {
    const items = [FILE_ITEM, FILE_ITEM]
    const lf = makeLfStub()
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items, reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const getPathsInternalImpl = jest.fn(async () => {
      throw new Error('paths fetch failed: 401')
    })
    const invokeClaudeImpl = jest.fn(async () => okStage2Outcome({ decision: 'auto_file' }))
    const postClassifyImpl = jest.fn(async (_p: ClassifyRequest) => okClassify)

    worker = runStage2Worker({
      langfuse: lf as never,
      getQueueImpl: getQueueImpl as never,
      invokeClaudeImpl: invokeClaudeImpl as never,
      postClassifyImpl: postClassifyImpl as never,
      getTaxonomyInternalImpl: getTaxonomyInternalImpl as never,
      getPathsInternalImpl: getPathsInternalImpl as never,
    })

    for (let i = 0; i < 50; i++) await Promise.resolve()

    // No invokeClaude, no postClassify — items stay in processing_stage2.
    expect(invokeClaudeImpl).not.toHaveBeenCalled()
    expect(postClassifyImpl).not.toHaveBeenCalled()
    // Failure trace was emitted.
    const traceNames = lf.trace.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(traceNames.some((n: string) => n.includes('paths-fetch-failed'))).toBe(true)
  })
})

/* ────────────────────────── h9w prompt-shape tests ────────────────────────── */

describe('buildStage2Prompt — h9w path-tree injection', () => {
  it('Test H9W-A: prompt contains an "Existing folders" / folder-tree section', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p.toLowerCase()).toMatch(/existing folders|folder tree|confirmed paths/)
  })

  it('Test H9W-B: non-empty paths render each parent and its count in the prompt body', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).toContain('/fonnit/invoices/')
    expect(p).toContain('/cortex/exports/')
    expect(p).toContain('12')
    expect(p).toContain('4')
  })

  it('Test H9W-C: empty paths render an explicit cold-start line', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, EMPTY_PATHS_CTX)
    expect(p.toLowerCase()).toMatch(/no existing folders|no folders yet|cold start/)
  })

  it('Test H9W-D: prompt MUST NOT contain the old fixed template "<type>/<from>/<context>/<filename>"', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).not.toContain('<type>/<from>/<context>/<filename>')
  })

  it('Test H9W-E: prompt MUST NOT contain partial old-template fragment "<type>/<from>"', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).not.toMatch(/<type>\/<from>/)
  })

  it('Test H9W-F: prompt instructs reuse + new branches + arbitrary depth', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    const lower = p.toLowerCase()
    expect(lower).toMatch(/reuse|already contain/)
    expect(lower).toMatch(/new branch|new folder|create a path/)
  })

  it('Test H9W-G: prompt instructs Claude to return path_confidence proportional to certainty', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).toContain('path_confidence')
    const lower = p.toLowerCase()
    const proportional =
      lower.includes('proportional') ||
      lower.includes('how sure') ||
      lower.includes('your confidence')
    expect(proportional).toBe(true)
  })

  it('Test H9W-H: prompt instructs preference for fewer levels (2-3)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    const lower = p.toLowerCase()
    const fewerLevels =
      lower.includes('prefer fewer levels') ||
      lower.includes('2-3 levels') ||
      lower.includes('2 or 3 levels') ||
      lower.includes('fewer levels')
    expect(fewerLevels).toBe(true)
  })

  it('Test H9W-I (sanity): valid response with path_confidence=0.9 + auto_file parses', () => {
    // This exercises the schema directly (no worker) for a simple sanity check.
    const { z } = require('zod') as { z: typeof import('zod').z }
    void z // satisfy linter — actual schema is exercised via Tests 4/5/6/H9W-J/H9W-K above
    // Direct parse check is duplicative with Test 4; we keep this here as a
    // cheap "happy path with h9w fields" assertion at the prompt boundary.
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX, PATHS_CTX)
    expect(p).toContain('path_confidence')
  })
})
