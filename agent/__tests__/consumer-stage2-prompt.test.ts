/**
 * Stage 2 prompt + worker `decision` field tests — quick task 260426-u47,
 * quick task 260427-h9w, quick task 260428-lx4 Task 3.
 *
 * Validates the agent-side changes:
 *   - buildStage2Prompt instructs Claude to emit a `decision` field
 *     ('auto_file' | 'ignore' | 'uncertain') alongside axes + proposed_drive_path.
 *   - Stage2ResultSchema requires `decision` and `path_confidence`.
 *   - lx4 Task 3: buildStage2Prompt no longer takes a PathContext arg — the
 *     model fetches paths via the cortex_paths_internal MCP tool. The prompt
 *     mentions all 3 cortex_* tools and does NOT inline the path-tree dump.
 *   - Stage 2 worker forwards `decision` + `path_confidence` in the classify
 *     payload (ok branch).
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
}

const TAXONOMY: TaxonomyInternalResponse = {
  type: ['invoice', 'receipt'],
  from: ['acme'],
}

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
    }
    proposed_drive_path: string
  }>,
): ClaudeOutcome<{
  axes: {
    type: { value: string | null; confidence: number }
    from: { value: string | null; confidence: number }
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
    }
    proposed_drive_path: string
    decision: 'auto_file' | 'ignore' | 'uncertain'
    path_confidence: number
    confidence?: number
  } = {
    axes: override?.axes ?? {
      type: { value: 'invoice', confidence: 0.9 },
      from: { value: 'acme', confidence: 0.9 },
    },
    proposed_drive_path: override?.proposed_drive_path ?? '/invoice/acme/paid/x.pdf',
    decision,
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

/* ───────────────────────────────── Prompt tests (lx4 P1–P6) ─────────────── */

describe('buildStage2Prompt — lx4 Task 3 prompt restructure', () => {
  it('Test P1: prompt mentions all 3 MCP tool names', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('cortex_paths_internal')
    expect(p).toContain('cortex_label_samples')
    expect(p).toContain('cortex_path_feedback')
  })

  it('Test P2: prompt does NOT inline the path-tree dump anymore (no preamble)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    // The old "Existing folders (parents that already contain..." preamble is gone.
    expect(p).not.toContain(
      'Existing folders (parents that already contain confirmed items',
    )
    // The old empty-state fallback line is also gone.
    expect(p).not.toContain('(no existing folders yet')
  })

  it('Test P3: prompt still includes the existing-taxonomy block (axes inline)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('Type axis: invoice, receipt')
    expect(p).toContain('From axis: acme')
    // SEED-v4-prod.md Decision 1 (260430-g6h): no Context axis line.
    expect(p).not.toContain('Context axis')
  })

  it('Test P4: prompt instructs that the FINAL message must be the JSON decision object', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    // Same shape sentence as today.
    expect(p).toContain('"axes"')
    expect(p).toContain('"decision"')
    expect(p).toContain('"path_confidence"')
    // New post-lx4 instruction: final message must be ONLY the JSON.
    const lower = p.toLowerCase()
    expect(lower).toContain('final message')
  })

  it('Test P5: prompt suggests calling cortex_label_samples for sub-0.85 axes and cortex_path_feedback before committing a path', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('cortex_label_samples')
    expect(p).toContain('cortex_path_feedback')
    // Soft suggestion — assert the threshold line is present.
    expect(p).toContain('0.85')
  })

  it('Test P6: deletes the old path-tree empty-state copy', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).not.toContain('(no existing folders yet — propose any path you think makes sense')
    // The empty-state path-feedback IS now handled by the MCP tool's response shape.
  })
})

/* ───────────────────────────────── u47 / wgk / h9w preserved ─────────────── */

describe('buildStage2Prompt — preserved u47/wgk/h9w invariants', () => {
  it('mentions decision field shape (auto_file, ignore, uncertain)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('decision')
    expect(p).toContain('auto_file')
    expect(p).toContain('ignore')
    expect(p).toContain('uncertain')
  })

  it('mentions junk categories for ignore (spam / marketing / automated)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    const lower = p.toLowerCase()
    const matches =
      lower.includes('spam') ||
      lower.includes('marketing') ||
      lower.includes('automated') ||
      lower.includes('junk')
    expect(matches).toBe(true)
  })

  it('still mentions confidence ≥ 0.85 (closed-vocab line stays)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('0.85')
  })

  it('explicitly permits proposing a NEW label when no existing label fits (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    const lower = p.toLowerCase()
    const proposes =
      lower.includes('propose a new') ||
      lower.includes('propose new') ||
      lower.includes('propose a label') ||
      lower.includes('new label')
    expect(proposes).toBe(true)
  })

  it('instructs that NEW (proposed) labels MUST carry confidence below 0.85 (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    const lower = p.toLowerCase()
    const subThreshold =
      lower.includes('below 0.85') ||
      lower.includes('< 0.85') ||
      lower.includes('less than 0.85') ||
      lower.includes('under 0.85')
    expect(subThreshold).toBe(true)
  })

  it('does NOT contain the old hard-prohibition phrase "Never invent labels" (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).not.toContain('Never invent labels')
  })

  it('still allows null as a valid axis value (wgk)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    const lower = p.toLowerCase()
    const nullAllowed =
      lower.includes('null is allowed') ||
      lower.includes('or null') ||
      lower.includes('may be null') ||
      lower.includes('can be null')
    expect(nullAllowed).toBe(true)
  })

  it('instructs Claude to return path_confidence proportional to certainty (h9w-G)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).toContain('path_confidence')
    const lower = p.toLowerCase()
    const proportional =
      lower.includes('proportional') ||
      lower.includes('how sure') ||
      lower.includes('your confidence')
    expect(proportional).toBe(true)
  })

  it('does NOT contain the old fixed template "<type>/<from>/<context>/<filename>"', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).not.toContain('<type>/<from>/<context>/<filename>')
  })

  it('SEED-v4 D1: prompt does not mention a context axis or "context" key in the JSON shape', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY_CTX)
    expect(p).not.toContain('Context axis')
    expect(p).not.toContain('"context"')
  })
})

