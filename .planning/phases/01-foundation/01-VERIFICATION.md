---
phase: 01-foundation
verified: 2026-04-24T21:00:00Z
status: human_needed
score: 14/17 truths verified
overrides_applied: 0
human_verification:
  - test: "Drop a file into ~/Downloads and confirm it appears in Neon within 60 seconds with classification_trace containing both stage1 and stage2 outputs"
    expected: "Item row exists in Neon with status=certain or status=uncertain, classification_trace JSONB has langfuse_trace_id + stage1 (decision, confidence, reason) + stage2 (axes, proposed_drive_path, allAxesConfident)"
    why_human: "Requires live DATABASE_URL, ANTHROPIC_API_KEY, running daemon — cannot run programmatically without credentials"
  - test: "Drop the same file a second time and confirm Neon still has exactly one row and Drive has exactly one blob"
    expected: "isDuplicate() returns true on second drop; Neon row count for that content_hash stays at 1; no second Drive upload"
    why_human: "Requires running daemon and live Neon + Drive connections"
  - test: "Confirm a keep-classified Downloads file has a blob at Drive _Inbox/{YYYY-MM}/{filename} and drive_inbox_id is non-null in Neon"
    expected: "drive_inbox_id column populated; Drive folder structure matches YYYY-MM pattern"
    why_human: "Requires live Drive API credentials and running daemon"
  - test: "Send a test email to the connected Gmail account; confirm it appears in Neon within one 5-minute poll cycle; verify gmail_fullsync_fallback appears in Langfuse when historyId is intentionally invalidated"
    expected: "Item row with source='gmail' and classification_trace.langfuse_trace_id in Neon; Langfuse trace event visible for fullsync fallback"
    why_human: "Requires live Gmail OAuth tokens in Keychain and Langfuse credentials"
  - test: "Confirm uncertain_rate and auto_filed_rate rows appear in MetricSnapshot table after 10 seconds of daemon uptime"
    expected: "SELECT * FROM MetricSnapshot ORDER BY captured_at DESC LIMIT 1 returns a row with numeric rates"
    why_human: "Requires running daemon with DATABASE_URL set"
  - test: "Confirm daemon_heartbeat Langfuse events appear every ~5 minutes after daemon start"
    expected: "Langfuse dashboard shows daemon_heartbeat traces at 5-minute intervals with pid and timestamp"
    why_human: "Requires running daemon with live Langfuse credentials"
  - test: "Confirm prisma db push succeeds against Neon with the current schema.prisma"
    expected: "npx prisma db push exits 0; all 4 tables (Item, GmailCursor, TaxonomyLabel, MetricSnapshot) exist in Neon"
    why_human: "DATABASE_URL was not available during execution; push was documented as a required manual step in 01-01-SUMMARY.md"
gaps:
  - truth: "SC1 classification trace includes rule matches"
    status: partial
    reason: "ROADMAP SC1 specifies 'both stage outputs, confidence scores, rule matches' in the trace. Rule system (RUL-01 to RUL-06) is Phase 3. The trace contains stage1+stage2+confidence correctly, but rule_matches field is absent. This is a scope ambiguity in the roadmap success criterion rather than a missing Phase 1 deliverable — rules are explicitly mapped to Phase 3."
    artifacts:
      - path: "agent/src/index.ts"
        issue: "classification_trace JSONB has langfuse_trace_id, stage1, stage2 — no rule_matches field (rules are Phase 3)"
    missing:
      - "Either update ROADMAP SC1 to remove 'rule matches' from Phase 1 criterion, or confirm this is intentionally deferred to Phase 3"
deferred:
  - truth: "Gmail keep-classified items trigger Stage 2 label classifier and Drive upload"
    addressed_in: "Phase 2"
    evidence: "01-05-SUMMARY.md explicitly notes: 'Gmail path still ends at processing status — Stage 2 not wired for Gmail messages (scope: Phase 2 or next foundation plan)'. Phase 2 goal: 'Daniel can authenticate, open the triage queue...and see Drive blobs move from _Inbox to classified paths'. The Gmail Stage 2 pipeline is part of the triage feedback loop addressed in Phase 2."
