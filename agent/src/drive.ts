import { google } from 'googleapis';
import { createReadStream } from 'fs';
import path from 'path';
import { getGoogleOAuthClient } from './auth/google.js';

// Cache folder IDs to avoid repeat API calls in the same session
const folderCache = new Map<string, string>();

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderName: string,
  parentId: string,
): Promise<string> {
  const key = `${parentId}/${folderName}`;
  if (folderCache.has(key)) return folderCache.get(key)!;

  // Search for existing folder
  const search = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
  });

  if (search.data.files && search.data.files.length > 0) {
    const id = search.data.files[0].id!;
    folderCache.set(key, id);
    return id;
  }

  // Create folder
  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  const id = res.data.id!;
  folderCache.set(key, id);
  return id;
}

export async function uploadToInbox(
  filePath: string,
  mimeType: string,
): Promise<string> {
  const auth = await getGoogleOAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // DRIVE_INBOX_FOLDER_ID must be set to the Drive folder ID of _Inbox root
  const inboxRootId = process.env.DRIVE_INBOX_FOLDER_ID;
  if (!inboxRootId) {
    throw new Error('DRIVE_INBOX_FOLDER_ID is required — set to the Drive folder ID of _Inbox');
  }

  // Two-phase lifecycle: _Inbox/{YYYY-MM}/{filename}
  const now = new Date();
  const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthFolderId = await getOrCreateFolder(drive, monthFolder, inboxRootId);

  const filename = path.basename(filePath);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [monthFolderId],
    },
    media: {
      mimeType,
      body: createReadStream(filePath),
    },
    fields: 'id',
  });

  return res.data.id!; // drive_inbox_id — stored in Neon Item row
}
