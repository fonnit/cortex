"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollGmail = pollGmail;
const googleapis_1 = require("googleapis");
const db_js_1 = require("../db.js");
const google_js_1 = require("../auth/google.js");
const USER_ID = 'me';
// Hardcoded single-operator user_id for MVP — tenancy-ready schema, single user
const CORTEX_USER_ID = process.env.CORTEX_USER_ID ?? 'daniel';
async function getOrCreateCursor() {
    const rows = await (0, db_js_1.sql) `
    SELECT last_history_id, last_successful_poll_at
    FROM "GmailCursor"
    WHERE user_id = ${CORTEX_USER_ID}
    LIMIT 1
  `;
    if (rows.length > 0) {
        return {
            last_history_id: rows[0].last_history_id,
            last_successful_poll_at: rows[0].last_successful_poll_at
                ? new Date(rows[0].last_successful_poll_at)
                : null,
        };
    }
    // First run — insert cursor row
    await (0, db_js_1.sql) `
    INSERT INTO "GmailCursor" (id, user_id, updated_at)
    VALUES (gen_random_uuid()::text, ${CORTEX_USER_ID}, now())
    ON CONFLICT (user_id) DO NOTHING
  `;
    return { last_history_id: null, last_successful_poll_at: null };
}
async function persistCursor(historyId) {
    await (0, db_js_1.sql) `
    UPDATE "GmailCursor"
    SET last_history_id = ${historyId},
        last_successful_poll_at = now(),
        updated_at = now()
    WHERE user_id = ${CORTEX_USER_ID}
  `;
}
async function extractMessageMetadata(gmail, messageId) {
    const msg = await gmail.users.messages.get({
        userId: USER_ID,
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
    });
    const headers = msg.data.payload?.headers ?? [];
    const get = (name) => headers.find((h) => h.name === name)?.value ?? undefined;
    return {
        id: messageId,
        threadId: msg.data.threadId ?? messageId,
        subject: get('Subject'),
        from: get('From'),
        date: get('Date'),
        snippet: msg.data.snippet ?? undefined,
        sizeEstimate: msg.data.sizeEstimate ?? undefined,
    };
}
async function fullSyncFallback(gmail, langfuse, onMessage, since) {
    langfuse.trace({
        name: 'gmail_fullsync_fallback',
        metadata: {
            reason: 'historyId_expired_or_null',
            since: since?.toISOString() ?? 'epoch',
        },
    });
    // List messages since the fallback timestamp (or last 7 days if no cursor)
    const afterDate = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const afterEpochSeconds = Math.floor(afterDate.getTime() / 1000);
    let pageToken;
    do {
        const listRes = await gmail.users.messages.list({
            userId: USER_ID,
            q: `after:${afterEpochSeconds}`,
            pageToken,
            maxResults: 100,
        });
        const messages = listRes.data.messages ?? [];
        for (const msg of messages) {
            if (!msg.id)
                continue;
            const metadata = await extractMessageMetadata(gmail, msg.id);
            await onMessage(metadata).catch((err) => {
                langfuse.trace({ name: 'gmail_message_error', metadata: { id: msg.id, error: err.message } });
            });
        }
        pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);
    // Fetch current historyId to reset cursor
    const profile = await gmail.users.getProfile({ userId: USER_ID });
    if (profile.data.historyId) {
        await persistCursor(profile.data.historyId);
    }
}
async function pollGmail(langfuse, onMessage) {
    const auth = await (0, google_js_1.getGoogleOAuthClient)();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    const cursor = await getOrCreateCursor();
    if (!cursor.last_history_id) {
        // First run — fall back to full sync
        await fullSyncFallback(gmail, langfuse, onMessage, cursor.last_successful_poll_at);
        return;
    }
    try {
        const res = await gmail.users.history.list({
            userId: USER_ID,
            startHistoryId: cursor.last_history_id,
            historyTypes: ['messageAdded'],
        });
        const records = res.data.history ?? [];
        for (const record of records) {
            const added = record.messagesAdded ?? [];
            for (const entry of added) {
                if (!entry.message?.id)
                    continue;
                const metadata = await extractMessageMetadata(gmail, entry.message.id);
                await onMessage(metadata).catch((err) => {
                    langfuse.trace({ name: 'gmail_message_error', metadata: { id: entry.message?.id, error: err.message } });
                });
            }
        }
        // Persist new cursor — ING-06: cursor in Neon, not local file
        if (res.data.historyId) {
            await persistCursor(res.data.historyId);
        }
    }
    catch (err) {
        const gaxiosErr = err;
        const statusCode = gaxiosErr.code ?? gaxiosErr.status;
        if (statusCode === 404) {
            // Explicit 404 handling — ING-06: not a silent drop
            await fullSyncFallback(gmail, langfuse, onMessage, cursor.last_successful_poll_at);
        }
        else {
            // Re-throw non-404 errors for the caller to handle
            langfuse.trace({ name: 'gmail_poll_error', metadata: { error: String(err) } });
            throw err;
        }
    }
}
