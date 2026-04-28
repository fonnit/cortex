/**
 * Stage 1/2 prompt-builder tests — Phase 7 Plan 01, Task 2.
 *
 * Mirrors the plan's <behavior> bullets exactly:
 *   - Stage 1 file: contains absolute path + "Read the file with the Read tool".
 *   - Stage 1 file with file_path: null throws Error("downloads item missing file_path").
 *   - Stage 1 gmail: contains Subject:/From:/Preview:/Headers:; no path leakage.
 *   - Both Stage 1 variants: 0.75 confidence threshold present.
 *   - Stage 2: lists allowed types/froms/contexts, empty axes => "(none yet)".
 *   - Stage 2: 0.85 confident-match threshold present.
 *   - prompts.ts source contains zero `fs.` references (static guard).
 *   - 16KB length cap with 200-label synthetic taxonomy.
 */

import {
  buildStage1Prompt,
  buildStage2Prompt,
  type TaxonomyContext,
} from '../src/consumer/prompts'
import type { QueueItem } from '../src/http/types'

const FILE_ITEM: QueueItem = {
  id: 'i_file_1',
  source: 'downloads',
  filename: '2025-Q1-statement.pdf',
  mime_type: 'application/pdf',
  size_bytes: 142_337,
  content_hash: 'sha256_abc',
  source_metadata: { file_path: '/Users/d/Downloads/2025-Q1-statement.pdf' },
  file_path: '/Users/d/Downloads/2025-Q1-statement.pdf',
}

const GMAIL_ITEM: QueueItem = {
  id: 'i_gmail_1',
  source: 'gmail',
  filename: null,
  mime_type: null,
  size_bytes: null,
  content_hash: 'sha256_xyz',
  source_metadata: {
    subject: 'Your March statement is ready',
    from: 'no-reply@bofa.com',
    snippet: 'Your monthly statement for account ending 1234 is now available...',
    headers: { 'Message-ID': '<abc@bofa.com>', 'Date': 'Mon, 01 Apr 2025 00:00:00 +0000' },
  },
  file_path: null,
}

const TAXONOMY: TaxonomyContext = {
  type: ['receipt', 'contract', 'statement'],
  from: ['Employer-Acme', 'BankOfAmerica'],
  context: ['finance-monthly', 'travel'],
}

// lx4 Task 3: PATHS fixture removed — buildStage2Prompt no longer takes a
// PathContext arg. The model fetches paths via the cortex_paths_internal MCP
// tool. The taxonomy block stays inline.

