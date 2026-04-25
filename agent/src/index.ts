import Langfuse from 'langfuse';
import path from 'path';
import { startHeartbeat } from './heartbeat.js';
import { startDownloadsCollector } from './collectors/downloads.js';
import { pollGmail, type GmailMessage } from './collectors/gmail.js';
import { sql } from './db.js';
import { computeHash, computeHashFromBuffer, isDuplicate } from './pipeline/dedup.js';
import { extractContent } from './pipeline/extractor.js';
import { classifyRelevance, classifyGmailRelevance } from './pipeline/relevance.js';
import { classifyLabel } from './pipeline/label.js';
import { uploadToInbox } from './drive.js';
import { snapshotMetrics } from './metrics.js';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
  flushAt: 5,
  flushInterval: 30_000,
});

const CORTEX_USER_ID = process.env.CORTEX_USER_ID ?? 'user_3Cp3nYpipz83FkIeojsC3WnivVf';
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
  const traceClient = langfuse.trace({ name: 'ingest_file', input: { filePath, filename } });
  const traceId = traceClient.id;
  const span = traceClient;

  console.log(`[file] ${filename}`);

  // 1. Dedup check — exits early if duplicate
  const contentHash = await computeHash(filePath);
  if (await isDuplicate(contentHash)) {
    span.update({ output: { status: 'duplicate_skip' } });
    console.log(`  skip (duplicate)`);
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
        ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now()
      )
      ON CONFLICT (content_hash) DO NOTHING
    `;
    span.update({ output: { status: 'ignored', reason: relevance.reason } });
    console.log(`  → ignored (${relevance.reason})`);
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
        ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now()
      )
      ON CONFLICT (content_hash) DO NOTHING
    `;
    span.update({ output: { status: 'uncertain' } });
    console.log(`  → uncertain (${relevance.reason})`);
    return;
  }

  // decision === 'keep': Stage 2 label classifier + Drive upload
  // Insert as 'processing' first — will be updated to 'certain' or 'uncertain' after Stage 2
  await sql`
    INSERT INTO "Item" (
      id, user_id, content_hash, source, status,
      filename, mime_type, size_bytes,
      classification_trace, ingested_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${CORTEX_USER_ID}, ${contentHash}, 'downloads', 'processing',
      ${filename}, ${content.mimeType}, ${content.sizeBytes},
      ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now()
    )
    ON CONFLICT (content_hash) DO NOTHING
  `;

  // Fetch existing taxonomy for label classifier context
  const taxonomyRows = await sql`
    SELECT axis, name FROM "TaxonomyLabel"
    WHERE user_id = ${CORTEX_USER_ID} AND deprecated = false
    ORDER BY item_count DESC
    LIMIT 50
  `;
  const existingTaxonomy = {
    types: taxonomyRows.filter((r) => r.axis === 'type').map((r) => r.name as string),
    froms: taxonomyRows.filter((r) => r.axis === 'from').map((r) => r.name as string),
    contexts: taxonomyRows.filter((r) => r.axis === 'context').map((r) => r.name as string),
  };

  // Stage 2: label classifier
  const labelSpan = langfuse.trace({ name: 'label_classifier', input: { filename } });
  const label = await classifyLabel(
    filename,
    content.mimeType,
    content.content,
    existingTaxonomy,
  );
  labelSpan.update({ output: label });

  const finalStatus = label.allAxesConfident ? 'certain' : 'uncertain';
  console.log(`  → ${finalStatus} | type:${label.axes.type.value} from:${label.axes.from.value} ctx:${label.axes.context.value}`);

  // CLS-08: write COMPLETE trace (stage1 + stage2) to Neon BEFORE Drive upload
  const fullTrace = JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance, stage2: label });
  const itemRows = await sql`
    UPDATE "Item"
    SET status = ${finalStatus},
        classification_trace = ${fullTrace}::jsonb,
        proposed_drive_path = ${label.proposed_drive_path},
        axis_type = ${label.axes.type.value},
        axis_from = ${label.axes.from.value},
        axis_context = ${label.axes.context.value},
        axis_type_confidence = ${label.axes.type.confidence},
        axis_from_confidence = ${label.axes.from.confidence},
        axis_context_confidence = ${label.axes.context.confidence},
        updated_at = now()
    WHERE content_hash = ${contentHash}
    RETURNING id
  `;

  // Drive upload AFTER Neon write — DRV-01 two-phase lifecycle
  if (itemRows.length > 0) {
    try {
      const driveInboxId = await uploadToInbox(filePath, content.mimeType);
      await sql`
        UPDATE "Item"
        SET drive_inbox_id = ${driveInboxId}, updated_at = now()
        WHERE content_hash = ${contentHash}
      `;
      span.update({ output: { status: finalStatus, drive_inbox_id: driveInboxId } });
    } catch (driveErr: unknown) {
      // Drive upload failed — Neon row is intact; Drive upload can be retried
      langfuse.trace({
        name: 'drive_upload_error',
        metadata: { filename, error: String(driveErr) },
      });
      span.update({ output: { status: finalStatus, drive_error: String(driveErr) } });
    }
  }
}

async function handleGmailMessage(msg: GmailMessage): Promise<void> {
  // Gmail uses message ID as dedup key — hash the ID bytes
  const contentHash = await computeHashFromBuffer(Buffer.from(msg.id));
  if (await isDuplicate(contentHash)) return;

  const gmailTraceClient = langfuse.trace({ name: 'ingest_gmail', input: { id: msg.id } });
  const gmailTraceId = gmailTraceClient.id;

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
      ${JSON.stringify({ langfuse_trace_id: gmailTraceId, stage1: relevance })}::jsonb,
      now(), now()
    )
    ON CONFLICT (content_hash) DO NOTHING
  `;

  gmailTraceClient.update({ output: { status } });
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

  // Daily metrics snapshot — OBS-06
  const runSnapshot = async () => {
    try {
      await snapshotMetrics();
      langfuse.trace({ name: 'metrics_snapshot', metadata: { ts: Date.now() } });
    } catch (err) {
      langfuse.trace({ name: 'metrics_snapshot_error', metadata: { error: String(err) } });
    }
  };
  // Run at startup (after a 10-second delay to let first items process)
  setTimeout(runSnapshot, 10_000);
  // Run every 24 hours
  setInterval(runSnapshot, 24 * 60 * 60 * 1000);

  // Graceful cleanup on error
  process.on('uncaughtException', async (err) => {
    langfuse.trace({ name: 'daemon_uncaught_error', metadata: { error: err.message } });
    await langfuse.flushAsync().catch(() => {});
    stopDownloads();
    process.exit(1);
  });
})();
