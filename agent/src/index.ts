import Langfuse from 'langfuse';
import { startHeartbeat } from './heartbeat.js';
import { startDownloadsCollector } from './collectors/downloads.js';
import { sql } from './db.js';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
  flushAt: 5,
  flushInterval: 30_000,
});

// Determine startup cursor — last time any item was successfully ingested
async function getLastProcessedAt(): Promise<Date> {
  try {
    const rows = await sql`SELECT MAX(ingested_at) as last FROM "Item"`;
    return rows[0]?.last ? new Date(rows[0].last as string) : new Date(0);
  } catch {
    return new Date(0);
  }
}

// Stub ingest handler — replaced by pipeline in Plans 04/05
async function handleFile(filePath: string): Promise<void> {
  console.log(`[cortex] queued: ${filePath}`);
  // TODO: Plan 04 wires dedup + size-band + relevance gate here
}

(async () => {
  const lastProcessedAt = await getLastProcessedAt();

  startHeartbeat(langfuse);

  const stopDownloads = startDownloadsCollector(langfuse, handleFile, lastProcessedAt);

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
