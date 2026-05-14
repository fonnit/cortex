# Cortex v1 — usage guide

A personal AI-native triage queue. You add files via the CLI; a worker classifies them with Claude Haiku; the triage UI shows ranked folder proposals; you approve, move, reject, or create-and-file. Items end up in `~/Documents/CortexArchive/<folder.path>/`.

## How the loop works

```
your Mac                                   cortex.fonnit.com (Vercel)
─────────                                  ─────────────────────────
$ cortex add file.pdf                  POST /api/items
                                       ────────────────►    Item row at pending_classification

worker (launchd, polling every 30s):
  POST /api/items/claim                ────────────────►    SELECT FOR UPDATE SKIP LOCKED;
                                                            sweep stale leases, return one row
  reads file from local FS
  Claude Haiku classify (multimodal)
  POST /api/items/[id]/classification  ────────────────►    Item → pending_review,
                                                            proposalCandidates set

browser triage UI                          GET /api/triage
                                       ◄────────────────    list of pending_review items
  click 1-5 to approve top-N proposal  POST /api/items/[id]/approve
                                       ────────────────►    Item → approved_pending_move

worker (next poll):
  POST /api/items/claim {stage:'move'} ────────────────►    claim approved item
  re-hash file, mv to CortexArchive
  POST /api/items/[id]/moved           ────────────────►    Item → filed
```

## Phase 0 setup (one-time)

### 1. Clerk M2M (TWO machines, TWO secrets)

Clerk's M2M model gives one Machine entity per service. Cortex has two:

- **cortex-worker** (your Mac) — has its own `ak_...` secret; lives in `agent/.env.daemon`
- **cortex-backend** (Vercel) — has a different `ak_...` secret; lives in Vercel env

In the Clerk dashboard:
1. **Machines → Add machine**, name it `cortex-worker`.
2. **Add machine** again, name it `cortex-backend`.
3. Open `cortex-worker` → **Scopes** → add `cortex-backend` as an allowed target.
4. View each machine's secret (**... menu → View machine secret**). You get two distinct `ak_...` values.

Runtime flow:
- Worker loads its `ak_...` secret. Per request, it calls `clerkClient.m2m.createToken()` to mint a short-lived `mt_...` token from that secret.
- Worker sends `Authorization: Bearer mt_...` to the backend.
- Backend route extracts `mt_...`, calls `clerkClient.m2m.verify()` with its own `ak_...` secret. Verification only succeeds if the dashboard scope `cortex-worker → cortex-backend` exists.

The `ak_...` secrets never transit the network — only `mt_...` tokens do.

### 2. Local worker env (`agent/.env.daemon`)

```env
CLERK_MACHINE_SECRET_KEY=ak_<cortex-worker's secret>
CORTEX_API_BASE_URL=https://cortex.fonnit.com
ANTHROPIC_API_KEY=sk-ant-<your Anthropic key>
```

Optional overrides:
```env
CORTEX_ARCHIVE_ROOT=/Users/dfonnegrag/Documents/CortexArchive
CORTEX_CLASSIFY_MODEL=claude-haiku-4-5
```

### 3. Vercel env (backend, ONE new var)

Add this to Vercel → Project → Settings → Environment Variables (Production):

```
CLERK_MACHINE_SECRET_KEY = ak_<cortex-backend's secret>
```

