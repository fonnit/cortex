import { watch } from 'chokidar';
import { stat, readdir } from 'fs/promises';
import path from 'path';
import Langfuse from 'langfuse';

const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH ?? `${process.env.HOME}/Downloads`;
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — polling fallback
const DEBOUNCE_MS = 2000;

export function startDownloadsCollector(
  langfuse: Langfuse,
  onFile: (filePath: string) => Promise<void>,
  lastProcessedAt: Date,
): () => void {
  // Primary: chokidar FSEvents watcher
  const watcher = watch(DOWNLOADS_PATH, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 100 },
  });

  watcher.on('add', (filePath) => {
    onFile(filePath).catch((err: Error) => {
      langfuse.trace({
        name: 'downloads_ingest_error',
        metadata: { filePath, error: err.message },
      });
    });
  });

  watcher.on('error', (err: unknown) => {
    langfuse.trace({
      name: 'fsevents_error',
      metadata: { error: String(err) },
    });
  });

  // Startup scan: catch files newer than lastProcessedAt missed during downtime
  (async () => {
    try {
      const entries = await readdir(DOWNLOADS_PATH, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(DOWNLOADS_PATH, entry.name);
        const s = await stat(fullPath);
        if (s.mtimeMs > lastProcessedAt.getTime()) {
          await onFile(fullPath).catch((err: Error) => {
            langfuse.trace({
              name: 'startup_scan_error',
              metadata: { filePath: fullPath, error: err.message },
            });
          });
        }
      }
    } catch (err) {
      langfuse.trace({ name: 'startup_scan_error', metadata: { error: String(err) } });
    }
  })();

  // Secondary: polling fallback — catches events if FSEvents silently dies (Pitfall 1)
  let lastMtime = 0;
  const pollTimer = setInterval(async () => {
    try {
      const s = await stat(DOWNLOADS_PATH);
      if (s.mtimeMs !== lastMtime) {
        lastMtime = s.mtimeMs;
        langfuse.trace({ name: 'downloads_poll_mtime_change', metadata: { mtime: s.mtimeMs } });
        // Re-scan for new files not caught by FSEvents
        const entries = await readdir(DOWNLOADS_PATH, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const fullPath = path.join(DOWNLOADS_PATH, entry.name);
          const fs = await stat(fullPath);
          if (fs.mtimeMs > Date.now() - POLL_INTERVAL_MS) {
            await onFile(fullPath).catch(() => {});
          }
        }
      }
    } catch (err) {
      langfuse.trace({ name: 'poll_fallback_error', metadata: { error: String(err) } });
    }
  }, POLL_INTERVAL_MS);

  // Return cleanup function
  return () => {
    clearInterval(pollTimer);
    watcher.close();
  };
}
