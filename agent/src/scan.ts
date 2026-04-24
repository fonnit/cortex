// One-shot scanner — runs the full pipeline on files passed as arguments.
// Usage: node --env-file=.env.local --import=tsx agent/src/scan.ts <file1> [file2] ...

import path from 'path';
import Langfuse from 'langfuse';
import { sql } from './db.js';
import { computeHash, isDuplicate } from './pipeline/dedup.js';
import { extractContent } from './pipeline/extractor.js';
import { classifyRelevance } from './pipeline/relevance.js';
import { classifyLabel } from './pipeline/label.js';
import { uploadToInbox } from './drive.js';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  flushAt: 1,
  flushInterval: 5_000,
});

const USER_ID = process.env.CORTEX_USER_ID ?? 'user_3CovgXkm1ISUmszeWA9lqO3eN2Y';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: npx tsx agent/src/scan.ts <file1> [file2] ...');
  process.exit(1);
}

for (const filePath of files) {
  const abs = path.resolve(filePath);
  const filename = path.basename(abs);
  console.log(`\n── ${filename} ──`);

  const traceClient = langfuse.trace({ name: 'scan_file', input: { filePath: abs, filename } });
  const traceId = traceClient.id;

  // 1. Dedup
  const contentHash = await computeHash(abs);
  if (await isDuplicate(contentHash)) {
    console.log('  ⏭ duplicate — skipped');
    continue;
  }

  // 2. Extract
  const content = await extractContent(abs);
  console.log(`  📦 ${content.mimeType} · ${content.sizeBytes} bytes · ${content.content?.length ?? 0} chars extracted`);

  // 3. Stage 1: relevance
  const relevance = await classifyRelevance(filename, content.mimeType, content);
  console.log(`  🔍 relevance: ${relevance.decision} (${(relevance.confidence * 100).toFixed(0)}%) — ${relevance.reason}`);

  if (relevance.decision === 'ignore') {
    await sql`
      INSERT INTO "Item" (id, user_id, content_hash, source, status, filename, mime_type, size_bytes, classification_trace, ingested_at, updated_at)
      VALUES (gen_random_uuid()::text, ${USER_ID}, ${contentHash}, 'downloads', 'ignored', ${filename}, ${content.mimeType}, ${content.sizeBytes}, ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now())
      ON CONFLICT (content_hash) DO NOTHING
    `;
    console.log('  ❌ ignored');
    continue;
  }

  if (relevance.decision === 'uncertain') {
    await sql`
      INSERT INTO "Item" (id, user_id, content_hash, source, status, filename, mime_type, size_bytes, classification_trace, ingested_at, updated_at)
      VALUES (gen_random_uuid()::text, ${USER_ID}, ${contentHash}, 'downloads', 'uncertain', ${filename}, ${content.mimeType}, ${content.sizeBytes}, ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now())
      ON CONFLICT (content_hash) DO NOTHING
    `;
    console.log('  ❓ uncertain — queued for triage');
    continue;
  }

  // 4. Keep → insert as processing
  await sql`
    INSERT INTO "Item" (id, user_id, content_hash, source, status, filename, mime_type, size_bytes, classification_trace, ingested_at, updated_at)
    VALUES (gen_random_uuid()::text, ${USER_ID}, ${contentHash}, 'downloads', 'processing', ${filename}, ${content.mimeType}, ${content.sizeBytes}, ${JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance })}::jsonb, now(), now())
    ON CONFLICT (content_hash) DO NOTHING
  `;

  // 5. Stage 2: label
  const taxonomyRows = await sql`SELECT axis, name FROM "TaxonomyLabel" WHERE user_id = ${USER_ID} AND deprecated = false ORDER BY item_count DESC LIMIT 50`;
  const taxonomy = {
    types: taxonomyRows.filter((r) => r.axis === 'type').map((r) => r.name as string),
    froms: taxonomyRows.filter((r) => r.axis === 'from').map((r) => r.name as string),
    contexts: taxonomyRows.filter((r) => r.axis === 'context').map((r) => r.name as string),
  };

  const label = await classifyLabel(filename, content.mimeType, content.content, taxonomy);
  const status = label.allAxesConfident ? 'certain' : 'uncertain';

  console.log(`  🏷 type: ${label.axes.type.value} (${(label.axes.type.confidence * 100).toFixed(0)}%)`);
  console.log(`  🏷 from: ${label.axes.from.value} (${(label.axes.from.confidence * 100).toFixed(0)}%)`);
  console.log(`  🏷 context: ${label.axes.context.value} (${(label.axes.context.confidence * 100).toFixed(0)}%)`);
  console.log(`  📂 path: ${label.proposed_drive_path}`);
  console.log(`  → ${status === 'certain' ? '✅ auto-archived' : '❓ needs label triage'}`);

  const fullTrace = JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance, stage2: label });
  await sql`
    UPDATE "Item"
    SET status = ${status},
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
  `;

  // Skip Drive upload in scan mode — no Google OAuth yet
  console.log('  ⏭ Drive upload skipped (no OAuth token)');
}

console.log('\n── done ──');
await langfuse.flushAsync();
const rows = await sql`SELECT COUNT(*) as count FROM "Item"`;
console.log(`Total items in Neon: ${rows[0].count}`);
process.exit(0);