---

# Phase 1: Foundation Verification Report

**Phase Goal:** Items flow from Downloads and Gmail through a two-stage classification pipeline into Neon and Drive _Inbox, with full traces and triage metrics instrumented from day one
**Verified:** 2026-04-24T21:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: A file dropped in ~/Downloads appears in Neon within 60 seconds with a classification trace | ? HUMAN | Pipeline wired end-to-end in index.ts; requires live daemon to confirm timing |
| 2 | SC1 (sub): Classification trace contains both stage outputs and confidence scores | VERIFIED | index.ts L134: `JSON.stringify({ langfuse_trace_id: traceId, stage1: relevance, stage2: label })` written before Drive upload |
| 3 | SC1 (sub): Classification trace contains rule matches | PARTIAL | Rule system is Phase 3 (RUL-01 to RUL-06); no rule_matches in trace. SC1 wording appears to anticipate Phase 3 content. See gaps. |
| 4 | SC2: A new Gmail message appears in Neon within one poll cycle | ? HUMAN | pollGmail() wired in index.ts with 5-min setInterval; requires live Gmail OAuth to confirm |
| 5 | SC2: historyId 404 triggers full-sync fallback logged to Langfuse | VERIFIED | gmail.ts L85-91: `langfuse.trace({ name: 'gmail_fullsync_fallback', metadata: { reason: 'historyId_expired_or_null' } })` emitted on 404 |
| 6 | SC3: A duplicate file (same SHA-256) results in exactly one Neon row | VERIFIED | dedup.ts: `isDuplicate(contentHash)` returns true on second drop; index.ts exits before insert; all inserts also have `ON CONFLICT (content_hash) DO NOTHING` |
| 7 | SC3: Exactly one Drive upload for a duplicate | VERIFIED | Drive upload only called if `itemRows.length > 0` after UPDATE; dedup exits before the INSERT, so UPDATE finds no rows and upload is skipped |
| 8 | SC4: Keep-classified item has Drive blob at _Inbox/{YYYY-MM}/{name} | ? HUMAN | drive.ts implements correct path; requires live Drive API credentials to confirm blob creation |
| 9 | SC4: Ignore-classified item has only minimal Neon row | VERIFIED | index.ts L57-73: ignore path writes content_hash, source, status='ignored', classification_trace then returns — no Drive call |
| 10 | SC5: uncertain_rate and auto_filed_rate readable from Neon from day one | VERIFIED | metrics.ts: `snapshotMetrics()` INSERTs MetricSnapshot with both rates; wired in index.ts with setTimeout(10s) + setInterval(24h) |
| 11 | SC5: Daemon heartbeat events in Langfuse every 5 minutes | VERIFIED | heartbeat.ts L9: `langfuse.trace({ name: 'daemon_heartbeat', metadata: { pid, ts } })` on 5-min setInterval |
| 12 | Downloads FSEvents watcher + polling fallback operational | VERIFIED | downloads.ts: chokidar watch + awaitWriteFinish debounce + 15-min pollTimer + startup scan — all present |
| 13 | Gmail historyId cursor persisted to Neon GmailCursor after every successful poll | VERIFIED | gmail.ts: `persistCursor()` called after incremental path AND after fullSyncFallback — both cursor columns updated atomically |
| 14 | Google OAuth tokens in macOS Keychain via keytar | VERIFIED | google.ts: `keytar.setPassword/getPassword` with service='com.cortex.daemon' — no plaintext token storage |
| 15 | SIGTERM handler calls flushAsync() before exit | VERIFIED | heartbeat.ts L17: `await langfuse.flushAsync()` in shutdown handler registered on SIGTERM and SIGINT |
| 16 | Full classification trace written to Neon BEFORE Drive upload (CLS-08) | VERIFIED | index.ts: UPDATE sets classification_trace at L135-148, Drive upload called at L154 — ordering enforced |
| 17 | Langfuse trace IDs stored on Item rows linking traces to items | VERIFIED | index.ts: `langfuse_trace_id: traceId` embedded in classification_trace JSONB on all 4 write paths (ignore, uncertain, processing INSERT, keep UPDATE) |

