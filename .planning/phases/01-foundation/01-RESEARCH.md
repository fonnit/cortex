# Phase 1: Foundation — Research

**Researched:** 2026-04-24
**Domain:** Mac launchd daemon, chokidar FSEvents, Gmail historyId sync, two-stage LLM classification, Prisma 7 + Neon schema, Drive _Inbox upload, Langfuse tracing
**Confidence:** HIGH

---

## Summary

Phase 1 is purely execution work. Every library is confirmed at its pinned version against npm registry as of 2026-04-24. The architecture — Mac daemon writes directly to Neon, Langfuse is fire-and-forget, Drive is blob-only — is fully resolved in prior project research. No alternatives exist to evaluate.

Three open questions from STATE.md are now resolved. Langfuse cloud platform is currently at v3.170.0 (released 2026-04-23), confirmed via GitHub releases API — the npm `langfuse` package latest tag remains `3.38.20` (v3), confirming the v3 pin is correct for cloud users. chokidar v5 is confirmed ESM-only (`"type": "module"` in package.json) — the daemon package must use `"type": "module"`. keytar v7.9.0 is available via npm and provides native macOS Keychain bindings, making it the correct choice for Google OAuth token storage over plaintext JSON.

The schema decisions in this phase are irreversible once data exists: `classification_trace` JSONB column, `near_duplicate_of` FK, `last_history_id` + `last_successful_poll_at` cursors, `user_id` tenancy column, `uncertain_rate`/`auto_filed_rate` metric rows. All must land in the initial migration.

**Primary recommendation:** Schema first, daemon core second, two-stage pipeline third. Every subsequent phase depends on the Neon schema being correct.

---

## Project Constraints (from CLAUDE.md)

- Neon Postgres only — no SQLite, no in-memory stores
- Prisma migrations through Vercel build (`postinstall: prisma generate`, `build: prisma generate && prisma migrate deploy && next build`) — never `prisma migrate dev` against production
- Mac daemon: launchd with KeepAlive
- chokidar for FSEvents watching
- googleapis for Gmail/Drive API
- @anthropic-ai/sdk for Claude classification
- Langfuse SDK for observability traces
- Google OAuth tokens stored locally (separate from Clerk web auth)
- FSEvents daemon needs heartbeat + polling fallback
- Gmail historyId 404 needs full-sync fallback
- Don't escalate spec constraints into MVP-blocking gates

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ING-01 | Downloads collector watches ~/Downloads via fsevents with launchd daemon, read-only | chokidar v5 ESM confirmed; launchd KeepAlive plist pattern documented |
| ING-02 | Gmail collector polls one account via OAuth read-only scope, incremental via historyId | googleapis `users.history.list` + historyId sync pattern; 404 fallback required |
| ING-03 | Content-hash dedup (SHA-256) in Neon prevents reprocessing across sources | Schema: `content_hash` unique index on `items` table; Node crypto built-in |
| ING-04 | Size-band routing: PDF ≤5 MB content-read, images ≤10 MB, installers metadata-only, default ≤1 MB | Daemon-side conditional read before Claude call; configurable per MIME type |
| ING-05 | Daemon heartbeat + polling fallback (fsevents can stop after ~1h) | Langfuse heartbeat event every 5 min; stat Downloads mtime every 15 min as fallback |
| ING-06 | Gmail historyId 404 triggers full-sync fallback, not silent drop | `last_successful_poll_at` timestamp in Neon as fallback cursor; Langfuse event on every fallback |
| CLS-01 | Relevance gate classifies items as keep / ignore / uncertain via Claude | @anthropic-ai/sdk 0.91.0; Claude Haiku; confidence threshold 0.75 |
| CLS-02 | Keep items upload to Drive _Inbox and proceed to label classifier | googleapis Drive v3 `files.create`; `_Inbox/{content_hash}` path pattern |
| CLS-03 | Ignore items store minimal Neon row (content_hash, source, reason) — no upload | Schema: `status = 'ignored'`; pipeline exits after relevance gate |
| CLS-04 | Uncertain items route to relevance triage queue | Schema: `status = 'uncertain'`; surfaced in Phase 2 triage UI |
| CLS-05 | Label classifier proposes candidates on 3 axes (Type / From / Context) with per-axis confidence | Second Claude call after keep gate; structured JSON output with confidence per axis |
| CLS-06 | Label classifier emits proposed_drive_path derived from taxonomy | `proposed_drive_path` column in Neon items table |
| CLS-07 | Above-threshold axes auto-archive; below-threshold route to label triage queue | Partial-match routing: `status = 'certain'` vs `'uncertain'` based on per-axis thresholds |
| CLS-08 | Full classification trace stored (both stage outputs + confidence) before any item is filed | `classification_trace` JSONB column on items; Langfuse span per stage; non-negotiable at schema time |
| DRV-01 | Two-phase lifecycle: _Inbox/{YYYY-MM}/{name} for items pending label triage | googleapis Drive v3 upload; `drive_inbox_id` stored in Neon; final path resolved in Phase 2 cron |
| OBS-01 | Langfuse traces on every classify / chunk / embed / ask call | `langfuse@3.38.20`; fire-and-forget spans; `forceFlush()` at daemon shutdown |
| OBS-06 | uncertain_rate and auto_filed_rate instrumented from day one | Schema: metrics table or computed from items status counts; surfaced from day one |
</phase_requirements>

