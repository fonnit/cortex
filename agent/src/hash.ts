// Shared SHA256-file helper used by cortex-add CLI and the worker.

import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const fh = await open(path, 'r')
  try {
    const stream = fh.createReadStream({ highWaterMark: 1 << 16 })
    for await (const chunk of stream) hash.update(chunk as Buffer)
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}
