import { watch } from 'chokidar';
import { stat, readdir } from 'fs/promises';
import path from 'path';
import Langfuse from 'langfuse';

const home = process.env.HOME ?? '';
const WATCH_PATHS = (process.env.WATCH_PATHS ?? process.env.DOWNLOADS_PATH ?? `${home}/Downloads`)
  .split(',')
  .map((p) => p.trim().replace(/^~/, home))
  .filter(Boolean);
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — polling fallback
const DEBOUNCE_MS = 2000;

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', '.next', '.cache']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);

export function startDownloadsCollector(
  langfuse: Langfuse,
  onFile: (filePath: string) => Promise<void>,
  lastProcessedAt: Date,
): () => void {
  const watcher = watch(WATCH_PATHS, {
    persistent: true,
    ignoreInitial: true,
    ignored: (filePath: string) => {
      const parts = filePath.split('/');
      return parts.some(p =>
        p === '.git' || p === 'node_modules' || p === '__pycache__' ||
        p === 'venv' || p === '.venv' || p === '.next' || p === '.cache'
      );
    },
    awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 100 },
  });

  watcher.on('error', (err: unknown) => {
    langfuse.trace({
      name: 'fsevents_error',
      metadata: { error: String(err) },
    });
  });

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await scanDir(fullPath);
        } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && !entry.name.startsWith('.')) {
          await onFile(fullPath).catch((err: Error) => {
            langfuse.trace({ name: 'startup_scan_error', metadata: { filePath: fullPath, error: err.message } });
          });
        }
      }
    } catch (err) {
      langfuse.trace({ name: 'startup_scan_error', metadata: { dir, error: String(err) } });
    }
  }

  // Startup scan first, then start watching for new files
  (async () => {
    console.log(`[scan] scanning ${WATCH_PATHS.join(', ')}...`);
    for (const watchPath of WATCH_PATHS) {
      await scanDir(watchPath);
    }
    console.log('[scan] startup scan complete — now watching for new files');
    watcher.on('add', (filePath) => {
      const name = path.basename(filePath);
      if (name.startsWith('.') || SKIP_FILES.has(name)) return;
      onFile(filePath).catch((err: Error) => {
        langfuse.trace({ name: 'downloads_ingest_error', metadata: { filePath, error: err.message } });
      });
    });
  })();

  // Polling fallback — catches events if FSEvents silently dies
  const lastMtimes: Record<string, number> = {};
  const pollTimer = setInterval(async () => {
    for (const watchPath of WATCH_PATHS) {
      try {
        const s = await stat(watchPath);
        if (s.mtimeMs !== (lastMtimes[watchPath] ?? 0)) {
          lastMtimes[watchPath] = s.mtimeMs;
          langfuse.trace({ name: 'poll_mtime_change', metadata: { path: watchPath, mtime: s.mtimeMs } });
          const entries = await readdir(watchPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const fullPath = path.join(watchPath, entry.name);
            const fs = await stat(fullPath);
            if (fs.mtimeMs > Date.now() - POLL_INTERVAL_MS) {
              await onFile(fullPath).catch(() => {});
            }
          }
        }
      } catch (err) {
        langfuse.trace({ name: 'poll_fallback_error', metadata: { error: String(err) } });
      }
    }
  }, POLL_INTERVAL_MS);

  return () => {
    clearInterval(pollTimer);
    watcher.close();
  };
}
