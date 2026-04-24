import Langfuse from 'langfuse';
import path from 'path';
import { startHeartbeat } from './heartbeat.js';
import { startDownloadsCollector } from './collectors/downloads.js';
import { pollGmail, type GmailMessage } from './collectors/gmail.js';
import { sql } from './db.js';
import { computeHash, computeHashFromBuffer, isDuplicate } from './pipeline/dedup.js';
import { extractContent } from './pipeline/extractor.js';
import { classifyRelevance, classifyGmailRelevance } from './pipeline/relevance.js';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
  flushAt: 5,
  flushInterval: 30_000,
});

const CORTEX_USER_ID = process.env.CORTEX_USER_ID ?? 'daniel';
const GMAIL_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Determine startup cursor — last time any item was successfully ingested
async function getLastProcessedAt(): Promise<Date> {
  try {
    const rows = await sql`SELECT MAX(ingested_at) as last FROM "Item"`;
    return rows[0]?.last ? new Date(rows[0].last as string) : new Date(0);
  } catch {
    return new Date(0);
  }
}

async function handleFile(filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  const span = langfuse.trace({ name: 'ingest_file', input: { filePath, filename } });

  // 1. Dedup check — exits early if duplicate
  const contentHash = await computeHash(filePath);
  if (await isDuplicate(contentHash)) {
    span.update({ output: { status: 'duplicate_skip' } });
    return;
  }

  // 2. Size-band content extraction
  const content = await extractContent(filePath);

  // 3. Stage 1: relevance gate
  const relevanceSpan = langfuse.trace({ name: 'relevance_gate', input: { filename, mimeType: content.mimeType } });
  const relevance = await classifyRelevance(filename, content.mimeType, content);
  relevanceSpan.update({ output: relevance });

  // 4. Write Neon row FIRST (CLS-08: classification trace stored before any Drive action)
  if (relevance.decision === 'ignore') {
    // CLS-03: minimal row for ignored items
    await sql`
      INSERT INTO "Item" (
        id, user_id, content_hash, source, status,
        filename, mime_type, size_bytes,
        classification_trace, ingested_at, updated_at
      ) VALUES (
        gen_random_uuid()::text, ${CORTEX_USER_ID}, ${contentHash}, 'downloads', 'ignored',
        ${filename}, ${content.mimeType}, ${content.sizeBytes},
        ${JSON.stringify({ stage1: relevance })}::jsonb, now(), now()
      )
      ON CONFLICT (content_hash) DO NOTHING
    `;
    span.update({ output: { status: 'ignored', reason: relevance.reason } });
    return;
  }

  if (relevance.decision === 'uncertain') {
    // CLS-04: uncertain items -> triage queue
    await sql`
      INSERT INTO "Item" (
        id, user_id, content_hash, source, status,
        filename, mime_type, size_bytes,
        classification_trace, ingested_at, updated_at
      ) VALUES (
        gen_random_uuid()::text, ${CORTEX_USER_ID}, ${contentHash}, 'downloads', 'uncertain',
        ${filename}, ${content.mimeType}, ${content.sizeBytes},
        ${JSON.stringify({ stage1: relevance })}::jsonb, now(), now()
      )
      ON CONFLICT (content_hash) DO NOTHING
    `;
    span.update({ output: { status: 'uncertain' } });
    return;
  }

  // decision === 'keep': continue to Plan 05 (label classifier + Drive upload)
  // Store as 'processing' status — Plan 05 will update to 'certain' or 'uncertain'
  await sql`
    INSERT INTO "Item" (
      id, user_id, content_hash, source, status,
      filename, mime_type, size_bytes,
      classification_trace, ingested_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${CORTEX_USER_ID}, ${contentHash}, 'downloads', 'processing',
      ${filename}, ${content.mimeType}, ${content.sizeBytes},
      ${JSON.stringify({ stage1: relevance })}::jsonb, now(), now()
    )
    ON CONFLICT (content_hash) DO NOTHING
  `;
  // TODO: Plan 05 wires label classifier + Drive upload here
  span.update({ output: { status: 'keep_queued_for_label' } });
}

async function handleGmailMessage(msg: GmailMessage): Promise<void> {
  // Gmail uses message ID as dedup key — hash the ID bytes
  const contentHash = await computeHashFromBuffer(Buffer.from(msg.id));
  if (await isDuplicate(contentHash)) return;

  const relevance = await classifyGmailRelevance(msg);

  const status = relevance.decision === 'ignore' ? 'ignored'
    : relevance.decision === 'uncertain' ? 'uncertain'
    : 'processing';

  await sql`
    INSERT INTO "Item" (
      id, user_id, content_hash, source, status,
      source_metadata, classification_trace, ingested_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${CORTEX_USER_ID}, ${contentHash}, 'gmail', ${status},
      ${JSON.stringify(msg)}::jsonb,
      ${JSON.stringify({ stage1: relevance })}::jsonb,
      now(), now()
    )
    ON CONFLICT (content_hash) DO NOTHING
  `;
}

(async () => {
  const lastProcessedAt = await getLastProcessedAt();

  startHeartbeat(langfuse);

  const stopDownloads = startDownloadsCollector(langfuse, handleFile, lastProcessedAt);

  // Gmail polling: initial run on startup, then every 5 minutes
  const gmailPoll = async () => {
    try {
      await pollGmail(langfuse, handleGmailMessage);
    } catch (err) {
      langfuse.trace({ name: 'gmail_poll_error', metadata: { error: String(err) } });
    }
  };
  await gmailPoll().catch(() => {});
  setInterval(gmailPoll, GMAIL_POLL_INTERVAL_MS);

  console.log('[cortex] daemon started');
  langfuse.trace({ name: 'daemon_start', metadata: { pid: process.pid } });

  // Graceful cleanup on error
  process.on('uncaughtException', async (err) => {
    langfuse.trace({ name: 'daemon_uncaught_error', metadata: { error: err.message } });
    await langfuse.flushAsync().catch(() => {});
    stopDownloads();
    process.exit(1);
  });
})();