The existing `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `DATABASE_URL` stay as-is.

### 4. iCloud Documents toggle (already verified)

"Desktop & Documents Folders" is ON in iCloud settings. The worker resolves the archive root to `~/Documents/CortexArchive/` (which macOS syncs to iCloud transparently). No code change needed.

### 5. Seed (one-time, already run)

The 22-folder taxonomy is already seeded against prod. If you ever need to re-seed (e.g. against a different Neon branch), set DATABASE_URL and run:

```bash
npm run seed
```

The seed creates the placeholder User on first run; your first browser sign-in upserts your real `clerkId` into that row. **Or** set `CORTEX_SEED_USER_CLERK_ID=user_xxx` to use a specific Clerk user before running.

## Day-to-day commands

### Add a file to the queue

```bash
cd ~/Projects/cortex/agent
npm run add /Users/dfonnegrag/Downloads/some-receipt.pdf
```

Output:
```
enqueued: some-receipt.pdf (id=cmp..., status=pending_classification)
```

Supported file types (everything else goes to `unsupported_type` and shows in the Failed tab):
- `.pdf` (with or without text layer — Claude does OCR on text-less PDFs natively)
- `.png`, `.jpg`, `.jpeg`, `.webp` (image content sent to Claude as multimodal)
- `.heic` (preconverted to JPEG via macOS `sips`)
- `.txt`, `.md`
- `.docx`

Duplicate (same SHA256, same user): returns 409, prints `duplicate: already added as <id> (status=...)`.

### Start the worker

```bash
cd ~/Projects/cortex/agent
npm run worker
```

Runs the two poll loops (classify + move). Polls every 30 seconds. Logs each tick to stderr.

For production: register under launchd with `agent/launchd/com.cortex.consumer.plist`. The existing plist needs its `ProgramArguments` updated to call `tsx src/worker.ts` instead of the old `src/index.js`. (Will write this in a follow-up if you want autostart.)

### Triage

Open https://cortex.fonnit.com/triage in your browser. Sign in via Clerk.

**Pending tab** shows items at `pending_review`. Each card has:
- The top proposal as a primary CTA — "Approve into /Finance/Taxes/2025" + confidence pill
- Ranks 2-5 (if classifier returned multiple proposals) as secondary buttons
- "Pick different folder" — full-tree picker with autocomplete from your folder list
- "Create new folder" — modal: pick parent, type a name (`[a-zA-Z0-9 _-]+`, max 60 chars), filed into the new folder atomically
- "Reject" — marks rejected, leaves the source file at its original path

**Keyboard shortcuts** (on the first pending card):
- `1`–`5` → approve proposal at rank N
- `N` → open "Create new folder"
- `R` → reject

**Failed tab** shows items that couldn't make it through the loop:
- `classify failed` (3 attempts exhausted) → **Retry**: resets to pending_classification, attempts=0
- `move failed` (mv error or dest collision) → **Retry**: resets to approved_pending_move
- `source missing` / `source changed` → **Delete record** (then re-add the file with `cortex add` if you still want it)
- `unsupported` → **Delete record**

### Where files end up

```
~/Documents/CortexArchive/
├── business/
│   └── terradan-dubai/
│       └── corporate/
├── education/
│   ├── certificates/
│   └── diplomas/
├── family/
│   └── civil-registry/
├── identity/
│   ├── national-ids/
│   ├── passport/
│   └── residence-permit/
├── legal/
│   └── contracts/
├── personal/
│   └── finance/
│       ├── credit-applications/
│       └── insurance/
└── real-estate/
    └── rental/
        └── contracts/
```

Plus whatever folders you create as you triage. iCloud syncs the whole tree to your other devices automatically.

## State machine reference

```
pending_classification ──worker classifies──► pending_review
                       └──source missing────► source_missing  (Failed tab → Delete record)
                       └──unsupported type──► unsupported_type (Failed tab → Delete record)
                       └──3 failed attempts─► classification_failed (Failed tab → Retry)

pending_review ──approve / move / create-folder──► approved_pending_move
               └──reject────────────────────────► rejected (terminal; source untouched)

approved_pending_move ──worker mv succeeds──► filed (terminal happy path)
                      └──mv error──────────► move_failed (Failed tab → Retry)
                      └──source changed────► source_changed (Failed tab → Delete record)
                      └──source missing────► source_missing (Failed tab → Delete record)
```

## Operations

### Inspecting the queue from the CLI

You don't have a shipped CLI for this yet, but you can hit the prod DB directly with `npx prisma studio` (with DATABASE_URL pointing at prod), or run SQL:

```sql
-- queue depth
SELECT status, COUNT(*) FROM "Item" GROUP BY status;

-- misclassification rate week 1
SELECT
  COUNT(*) FILTER (WHERE action = 'move') * 100.0 / NULLIF(COUNT(*), 0) AS misclass_pct
FROM "Decision"
WHERE "createdAt" > NOW() - INTERVAL '7 days'
  AND action IN ('approve', 'move');

-- manual-new-folder rate
SELECT
  COUNT(*) FILTER (WHERE action = 'create_folder') AS new_folders_created,
  COUNT(*) FILTER (WHERE action = 'approve')      AS approves,
  COUNT(*) FILTER (WHERE action = 'move')         AS moves
FROM "Decision"
WHERE "createdAt" > NOW() - INTERVAL '7 days';

-- did the classifier ever emit proposedNewFolder?
SELECT COUNT(*) FILTER (WHERE "proposedNewFolder" IS NOT NULL) AS emitted,
       COUNT(*)                                                AS total
