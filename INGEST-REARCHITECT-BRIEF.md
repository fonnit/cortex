# Brief — Ingest Pipeline Rearchitecture

**Project:** Cortex
**Written:** 2026-04-25
**Trigger:** Daemon-to-Neon direct access violated backend isolation. Claude CLI integration via execFile broke on binary files, argument size limits, and file descriptor exhaustion.

## Problem

The Mac daemon currently reads/writes Neon directly and passes file contents as CLI arguments to `claude -p`. This causes:

1. **No backend isolation** — daemon has DATABASE_URL, bypasses all API routes. Any bug in the daemon can corrupt the DB without validation.
2. **claude -p misuse** — file content passed as argv (size limits, null bytes, EBADF). Should pass file paths and let Claude read them.
3. **No queue** — files process inline during scan. Failures leave items stuck at `processing` forever. No retry, no backpressure.
4. **Gmail Stage 2 never runs** — "keep" emails stay at `processing` permanently. No consumer picks them up for label classification.
5. **Repo scanning** — directories containing `.git` or `node_modules` should be skipped entirely (not just the `.git` dir itself).

## Target architecture

### Daemon (thin client)
- Discovers files (chokidar + startup scan) and Gmail messages
- POSTs metadata to `POST /api/ingest` (file path, source, hash)
- Does NOT read Neon, does NOT classify, does NOT upload to Drive
- Env: `CORTEX_API_URL`, `CORTEX_API_KEY`, `WATCH_PATHS`, Google OAuth creds, Langfuse
- No `DATABASE_URL`

### Backend API (Vercel — sole Neon accessor)
- `POST /api/ingest` — receives file/email metadata, dedup check, writes Item row as `pending_stage1`
- `GET /api/queue?stage=1&limit=10` — returns pending items for Stage 1
- `GET /api/queue?stage=2&limit=2` — returns pending items for Stage 2
- `POST /api/classify` — receives classification result, updates Item row, advances to next stage
- All existing routes unchanged (triage, taxonomy, rules, ask, admin, etc.)

### Stage 1 consumer (local process)
- Polls `GET /api/queue?stage=1&limit=10`
- For each item: runs `claude -p` with the file path (not content) — Claude reads the file directly
- POSTs result to `POST /api/classify` with keep/ignore/uncertain decision
- Max 10 concurrent classifications
- Runs as a separate process from the daemon (can be same launchd plist or separate)

### Stage 2 consumer (local process)
- Polls `GET /api/queue?stage=2&limit=2`
- For each item: runs `claude -p` with the file path + existing taxonomy context
- POSTs result to `POST /api/classify` with 3-axis labels + confidence + proposed Drive path
- Max 2 concurrent classifications
- Items that fail Stage 2 stay in queue with retry count

### Queue states (Neon Item.status)
```
pending_stage1 → processing_stage1 → pending_stage2 → processing_stage2 → certain/uncertain
                                   → ignored (from stage 1)
                                   → uncertain (from stage 1, relevance triage)
```

### Directory scanning rules
- Recurse into subdirectories
- If a directory contains `.git` or `node_modules`, skip the entire directory tree
- Skip hidden files (`.DS_Store`, dotfiles)
- No depth limit

### Claude CLI usage
- Pass file path: `claude -p "Classify this file: /path/to/file.pdf. Respond with JSON..."`
- Claude reads the file content itself — no content in the prompt
- For Gmail: pass email metadata (subject, from, snippet) as the prompt text — no file path

### Neon access restriction
- Remove `DATABASE_URL` from `.env` (daemon config)
- Only Vercel env vars have `DATABASE_URL`
- Daemon authenticates to API via `CORTEX_API_KEY` (shared secret, checked in API middleware)

## Non-goals
- No changes to the web UI, triage flow, taxonomy, rules, admin, or ask surfaces
- No schema changes beyond adding status values
- No changes to Drive upload flow (stays in Vercel cron)
- No multi-user changes

## Success criteria
- Daemon runs for 1 hour scanning ~/Downloads + ~/Documents with zero errors
- Gmail 6-month backfill completes without hanging
- Items flow through both stages and appear in triage
- No `DATABASE_URL` in the daemon's environment
- `claude -p` never receives file content as an argument
