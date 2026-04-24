"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToInbox = uploadToInbox;
const googleapis_1 = require("googleapis");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const google_js_1 = require("./auth/google.js");
// Cache folder IDs to avoid repeat API calls in the same session
const folderCache = new Map();
async function getOrCreateFolder(drive, folderName, parentId) {
    const key = `${parentId}/${folderName}`;
    if (folderCache.has(key))
        return folderCache.get(key);
    // Search for existing folder
    const search = await drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id)',
    });
    if (search.data.files && search.data.files.length > 0) {
        const id = search.data.files[0].id;
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
    const id = res.data.id;
    folderCache.set(key, id);
    return id;
}
async function uploadToInbox(filePath, mimeType) {
    const auth = await (0, google_js_1.getGoogleOAuthClient)();
    const drive = googleapis_1.google.drive({ version: 'v3', auth });
    // DRIVE_INBOX_FOLDER_ID must be set to the Drive folder ID of _Inbox root
    const inboxRootId = process.env.DRIVE_INBOX_FOLDER_ID;
    if (!inboxRootId) {
        throw new Error('DRIVE_INBOX_FOLDER_ID is required — set to the Drive folder ID of _Inbox');
    }
    // Two-phase lifecycle: _Inbox/{YYYY-MM}/{filename}
    const now = new Date();
    const monthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthFolderId = await getOrCreateFolder(drive, monthFolder, inboxRootId);
    const filename = path_1.default.basename(filePath);
    const res = await drive.files.create({
        requestBody: {
            name: filename,
            parents: [monthFolderId],
        },
        media: {
            mimeType,
            body: (0, fs_1.createReadStream)(filePath),
        },
        fields: 'id',
    });
    return res.data.id; // drive_inbox_id — stored in Neon Item row
}