FROM "Item"
WHERE status != 'pending_classification';
```

### Anthropic billing

After 2026-06-15 the Claude CLI subscription billing ends. Your Max tier gives $100/month in API credits. Cortex's classify spend is roughly:
- Text-mode classification: ~$0.005 per item
- Image / native-PDF: ~$0.005-$0.012 per item

At 10-20 items/day, you'll use $1-5/month of credit. Well inside the pool.

### What's deliberately NOT in v1 (deferred to v2)

- Gmail ingest
- Drive blob store (files stay on local FS, iCloud-synced)
- Embeddings + Q&A ("What's my passport number?" Q&A)
- OCR for scan-only PDFs without text layers (Claude native PDF handles most of this already)
- Model-driven folder proposals in the UI (the `proposedNewFolder` field is collected on every classification but hidden in v1; v2 decides whether to surface it)
- The Mac watcher (chokidar) — v1 uses manual `cortex add`; once the loop is rock-solid for a week, add the watcher
- LangSmith / observability — `lib/trace.ts` is a noop wrapper; swap a real client there when needed
- `cortex add --hint <folder-id>` shortcut (TODO captured)

## Troubleshooting

### Worker crashes immediately with "Missing CORTEX_API_BASE_URL"

Set the env in `.env.daemon` or pass it inline:
```bash
CORTEX_API_BASE_URL=https://cortex.fonnit.com CLERK_MACHINE_SECRET_KEY=ak_... ANTHROPIC_API_KEY=... npm run worker
```

### Worker returns 401 on every claim

Clerk machine-token exchange failed. Verify:
- `CLERK_DOMAIN` matches your instance (no trailing slash; usually `https://<slug>.clerk.accounts.dev` or your custom subdomain).
- The Machine in Clerk dashboard is enabled.
- The client_secret hasn't been rotated.

### Worker claims an item but returns 409 on POST /classification

Race: the user retried the item via the UI while the worker was classifying. Worker should log and move on; the sweep handles the retry.

### "No folders for user — run prisma seed first"

Sign in to the triage UI once (creates the User row from your Clerk identity), then run `npm run seed` against the same DATABASE_URL with `CORTEX_SEED_USER_CLERK_ID=user_xxx` set to your Clerk user ID. Or copy the 22 folders from the placeholder User to your real one via SQL.

### File ended up in `source_missing` or `source_changed`

The worker re-hashes the source file at classification time AND at move time. If the file was modified or moved between `cortex add` and the worker pickup, it lands in these states. Action: delete the record from Failed tab and `cortex add` the file again from its new location.

### "Already added" on a file you don't see in triage

Uniqueness is on `(userId, sha256)`. If you previously added the same content under a different filename, the duplicate is caught at ingest. Check status via the API or SQL.

## Architecture pointers

- **Plan file** (running spec): [/Users/dfonnegrag/.claude/plans/compressed-wobbling-treehouse.md](/Users/dfonnegrag/.claude/plans/compressed-wobbling-treehouse.md)
- **Design doc** (office-hours output): [~/.gstack/projects/fonnit-cortex/dfonnegrag-main-design-20260512-233606.md](~/.gstack/projects/fonnit-cortex/dfonnegrag-main-design-20260512-233606.md)
- **Test plan artifact**: [~/.gstack/projects/fonnit-cortex/dfonnegrag-main-eng-review-test-plan-20260514-111410.md](~/.gstack/projects/fonnit-cortex/dfonnegrag-main-eng-review-test-plan-20260514-111410.md)
- **CLAUDE.md** (project conventions for future agents): [./CLAUDE.md](./CLAUDE.md)

## Week 1 success criteria (dogfood retro)

By end of dogfood week 1 (run `~/.gstack/projects/fonnit-cortex/retro-week-1.md`):

- ✅ Triage cleared (zero `pending_review`) at least 3 times across the week.
- ✅ Misclassification rate (resolved via `move` rather than `approve`) under 30%, trending down by end of week.
- ✅ `proposedNewFolder` emission rate measurable (> 0%) — confirms the prompt is asking for it.
- ✅ `create-folder` rate measurable — input to v2 "do we need automated folder-proposal UI" decision.
- ✅ Anthropic billing dashboard flat — Max $100/mo credit covers everything.
- ✅ No items stuck in `pending_classification` for > 1 hour (sweep is working).

By end of week 4: triage-load-per-week trends DOWN compared to week 1 (the compounding-feedback-loop thesis).