---

## Standard Stack

### Core (Mac Daemon — Phase 1 primary)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22 LTS | Daemon runtime | chokidar v5 requires Node ≥ 20; 22 is current LTS [VERIFIED: npm registry] |
| chokidar | 5.0.0 | FSEvents file watching | ESM-only; native macOS FSEvents; zero polling; debounce + error recovery over raw fsevents [VERIFIED: npm registry + github.com/paulmillr/chokidar] |
| googleapis | 171.4.0 | Gmail + Drive API | Official Google client; `users.history.list` for incremental Gmail; Drive v3 for uploads [VERIFIED: npm registry] |
| @anthropic-ai/sdk | 0.91.0 | Claude classification | Direct API calls; two-stage relevance then label; both Claude Haiku [VERIFIED: npm registry] |
| keytar | 7.9.0 | Google OAuth token storage | Native macOS Keychain bindings; preferred over plaintext JSON for credentials [VERIFIED: npm registry] |
| langfuse | 3.38.20 | LLM tracing | v3 is current cloud-compatible version; v4 SDK targets self-hosted platform — cloud platform confirmed at v3.170.0 as of 2026-04-23 [VERIFIED: npm registry + GitHub releases API] |

### Core (Web App — Phase 1 schema/migrations only)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| prisma | 7.8.0 | ORM + migrations | Constraint: migrations via Vercel build; edge-runtime support via Neon adapter [VERIFIED: npm registry] |
| @prisma/adapter-neon | 7.8.0 | Neon HTTP transport | Required for Vercel Functions; matches Prisma version exactly [VERIFIED: npm registry] |
| @neondatabase/serverless | 1.1.0 | Neon driver | Underlying transport; used directly for raw SQL where Prisma pgvector support is insufficient [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (Node built-in) | — | SHA-256 content hashing | ING-03 dedup; no additional package needed |
| pdf-parse or pdfjs-dist | verify at impl | PDF text extraction | Size-band routing for PDFs ≤5 MB; evaluate at implementation |
| node-cron or launchd StartInterval | — | Gmail poll scheduling | `StartInterval` in plist is simpler than an in-process cron; prefer launchd |

### Resolved Open Questions

| Question | Resolution | Evidence |
|----------|------------|----------|
| Langfuse cloud SDK version (v3 vs v4) | Stay on `langfuse@3.38.20` | Langfuse cloud platform at v3.170.0 (2026-04-23); npm `latest` tag = 3.38.20; v4 SDK targets self-hosted ≥ 3.95.0 [VERIFIED: GitHub releases API + npm registry] |
| chokidar v5 ESM in launchd context | ESM confirmed — daemon must use `"type": "module"` | chokidar v5 package.json: `"type": "module"` [VERIFIED: github.com/paulmillr/chokidar raw package.json] |
| Google OAuth token storage | Use keytar (native Keychain) | keytar 7.9.0 available; native macOS Keychain bindings; no plaintext credentials on disk [VERIFIED: npm registry] |

### Installation

```bash
# Mac agent package
npm install chokidar@5.0.0 googleapis@171.4.0 @anthropic-ai/sdk@0.91.0 keytar@7.9.0 langfuse@3.38.20

# Web app (schema + migrations only in Phase 1)
npm install prisma@7.8.0 @prisma/adapter-neon@7.8.0 @neondatabase/serverless@1.1.0
```

---

## Architecture Patterns

### Recommended Project Structure

```
cortex/
├── agent/                    # Mac daemon (separate package, "type": "module")
│   ├── src/
│   │   ├── collectors/
│   │   │   ├── downloads.ts  # chokidar watcher + polling fallback
│   │   │   └── gmail.ts      # historyId sync + 404 fallback
│   │   ├── pipeline/
│   │   │   ├── dedup.ts      # SHA-256 + Neon lookup
│   │   │   ├── extractor.ts  # size-band pre-read
│   │   │   ├── relevance.ts  # stage 1 Claude call
│   │   │   └── label.ts      # stage 2 Claude call
│   │   ├── drive.ts          # _Inbox upload
│   │   ├── heartbeat.ts      # Langfuse 5-min ping
│   │   └── index.ts          # daemon entry, launchd KeepAlive target
│   └── package.json          # "type": "module"
├── prisma/
│   ├── schema.prisma         # single schema, migrations via Vercel build
│   └── migrations/           # generated, committed
├── src/                      # Next.js app (Phase 2+)
└── package.json              # web app
```

### Pattern 1: Chokidar FSEvents Watcher with Polling Fallback

**What:** Primary watch via chokidar FSEvents; secondary poll every 15 min via stat on Downloads mtime; Langfuse heartbeat every 5 min proves liveness.
**When to use:** ING-01, ING-05

```typescript
// Source: chokidar v5 ESM API (github.com/paulmillr/chokidar)
import { watch } from 'chokidar';
import { langfuse } from './langfuse.js';

const watcher = watch(DOWNLOADS_PATH, {
  persistent: true,
  ignoreInitial: false,    // scan for files newer than last_processed_at on startup
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
});

watcher.on('add', (filePath) => ingestFile(filePath));
watcher.on('error', (err) => langfuse.trace({ name: 'fsevents_error', metadata: { err } }));

// Heartbeat — emitted every 5 minutes regardless of file events
setInterval(() => {
  langfuse.trace({ name: 'daemon_heartbeat', metadata: { pid: process.pid } });
}, 5 * 60 * 1000);

// Polling fallback — catches events if FSEvents subscription silently dies
setInterval(() => checkDownloadsMtime(), 15 * 60 * 1000);
```

### Pattern 2: Gmail historyId Incremental Sync with 404 Fallback

**What:** Incremental sync via `users.history.list`; on 404, fall back to full sync from `last_successful_poll_at`; both cursors persisted to Neon.
**When to use:** ING-02, ING-06

```typescript
// Source: developers.google.com/workspace/gmail/api/guides/sync
async function pollGmail(gmail: gmail_v1.Gmail) {
  const cursor = await db.gMailCursor.findFirst(); // { last_history_id, last_successful_poll_at }
  
  try {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: cursor.last_history_id,
      historyTypes: ['messageAdded'],
    });
    // process res.data.history ...
    await db.gMailCursor.update({ last_history_id: res.data.historyId, last_successful_poll_at: new Date() });
  } catch (err: any) {
    if (err.code === 404) {
      // Explicit fallback — not a silent drop
      langfuse.trace({ name: 'gmail_fullsync_fallback', metadata: { reason: 'historyId_expired' } });
      await fullSyncFromTimestamp(gmail, cursor.last_successful_poll_at);
    } else {
      throw err;
    }
  }
}
```

### Pattern 3: Two-Stage Classification Pipeline

**What:** Relevance gate (stage 1) → optional label classifier (stage 2). Full trace stored to Neon JSONB before any Drive upload or status write. Uncertain if either stage confidence < 0.75.
**When to use:** CLS-01 through CLS-08

```typescript
// Source: @anthropic-ai/sdk + project architecture decisions
async function classify(item: IngestItem): Promise<ClassificationResult> {
  const span = langfuse.trace({ name: 'classify', input: item.metadata });
  
  // Stage 1: relevance gate
  const relevanceSpan = span.span({ name: 'relevance_gate' });
  const relevance = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    messages: [{ role: 'user', content: buildRelevancePrompt(item) }],
  });
  const { decision, confidence: relevanceConf } = parseRelevance(relevance);
  relevanceSpan.end({ output: { decision, confidence: relevanceConf } });
  
  if (decision === 'ignore') {
    // Store minimal row, exit
    await db.item.create({ data: { ...item.metadata, status: 'ignored', classification_trace: { stage1: { decision, confidence: relevanceConf } } } });
    return { status: 'ignored' };
  }
  
  // Stage 2: label classifier (runs for both keep and uncertain)
  const labelSpan = span.span({ name: 'label_classifier' });
  const label = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    messages: [{ role: 'user', content: buildLabelPrompt(item, existingTaxonomy) }],
  });
  const { axes, proposed_drive_path, axisConfidences } = parseLabel(label);
  labelSpan.end({ output: { axes, proposed_drive_path, axisConfidences } });
  
  // Uncertain if either stage confidence < 0.75
  const status = (relevanceConf < 0.75 || Object.values(axisConfidences).some(c => c < 0.75))
    ? 'uncertain' : 'certain';
  
  // Full trace stored before any write — CLS-08
  const trace = {
    stage1: { decision, confidence: relevanceConf },
    stage2: { axes, proposed_drive_path, axisConfidences },
  };
  
  await db.item.create({ data: { ...item, status, proposed_drive_path, classification_trace: trace } });
  span.end();
  return { status, proposed_drive_path };
}
```

### Pattern 4: Prisma Schema for Phase 1

**What:** Complete initial schema including all irreversible columns. Must include `classification_trace` JSONB, `near_duplicate_of` FK, `user_id` tenancy, Gmail cursors, metrics tracking.
**When to use:** All ING/CLS/DRV/OBS requirements; schema is the foundation for all subsequent phases.

```prisma
// Source: Prisma 7 docs + project architecture decisions
// prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector", schema: "public")]
}

model Item {
  id                    String   @id @default(cuid())
  user_id               String   // tenancy-ready from day one
  content_hash          String   @unique
  source                String   // 'downloads' | 'gmail'
  status                String   // 'ignored' | 'uncertain' | 'certain' | 'resolved' | 'filed'
  
  // Metadata
  filename              String?
  mime_type             String?
  size_bytes            Int?
  source_metadata       Json?    // email headers, sender, subject etc.
  
  // Classification — CLS-08: full trace stored before any filing
  classification_trace  Json?    // { stage1: {...}, stage2: {...} }
  proposed_drive_path   String?
  confirmed_drive_path  String?
  drive_inbox_id        String?  // Drive file ID at _Inbox/{content_hash}
  drive_filed_id        String?  // Drive file ID after resolve
  
  // Taxonomy axes
  axis_type             String?
  axis_from             String?
  axis_context          String?
  axis_type_confidence  Float?
  axis_from_confidence  Float?
  axis_context_confidence Float?
  
  // Dedup — Pitfall 9: near-duplicate detection
  near_duplicate_of     String?
  near_duplicate_of_item Item?  @relation("NearDuplicate", fields: [near_duplicate_of], references: [id])
  near_duplicates       Item[]  @relation("NearDuplicate")
  
  // Embedding (Phase 4 — column exists from day one for schema stability)
  embedding             Unsupported("halfvec(512)")?
  
  ingested_at           DateTime @default(now())
  updated_at            DateTime @updatedAt
  
  @@index([user_id, status])
  @@index([content_hash])
}

model GmailCursor {
  id                      String   @id @default(cuid())
  user_id                 String   @unique
  last_history_id         String?
  last_successful_poll_at DateTime?
  updated_at              DateTime @updatedAt
}

model TaxonomyLabel {
  id          String   @id @default(cuid())
  user_id     String
  axis        String   // 'type' | 'from' | 'context'
  name        String
  item_count  Int      @default(0)
  last_used   DateTime?
  deprecated  Boolean  @default(false)
  created_at  DateTime @default(now())
  
  @@unique([user_id, axis, name])
  @@index([user_id, axis])
}
```

### Pattern 5: launchd Plist (KeepAlive + StartInterval)

**What:** launchd plist for Mac daemon with KeepAlive and a separate Gmail poll interval without an in-process cron dependency.
**When to use:** ING-01, ING-05

```xml
<!-- ~/Library/LaunchAgents/com.cortex.daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/dfonnegrag/.cortex/agent/dist/index.js</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/cortex-daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/cortex-daemon-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
```

### Anti-Patterns to Avoid

- **Daemon calling Vercel API routes:** Daemon writes directly to Neon via Prisma/pg. No Vercel roundtrip.
- **Embedding at ingest time:** Embed only after `filed` status. Phase 4 only.
- **Langfuse on the critical path:** All Langfuse calls are fire-and-forget. `forceFlush()` only at daemon shutdown. SDK failure must never block item processing.
- **Writing classification trace after Drive upload:** CLS-08 requires trace stored before any filing. Write trace + status atomically before Drive call.
- **Storing Gmail cursor in a local file:** Cursor must be in Neon so daemon restarts don't lose state.
- **Using chokidar v4 by default:** v5 is ESM and required for `"type": "module"` daemon. Only fall back to v4 if a dependency forces CJS.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File system watching | Custom poll loop | chokidar 5 | FSEvents subscription management, debounce, glob filter, error recovery |
| Gmail incremental sync | Custom diff | googleapis `users.history.list` | historyId is the API's official incremental cursor; hand-rolling misses message deletions |
| Drive file upload | Custom multipart form | googleapis Drive v3 `files.create` | Resumable upload, retry, auth refresh handled by client |
| LLM API calls | Custom HTTP client | @anthropic-ai/sdk | Streaming, retry, auth, typed responses |
| macOS Keychain access | Encrypted JSON file | keytar | Native Keychain prevents credentials being readable from disk; avoids encryption key management |
| LLM observability | Custom logging | Langfuse | Trace ID correlation, span nesting, token cost tracking, Langfuse UI queries |
| Content dedup | Fuzzy hash | SHA-256 via Node crypto built-in | Exact dedup is correct for this use case; semantic dedup is a Phase 2 enhancement |

**Key insight:** The Mac agent's complexity lives in orchestration, not in any individual operation. Every individual operation (watch, poll, classify, upload) has a production-grade library. The only custom code is the pipeline glue and the prompt construction.

---

## Common Pitfalls

### Pitfall 1: FSEvents Daemon Silently Dies After Hours

**What goes wrong:** macOS FSEvents subscriptions can stop delivering events after ~1 hour of runtime without any error. The daemon process stays alive under launchd but no new files are processed.
**Why it happens:** Kernel event queue overflow or internal path table exhaustion. Documented in community reports for long-running FSEvents watchers.
**How to avoid:** Emit a Langfuse heartbeat every 5 minutes. Add a polling fallback that stats Downloads mtime every 15 minutes independently of FSEvents. On daemon init, scan Downloads for files newer than `last_processed_at` to catch missed events during any downtime.
**Warning signs:** No heartbeat events in Langfuse for >10 minutes while Mac is active.

### Pitfall 2: Gmail historyId Expiry Causes Silent Message Gaps

**What goes wrong:** historyId validity is documented as probabilistic. A 404 from `users.history.list` must trigger a full sync from timestamp, not a silent skip.
**Why it happens:** historyId can expire within hours to days depending on activity. Daemons that log the error and move on silently drop days of email.
**How to avoid:** Treat 404 as a first-class expected state. Store both `last_history_id` and `last_successful_poll_at` in Neon. On 404, use `last_successful_poll_at` as the fallback sync window. Emit a Langfuse event for every fallback.
**Warning signs:** Fallback events in Langfuse more than once per week; items from specific date ranges missing from the queue.

### Pitfall 3: Classification Trace Stored After Drive Upload

**What goes wrong:** Drive upload succeeds but Neon write fails. Item exists in Drive with no Neon row. Orphaned Drive blob, no way to recover or deduplicate.
**Why it happens:** Write order error — treating Drive upload as the primary action.
**How to avoid:** Write the Neon item row (with `status = 'processing'`, full `classification_trace`) first. Then upload to Drive. Then update the row with `drive_inbox_id` and final status. If Drive upload fails, the Neon row exists for retry.
**Warning signs:** Drive files in `_Inbox` with no corresponding Neon row.

### Pitfall 4: Schema Missing Irreversible Columns

**What goes wrong:** `classification_trace`, `near_duplicate_of`, `user_id`, or Gmail cursor columns are added in Phase 2 after data exists, requiring a migration that touches existing rows.
**Why it happens:** "We'll add it when we need it" deferred decisions on columns that cannot be retrofitted cleanly.
**How to avoid:** All columns listed in the Pattern 4 schema must exist in the Phase 1 initial migration. The embedding column (`halfvec(512)`) must also exist even though it won't be populated until Phase 4.
**Warning signs:** N/A — this is a design-time decision.

### Pitfall 5: keytar Native Build Failure in CI

**What goes wrong:** keytar requires native compilation (node-gyp). CI environments without Xcode Command Line Tools or the correct Python version will fail `npm install`.
**Why it happens:** keytar is a native Node addon. Standard CI Node images may lack the build toolchain.
**How to avoid:** For the Mac daemon, CI builds are not the primary concern (daemon runs locally). However, if the daemon is ever built in CI, add `npm rebuild keytar` with the appropriate native build flags. Alternatively, encrypt the token JSON as a fallback with a clearly documented security trade-off.
**Warning signs:** `node-gyp rebuild` errors during `npm install`.

### Pitfall 6: Langfuse `forceFlush` Not Called at Daemon Shutdown

**What goes wrong:** Daemon is killed by launchd (e.g., machine shutdown). Buffered Langfuse spans are lost. Last classification trace missing from Langfuse.
**Why it happens:** Langfuse SDK buffers spans in memory and flushes on an interval. Process kill before flush = data loss.
**How to avoid:** Register `process.on('SIGTERM')` and `process.on('SIGINT')` handlers that call `await langfuse.flushAsync()` before exiting. launchd sends SIGTERM on stop.
**Warning signs:** Incomplete traces in Langfuse for items processed near daemon restart events.

---

## Code Examples

### Content Hash + Neon Dedup (ING-03)

```typescript
// Source: Node.js crypto built-in + @prisma/adapter-neon pattern
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

async function computeContentHash(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function isDuplicate(db: PrismaClient, contentHash: string): Promise<boolean> {
  const existing = await db.item.findUnique({ where: { content_hash: contentHash } });
  return existing !== null;
}
```

### Size-Band Routing (ING-04)

```typescript
// Source: project requirements + implementation pattern
const SIZE_BANDS = {
  'application/pdf': 5 * 1024 * 1024,           // 5 MB
  'image/': 10 * 1024 * 1024,                    // 10 MB prefix match
  'installer': 0,                                 // metadata-only always
  default: 1 * 1024 * 1024,                      // 1 MB
};

function shouldReadContent(mimeType: string, sizeBytes: number): boolean {
  if (mimeType.includes('dmg') || mimeType.includes('pkg') || mimeType.includes('exe')) return false;
  if (mimeType === 'application/pdf') return sizeBytes <= SIZE_BANDS['application/pdf'];
  if (mimeType.startsWith('image/')) return sizeBytes <= SIZE_BANDS['image/'];
  return sizeBytes <= SIZE_BANDS.default;
}
```

### Drive _Inbox Upload (DRV-01)

```typescript
// Source: googleapis Drive v3 API + project two-phase lifecycle pattern
import { drive_v3 } from 'googleapis';
import { createReadStream } from 'fs';

async function uploadToInbox(
  drive: drive_v3.Drive,
  filePath: string,
  contentHash: string,
  mimeType: string,
): Promise<string> {
  const date = new Date();
  const folder = `_Inbox/${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const filename = path.basename(filePath);
  
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [await getOrCreateFolder(drive, folder)],
    },
    media: {
      mimeType,
      body: createReadStream(filePath),
    },
    fields: 'id',
  });
  
  return res.data.id!; // drive_inbox_id stored in Neon
}
```

### Langfuse Span Pattern (OBS-01)

```typescript
// Source: langfuse@3.38.20 SDK — fire-and-forget, never on critical path
import Langfuse from 'langfuse';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  flushAt: 5,       // batch size before auto-flush
  flushInterval: 30_000, // 30 second auto-flush
});

