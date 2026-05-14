// GET /api/taxonomy — folder tree. Accepts user or machine. ETag-cached.

import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getFolderTree } from '@/lib/taxonomy'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    await requireAuth(['user', 'machine'])
    const folders = await getFolderTree()
    const body = JSON.stringify({ folders })
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex') + '"'

    const inm = req.headers.get('if-none-match')
    if (inm === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } })
    }

    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: etag },
    })
  } catch (e) {
    if (isHttpError(e)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[GET /api/taxonomy]', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