/* ─────────────────────────────────────────────────────────────────────── */
/* Stage 1                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('buildStage1Prompt — file', () => {
  it('contains the absolute file path verbatim', () => {
    const p = buildStage1Prompt(FILE_ITEM)
    expect(p).toContain('/Users/d/Downloads/2025-Q1-statement.pdf')
  })

  it('instructs Claude to use the Read tool', () => {
    const p = buildStage1Prompt(FILE_ITEM)
    expect(p).toContain('Read the file with the Read tool')
  })

  it('asks for Stage 1 JSON shape', () => {
    const p = buildStage1Prompt(FILE_ITEM)
    expect(p).toContain('"decision"')
    expect(p).toContain('"confidence"')
    expect(p).toContain('"reason"')
  })

  it('contains the 0.75 confidence threshold', () => {
    const p = buildStage1Prompt(FILE_ITEM)
    expect(p).toContain('0.75')
  })

  it('throws on null file_path for downloads source', () => {
    const broken: QueueItem = { ...FILE_ITEM, file_path: null }
    expect(() => buildStage1Prompt(broken)).toThrow('downloads item missing file_path')
  })

  it('does not include file content (size or content_hash)', () => {
    const p = buildStage1Prompt(FILE_ITEM)
    expect(p).not.toContain('142337')
    expect(p).not.toContain('sha256_abc')
  })
})

describe('buildStage1Prompt — gmail', () => {
  it('contains Subject:, From:, Preview:, Headers:', () => {
    const p = buildStage1Prompt(GMAIL_ITEM)
    expect(p).toContain('Subject:')
    expect(p).toContain('From:')
    expect(p).toContain('Preview:')
    expect(p).toContain('Headers:')
  })

  it('contains the actual subject/from/snippet values', () => {
    const p = buildStage1Prompt(GMAIL_ITEM)
    expect(p).toContain('Your March statement is ready')
    expect(p).toContain('no-reply@bofa.com')
    expect(p).toContain('account ending 1234')
  })

  it('does not contain a leading filesystem path', () => {
    const p = buildStage1Prompt(GMAIL_ITEM)
    // Crude: no `/Users/` or `/var/` etc. — since no Gmail field would
    // legitimately include a downloads path.
    expect(p).not.toMatch(/\/Users\//)
    expect(p).not.toMatch(/\/Downloads\//)
  })

  it('contains 0.75 confidence threshold', () => {
    const p = buildStage1Prompt(GMAIL_ITEM)
    expect(p).toContain('0.75')
  })

  it('does NOT instruct Claude to fetch the full body', () => {
    const p = buildStage1Prompt(GMAIL_ITEM)
    expect(p).toMatch(/do not.*fetch the full body/i)
  })

  it('renders missing metadata fields as (none) rather than undefined', () => {
    const minimal: QueueItem = {
      ...GMAIL_ITEM,
      source_metadata: {}, // no subject, from, snippet, or headers
    }
    const p = buildStage1Prompt(minimal)
    expect(p).toContain('Subject: (none)')
    expect(p).toContain('From: (none)')
    expect(p).toContain('Preview: (none)')
    expect(p).toContain('Headers: {}')
    expect(p).not.toContain('undefined')
    expect(p).not.toContain('null')
  })
})

/* ─────────────────────────────────────────────────────────────────────── */
/* Stage 2                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('buildStage2Prompt — file', () => {
  it('renders all allowed types/froms/contexts joined by ", "', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).toContain('Type axis: receipt, contract, statement')
    expect(p).toContain('From axis: Employer-Acme, BankOfAmerica')
    expect(p).toContain('Context axis: finance-monthly, travel')
  })

  it('interpolates the file path under "Read"', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).toContain('Read /Users/d/Downloads/2025-Q1-statement.pdf')
  })

  it('asks for the 3-axis JSON shape with proposed_drive_path', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).toContain('"axes"')
    expect(p).toContain('"type"')
    expect(p).toContain('"from"')
    expect(p).toContain('"context"')
    expect(p).toContain('"value"')
    expect(p).toContain('"confidence"')
    expect(p).toContain('"proposed_drive_path"')
  })

  it('contains the 0.85 confidence threshold', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).toContain('0.85')
  })

  it('allows proposing new labels at low confidence (wgk relaxation)', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).toMatch(/propose a new label/i)
    expect(p).not.toMatch(/never invent/i)
  })

  it('renders empty taxonomy axes as (none yet)', () => {
    const p = buildStage2Prompt(FILE_ITEM, { type: [], from: [], context: [] })
    expect(p).toContain('Type axis: (none yet)')
    expect(p).toContain('From axis: (none yet)')
    expect(p).toContain('Context axis: (none yet)')
  })

  it('throws on null file_path for downloads source', () => {
    const broken: QueueItem = { ...FILE_ITEM, file_path: null }
    expect(() => buildStage2Prompt(broken, TAXONOMY)).toThrow(
      'downloads item missing file_path',
    )
  })

  it('does not include content_hash or size_bytes', () => {
    const p = buildStage2Prompt(FILE_ITEM, TAXONOMY)
    expect(p).not.toContain('142337')
    expect(p).not.toContain('sha256_abc')
  })
})

describe('buildStage2Prompt — gmail', () => {
  it('renders gmail metadata block (subject, from, snippet, headers)', () => {
    const p = buildStage2Prompt(GMAIL_ITEM, TAXONOMY)
    expect(p).toContain('Subject:')
    expect(p).toContain('From:')
    expect(p).toContain('Preview:')
    expect(p).toContain('Headers:')
    expect(p).toContain('Your March statement is ready')
  })

  it('still injects taxonomy axes', () => {
    const p = buildStage2Prompt(GMAIL_ITEM, TAXONOMY)
    expect(p).toContain('Type axis: receipt, contract, statement')
  })

  it('does NOT include a downloads-style file path', () => {
    const p = buildStage2Prompt(GMAIL_ITEM, TAXONOMY)
    expect(p).not.toMatch(/\/Users\//)
  })
})

/* ─────────────────────────────────────────────────────────────────────── */
/* Length-cap sanity                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('Stage 2 prompt length under heavy taxonomy', () => {
  it('200-label-per-axis taxonomy still fits in 16KB', () => {
    const huge: TaxonomyContext = {
      type: Array.from({ length: 200 }, (_, i) => `type_${i}`),
      from: Array.from({ length: 200 }, (_, i) => `from_${i}`),
      context: Array.from({ length: 200 }, (_, i) => `context_${i}`),
    }
    const p = buildStage2Prompt(FILE_ITEM, huge)
    // 16KB cap — generous; current builder produces well under this.
    expect(p.length).toBeLessThan(16 * 1024)
  })
})

/* ─────────────────────────────────────────────────────────────────────── */
/* Static-source guard: prompts.ts must not import fs                       */
/* ─────────────────────────────────────────────────────────────────────── */

describe('source-file invariants (prompts.ts)', () => {
  let src: string
  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises')
    src = await readFile(require.resolve('../src/consumer/prompts'), 'utf8')
  })

  it('does not import fs / node:fs / node:fs/promises', () => {
    expect(src).not.toMatch(/from\s+['"]fs['"]/)
    expect(src).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(src).not.toMatch(/from\s+['"]node:fs\/promises['"]/)
  })

  it('does not call fs.readFile or readFileSync', () => {
    expect(src).not.toMatch(/fs\.readFile/)
    expect(src).not.toMatch(/readFileSync/)
  })

  it('declares the throw on missing file_path', () => {
    expect(src).toContain("'downloads item missing file_path'")
  })

  it('contains the (none yet) empty-axis fallback', () => {
    expect(src).toContain('(none yet)')
  })

  it('contains both confidence thresholds (Stage 1 0.75 and Stage 2 0.85)', () => {
    expect(src).toMatch(/0\.75/)
    expect(src).toMatch(/0\.85/)
  })
})