// At daemon shutdown
process.on('SIGTERM', async () => {
  await langfuse.flushAsync();
  process.exit(0);
});

// Heartbeat (OBS-06 + ING-05)
setInterval(() => {
  langfuse.trace({ name: 'daemon_heartbeat', metadata: { pid: process.pid, ts: Date.now() } });
}, 5 * 60 * 1000);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fsevents npm (raw binding) | chokidar v5 (ESM, wraps fsevents) | chokidar v5 2024 | Adds debounce, glob, error recovery; zero polling |
| chokidar v4 (CJS) | chokidar v5 (ESM-only) | 2024 | Daemon package must be `"type": "module"` |
| langfuse v3 SDK | langfuse v3 SDK (v4 self-hosted only) | SDK v4 released Aug 2025 | Stay on v3 for Langfuse cloud users until cloud platform upgrades |
| Prisma with TCP Neon connection | Prisma + @prisma/adapter-neon (HTTP) | Prisma 7 / Neon adapter | Edge/serverless compatible; no TCP connection pool issues |
| vector(1536) | halfvec(512) | Neon halfvec support 2024 | 50% storage reduction; OpenAI text-embedding-3-small natively supports 512 dims |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Langfuse cloud platform version is v3.170.0 and does not support SDK v4 | Standard Stack | If cloud has silently upgraded to ≥ 3.95.0, SDK v4 would be available; v3 pin is safe regardless |
| A2 | keytar 7.9.0 compiles cleanly on macOS 25.x (Darwin 25.3.0) | Standard Stack | If node-gyp fails on this OS version, fall back to encrypted JSON file; daemon is local-only so CI build is not a concern |
| A3 | PDF content extraction for files ≤5 MB is sufficient for classification quality | Standard Stack / ING-04 | If classifier quality is poor on PDFs with metadata-only, threshold may need tuning; addressable without schema change |

