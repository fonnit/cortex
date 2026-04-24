import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { sql } from '../db.js';

export async function computeHash(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function computeHashFromBuffer(buf: Buffer): Promise<string> {
  return createHash('sha256').update(buf).digest('hex');
}

export async function isDuplicate(contentHash: string): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM "Item" WHERE content_hash = ${contentHash} LIMIT 1
  `;
  return rows.length > 0;
}
