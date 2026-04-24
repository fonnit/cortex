---
phase: 01-foundation
plan: 03
subsystem: auth
tags: [gmail, oauth2, keytar, keychain, googleapis, langfuse, neon, historyId, incremental-sync]

# Dependency graph
requires:
  - phase: 01-01
    provides: agent/package.json with googleapis@171.4.0 and keytar@7.9.0; GmailCursor schema

provides:
  - getGoogleOAuthClient() — OAuth2 client with keytar Keychain token storage
  - storeTokens() / loadTokens() — read/write Google tokens from macOS Keychain
  - pollGmail() — incremental Gmail sync with historyId 404 fallback
  - Neon GmailCursor persistence after every successful poll
  - Langfuse gmail_fullsync_fallback trace on every 404 or first-run fallback
  - agent/src/db.ts — Neon client singleton (shared by all agent modules)

affects: [01-04, 01-05, 01-06, 02-02]

# Tech tracking
tech-stack:
  added:
    - keytar@7.9.0 (macOS Keychain storage for OAuth tokens)
    - googleapis@171.4.0 (Gmail API incremental sync via history.list)
    - langfuse@3.38.20 (tracing for fullsync fallback events)
    - "@neondatabase/serverless" (Neon sql singleton in db.ts)
  patterns:
    - keytar stores tokens as (service=com.cortex.daemon, account=google_access_token|google_refresh_token)
    - oauth2Client.on('tokens') auto-persists refreshed access tokens back to Keychain
    - 404 from history.list → fullSyncFallback() + Langfuse trace; never silent
    - Both cursors (last_history_id, last_successful_poll_at) written together to GmailCursor on every successful poll

key-files:
  created:
    - agent/src/auth/google.ts
    - agent/src/collectors/gmail.ts
    - agent/src/db.ts
  modified: []

key-decisions:
  - "db.ts created ahead of Plan 02 schedule — gmail.ts imports it and Plan 02 hadn't executed; Rule 3 (blocking dep) applied"
  - "CORTEX_USER_ID defaults to 'daniel' — single-operator MVP; schema is tenancy-ready (user_id column exists)"
  - "fullSyncFallback falls back to last 7 days when last_successful_poll_at is null — bounded recovery on first run"
  - "Non-404 poll errors are re-thrown after emitting Langfuse trace — let the caller decide on retry"

patterns-established:
  - "Pattern: keytar service='com.cortex.daemon' is the shared Keychain namespace for all Cortex secrets"
  - "Pattern: 404 from Gmail history.list is an explicit code path, not an error — fullSyncFallback + Langfuse event"
  - "Pattern: both cursor columns updated atomically in one SQL UPDATE after each successful poll"

requirements-completed:
  - ING-02
  - ING-06

# Metrics
duration: 20min
completed: 2026-04-24
---

# Phase 01 Plan 03: Gmail Incremental Sync and Google OAuth Summary

**Gmail incremental sync via historyId with explicit 404-to-fullsync fallback + macOS Keychain OAuth token storage via keytar**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-24T19:40:00Z
- **Completed:** 2026-04-24T20:00:00Z
- **Tasks:** 2
- **Files modified:** 3 created, 0 modified

## Accomplishments
- `agent/src/auth/google.ts` — `storeTokens`, `loadTokens`, `getGoogleOAuthClient` with keytar Keychain storage; tokens auto-refreshed and re-persisted on token event
- `agent/src/collectors/gmail.ts` — `pollGmail()` with historyId incremental sync; 404 triggers `fullSyncFallback()` + `gmail_fullsync_fallback` Langfuse trace; both GmailCursor columns persisted after every successful poll
- `agent/src/db.ts` — Neon client singleton (created ahead of Plan 02 due to blocking import in gmail.ts)
- TypeScript compiles clean with no errors

## Task Commits

1. **Task 1: Google OAuth client with keytar Keychain token storage** - `16a5a0c` (feat)
2. **Task 2: Gmail incremental sync with historyId 404 fallback** - `4b1c524` (feat)

## Files Created/Modified
- `agent/src/auth/google.ts` — OAuth2 client; storeTokens/loadTokens/getGoogleOAuthClient exports; keytar Keychain storage
- `agent/src/collectors/gmail.ts` — pollGmail(); incremental sync + 404 fallback; GmailCursor persistence; Langfuse tracing
- `agent/src/db.ts` — Neon client singleton (`export const sql = neon(...)`)

## Decisions Made
- `db.ts` created in this plan (Plan 03) rather than waiting for Plan 02 — `gmail.ts` imports `../db.js` and Plan 02 had not yet executed. Blocked compile without it (Rule 3).
- `CORTEX_USER_ID` defaults to `'daniel'` for single-operator MVP; GmailCursor schema has `user_id` for tenancy-readiness.
- `fullSyncFallback` uses last 7 days when `last_successful_poll_at` is null — bounded first-run recovery, not unlimited backfill.
- Non-404 errors are re-thrown (after Langfuse trace) so the daemon's outer error handler can decide on retry behaviour.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created agent/src/db.ts ahead of Plan 02**
- **Found during:** Task 2 setup (gmail.ts imports `../db.js`)
- **Issue:** Plan 02 creates `db.ts` but Plan 02 had not been executed; `gmail.ts` imports it at compile time, blocking `tsc --noEmit`
- **Fix:** Created `agent/src/db.ts` (exact content specified in Plan 02) and included it in the Task 1 commit
- **Files modified:** agent/src/db.ts (new)
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** 16a5a0c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking dependency)
**Impact on plan:** Necessary for compile — exact Plan 02 artifact content, no scope creep. Plan 02 will find db.ts already present when it executes.

## Issues Encountered
None beyond the blocking db.ts dependency handled via Rule 3.

## User Setup Required
None — this plan creates source files only. Runtime prerequisites:
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`
- One-time OAuth flow: call `runInitialAuthFlow()` to get tokens into Keychain before daemon start
- `DATABASE_URL` in `.env` (Neon) for GmailCursor persistence (see Plan 01 USER-SETUP)

## Known Stubs

None — `pollGmail()` is fully wired. The `onMessage` callback is a parameter that Plans 04/05 will supply when wiring the full pipeline.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. T-03-01 (token disclosure) mitigated by keytar. T-03-02 (spoofing) mitigated by OAuth2 offline flow. T-03-03 (historyId 404 DoS) mitigated by explicit fullSyncFallback.

## Next Phase Readiness
- `pollGmail()` is ready to be wired into the daemon entry point (Plan 04/05)
- `getGoogleOAuthClient()` is importable by any module needing Google API access (Drive, etc.)
- `db.ts` is available for all agent modules in subsequent plans
- Plans 04/05 supply the `onMessage` handler that feeds the dedup + triage pipeline

---
*Phase: 01-foundation*
*Completed: 2026-04-24*
