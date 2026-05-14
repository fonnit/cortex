// GET /api/taxonomy — folder tree for the current user.
// Accepts user (browser triage picker) AND machine (worker classify prompt).
// Returns ETag header; supports If-None-Match for 304 (worker caches).
//
// ETag is sha1(JSON.stringify(folders)) — fine for v1 scale (≤100 folders).

import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getFolderTreeForUser } from '@/lib/taxonomy'
import { requireAuth } from '@/lib/require-auth'
import { isHttpError } from '@/lib/http-error'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const identity = await requireAuth(['user', 'machine'])
    const folders = await getFolderTreeForUser(identity.userId)
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
    console.error('[GET /api/taxonomy] error', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
