// One-shot Gmail test — fetches the latest email only.
// Usage: node --env-file=.env --import=tsx agent/src/test-gmail.ts

import { google } from 'googleapis';
import Langfuse from 'langfuse';
import { getGoogleOAuthClient } from './auth/google.js';
import { sql } from './db.js';
import { computeHashFromBuffer, isDuplicate } from './pipeline/dedup.js';
import { classifyGmailRelevance } from './pipeline/relevance.js';

const USER_ID = process.env.CORTEX_USER_ID ?? 'user_3Cp3nYpipz83FkIeojsC3WnivVf';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  flushAt: 1,
  flushInterval: 5_000,
});

const auth = await getGoogleOAuthClient();
const gmail = google.gmail({ version: 'v1', auth });

console.log('Fetching latest email...');

const listRes = await gmail.users.messages.list({
  userId: 'me',
  maxResults: 1,
});

const msgId = listRes.data.messages?.[0]?.id;
if (!msgId) {
  console.log('No messages found.');
  process.exit(0);
}

const msg = await gmail.users.messages.get({
  userId: 'me',
  id: msgId,
  format: 'metadata',
  metadataHeaders: ['Subject', 'From', 'Date'],
});

const headers = msg.data.payload?.headers ?? [];
const get = (name: string) => headers.find((h) => h.name === name)?.value ?? '—';

const subject = get('Subject');
const from = get('From');
const snippet = msg.data.snippet ?? '';
const sizeEstimate = msg.data.sizeEstimate ?? 0;

console.log(`\n── ${subject} ──`);
console.log(`  from: ${from}`);
console.log(`  snippet: ${snippet.slice(0, 100)}...`);
console.log(`  size: ${sizeEstimate} bytes`);

// Dedup
const contentHash = await computeHashFromBuffer(Buffer.from(msgId));
if (await isDuplicate(contentHash)) {
  console.log('  ⏭ duplicate — skipped');
  process.exit(0);
}

// Classify
console.log('  🔍 classifying...');
const relevance = await classifyGmailRelevance({ subject, from, snippet, sizeEstimate });
console.log(`  🔍 relevance: ${relevance.decision} (${(relevance.confidence * 100).toFixed(0)}%) — ${relevance.reason}`);

const status = relevance.decision === 'ignore' ? 'ignored'
  : relevance.decision === 'uncertain' ? 'uncertain'
  : 'processing';

const traceId = langfuse.trace({ name: 'test_gmail', input: { id: msgId, subject } }).id;

await sql`
  INSERT INTO "Item" (
    id, user_id, content_hash, source, status,
    filename, source_metadata, classification_trace, ingested_at, updated_at
  ) VALUES (
    gen_random_uuid()::text, ${USER_ID}, ${contentHash}, 'gmail', ${status},
    ${subject}, ${JSON.stringify({ subject, from, snippet, sizeEstimate })}::jsonb,
    ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb,
    now(), now()
  )
  ON CONFLICT (content_hash) DO NOTHING
`;

console.log(`  → ${status}`);

// Update Gmail cursor so daemon doesn't re-fetch
const profile = await gmail.users.getProfile({ userId: 'me' });
if (profile.data.historyId) {
  await sql`
    INSERT INTO "GmailCursor" (id, user_id, last_history_id, last_successful_poll_at, updated_at)
    VALUES (gen_random_uuid()::text, ${USER_ID}, ${profile.data.historyId}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      last_history_id = ${profile.data.historyId},
      last_successful_poll_at = now(),
      updated_at = now()
  `;
  console.log(`  📌 Gmail cursor set to historyId ${profile.data.historyId}`);
}

await langfuse.flushAsync();
const rows = await sql`SELECT COUNT(*) as count FROM "Item"`;
console.log(`\nTotal items in Neon: ${rows[0].count}`);
process.exit(0);
