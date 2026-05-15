// Dispatch by file extension. Every supported file becomes a single 'text' result
// before classify sees it. macOS Vision OCR handles images and scan-only PDFs;
// pdf-parse handles PDFs with a text layer; mammoth handles DOCX.
//
// Returns the FULL extracted text. Classify truncates at prompt-build time;
// RAG embeds the full text.

import { readFile, stat, access } from 'node:fs/promises'
import { extname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { constants as fsConstants } from 'node:fs'

export type ExtractionSource =
  | 'plain_text'
  | 'docx'
  | 'pdf_text'
  | 'ocr_image'
  | 'ocr_pdf'

export type ExtractResult =
  | { kind: 'text'; source: ExtractionSource; content: string; extractedCharCount: number; ms: number }
  | { kind: 'unsupported'; reason: string; ms: number }

const TEXT_EXT = new Set(['.txt', '.md', '.markdown'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'])
const DOCX_EXT = new Set(['.docx'])
const PDF_EXT = new Set(['.pdf'])

const PDF_TEXT_MIN_CHARS = 50  // below this, treat as scan-only and OCR via Vision

// vision-ocr is built once via `npm run build:ocr` (swift build).
// We resolve it relative to this source file so it works under tsx and dist alike.
function visionOcrBinaryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/text-extract.ts → ../macos-bin/.build/release/vision-ocr
  return resolvePath(here, '..', 'macos-bin', '.build', 'release', 'vision-ocr')
}

async function runVisionOcr(filePath: string): Promise<string> {
  const bin = visionOcrBinaryPath()
  try {
    await access(bin, fsConstants.X_OK)
  } catch {
    throw new Error(
      `vision-ocr binary not found at ${bin}. Run \`npm run build:ocr\` to build it.`,
    )
  }

  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, [filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`vision-ocr exited ${code}: ${stderr.trim().slice(0, 500)}`))
    })
  })
}

export async function extract(sourcePath: string): Promise<ExtractResult> {
  const t0 = Date.now()
  await stat(sourcePath)  // throws if missing — caller handles ENOENT → source_missing

  const ext = extname(sourcePath).toLowerCase()

  if (TEXT_EXT.has(ext)) {
    const content = await readFile(sourcePath, 'utf-8')
    return {
      kind: 'text',
      source: 'plain_text',
      content,
      extractedCharCount: content.length,
      ms: Date.now() - t0,
    }
  }

  if (DOCX_EXT.has(ext)) {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path: sourcePath })
    const content = value ?? ''
    return {
      kind: 'text',
      source: 'docx',
      content,
      extractedCharCount: content.length,
      ms: Date.now() - t0,
    }
  }

  if (PDF_EXT.has(ext)) {
    // Try the text layer first (cheap, deterministic).
    try {
      const buf = await readFile(sourcePath)
      const pdfParse = (await import('pdf-parse')).default
      const parsed = await pdfParse(buf)
      const text = (parsed.text ?? '').trim()
      if (text.length >= PDF_TEXT_MIN_CHARS) {
        return {
          kind: 'text',
          source: 'pdf_text',
          content: text,
          extractedCharCount: text.length,
          ms: Date.now() - t0,
        }
      }
    } catch {
      // fall through to Vision OCR
    }
    // Scan-only PDF — rasterize pages + OCR via vision-ocr (PDFKit + Vision in Swift).
    const content = (await runVisionOcr(sourcePath)).trim()
    return {
      kind: 'text',
      source: 'ocr_pdf',
      content,
      extractedCharCount: content.length,
      ms: Date.now() - t0,
    }
  }

  if (IMAGE_EXT.has(ext)) {
    const content = (await runVisionOcr(sourcePath)).trim()
    return {
      kind: 'text',
      source: 'ocr_image',
      content,
      extractedCharCount: content.length,
      ms: Date.now() - t0,
    }
  }

  return { kind: 'unsupported', reason: `extension ${ext} not supported in v1`, ms: Date.now() - t0 }
}

// Maps the new ExtractionSource → Prisma ExtractionKind enum value for the
// classification POST body. The values are 1:1 — the union is the same
// string set as the Prisma enum (post v2 migration).
export function sourceToExtractionKind(source: ExtractionSource): ExtractionSource {
  return source
}