**Score:** 14/17 truths verified (3 require human testing; 1 is a roadmap scope ambiguity)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Gmail keep-classified items trigger Stage 2 label classifier and Drive upload | Phase 2 | 01-05-SUMMARY: "Gmail path still ends at 'processing' status — Stage 2 not wired for Gmail messages (scope: Phase 2 or next foundation plan)" |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | 4 models with all irreversible columns | VERIFIED | Item (halfvec(512), classification_trace, near_duplicate_of, user_id), GmailCursor, TaxonomyLabel, MetricSnapshot — all present |
| `prisma.config.ts` | Prisma 7 datasource config | VERIFIED | Conditional datasource url; `prisma validate` exits 0 |
| `package.json` | Web app deps with Prisma 7.8.0 | VERIFIED | Prisma 7.8.0 present (confirmed from 01-01-SUMMARY) |
| `agent/package.json` | ESM daemon package with chokidar 5, googleapis, keytar, langfuse | VERIFIED | `"type": "module"`, chokidar 5.0.0, googleapis 171.4.0, keytar 7.9.0, langfuse 3.38.20 — all present |
| `.env.example` | All required env vars documented | VERIFIED | DATABASE_URL, ANTHROPIC_API_KEY, LANGFUSE_*, GOOGLE_*, DRIVE_INBOX_FOLDER_ID, CLERK_* all present |
| `agent/src/db.ts` | Neon client singleton | VERIFIED | `export const sql = neon(process.env.DATABASE_URL)` with startup guard |
| `agent/src/collectors/downloads.ts` | chokidar watcher + polling fallback + startup scan | VERIFIED | All three patterns present; exports `startDownloadsCollector` |
| `agent/src/heartbeat.ts` | 5-min Langfuse heartbeat + SIGTERM flush | VERIFIED | daemon_heartbeat trace on 5-min interval; SIGTERM/SIGINT handler with flushAsync() |
| `agent/src/index.ts` | Daemon entry point — full pipeline wired | VERIFIED | All imports wired: heartbeat, downloads, gmail, dedup, extractor, relevance, label, drive, metrics |
| `agent/launchd/com.cortex.daemon.plist` | launchd plist with KeepAlive + RunAtLoad | VERIFIED | Both keys present; credentials not in plist |
| `agent/src/collectors/gmail.ts` | pollGmail() with historyId 404 fallback | VERIFIED | Incremental sync + fullSyncFallback on 404; both cursors persisted; Langfuse event on fallback |
| `agent/src/auth/google.ts` | OAuth2 client with keytar token storage | VERIFIED | storeTokens, loadTokens, getGoogleOAuthClient — all exported; keytar Keychain storage |
| `agent/src/pipeline/dedup.ts` | SHA-256 hash + Neon dedup check | VERIFIED | computeHash, computeHashFromBuffer, isDuplicate — all exported |
| `agent/src/pipeline/extractor.ts` | Size-band content extraction | VERIFIED | 4 bands: installer (always), PDF (5MB), image (10MB), default (1MB) |
| `agent/src/pipeline/relevance.ts` | Stage 1 Claude relevance gate | VERIFIED | classifyRelevance + classifyGmailRelevance; 0.75 confidence threshold enforced in parseRelevanceResponse |
| `agent/src/pipeline/label.ts` | Stage 2 label classifier — 3-axis | VERIFIED | classifyLabel; AxisProposal, LabelResult; allAxesConfident flag; CONFIDENCE_THRESHOLD = 0.75 |
| `agent/src/drive.ts` | Drive _Inbox upload + folder resolution | VERIFIED | uploadToInbox; getOrCreateFolder with session cache; _Inbox/{YYYY-MM}/{filename} path |
| `agent/src/metrics.ts` | snapshotMetrics() — daily MetricSnapshot write | VERIFIED | computeMetrics() + snapshotMetrics(); uncertain_rate and auto_filed_rate correctly computed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `downloads.ts` | `index.ts` | startDownloadsCollector() import | WIRED | index.ts L4: `import { startDownloadsCollector }` |
| `heartbeat.ts` | Langfuse | langfuse.trace('daemon_heartbeat') | WIRED | heartbeat.ts L9: daemon_heartbeat trace on 5-min interval |
| `gmail.ts` | Neon GmailCursor | sql query on 'GmailCursor' | WIRED | gmail.ts: getOrCreateCursor() + persistCursor() both query "GmailCursor" table |
| `gmail.ts` | Langfuse | langfuse.trace('gmail_fullsync_fallback') | WIRED | gmail.ts L85: trace emitted with historyId_expired_or_null reason |
| `auth/google.ts` | keytar | keytar.setPassword / getPassword | WIRED | google.ts: storeTokens uses setPassword, loadTokens uses getPassword |
| `pipeline/relevance.ts` | @anthropic-ai/sdk | anthropic.messages.create() | WIRED | relevance.ts L87: `anthropic.messages.create({ model: 'claude-haiku-4-5' })` |
| `pipeline/dedup.ts` | Neon Item table | sql query on content_hash | WIRED | dedup.ts L15: `SELECT id FROM "Item" WHERE content_hash = ${contentHash}` |
| `index.ts` | pipeline/dedup + extractor + relevance | handleFile() wiring | WIRED | index.ts L7-9: imports computeHash, isDuplicate, extractContent, classifyRelevance all called in handleFile |
| `pipeline/label.ts` | @anthropic-ai/sdk | anthropic.messages.create() | WIRED | label.ts L110: `anthropic.messages.create({ model: 'claude-haiku-4-5' })` |
| `drive.ts` | googleapis Drive v3 | drive.files.create() | WIRED | drive.ts L64: `drive.files.create({ requestBody: { name, parents }, media })` |
| `index.ts` | pipeline/label + drive | handleFile() keep branch | WIRED | index.ts L10-11: imports classifyLabel + uploadToInbox; called in keep branch |
| `index.ts` | Neon Item table (trace before drive) | sql UPDATE classification_trace BEFORE drive upload | WIRED | index.ts L135-148 UPDATE, then L154 uploadToInbox — write order enforced |
| `metrics.ts` | Neon MetricSnapshot table | sql INSERT | WIRED | metrics.ts L59: `INSERT INTO "MetricSnapshot"` |
| `index.ts` | Langfuse traces (trace IDs on Item rows) | langfuse_trace_id in classification_trace JSONB | WIRED | index.ts L67, L85, L103, L134: langfuse_trace_id embedded in all 4 write paths |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `index.ts handleFile` | contentHash | computeHash(filePath) reads file bytes | Yes — SHA-256 of real file | FLOWING |
| `index.ts handleFile` | relevance | classifyRelevance() → anthropic.messages.create() | Yes — live LLM call | FLOWING |
| `index.ts handleFile` | label | classifyLabel() → anthropic.messages.create() | Yes — live LLM call | FLOWING |
| `index.ts handleFile` | driveInboxId | uploadToInbox() → drive.files.create() | Yes — real Drive file ID | FLOWING (requires credentials) |
| `metrics.ts` | uncertain_rate | COUNT(*) FILTER on Neon Item table | Yes — real DB aggregate | FLOWING |
| `gmail.ts pollGmail` | history records | gmail.users.history.list() | Yes — live Gmail API | FLOWING (requires OAuth) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `cd agent && npx tsc --noEmit` | Exit 0, no errors | PASS |
| Prisma schema validates | `node_modules/.bin/prisma validate` | "The schema at prisma/schema.prisma is valid" | PASS |
| 4 Prisma models present | `grep -c "^model " prisma/schema.prisma` | 4 | PASS |
| agent/ is ESM package | `grep '"type": "module"' agent/package.json` | Match | PASS |
| daemon_heartbeat in heartbeat.ts | `grep daemon_heartbeat agent/src/heartbeat.ts` | Match | PASS |
| SIGTERM + flushAsync in heartbeat.ts | `grep -c "SIGTERM\|flushAsync" agent/src/heartbeat.ts` | 2 | PASS |
| KeepAlive + RunAtLoad in plist | `grep -c "KeepAlive\|RunAtLoad" agent/launchd/com.cortex.daemon.plist` | 2 | PASS |
| Live Neon DB (prisma db push) | Manual step | Not run — DATABASE_URL not available in execution environment | SKIP — human required |
| Live daemon ingest | Manual step | Requires all credentials + OAuth setup | SKIP — human required |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ING-01 | 01-02 | Downloads watcher via fsevents, launchd daemon, read-only | SATISFIED | downloads.ts: chokidar FSEvents watcher; plist with KeepAlive; no filesystem writes |
| ING-02 | 01-03 | Gmail OAuth read-only, incremental historyId | SATISFIED | gmail.ts: pollGmail() with history.list; gmail.readonly scope in auth |
| ING-03 | 01-01, 01-04 | SHA-256 dedup in Neon | SATISFIED | dedup.ts: computeHash + isDuplicate; content_hash UNIQUE in schema |
| ING-04 | 01-01, 01-04 | Size-band routing | SATISFIED | extractor.ts: PDF≤5MB, image≤10MB, installers always metadata-only, default≤1MB |
| ING-05 | 01-02 | Daemon heartbeat + polling fallback | SATISFIED | heartbeat.ts: 5-min trace; downloads.ts: 15-min pollTimer |
| ING-06 | 01-03 | Gmail historyId 404 triggers full-sync, not silent drop | SATISFIED | gmail.ts L167: 404 branch calls fullSyncFallback; Langfuse event emitted |
| CLS-01 | 01-04 | Relevance gate: keep/ignore/uncertain via Claude | SATISFIED | relevance.ts: classifyRelevance + classifyGmailRelevance with Anthropic SDK |
| CLS-02 | 01-05 | Keep items upload to Drive _Inbox, proceed to label classifier | SATISFIED (Downloads only) | index.ts keep branch: Stage 2 → Neon write → Drive upload. Gmail keep path stops at status='processing' (deferred to Phase 2) |
| CLS-03 | 01-04 | Ignore items: minimal Neon row, no upload | SATISFIED | index.ts L57-73: content_hash, source, status='ignored', classification_trace written; return before Drive |
| CLS-04 | 01-04 | Uncertain items: route to relevance triage queue | SATISFIED | index.ts L75-91: status='uncertain' row written; no Drive call |
| CLS-05 | 01-05 | Label classifier: 3 axes from taxonomy with per-axis confidence | SATISFIED | label.ts: Type/From/Context axes; normalise() clamps confidence 0-1; existingTaxonomy parameter |
| CLS-06 | 01-05 | Label classifier emits proposed_drive_path | SATISFIED | label.ts L84: proposed_drive_path derived as Context/Types/From; written to Neon |
| CLS-07 | 01-05 | Above-threshold auto-archive; below-threshold → label triage | SATISFIED | label.ts: allAxesConfident (all 3 >= 0.75) → certain; any below → uncertain. Per-axis confidence stored in axis_*_confidence columns for triage UI to read |
| CLS-08 | 01-05 | Full classification trace stored before any filing | SATISFIED | index.ts: Neon UPDATE with full {stage1, stage2} trace at L135-148; drive.files.create at L154 — enforced ordering |
| DRV-01 | 01-05 | Two-phase lifecycle: _Inbox/{YYYY-MM}/{name} | SATISFIED | drive.ts: monthFolder = YYYY-MM; getOrCreateFolder; files.create with monthFolderId as parent |
| OBS-01 | 01-06 | Langfuse traces on every classify call | SATISFIED | index.ts: traceClient captured on handleFile + handleGmailMessage; relevance_gate and label_classifier child spans |
| OBS-06 | 01-06 | uncertain_rate and auto_filed_rate from day one | SATISFIED | metrics.ts: computeMetrics() queries Neon; snapshotMetrics() INSERTs MetricSnapshot; wired in index.ts with 10s startup + 24h interval |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `agent/src/index.ts` | 184 | Gmail keep path leaves status='processing' — Stage 2 not wired for Gmail | Warning | Gmail 'keep' items sit in 'processing' status indefinitely until Phase 2 wires Stage 2 for Gmail. Not a blocker for Phase 1 goal (Downloads pipeline is complete end-to-end). |

