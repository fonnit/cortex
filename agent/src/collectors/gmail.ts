// agent/src/collectors/gmail.ts — Phase 6 Plan 02 Task 3
// Polls Gmail incrementally via historyId; emits IngestRequest payloads
// (one per message) to a callback. No Neon access — cursor lives in
// agent/src/cursor/gmail-cursor.ts (a local file under ~/.config/cortex/).
//
// Preserves the v1.0 historyId 404 → fullSyncFallback behaviour (ING-06).

import { google, gmail_v1 } from 'googleapis'
import crypto from 'crypto'
import type Langfuse from 'langfuse'

import { getGoogleOAuthClient } from '../auth/google.js'
import { readCursor, writeCursor } from '../cursor/gmail-cursor.js'
import type { IngestRequest } from '../http/types.js'

const USER_ID = 'me'

interface GmailMessage {
  id: string
  threadId: string
  subject?: string
  from?: string
  date?: string
  snippet?: string
  sizeEstimate?: number
  headers?: Record<string, string>
}

async function fetchMetadata(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<GmailMessage> {
  const msg = await gmail.users.messages.get({
    userId: USER_ID,
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date', 'Message-ID', 'List-Unsubscribe'],
  })
  const headers = msg.data.payload?.headers ?? []
  const get = (name: string) => headers.find((h) => h.name === name)?.value ?? undefined
  const headerMap: Record<string, string> = {}
  for (const h of headers) if (h.name && h.value) headerMap[h.name] = h.value
  const result: GmailMessage = {
    id: messageId,
    threadId: msg.data.threadId ?? messageId,
    headers: headerMap,
  }
  const subject = get('Subject')
  if (subject !== undefined) result.subject = subject
  const from = get('From')
  if (from !== undefined) result.from = from
  const date = get('Date')
  if (date !== undefined) result.date = date
  if (msg.data.snippet) result.snippet = msg.data.snippet
  if (typeof msg.data.sizeEstimate === 'number') result.sizeEstimate = msg.data.sizeEstimate
  return result
}

function toIngestRequest(msg: GmailMessage): IngestRequest {
  // Dedup key: SHA-256 of the gmail message id (same convention as v1.0).
  const content_hash = crypto.createHash('sha256').update(msg.id).digest('hex')
  return {
    source: 'gmail',
    content_hash,
    source_metadata: {
      gmail_id: msg.id,
      threadId: msg.threadId,
      subject: msg.subject,
      from: msg.from,
      date: msg.date,
      snippet: msg.snippet,
      sizeEstimate: msg.sizeEstimate,
      headers: msg.headers,
    },
  }
}

async function fullSyncFallback(
  gmail: gmail_v1.Gmail,
  langfuse: Langfuse,
  onPayload: (p: IngestRequest) => void,
  since: string | null,
): Promise<void> {
  langfuse.trace({
    name: 'gmail_fullsync_fallback',
    metadata: { reason: 'historyId_expired_or_null', since: since ?? 'epoch' },
  })
  const afterDate = since ? new Date(since) : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
  const afterEpochSeconds = Math.floor(afterDate.getTime() / 1000)

  let pageToken: string | undefined
  do {
    const listRes = await gmail.users.messages.list({
      userId: USER_ID,
      q: `after:${afterEpochSeconds}`,
      pageToken,
      maxResults: 100,
    })
    const messages = listRes.data.messages ?? []
    for (const m of messages) {
      if (!m.id) continue
      try {
        const meta = await fetchMetadata(gmail, m.id)
        onPayload(toIngestRequest(meta))
      } catch (err) {
        langfuse.trace({
          name: 'gmail_message_error',
          metadata: { id: m.id, error: String(err) },
        })
      }
    }
    pageToken = listRes.data.nextPageToken ?? undefined
  } while (pageToken)

  const profile = await gmail.users.getProfile({ userId: USER_ID })
  if (profile.data.historyId) await writeCursor(profile.data.historyId)
}

/**
 * One Gmail poll cycle. Reads the persisted cursor, runs an incremental
 * `users.history.list` against the stored `historyId`, and emits an
 * IngestRequest per added message. On historyId 404 (cursor expired), falls
 * back to a full sync. The cursor is updated on every successful path.
 */
export async function pollGmail(
  langfuse: Langfuse,
  onPayload: (p: IngestRequest) => void,
): Promise<void> {
  const auth = await getGoogleOAuthClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const cursor = await readCursor()

  if (!cursor || !cursor.last_history_id) {
    await fullSyncFallback(gmail, langfuse, onPayload, cursor?.last_successful_poll_at ?? null)
    return
  }

  try {
    const res = await gmail.users.history.list({
      userId: USER_ID,
      startHistoryId: cursor.last_history_id,
      historyTypes: ['messageAdded'],
    })
    const records = res.data.history ?? []
    for (const record of records) {
      const added = record.messagesAdded ?? []
      for (const entry of added) {
        if (!entry.message?.id) continue
        try {
          const meta = await fetchMetadata(gmail, entry.message.id)
          onPayload(toIngestRequest(meta))
        } catch (err) {
          langfuse.trace({
            name: 'gmail_message_error',
            metadata: { id: entry.message.id, error: String(err) },
          })
        }
      }
    }
    if (res.data.historyId) await writeCursor(res.data.historyId)
  } catch (err: unknown) {
    const e = err as { code?: number; status?: number }
    const statusCode = e.code ?? e.status
    if (statusCode === 404) {
      // ING-06: explicit fallback on cursor expiry.
      await fullSyncFallback(gmail, langfuse, onPayload, cursor.last_successful_poll_at)
    } else {
      langfuse.trace({ name: 'gmail_poll_error', metadata: { error: String(err) } })
      throw err
    }
  }
}
