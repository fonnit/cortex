---
phase: 01-foundation
plan: 04
subsystem: pipeline
tags: [sha256, dedup, content-extraction, relevance-gate, claude-haiku, langfuse, neon]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: Neon Item table schema with content_hash, status, classification_trace columns
  - phase: 01-foundation/01-02
    provides: daemon entry point (index.ts), startDownloadsCollector, Langfuse setup
  - phase: 01-foundation/01-03
    provides: pollGmail, GmailMessage type, Google OAuth client

provides:
  - SHA-256 dedup gate — computeHash (file path), computeHashFromBuffer, isDuplicate (Neon lookup)
  - Size-band content extractor — PDF<=5MB, image<=10MB, default<=1MB, installer=always metadata-only
  - Stage 1 Claude Haiku relevance gate — keep/ignore/uncertain with 0.75 confidence threshold
  - Wired daemon: handleFile and handleGmailMessage replace stubs; Gmail polling runs on startup + 5 min interval
  - Neon Item rows written before any Drive action for all paths (ignored/uncertain/processing)

affects: [01-05, drive-upload, label-classifier]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk (already in package.json, now used)", "pdf-parse (optional dynamic import)"]
  patterns:
    - "Pipeline gate: dedup -> extract -> relevance, exit early on duplicate or ignore"
    - "CLS-08: Neon row written before any Drive action"
    - "Confidence threshold enforcement: scores below 0.75 coerce decision to 'uncertain'"
    - "Optional dependency via dynamic import with null fallback (pdf-parse)"

key-files:
  created:
    - agent/src/pipeline/dedup.ts
    - agent/src/pipeline/extractor.ts
    - agent/src/pipeline/relevance.ts
  modified:
    - agent/src/index.ts

key-decisions:
  - "pdf-parse loaded via dynamic import with .catch(() => null) — avoids hard crash if not installed; falls back to metadata-only"
  - "Gmail dedup uses hash of message ID bytes, not file content — consistent with Neon content_hash dedup semantics"
  - "confidence < 0.75 always coerces to uncertain in parseRelevanceResponse regardless of decision field"
  - "Keep decisions stored as 'processing' status, not 'certain' — Plan 05 will run label classifier and update"

patterns-established:
  - "Pipeline module pattern: each stage is a pure function exported from agent/src/pipeline/*.ts"
  - "Langfuse span per pipeline stage — trace wraps full ingest; relevance_gate gets its own child span"
  - "ON CONFLICT (content_hash) DO NOTHING on all Neon inserts — idempotent pipeline"

requirements-completed: [ING-03, ING-04, CLS-01, CLS-03, CLS-04]

# Metrics
duration: 20min
completed: 2026-04-24
---

# Phase 01 Plan 04: Pipeline Core Summary

**SHA-256 dedup + size-band extraction + Claude Haiku relevance gate wired into the daemon, replacing stubs with a full ingest pipeline that writes Neon rows before any Drive action**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-24T18:23:00Z
- **Completed:** 2026-04-24T18:43:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- dedup.ts: SHA-256 hash of file content + Neon `SELECT id FROM Item WHERE content_hash` duplicate check; exits pipeline early if duplicate
- extractor.ts: four size bands — installer (always metadata-only), PDF (<=5 MB), image (<=10 MB), default text (<=1 MB); pdf-parse optional via dynamic import
- relevance.ts: Claude Haiku `claude-haiku-4-5` stage-1 gate returning `keep | ignore | uncertain` with numeric confidence; enforces 0.75 threshold; falls back to `uncertain` on parse error
- index.ts: stub `handleFile` replaced with dedup -> extract -> relevance chain; `handleGmailMessage` added; Gmail polling wired with 5-minute interval; all Neon inserts use `ON CONFLICT (content_hash) DO NOTHING`

## Task Commits

1. **Task 1: SHA-256 dedup + size-band content extractor** - `ae1a68d` (feat)
2. **Task 2: Stage 1 relevance gate + wire pipeline into daemon** - `d123d48` (feat)

## Files Created/Modified
- `agent/src/pipeline/dedup.ts` - SHA-256 hash functions + Neon isDuplicate check
- `agent/src/pipeline/extractor.ts` - Size-band content extraction with installer/PDF/image/default routing
- `agent/src/pipeline/relevance.ts` - Claude Haiku relevance classifier with JSON parsing and confidence enforcement
- `agent/src/index.ts` - Stub handler replaced; Gmail polling added; full pipeline wired

## Decisions Made
- pdf-parse loaded via dynamic import with `.catch(() => null)` — avoids hard crash if package absent; returns metadata-only on failure
- Gmail dedup uses `computeHashFromBuffer(Buffer.from(msg.id))` — message ID is the natural dedup key for Gmail
- Keep decisions use `status='processing'` not `'certain'` — Plan 05 label classifier determines final certainty
- TypeScript `@ts-ignore` on optional pdf-parse dynamic import — module has no types and is intentionally optional

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript TS2307 error on optional pdf-parse import**
- **Found during:** Task 1 (extractor.ts compilation)
- **Issue:** `import('pdf-parse')` caused TS2307 "cannot find module" because pdf-parse is not in package.json and has no type declarations
- **Fix:** Added `@ts-ignore` comment above the dynamic import and typed the resolved module inline so TypeScript skips the missing-module check while preserving the null fallback behavior
- **Files modified:** agent/src/pipeline/extractor.ts
- **Verification:** `npx tsc --noEmit` exits 0 with no errors
- **Committed in:** ae1a68d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type error on optional dependency)
**Impact on plan:** Minimal — pdf-parse was always intended as optional. The fix preserves that intent cleanly.

## Issues Encountered
None beyond the pdf-parse type resolution handled above.

## Next Phase Readiness
- Pipeline core is complete; Plan 05 can wire the label classifier and Drive upload at the `keep_queued_for_label` point
- `handleFile` leaves `status='processing'` rows in Neon — Plan 05 should update these to `'certain'` or `'uncertain'` after label classification
- Gmail polling is live on daemon startup; Plan 05 can add Drive upload for Gmail `keep` decisions following the same pattern

---
*Phase: 01-foundation*
*Completed: 2026-04-24*