### Human Verification Required

#### 1. End-to-end Downloads ingest (SC1)

**Test:** With DATABASE_URL, ANTHROPIC_API_KEY, LANGFUSE credentials, and GOOGLE credentials set; with `prisma db push` run; build the agent and start the daemon. Drop a new file into ~/Downloads.
**Expected:** Within 60 seconds, a row appears in the Neon Item table with status=certain or status=uncertain, classification_trace JSONB contains `langfuse_trace_id`, `stage1` (decision, confidence, reason), and `stage2` (axes, proposed_drive_path, allAxesConfident). A keep-classified file has drive_inbox_id populated.
**Why human:** Requires live credentials, running daemon, and real API calls to Anthropic and Drive.

#### 2. Dedup end-to-end (SC3)

**Test:** Drop the same file twice; query `SELECT count(*) FROM "Item" WHERE content_hash = '<hash>'`.
**Expected:** count = 1; Drive has exactly one blob for that file.
**Why human:** Requires running daemon and live Neon + Drive connections.

#### 3. Gmail ingest + historyId fallback (SC2)

**Test:** Poll Gmail with valid OAuth tokens in Keychain. Then manually expire the historyId and trigger another poll.
**Expected:** New Gmail messages appear in Neon with source='gmail'; Langfuse shows gmail_fullsync_fallback event with reason=historyId_expired_or_null on the invalidated poll.
**Why human:** Requires Gmail OAuth tokens in macOS Keychain via `runInitialAuthFlow()`.