/* ───────────────────────────────── Schema tests (preserved) ────────────── */

describe('Stage2ResultSchema (via worker) — decision + path_confidence required', () => {
  let worker: { stop: () => Promise<void> } | null = null
  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('parses a valid response with decision="auto_file" + path_confidence', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(
      async (
        _prompt: string,
        schema: { safeParse: (v: unknown) => { success: boolean } },
      ) => {
        parsed = schema.safeParse({
          axes: {
            type: { value: 'invoice', confidence: 0.9 },
            from: { value: 'acme', confidence: 0.9 },
          },
          proposed_drive_path: '/x.pdf',
          decision: 'auto_file',
          path_confidence: 0.9,
        })
        return okStage2Outcome({ decision: 'auto_file' })
      },
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
    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(true)
  })

  it('rejects a response missing the decision field (decision is REQUIRED)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(
      async (
        _prompt: string,
        schema: { safeParse: (v: unknown) => { success: boolean } },
      ) => {
        parsed = schema.safeParse({
          axes: {
            type: { value: 'invoice', confidence: 0.9 },
            from: { value: 'acme', confidence: 0.9 },
          },
          proposed_drive_path: '/x.pdf',
          path_confidence: 0.9,
          // decision intentionally OMITTED — must fail schema parse
        })
        return okStage2Outcome()
      },
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
    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })

  it('rejects a response missing path_confidence (REQUIRED)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(
      async (
        _prompt: string,
        schema: { safeParse: (v: unknown) => { success: boolean } },
      ) => {
        parsed = schema.safeParse({
          axes: {
            type: { value: 'invoice', confidence: 0.9 },
            from: { value: 'acme', confidence: 0.9 },
          },
          proposed_drive_path: '/x.pdf',
          decision: 'auto_file',
          // path_confidence intentionally OMITTED
        })
        return okStage2Outcome()
      },
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
    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })

  it('rejects a response with path_confidence outside [0,1] (e.g. 1.5)', async () => {
    let parsed: unknown = null
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
    const invokeClaudeImpl = jest.fn(
      async (
        _prompt: string,
        schema: { safeParse: (v: unknown) => { success: boolean } },
      ) => {
        parsed = schema.safeParse({
          axes: {
            type: { value: 'invoice', confidence: 0.9 },
            from: { value: 'acme', confidence: 0.9 },
          },
          proposed_drive_path: '/x.pdf',
          decision: 'auto_file',
          path_confidence: 1.5,
        })
        return okStage2Outcome()
      },
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
    expect(parsed).toBeTruthy()
    expect((parsed as { success: boolean }).success).toBe(false)
  })
})

/* ───────────────────────────── Worker behavior tests ───────────────────── */

describe('runStage2Worker — forwards decision + path_confidence in classify payload', () => {
  let worker: { stop: () => Promise<void> } | null = null
  afterEach(async () => {
    if (worker) {
      await worker.stop().catch(() => {})
      worker = null
    }
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('ok payload with decision=auto_file → postClassify body includes decision:"auto_file"', async () => {
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
    expect(payload.axes).toBeDefined()
    expect(payload.proposed_drive_path).toBe('/invoice/acme/paid/x.pdf')
  })

  it('ok payload with decision=ignore + null axes → forwards null axes unchanged', async () => {
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
    expect(payload.axes!.type.value).toBeNull()
    expect(payload.axes!.from.value).toBeNull()
    // SEED-v4 D1: axes.context is no longer part of the payload shape.
    expect(payload.axes).not.toHaveProperty('context')
    expect(payload.axes!.type.confidence).toBe(0.1)
  })

  it('ok payload forwards path_confidence to postClassify', async () => {
    const item = FILE_ITEM
    const getQueueImpl = jest
      .fn()
      .mockResolvedValueOnce({ items: [item], reclaimed: 0, traceId: null } as QueueResponse)
      .mockResolvedValue({ items: [], reclaimed: 0, traceId: null } as QueueResponse)
    const getTaxonomyInternalImpl = jest.fn(async () => TAXONOMY)
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
})
