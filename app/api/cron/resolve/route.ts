import { NextRequest } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Walk proposed_drive_path segments, creating folders that don't exist.
// Returns the ID of the deepest folder.
async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderPath: string,
  rootId: string,
): Promise<string> {
  // Strip leading slash and split into segments; ignore empty parts
  const segments = folderPath.replace(/^\//, '').split('/').filter(Boolean)
  let parentId = rootId

  for (const segment of segments) {
    const search = await drive.files.list({
      q: `name='${segment}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
    })

    if (search.data.files && search.data.files.length > 0) {
      parentId = search.data.files[0].id!
    } else {
      const res = await drive.files.create({
        requestBody: {
          name: segment,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      })
      parentId = res.data.id!
    }
  }

  return parentId
}

export async function POST(request: NextRequest) {
  // T-02-10: Validate CRON_SECRET header
  if (
    request.headers.get('authorization') !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  const inboxFolderId = process.env.DRIVE_INBOX_FOLDER_ID
  if (!inboxFolderId) {
    return new Response('DRIVE_INBOX_FOLDER_ID not configured', { status: 500 })
  }

  // Build Drive client from stored refresh token (user OAuth — not service account)
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  const drive = google.drive({ version: 'v3', auth })

  // Fetch items to resolve: certain, have inbox ID, not yet filed
  const items = await prisma.item.findMany({
    where: {
      status: 'certain',
      drive_inbox_id: { not: null },
      drive_filed_id: null,
    },
    take: 20, // Stay within Vercel 60s function timeout at 350ms/item
  })

  let resolved = 0
  let errors = 0

  for (const item of items) {
    try {
      const proposedPath = item.proposed_drive_path!
      // Strip filename (last segment) to get the folder path
      const segments = proposedPath.replace(/^\//, '').split('/')
      const filename = segments.at(-1)!
      const folderSegments = segments.slice(0, -1)
      const folderPath = folderSegments.join('/')

      const targetFolderId = await getOrCreateFolder(drive, folderPath, inboxFolderId)

      // DRV-05: collision check — if same name exists in target, append hash suffix
      const existing = await drive.files.list({
        q: `'${targetFolderId}' in parents and name='${filename}' and trashed=false`,
        fields: 'files(id)',
      })

      let finalName = filename
      if (existing.data.files && existing.data.files.length > 0) {
        const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
        const base = filename.slice(0, filename.length - ext.length)
        finalName = `${base}-${item.content_hash.slice(0, 6)}${ext}`
      }

      // DRV-02: files.update preserves drive_file_id (never re-upload)
      await drive.files.update({
        fileId: item.drive_inbox_id!,
        addParents: targetFolderId,
        removeParents: inboxFolderId,
        requestBody: { name: finalName },
        fields: 'id, parents',
      })

      await prisma.item.update({
        where: { id: item.id },
        data: {
          status: 'filed',
          drive_filed_id: item.drive_inbox_id,
          confirmed_drive_path: proposedPath,
          resolve_error: null,
        },
      })

      resolved++
    } catch (err) {
      // DRV-04: write per-item error — item retries on next cron run
      await prisma.item.update({
        where: { id: item.id },
        data: {
          resolve_error: JSON.stringify({
            message: String(err),
            at: new Date().toISOString(),
          }),
        },
      })
      errors++
    }

    // DRV-03: 3 ops/sec Drive API rate limit → 350ms between moves
    await sleep(350)
  }

  return Response.json({ ok: true, resolved, errors })
}