---

## Open Questions

1. **PDF text extraction library**
   - What we know: Phase 1 needs to read PDF content for files ≤5 MB for classification
   - What's unclear: `pdf-parse` is widely used but unmaintained; `pdfjs-dist` is actively maintained but heavier
   - Recommendation: Evaluate at implementation. Start with `pdf-parse`; switch to `pdfjs-dist` if extraction quality is insufficient.

2. **Gmail poll interval**
   - What we know: launchd `StartInterval` handles scheduling without in-process cron; 5 minutes is the stated default
   - What's unclear: Whether 5-minute polling creates any Gmail API quota pressure at typical volume (50+ items/week)
   - Recommendation: Start at 5 minutes. Gmail API allows 250 read quota units/second/user for personal accounts — 5-minute polls are negligible.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Mac daemon runtime | ✓ | v22.12.0 | — |
| npm | Package installation | ✓ | via Node 22 | — |
| launchd | Daemon orchestration | ✓ | macOS built-in | — |
| Neon Postgres | Data store | [ASSUMED] | — | None — required |
| Google Drive API access | DRV-01 | [ASSUMED] | — | None — required |
| Gmail API access | ING-02 | [ASSUMED] | — | None — required |
| Anthropic API key | Classification | [ASSUMED] | — | None — required |
| Langfuse account | OBS-01 | [ASSUMED] | — | None — required |

