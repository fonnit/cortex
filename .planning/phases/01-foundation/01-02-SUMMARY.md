---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [chokidar, fsevents, langfuse, neon, launchd, typescript, esm, daemon]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: agent/package.json as ESM package with chokidar 5, langfuse, @neondatabase/serverless installed
provides:
  - Downloads FSEvents collector with chokidar watcher, startup scan, and 15-min polling fallback
  - Neon client singleton (sql) for agent modules
  - 5-min Langfuse daemon_heartbeat with SIGTERM/SIGINT flushAsync() shutdown
  - Daemon entry point wiring collectors + heartbeat with getLastProcessedAt() cursor
  - launchd plist at agent/launchd/com.cortex.daemon.plist with KeepAlive + RunAtLoad
affects: [01-03, 01-04, 01-05, 01-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chokidar v5 ESM watch with awaitWriteFinish debounce (2s stabilityThreshold)"
    - "Polling fallback pattern: stat(DOWNLOADS_PATH).mtimeMs every 15 min guards against FSEvents silent death"
    - "Startup scan pattern: readdir + stat on launch catches files missed during daemon downtime"
    - "SIGTERM handler pattern: clearInterval + langfuse.flushAsync() + process.exit(0) — launchd-safe shutdown"
    - "Langfuse fire-and-forget: all traces are non-blocking; flush only at daemon shutdown"
    - "Neon singleton: single neon() call at module load; DATABASE_URL guard throws at startup not at query time"
    - "Credentials never in plist: only NODE_ENV + HOME; credentials read from env at runtime (T-02-01)"

key-files:
  created:
    - agent/src/db.ts
    - agent/src/collectors/downloads.ts
    - agent/src/heartbeat.ts
    - agent/src/index.ts
    - agent/launchd/com.cortex.daemon.plist
  modified: []

key-decisions:
  - "Polling fallback checks Downloads mtime every 15 min independently of FSEvents — addresses FSEvents silent death (Pitfall 1) documented in community reports"
  - "Startup scan uses readdir + stat.mtimeMs > lastProcessedAt.getTime() — catches files added during daemon downtime without re-processing old files"
  - "handleFile in index.ts is an intentional stub — pipes to console.log only; Plans 04/05 will wire dedup + size-band + relevance gate"
  - "getLastProcessedAt() falls back to new Date(0) on DB error — daemon starts cleanly even without DATABASE_URL at dev time; startup scan will pick up all files"
  - "launchd plist uses /Users/dfonnegrag/.cortex/agent/dist/index.js — separate install path from repo, preventing repo churn from triggering launchd restarts"

patterns-established:
  - "Pattern: chokidar v5 ESM import — import { watch } from 'chokidar'; no CJS require"
  - "Pattern: cleanup functions — all start* functions return () => void for graceful teardown"
  - "Pattern: Langfuse traces on every error path — fsevents_error, startup_scan_error, poll_fallback_error, downloads_ingest_error"
  - "Pattern: plist credentials discipline — only NODE_ENV + HOME in EnvironmentVariables; all secrets via process.env at runtime"

requirements-completed:
  - ING-01
  - ING-05

# Metrics
duration: 2min
completed: 2026-04-24
---

# Phase 01 Plan 02: Downloads FSEvents Collector and Daemon Heartbeat Summary

**chokidar v5 Downloads collector with FSEvents + 15-min polling fallback, 5-min Langfuse heartbeat, SIGTERM-safe shutdown, and launchd plist wiring the daemon entry point**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-24T18:36:23Z
- **Completed:** 2026-04-24T18:38:24Z
- **Tasks:** 2
- **Files modified:** 5 created, 0 modified

## Accomplishments
- Downloads collector: chokidar FSEvents watcher with 2s `awaitWriteFinish` debounce + startup scan (catches files missed during downtime) + 15-min polling fallback (guards Pitfall 1: FSEvents silent death)
- Heartbeat: 5-min `daemon_heartbeat` Langfuse trace + SIGTERM/SIGINT handler calling `flushAsync()` before exit (Pitfall 6 mitigated)
- Daemon entry point: wires collectors + heartbeat, queries Neon for `getLastProcessedAt()` cursor, stub `handleFile` for Plans 04/05
- launchd plist: `KeepAlive=true`, `RunAtLoad=true`, logs to `/tmp/`, credentials NOT in plist (T-02-01 mitigated)
- TypeScript compiles clean (`tsc --noEmit` exits 0)

## Task Commits

1. **Task 1: Neon client singleton + Downloads FSEvents collector** - `698fecc` (feat)
2. **Task 2: Daemon heartbeat + launchd entry point + plist** - `e25751a` (feat)

## Files Created/Modified
- `agent/src/db.ts` - Neon serverless client singleton with DATABASE_URL guard
- `agent/src/collectors/downloads.ts` - chokidar watcher + polling fallback + startup scan; exports `startDownloadsCollector`
- `agent/src/heartbeat.ts` - 5-min Langfuse heartbeat + SIGTERM/SIGINT flushAsync shutdown; exports `startHeartbeat`
- `agent/src/index.ts` - Daemon entry point: wires heartbeat + downloads collector; stub `handleFile`; `getLastProcessedAt()` queries Neon
- `agent/launchd/com.cortex.daemon.plist` - launchd plist with KeepAlive, RunAtLoad, log paths; no credentials

## Decisions Made
- Polling fallback interval (15 min) matches research recommendation — stat() on Downloads directory mtime, not individual files, to minimize syscalls
- `handleFile` stub logs to console only — intentional; Plans 04/05 wire the actual pipeline; documented with TODO comment
- `getLastProcessedAt()` catches all errors and returns `new Date(0)` — daemon cannot fail at startup due to a DB cursor query; worst case is a full startup scan

## Deviations from Plan

None — plan executed exactly as written. All five files match the plan's specified implementations; TypeScript compiles clean on first attempt.

## Issues Encountered

None.

## User Setup Required

None for this plan specifically. The launchd plist requires `DATABASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` at daemon runtime. These are documented in `.env.example` (from Plan 01). The daemon startup will throw on missing DATABASE_URL before accepting any files.

## Known Stubs

- `handleFile` in `agent/src/index.ts` (line 27): stub that logs file path only. Intentional — Plans 04/05 wire dedup + size-band + relevance gate. Daemon is not functional as an ingestion pipeline until Plan 04, but the liveness infrastructure (collector, heartbeat, plist) is fully operational.

## Threat Flags

No new network endpoints introduced. T-02-01 (credentials in plist) mitigated — plist contains only NODE_ENV + HOME. T-02-03 (FSEvents silent death) mitigated — polling fallback every 15 min + heartbeat every 5 min.

## Next Phase Readiness
- Daemon liveness infrastructure complete: FSEvents watcher, polling fallback, heartbeat, launchd plist all implemented
- Plan 03 (Gmail collector) can import `sql` from `db.ts` and `startHeartbeat` from `heartbeat.ts`
- Plans 04/05 replace the `handleFile` stub with the actual dedup + classification pipeline
- `DATABASE_URL` must be set and `prisma db push` run before daemon can process files into Neon

---
*Phase: 01-foundation*
*Completed: 2026-04-24*
