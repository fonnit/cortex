---
phase: 02-triage-web-app
plan: 04
subsystem: drive-lifecycle
tags: [drive, cron, delete, prisma, migration]
dependency_graph:
  requires: [02-01]
  provides: [DRV-02, DRV-03, DRV-04, DRV-05, AUTH-03]
  affects: [02-05]
tech_stack:
  added: [googleapis@171.4.0]
  patterns: [drive-files-update-move, vercel-cron-secret-guard, per-item-try-catch]
key_files:
  created:
    - app/api/cron/resolve/route.ts
    - app/api/delete/route.ts
    - vercel.json
    - prisma/migrations/20260424000000_add_resolve_error/migration.sql
    - prisma/migrations/migration_lock.toml
  modified:
    - prisma/schema.prisma
    - .env.example
    - package.json
decisions:
  - Drive move uses files.update (addParents/removeParents) to preserve drive_file_id — never re-upload
  - Per-item try/catch in cron loop; resolve_error written on failure; item retries next run
  - Collision appends content_hash[:6] suffix before move (not after)
  - Drive delete in AUTH-03 catches 404 gracefully; Neon delete proceeds regardless
metrics:
  duration: 25m
  completed: 2026-04-24
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 3
---

# Phase 2 Plan 4: Drive Lifecycle (Resolve Cron + Delete API) Summary

**One-liner:** Drive resolve cron moves `certain` items from `_Inbox` to confirmed paths using `files.update` with per-item error tracking and 350ms rate limiting; delete API removes Drive blob + Neon row with ownership guard.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Schema update + Drive resolve cron | 7617fe5 | schema.prisma, migration.sql, migration_lock.toml, vercel.json, .env.example, cron/resolve/route.ts, package.json |
| 2 | Delete API (AUTH-03) | 1b902e7 | app/api/delete/route.ts |

## What Was Built

**Drive resolve cron (`app/api/cron/resolve/route.ts`):**
- `POST /api/cron/resolve` — protected by `Authorization: Bearer $CRON_SECRET` (T-02-10)
- Queries up to 20 `certain` items with `drive_inbox_id` set and `drive_filed_id` null
- Walks `proposed_drive_path` folder segments via `getOrCreateFolder`, creating missing folders
- DRV-05: Collision check via `files.list`; appends `content_hash[:6]` suffix if name exists
- DRV-02: `files.update` with `addParents`/`removeParents` — preserves `drive_file_id`
- DRV-04: Per-item `try/catch`; writes `resolve_error` JSON on failure; item retries next run
- DRV-03: `sleep(350)` between each move — stays under 3 ops/sec Drive API limit
- Returns `{ ok, resolved, errors }` count

**Schema migration:**
- Added `resolve_error String?` column to `Item` model
- Created `prisma/migrations/20260424000000_add_resolve_error/migration.sql`
- Vercel build runs `prisma migrate deploy` — migration applies automatically on deploy

**vercel.json:** Cron schedule `*/5 * * * *` targeting `/api/cron/resolve`

**Delete API (`app/api/delete/route.ts`):**
- `DELETE /api/delete?itemId=X` — requires Clerk session via `requireAuth()`
- T-02-11: `findFirst({ where: { id, user_id: userId } })` — 404 if not owned
- Drive delete: `drive_filed_id ?? drive_inbox_id`; catches Drive 404 gracefully; never blocks Neon delete
- `prisma.item.delete` removes row + on-row embeddings

**`.env.example`:** Added `GOOGLE_REFRESH_TOKEN` and `CRON_SECRET` documentation

## Requirements Fulfilled

| Req ID | Status | Notes |
|--------|--------|-------|
| AUTH-03 | Complete | Ownership check + Drive blob + Neon row deleted |
| DRV-02 | Complete | `files.update` preserves drive_file_id throughout |
| DRV-03 | Complete | 350ms sleep between moves (3 ops/sec limit) |
| DRV-04 | Complete | `resolve_error` column + per-item write on failure |
| DRV-05 | Complete | Collision check + `content_hash[:6]` suffix |

## Deviations from Plan

**[Rule 3 - Blocking] Migration created manually — no live DATABASE_URL**
- Found during: Task 1
- Issue: `npx prisma migrate dev` requires `DATABASE_URL`; no `.env` file exists (only `.env.example`)
- Fix: Created migration SQL file and `migration_lock.toml` manually with correct column DDL; Vercel's `prisma migrate deploy` will apply it on build
- Files modified: `prisma/migrations/20260424000000_add_resolve_error/migration.sql`, `prisma/migrations/migration_lock.toml`
- Commit: 7617fe5

## Security Review

All STRIDE mitigations from threat model implemented:
- T-02-10: CRON_SECRET bearer check is first operation in handler
- T-02-11: Ownership verified by `findFirst(user_id)` before any Drive or DB mutation
- T-02-13: `GOOGLE_REFRESH_TOKEN` read from env var only; never logged or returned

## User Setup Required

Before deploying, add to Vercel environment variables:
- `CRON_SECRET` — generate with `openssl rand -hex 32`
- `GOOGLE_REFRESH_TOKEN` — from existing agent OAuth flow
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console (same credentials as Mac agent)

## Known Stubs

None — all data flows are wired. The cron handler returns real Drive move results.

## Threat Flags

None — no new trust boundaries beyond those in the plan's threat model.

## Self-Check: PASSED

- [x] `app/api/cron/resolve/route.ts` exists
- [x] `app/api/delete/route.ts` exists
- [x] `prisma/migrations/20260424000000_add_resolve_error/migration.sql` exists
- [x] `vercel.json` exists with crons
- [x] Commit 7617fe5 exists (Task 1)
- [x] Commit 1b902e7 exists (Task 2)
- [x] TypeScript: zero errors (`npx tsc --noEmit`)
