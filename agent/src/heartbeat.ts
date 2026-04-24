import Langfuse from 'langfuse';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startHeartbeat(langfuse: Langfuse): () => void {
  const timer = setInterval(() => {
    langfuse.trace({
      name: 'daemon_heartbeat',
      metadata: { pid: process.pid, ts: Date.now() },
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Register SIGTERM handler — launchd sends SIGTERM on stop (Pitfall 6)
  const shutdown = async () => {
    clearInterval(timer);
    try {
      await langfuse.flushAsync();
    } catch {
      // Flush errors must not block exit
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return () => clearInterval(timer);
}
