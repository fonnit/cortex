---
phase: 06-daemon-thin-client
plan: 02
subsystem: agent (Mac launchd daemon)
tags: [daemon, refactor, http-client, scan-rules, gmail-cursor, plist, package-json]
requires:
  - Phase 6 Plan 01 HTTP plumbing (postIngest, postHeartbeat, IngestBuffer)
  - Node 22 LTS native fetch
  - Phase 5 `/api/ingest` route (server-side dedup + heartbeat short-circuit)
provides:
  - Refactored daemon main loop wired to /api/ingest only
  - Pure recursive walker (walkDirectory + shouldSkipDirectory + shouldSkipFile)
  - Local-file Gmail cursor (replaces v1.0 Neon GmailCursor table)
  - Dual heartbeat (60s API ping + 5min Langfuse trace with counters)
  - Slimmed agent dependencies (4 deps total: chokidar, googleapis, keytar, langfuse)
  - launchd plist with no DATABASE_URL, with CORTEX_API_URL/KEY/WATCH_PATHS
affects:
  - agent/src/index.ts (rewritten)
  - agent/src/scan.ts (rewritten)
  - agent/src/heartbeat.ts (rewritten)
  - agent/src/collectors/downloads.ts (rewritten)
  - agent/src/collectors/gmail.ts (rewritten)
  - agent/launchd/com.cortex.daemon.plist (canonical)
  - agent/package.json (slimmed)
  - jest.config.js (added .js suffix moduleNameMapper)
tech-stack:
  added: []  # zero new runtime deps; net REMOVAL of @prisma/client + @neondatabase/serverless
  patterns:
    - dependency-injected langfuse + onPayload callback (collectors stay pure)
    - DI-friendly bootstrap() that accepts a stubbed Langfuse for unit tests
    - JEST_WORKER_ID guard on the auto-start branch (so tests can import the module)
    - moduleNameMapper to strip `.js` suffix on relative imports for ts-jest
    - atomic write-rename for the gmail cursor file (0600 perms)
key-files:
  created:
    - agent/src/cursor/gmail-cursor.ts (64 lines)
    - agent/__tests__/scan-rules.test.ts (12 tests)
    - agent/__tests__/gmail-cursor.test.ts (5 tests)
    - agent/__tests__/index-bootstrap.test.ts (6 tests)
  modified:
    - agent/src/index.ts (251 → 141 lines; full rewrite)
    - agent/src/scan.ts (121 → 75 lines; full rewrite — was a CLI, now a pure walker)
    - agent/src/heartbeat.ts (28 → 98 lines; v1.0 single trace → dual heartbeat)
    - agent/src/collectors/downloads.ts (94 → 133 lines; pipeline calls removed, walker added)
    - agent/src/collectors/gmail.ts (177 → 172 lines; Neon cursor → file cursor)
    - agent/launchd/com.cortex.daemon.plist (replaced with canonical version)
    - agent/package.json (deps: 6 → 4; version: 0.1.0 → 0.1.1)
    - agent/package-lock.json (regenerated; -7 packages)
    - jest.config.js (+5 lines: `.js` suffix mapper)
  deleted:
    - agent/src/db.{ts,js}
    - agent/src/drive.{ts,js}
    - agent/src/metrics.{ts,js}
    - agent/src/pipeline/relevance.{ts,js}
    - agent/src/pipeline/label.{ts,js}
    - agent/src/pipeline/extractor.{ts,js}
    - agent/src/pipeline/dedup.{ts,js}
    - agent/src/pipeline/claude.ts
    - agent/src/pipeline/identity.ts
    - agent/src/pipeline/  (empty directory removed)
    - agent/src/{index,heartbeat}.js  (stale tsc artifacts)
    - agent/src/auth/google.js, agent/src/collectors/{downloads,gmail}.js  (stale tsc artifacts)
