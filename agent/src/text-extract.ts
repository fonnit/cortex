// Dispatch by file extension to one of:
//   - text mode: extracted UTF-8 string (TXT/MD/DOCX/PDF-with-text-layer)
//   - image mode: pass the file path to Claude as a multimodal attachment
//   - pdf_native mode: PDF without text layer; Claude handles natively
//   - unsupported: types Cortex can't handle in v1 (e.g. .pages, .keynote)
//
// Image mode for .heic preconverts via macOS built-in `sips` to a temp .jpg.

import { readFile, stat } from 'node:fs/promises'
import { extname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export type ExtractResult =
  | { kind: 'text'; content: string; extractedCharCount: number; ms: number }
  | { kind: 'image'; path: string; ms: number }
  | { kind: 'pdf_native'; path: string; ms: number }
  | { kind: 'unsupported'; reason: string; ms: number }

const TEXT_EXT = new Set(['.txt', '.md', '.markdown'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const DOCX_EXT = new Set(['.docx'])
const PDF_EXT = new Set(['.pdf'])
const HEIC_EXT = new Set(['.heic', '.heif'])

const MAX_TEXT_CHARS = 8000  // truncate; Haiku prompt cap

export async function extract(sourcePath: string): Promise<ExtractResult> {
  const t0 = Date.now()
  await stat(sourcePath)  // throws if missing — caller handles ENOENT → source_missing

  const ext = extname(sourcePath).toLowerCase()

  if (TEXT_EXT.has(ext)) {
    const buf = await readFile(sourcePath, 'utf-8')
    const truncated = buf.slice(0, MAX_TEXT_CHARS)
    return {
      kind: 'text',
      content: truncated,
      extractedCharCount: truncated.length,
      ms: Date.now() - t0,
    }
  }

  if (DOCX_EXT.has(ext)) {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path: sourcePath })
    const truncated = (value ?? '').slice(0, MAX_TEXT_CHARS)
    return {
      kind: 'text',
      content: truncated,
      extractedCharCount: truncated.length,
      ms: Date.now() - t0,
    }
  }

  if (PDF_EXT.has(ext)) {
    // Try text-layer extract first
    try {
      const buf = await readFile(sourcePath)
      const pdfParse = (await import('pdf-parse')).default
      const parsed = await pdfParse(buf)
      const text = (parsed.text ?? '').trim()
      if (text.length >= 50) {
        const truncated = text.slice(0, MAX_TEXT_CHARS)
        return {
          kind: 'text',
          content: truncated,
          extractedCharCount: truncated.length,
          ms: Date.now() - t0,
        }
      }
    } catch {
      // fall through to pdf_native — Claude will OCR
    }
    return { kind: 'pdf_native', path: sourcePath, ms: Date.now() - t0 }
  }

  if (IMAGE_EXT.has(ext)) {
    return { kind: 'image', path: sourcePath, ms: Date.now() - t0 }
  }

  if (HEIC_EXT.has(ext)) {
    const hash = createHash('sha1').update(sourcePath).digest('hex').slice(0, 12)
    const dest = join(tmpdir(), `cortex-${hash}-${basename(sourcePath, ext)}.jpg`)
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', sourcePath, '--out', dest], {
      stdio: 'ignore',
    })
    if (r.status !== 0) {
      return { kind: 'unsupported', reason: `sips preconvert failed (.heic → .jpg)`, ms: Date.now() - t0 }
    }
    return { kind: 'image', path: dest, ms: Date.now() - t0 }
  }

  return { kind: 'unsupported', reason: `extension ${ext} not supported in v1`, ms: Date.now() - t0 }
}