**Missing dependencies with no fallback:**
- Neon connection string, Google OAuth credentials, Anthropic API key, Langfuse public/secret keys — all must be in `.env` before daemon can run. These are credentials, not installable packages.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (web app — Phase 2) | Clerk 7 with MFA |
| V3 Session Management | Yes (web app — Phase 2) | Clerk session tokens |
| V4 Access Control | No (single-operator) | — |
| V5 Input Validation | Yes | Zod on API routes; daemon validates file paths before processing |
| V6 Cryptography | Yes | keytar for Keychain storage; SHA-256 for content hashing; no hand-rolled crypto |

**Phase 1 specific:** Google OAuth tokens stored via keytar in macOS Keychain — satisfies credential storage requirement without plaintext on disk. Daemon operates read-only on filesystem (macOS permissions enforce this structurally).

---

## Sources

### Primary (HIGH confidence)
- npm registry (2026-04-24) — all version pins verified: langfuse@3.38.20, chokidar@5.0.0, googleapis@171.4.0, @anthropic-ai/sdk@0.91.0, keytar@7.9.0, prisma@7.8.0
- github.com/langfuse/langfuse releases API — platform v3.170.0 confirmed 2026-04-23
- github.com/paulmillr/chokidar raw package.json — `"type": "module"` confirmed for v5
- developers.google.com/workspace/gmail/api/guides/sync — historyId behavior and 404 handling
- launchd.info — KeepAlive + RunAtLoad plist patterns

### Secondary (MEDIUM confidence)
- github.com/langfuse/langfuse-js CHANGELOG — v4.0.0 released 2025-08-28; v3 remains latest npm tag
- Langfuse upgrade docs — v4 targets self-hosted platform ≥ 3.95.0

### Tertiary (LOW confidence)
- github.com/maid/maid/issues/163 — FSEvents daemon silent death documentation (community report, single source)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry and official sources 2026-04-24
- Architecture: HIGH — direct continuation of prior project research; unidirectional flow confirmed
- Pitfalls: MEDIUM-HIGH — FSEvents and Gmail findings from community reports; classification trace and schema pitfalls from first principles
- Resolved open questions: HIGH — Langfuse version from GitHub releases API; chokidar ESM from package.json source; keytar from npm registry

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable libraries; Langfuse cloud version may upgrade)