decisions:
  - Stale tsc-output .js files in agent/src/* deleted as Rule 3 cleanup (they referenced deleted modules)
  - jest.config.js gets a `.js` suffix moduleNameMapper instead of converting agent code to extensionless imports — keeps daemon source idiomatic for direct ESM execution under `--import=tsx`
  - Auto-start guard on index.ts uses `process.env.JEST_WORKER_ID` (always set in jest workers) instead of `globalThis.jest` (intermittently undefined inside test files)
  - Test 12 (scan-rules permission error) uses real `chmod 0o000` on a tmpdir rather than `jest.spyOn(fs/promises, 'readdir')` — fs/promises exports are non-configurable in current Node and the spy fails with "Cannot redefine property"
  - index-bootstrap.test.ts uses `jest.mock` to stub chokidar/googleapis/keytar/langfuse since the bootstrap-error path under test never calls into them; full integration is a Phase 8 concern
metrics:
  duration_seconds: 1860  # ~31 minutes from session start to final commit
  duration_human: 31m
  completed_at: 2026-04-25T13:00:00Z  # approximate
  tasks_total: 6
  tasks_completed: 6
  tests_added: 23  # 12 scan-rules + 5 gmail-cursor + 6 index-bootstrap
  phase_total_tests: 57  # plus 25 from Plan 01: 12 ingest-api + 13 http-client + 9 http-buffer + (this plan's 23)
  web_regression_tests: 83  # all green across 8 suites
  commits:
    - 4becd6e chore(06-02): delete v1.0 daemon code (db, drive, metrics, pipeline)
    - e6f7eb8 feat(06-02): rewrite scan.ts as pure recursive walker with skip rules
    - 7da4a63 refactor(06-02): wire downloads + gmail collectors to HTTP buffer; add file-based gmail cursor
    - daf6ca1 refactor(06-02): heartbeat — dual signal (60s API ping + 5min Langfuse trace)
    - 3a5a72c chore(06-02): plist + package.json — drop DATABASE_URL/Prisma/Neon, add CORTEX_API_*
    - f5bfcfe feat(06-02): rewrite daemon main loop as thin HTTP client
---

# Phase 6 Plan 2: Daemon Thin Client (Refactor) Summary

Refactored the Mac launchd daemon into a thin metadata producer. Deleted every v1.0 code path that touched Neon, Drive, or `claude -p`. Wired the surviving collectors and main loop to Plan 01's HTTP plumbing. After this plan ships, `agent/` contains zero references to Prisma, Neon, Anthropic, or OpenAI — only the Vercel API has DATABASE_URL.

## Files Deleted (16 plan-listed + 5 stale .js artifacts)

Plan deletion list (all clean delete — no compatibility shims):

| File | Why |
|------|------|
| `agent/src/db.ts`, `db.js` | Daemon no longer connects to Neon (DAEMON-01) |
| `agent/src/drive.ts`, `drive.js` | Drive uploads move to Phase 7 consumers |
| `agent/src/metrics.ts`, `metrics.js` | Metrics computed server-side now |
| `agent/src/pipeline/relevance.{ts,js}` | Two-stage classification moves to Phase 7 |
| `agent/src/pipeline/label.{ts,js}` | Label classifier moves to Phase 7 |
| `agent/src/pipeline/extractor.{ts,js}` | Content extraction moves to Phase 7 |
| `agent/src/pipeline/dedup.{ts,js}` | Server-side SHA-256 dedup is the dedup story |
| `agent/src/pipeline/claude.ts` | `claude -p` invocation gone — daemon no longer classifies |
| `agent/src/pipeline/identity.ts` | Subsumed by Phase 7 entity-resolution layer |

`agent/src/pipeline/` directory removed (empty after the deletes).

Stale tsc-output `.js` files also removed (Rule 3 — they referenced deleted modules and would confuse the runtime / IDE):
- `agent/src/index.js`
- `agent/src/heartbeat.js`
- `agent/src/auth/google.js`
- `agent/src/collectors/downloads.js`
- `agent/src/collectors/gmail.js`

Total: **21 files removed**, 1530 lines deleted.

## Files Refactored (5)

| File | Before (lines) | After (lines) | What changed |
|------|----------------|----------------|--------------|
| `agent/src/index.ts` | 251 | 141 | Full rewrite. Removed v1.0 pipeline orchestration (handleFile, handleGmailMessage, runSnapshot). Now wires IngestBuffer + heartbeat + collectors and exits(1) on missing CORTEX_API_URL/KEY. Exports `validateBootstrapEnv()` and `bootstrap()` for unit tests. |
| `agent/src/scan.ts` | 121 | 75 | Full rewrite. Was a one-shot CLI that called the deleted pipeline; now a pure async generator with `walkDirectory`, `shouldSkipFile`, `shouldSkipDirectory` exports. Applies SCAN-01 (unbounded recursion) + SCAN-02 (.git/node_modules tree skip) + SCAN-03 (hidden-file skip). |
| `agent/src/heartbeat.ts` | 28 | 98 | v1.0 single Langfuse trace every 5min → dual heartbeat: 60s API ping via `postHeartbeat` + 5min Langfuse trace with running counters (uptime_seconds, files_seen, files_posted, gmail_messages_posted, http_failures). New `incrementCounter` export. |
| `agent/src/collectors/downloads.ts` | 94 | 133 | Removed pipeline + Neon writes; emits IngestRequest payloads via callback. chokidar `ignored` callback skips dotfiles + `.git`/`node_modules` at watcher level. Startup recursive scan delegates to `walkDirectory`. v1.0 polling fallback removed. SHA-256 hash computed at the daemon (used as dedup key by the API). |
| `agent/src/collectors/gmail.ts` | 177 | 172 | Removed Neon cursor SQL + pipeline calls; emits IngestRequest payloads via callback. Cursor reads/writes go through `agent/src/cursor/gmail-cursor.ts` (file). historyId 404 → `fullSyncFallback` branch preserved (ING-06). Captures full Gmail header set in `source_metadata`. |

Total surviving daemon source: **683 lines** across 8 files (down from ~1300 lines pre-refactor).

## Files Added (1)

- `agent/src/cursor/gmail-cursor.ts` (64 lines) — local-file replacement for the v1.0 Neon `GmailCursor` table. Default path `~/.config/cortex/gmail-cursor.json` with mode 0600; configurable via `CORTEX_AGENT_STATE_DIR`. Atomic write-rename pattern; tolerates ENOENT and malformed JSON without throwing.

## Tests Added (23 new across 3 files)

| Suite | Tests | What's covered |
|-------|-------|----------------|
| `agent/__tests__/scan-rules.test.ts` | 12 | shouldSkipFile (dotfile basename) × 2, shouldSkipDirectory (.git, node_modules, neither) × 3, walkDirectory (unbounded recursion, .git tree skip, node_modules tree skip, hidden file skip, normal subdir recursion, missing path, EACCES on subdir) × 7 |
| `agent/__tests__/gmail-cursor.test.ts` | 5 | readCursor returns null on missing file, write/read round-trip with timestamp, file path + 0600 perms, atomic overwrite, malformed JSON returns null without throwing |
| `agent/__tests__/index-bootstrap.test.ts` | 6 | validateBootstrapEnv truth table × 4, bootstrap() exits 1 + console.error on missing KEY, bootstrap() emits `daemon_bootstrap_fatal` Langfuse trace + flushAsync |

Plan 01 already shipped 25 tests (3 ingest-api heartbeat + 13 http-client + 9 http-buffer). Phase 6 total = **57 tests across 6 suites**.

```
$ npx jest \
    __tests__/ingest-api.test.ts \
    agent/__tests__/http-client.test.ts \
    agent/__tests__/http-buffer.test.ts \
    agent/__tests__/scan-rules.test.ts \
    agent/__tests__/gmail-cursor.test.ts \
    agent/__tests__/index-bootstrap.test.ts \
    --no-coverage
Test Suites: 6 passed, 6 total
Tests:       57 passed, 57 total
```

## Web Regression (Plan 01-touched routes)

```
$ npx jest \
    __tests__/api-key.test.ts \
    __tests__/queue-config.test.ts \
    __tests__/queue-sql.test.ts \
    __tests__/ingest-api.test.ts \
    __tests__/classify-api.test.ts \
    __tests__/queue-api.test.ts \
    __tests__/queue-api-integration.test.ts \
    __tests__/queue-claim-sql.integration.test.ts \
    --no-coverage
Test Suites: 8 passed, 8 total
Tests:       83 passed, 83 total
```

## Type-check

```
$ npx tsc --noEmit -p agent/tsconfig.json
TypeScript compilation completed
```

Zero errors across all surviving `agent/src/*` files.

## Plist Diff (Canonical vs Prior Committed Version)

The plist had pre-existing uncommitted edits at session start (Node path + PATH var). Per the plan, the file was rewritten with the canonical version regardless — those prior edits aligned with the canonical target so they were preserved in net effect.

```diff
--- HEAD~6:agent/launchd/com.cortex.daemon.plist
+++ working tree
@@ -6,7 +6,7 @@
   <key>ProgramArguments</key>
   <array>
-    <string>/usr/local/bin/node</string>
+    <string>/Users/dfonnegrag/.nvm/versions/node/v22.12.0/bin/node</string>
     <string>--env-file=/Users/dfonnegrag/Projects/cortex/.env</string>
     <string>--import=tsx</string>
     <string>/Users/dfonnegrag/Projects/cortex/agent/src/index.ts</string>
@@ -27,6 +27,14 @@
     <key>HOME</key>
     <string>/Users/dfonnegrag</string>
+    <key>PATH</key>
+    <string>/Users/dfonnegrag/.nvm/versions/node/v22.12.0/bin:...</string>
+    <key>CORTEX_API_URL</key>
+    <string>https://REPLACE_WITH_VERCEL_URL.vercel.app</string>
+    <key>CORTEX_API_KEY</key>
+    <string>REPLACE_WITH_API_KEY_FROM_VERCEL</string>
+    <key>WATCH_PATHS</key>
+    <string>/Users/dfonnegrag/Downloads,/Users/dfonnegrag/Documents</string>
   </dict>
 </dict>
 </plist>
```

`DATABASE_URL` was never in the prior committed plist; this plan keeps it absent.

`plutil -lint`: **OK**.

## agent/package.json Diff

```diff
-  "version": "0.1.0",
+  "version": "0.1.1",
   ...
   "dependencies": {
-    "@neondatabase/serverless": "1.1.0",
-    "@prisma/client": "7.8.0",
     "chokidar": "5.0.0",
     "googleapis": "171.4.0",
     "keytar": "7.9.0",
     "langfuse": "3.38.20"
   },
```

`npm install --prefix agent` removed 7 packages (Prisma + Neon + transitive). `@anthropic-ai/sdk` and `openai` were not in the dep list at session start (Plan 01's HEAD), so they remain absent — Phase 7 consumers will add them in their own package boundary.

## Decision Coverage

| Decision | Plan task | Status |
|----------|-----------|--------|
| HTTP client native fetch + retry 5/1s/30s | Plan 01 Task 2 | ✓ |
| Terminal failure → Langfuse warning + skip | Plan 01 Task 2 | ✓ |
| FIFO buffer cap=100, drop OLDEST | Plan 01 Task 3 | ✓ |
| Heartbeat 60s POST + 5min Langfuse trace | Plan 01 Task 1 + Plan 02 Task 4 | ✓ |
| Heartbeat schema extension on /api/ingest | Plan 01 Task 1 | ✓ |
| Auth Bearer ${CORTEX_API_KEY} | Plan 01 Task 2 | ✓ |
| Daemon exits 1 on missing env | Plan 02 Task 6 | ✓ |
| Clean delete of v1.0 daemon code | Plan 02 Task 1 | ✓ |
| Refactor downloads/gmail/scan/heartbeat/index | Plan 02 Tasks 2,3,4,6 | ✓ |
| Plist removes DATABASE_URL, adds CORTEX_API_* | Plan 02 Task 5 | ✓ |
| package.json drops Prisma/Neon | Plan 02 Task 5 | ✓ |
| Local file Gmail cursor | Plan 02 Task 3 | ✓ |
| SCAN-01 unbounded recursion | Plan 02 Task 2 | ✓ |
| SCAN-02 .git/node_modules tree skip | Plan 02 Task 2 | ✓ |
| SCAN-03 hidden-file skip | Plan 02 Task 2 | ✓ |
| Gmail 60s poll + historyId 404 fallback | Plan 02 Tasks 3, 6 | ✓ |
| chokidar `ignored` enforces skip rules | Plan 02 Task 3 | ✓ |

All 17 decisions covered.

## Requirements Closed

DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-05, DAEMON-06, SCAN-01, SCAN-02, SCAN-03 — all addressed by this plan's implementation.

(DAEMON-04 was Plan 01 Task 2 — auth header.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 – Blocking] Removed stale tsc-output `.js` artifacts under `agent/src/`.**
- Found during: Task 1 (post-deletion sweep)
- Issue: `agent/src/index.js`, `agent/src/heartbeat.js`, `agent/src/auth/google.js`, `agent/src/collectors/{downloads,gmail}.js` existed as compiled CommonJS artifacts that referenced the just-deleted `db.js` / `pipeline/dedup.js` / etc. via `require()` paths. They were tracked in git but not in the plan's deletion list. Leaving them would have:
  - polluted IDE module-resolution suggestions (especially with `--import=tsx`'s `.js` suffix stripping behaviour),
  - tripped any future `node` invocation that didn't go through tsx,
  - drifted out-of-sync with the upcoming `.ts` rewrites.
- Fix: deleted alongside the plan's 16-file deletion list in commit `4becd6e`.
- Files modified: 5 stale `.js` artifacts.
- Commit: `4becd6e`

### Refinements

**2. [Refinement] `jest.config.js` got a `.js` suffix moduleNameMapper.**
The plan's collectors and the rewritten `index.ts` use `'../scan.js'`-style imports per the agent's existing ESM-style convention (and to keep `--import=tsx` happy in production). Without a mapper, ts-jest's `moduleResolution: node` would not resolve those paths to their `.ts` source. Plan 01 Refinement 2 explicitly flagged this option. The mapper is a 3-line change (`'^(\\.{1,2}/.*)\\.js$': '$1'`) that doesn't affect non-relative imports.

**3. [Refinement] Auto-start guard uses `JEST_WORKER_ID` env var, not `globalThis.jest`.**
The plan suggested checking `globalThis.jest`. In practice that global is intermittently undefined inside test-file evaluation contexts under ts-jest, and the auto-start fired during the import — which made `bootstrap()` exit(1) at module load and aborted the whole suite. `JEST_WORKER_ID` is set by jest in every worker process, so it's a more robust guard.

**4. [Refinement] Permission-error test uses real `chmod 0o000`, not `jest.spyOn(fs/promises, 'readdir')`.**
Modern Node's `fs/promises` exports are non-configurable: `jest.spyOn(fs/promises, 'readdir')` throws `Cannot redefine property: readdir`. Real `chmod 0o000` on a tmpdir reproduces EACCES exactly and is restored in `finally` so afterEach can clean up. Test asserts the same behaviour (no throw escapes; sibling files still yielded).

**5. [Refinement] index-bootstrap.test.ts mocks heavy ESM transitive deps via `jest.mock`.**
The bootstrap-error path under test never actually invokes chokidar / googleapis / keytar / langfuse — but jest must still parse the import graph to load the module. Empty mocks suffice: `jest.mock('chokidar', () => ({ watch: jest.fn() }))` etc. Full integration testing of the watcher + Gmail-poll loops is a Phase 8 acceptance concern (real OAuth + real network).

**6. [Refinement] `agent/src/auth/google.ts` carries pre-existing uncommitted edits from a prior session.**
Per the plan's environment_note and critical constraint #3, this file is "KEEP AS-IS" — I did not modify it in this plan execution and did not include it in any of the 6 task commits. The OAuth redirect URI change (`urn:ietf:wg:oauth:2.0:oob` → `http://localhost:41245/api/auth/google/callback`) remains in working-tree-only state, exactly as it was at session start. A future commit (outside this plan's scope) should reconcile it.

## Authentication Gates

None encountered. The plan's CORTEX_API_URL / CORTEX_API_KEY are not required at test time — `validateBootstrapEnv()` is a pure check, and `bootstrap()` was tested via DI of a stubbed Langfuse. Real-world activation of the daemon requires the user to:

1. Replace `REPLACE_WITH_VERCEL_URL` and `REPLACE_WITH_API_KEY_FROM_VERCEL` in the plist
2. Run `launchctl unload && launchctl load ~/Library/LaunchAgents/com.cortex.daemon.plist`

The plan's `user_setup` block calls this out. No automation can substitute for user-supplied secrets here.

## Runtime Verification Note (for Phase 8 ACC-04)

Once the daemon is loaded, ACC-04 will audit DAEMON-01 via:

```bash
launchctl unload ~/Library/LaunchAgents/com.cortex.daemon.plist
launchctl load ~/Library/LaunchAgents/com.cortex.daemon.plist
launchctl print gui/$(id -u)/com.cortex.daemon | grep -E "DATABASE_URL|CORTEX_API"
# Expected: DATABASE_URL absent; CORTEX_API_URL + CORTEX_API_KEY present.
```

## Known Stubs

None. Every code path is wired to real production targets:
- `postIngest` → real fetch to `${CORTEX_API_URL}/api/ingest`
- `postHeartbeat` → same with `{heartbeat:true}` body
- `IngestBuffer` → real DI postIngest from index.ts
- Gmail cursor → real file at `~/.config/cortex/gmail-cursor.json`
- chokidar watcher → real FSEvents on darwin
- googleapis → real Gmail API via OAuth credentials

The only test-only branches are:
- `JEST_WORKER_ID` guard skipping auto-start under jest (intentional, by design)
- DI parameter `bootstrap({ langfuse? })` (intentional — production path uses the real Langfuse constructor)

## Threat Flags

None. The refactor *removes* trust-boundary surface from the daemon process:
- DATABASE_URL no longer in launchd env (DAEMON-06 enforced via plist)
- @prisma/client + @neondatabase/serverless removed (no Postgres connection possible from the daemon)
- Anthropic / OpenAI not in daemon deps (no LLM API calls from the daemon process)
- The only outbound HTTP target is `${CORTEX_API_URL}/api/ingest`, authenticated with `Bearer ${CORTEX_API_KEY}`

The new `agent/src/cursor/gmail-cursor.ts` writes to `~/.config/cortex/gmail-cursor.json` with mode 0600 — same trust posture as `keytar`-stored OAuth tokens (both single-user, machine-local).

## Self-Check: PASSED

Files created (all confirmed present):
- `agent/src/cursor/gmail-cursor.ts` — FOUND
- `agent/__tests__/scan-rules.test.ts` — FOUND
- `agent/__tests__/gmail-cursor.test.ts` — FOUND
- `agent/__tests__/index-bootstrap.test.ts` — FOUND
- `.planning/phases/06-daemon-thin-client/06-02-SUMMARY.md` — FOUND (this file)

Files refactored (confirmed via `git log --stat` + content read):
- `agent/src/index.ts` — REWRITTEN (251 → 141 lines)
- `agent/src/scan.ts` — REWRITTEN (121 → 75 lines)
- `agent/src/heartbeat.ts` — REWRITTEN (28 → 98 lines)
- `agent/src/collectors/downloads.ts` — REWRITTEN (94 → 133 lines)
- `agent/src/collectors/gmail.ts` — REWRITTEN (177 → 172 lines)
- `agent/launchd/com.cortex.daemon.plist` — CANONICAL
- `agent/package.json` — SLIMMED

Files deleted (confirmed via `test ! -e`):
- All 16 plan-listed files: GONE
- 5 stale `.js` artifacts: GONE
- `agent/src/pipeline/` directory: GONE

Commits (all present in `git log`):
- `4becd6e` chore(06-02): delete v1.0 daemon code (db, drive, metrics, pipeline)
- `e6f7eb8` feat(06-02): rewrite scan.ts as pure recursive walker with skip rules
- `7da4a63` refactor(06-02): wire downloads + gmail collectors to HTTP buffer; add file-based gmail cursor
- `daf6ca1` refactor(06-02): heartbeat — dual signal (60s API ping + 5min Langfuse trace)
- `3a5a72c` chore(06-02): plist + package.json — drop DATABASE_URL/Prisma/Neon, add CORTEX_API_*
- `f5bfcfe` feat(06-02): rewrite daemon main loop as thin HTTP client

Plan-level verification:
- 57/57 Phase 6 tests passing across 6 suites
- 83/83 web regression tests passing across 8 suites
- `npx tsc --noEmit -p agent/tsconfig.json` → clean
- `plutil -lint agent/launchd/com.cortex.daemon.plist` → OK
- No surviving file in `agent/src/` imports a deleted module
- No `@neondatabase/serverless | @prisma/client | @anthropic-ai/sdk | openai` import in `agent/src/`
- No `DATABASE_URL` in plist
- `CORTEX_API_URL`, `CORTEX_API_KEY`, `WATCH_PATHS` all present in plist
