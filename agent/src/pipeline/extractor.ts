import { readFile, stat } from 'fs/promises';
import path from 'path';

export interface ContentResult {
  content: string | null;   // null = metadata-only
  mimeType: string;
  sizeBytes: number;
  metadataOnly: boolean;
  reason?: string;           // why content was skipped
}

// Size limits per ING-04
const LIMITS = {
  pdf: 5 * 1024 * 1024,      // 5 MB
  image: 10 * 1024 * 1024,   // 10 MB
  default: 1 * 1024 * 1024,  // 1 MB
};

const INSTALLER_EXTS = new Set(['.dmg', '.pkg', '.exe', '.msi', '.deb', '.rpm', '.appimage']);
const INSTALLER_MIMES = new Set([
  'application/x-apple-diskimage',
  'application/vnd.apple.installer+xml',
  'application/x-msi',
  'application/x-msdownload',
]);

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.dmg': 'application/x-apple-diskimage',
    '.pkg': 'application/vnd.apple.installer+xml',
    '.exe': 'application/x-msdownload',
    '.zip': 'application/zip',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

export async function extractContent(filePath: string): Promise<ContentResult> {
  const s = await stat(filePath);
  const sizeBytes = s.size;
  const mimeType = guessMimeType(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Installer check: always metadata-only
  if (INSTALLER_EXTS.has(ext) || INSTALLER_MIMES.has(mimeType)) {
    return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'installer' };
  }

  // PDF: content-read only if <= 5 MB
  if (mimeType === 'application/pdf') {
    if (sizeBytes > LIMITS.pdf) {
      return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'pdf_too_large' };
    }
    try {
      // Using dynamic import so absence of pdf-parse doesn't crash the module
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — pdf-parse is optional; fallback to null if not installed
      const pdfParse = await import('pdf-parse').then((m: { default: (buf: Buffer) => Promise<{ text: string }> }) => m.default).catch(() => null);
      if (pdfParse) {
        const buf = await readFile(filePath);
        const parsed = await pdfParse(buf);
        return { content: parsed.text ?? null, mimeType, sizeBytes, metadataOnly: false };
      }
    } catch {
      // Fall through to metadata-only if pdf-parse fails
    }
    return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'pdf_parse_unavailable' };
  }

  // Images: content-read only if <= 10 MB (content = base64 for multimodal Claude)
  if (mimeType.startsWith('image/')) {
    if (sizeBytes > LIMITS.image) {
      return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'image_too_large' };
    }
    const buf = await readFile(filePath);
    return { content: buf.toString('base64'), mimeType, sizeBytes, metadataOnly: false };
  }

  // Default: text content-read if <= 1 MB
  if (sizeBytes > LIMITS.default) {
    return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'default_too_large' };
  }

  try {
    const text = await readFile(filePath, 'utf-8');
    return { content: text, mimeType, sizeBytes, metadataOnly: false };
  } catch {
    return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'read_error' };
  }
}
