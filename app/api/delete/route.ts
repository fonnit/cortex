import { NextRequest } from 'next/server'
import { google } from 'googleapis'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest) {
  // T-02-11: Auth check — throws 401 Response if not authenticated
  const userId = await requireAuth()

  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('itemId')
  if (!itemId) {
    return new Response('itemId is required', { status: 400 })
  }

  // T-02-11: Verify ownership before any Drive or DB operation
  const item = await prisma.item.findFirst({
    where: { id: itemId, user_id: userId },
  })
  if (!item) {
    return new Response('Not found', { status: 404 })
  }

  // Determine active Drive file ID: filed takes priority over inbox
  const driveFileId = item.drive_filed_id ?? item.drive_inbox_id

  if (driveFileId) {
    try {
      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      )
      auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
      const drive = google.drive({ version: 'v3', auth })

      await drive.files.delete({ fileId: driveFileId })
    } catch (err: unknown) {
      // Catch Drive 404 gracefully — file may already be gone; do not block Neon deletion
      const status = (err as { code?: number })?.code
      if (status !== 404) {
        console.error('[delete] Drive delete failed for fileId', driveFileId, err)
      }
    }
  }

  // Delete Neon row — embeddings are a column on Item, deleted with the row
  await prisma.item.delete({ where: { id: itemId } })

  return Response.json({ ok: true })
}
