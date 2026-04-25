// agent/src/heartbeat.ts — Phase 6 Plan 02 Task 4
// Dual heartbeat per CONTEXT D-heartbeat-dual:
//  - Every 60s: POST /api/ingest { heartbeat: true } via postHeartbeat
//                (server returns 204 No Content — silent on success)
//  - Every 5min: Langfuse trace `daemon-heartbeat` with running counters
//                { uptime_seconds, files_seen, files_posted,
//                  gmail_messages_posted, http_failures }
//
// Counters are bumped from outside this module via incrementCounter().

import type Langfuse from 'langfuse'

import { postHeartbeat } from './http/client.js'

const API_PING_INTERVAL_MS = 60 * 1000 // 60s — matches Gmail poll cadence
const LANGFUSE_TRACE_INTERVAL_MS = 5 * 60 * 1000 // 5min

interface Counters {
  files_seen: number
  files_posted: number
  gmail_messages_posted: number
  http_failures: number
}

const counters: Counters = {
  files_seen: 0,
  files_posted: 0,
  gmail_messages_posted: 0,
  http_failures: 0,
}

/** Increment a daemon counter (used by collectors + the HTTP-failure path). */
export function incrementCounter(key: keyof Counters, by = 1): void {
  counters[key] = (counters[key] ?? 0) + by
}

/**
 * Start the dual heartbeat. Returns a stop function that clears both intervals.
 *
 * NOTE: SIGTERM / SIGINT handlers live in `index.ts` (MN-06). Heartbeat used
 * to install its own signal handler that called `process.exit(0)` immediately
 * after a Langfuse flush — but that path raced the buffer drain and dropped
 * any pending IngestRequest payloads on `launchctl stop`. The orderly shutdown
 * sequence (stop timers → drain buffer with timeout → flush → exit) belongs to
 * the main loop, which owns the buffer instance.
 */
export function startHeartbeat(langfuse: Langfuse): () => void {
  const startedAt = Date.now()

  // Track if we're mid-ping to avoid overlap on slow networks.
  let pingInFlight = false
  const apiTimer = setInterval(async () => {
    if (pingInFlight) return
    pingInFlight = true
    try {
      const outcome = await postHeartbeat({ langfuse })
      if (outcome.kind === 'skip') incrementCounter('http_failures')
    } catch (err) {
      // postHeartbeat throws synchronously only when env vars are unset — that's a
      // startup error and the daemon should already have exited. Defensive log.
      incrementCounter('http_failures')
      langfuse.trace({
        name: 'heartbeat_ping_unexpected_error',
        metadata: { error: String(err) },
      })
    } finally {
      pingInFlight = false
    }
  }, API_PING_INTERVAL_MS)

  const lfTimer = setInterval(() => {
    langfuse.trace({
      name: 'daemon-heartbeat',
      metadata: {
        pid: process.pid,
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        files_seen: counters.files_seen,
        files_posted: counters.files_posted,
        gmail_messages_posted: counters.gmail_messages_posted,
        http_failures: counters.http_failures,
      },
    })
  }, LANGFUSE_TRACE_INTERVAL_MS)

  return () => {
    clearInterval(apiTimer)
    clearInterval(lfTimer)
  }
}