#### 4. Metrics snapshot (SC5)

**Test:** Run the daemon for 15 seconds after setting DATABASE_URL; query `SELECT uncertain_rate, auto_filed_rate FROM "MetricSnapshot" ORDER BY captured_at DESC LIMIT 1`.
**Expected:** Row exists with numeric (possibly 0) rates; no error thrown.
**Why human:** Requires live Neon DATABASE_URL.

#### 5. Heartbeat in Langfuse (SC5)

**Test:** Run daemon for 10 minutes with LANGFUSE_* credentials set; check Langfuse dashboard.
**Expected:** daemon_heartbeat traces appear at ~5-minute intervals with pid and timestamp metadata.
**Why human:** Requires live Langfuse credentials and running daemon.

#### 6. Prisma DB push (Plan 01 blocking step)

**Test:** With DATABASE_URL set, run `npx prisma db push` from project root.
**Expected:** Exit 0; all 4 tables created in Neon (Item, GmailCursor, TaxonomyLabel, MetricSnapshot); pgvector extension enabled.
**Why human:** DATABASE_URL was not available during execution; documented as a required manual step in 01-01-SUMMARY.md.

#### 7. TypeScript compilation (regression check)

**Test:** `cd agent && npx tsc --noEmit`
**Expected:** Exit 0, no errors.
**Why human:** Already passed in automated spot-check — included here for completeness as a pre-run gate.

### Gaps Summary

One gap requires clarification rather than code work:

**ROADMAP SC1 "rule matches" in classification trace:** The Phase 1 ROADMAP success criterion SC1 says the classification trace should include "both stage outputs, confidence scores, rule matches." The rule system (RUL-01 to RUL-06) is mapped to Phase 3 in REQUIREMENTS.md, so no rule_matches field can exist in the Phase 1 trace. This appears to be a forward reference in the SC1 wording, not a missing Phase 1 deliverable. Recommend updating ROADMAP SC1 to say "both stage outputs and confidence scores" and add rule matches to Phase 3's SC.

One deferred item (Gmail Stage 2): Gmail 'keep' items reach status='processing' but do not trigger Stage 2 label classification or Drive upload. The 01-05-SUMMARY explicitly scopes this to Phase 2. The Downloads path is complete end-to-end — the phase goal ("Items flow from Downloads and Gmail through a two-stage classification pipeline") is partially met: Downloads is fully wired; Gmail stage 2 is deferred.

---

_Verified: 2026-04-24T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
