# Quick Task 260427-h9w: Model-defined evolving folder structure — Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Task Boundary

Replace the fixed `/<type>/<from>/<context>/<filename>` path template with model-proposed paths that match against (or extend) the existing tree of confirmed paths. The "taxonomy of folders" becomes whatever has actually been filed — it grows as the user confirms more items.

**Background:** the current Stage 2 prompt nudges claude to a 3-level fixed schema (`type/from/context`). With every item producing a unique combination, this generates ~1 folder per file. With 300 invoices from 300 senders you'd get 300 sibling branches under `/invoice/`. The user wants paths defined by the model, with arbitrary depth, evolving from the existing tree.

In scope:
- Stage 2 prompt receives a list of existing confirmed paths (with file counts) and produces a `proposed_drive_path` of arbitrary depth.
- Stage 2 schema gains a top-level `path_confidence` field (the existing per-axis confidences stay, for axis-level metadata reasons).
- `/api/classify` cold-start auto-file guard switches from "all 3 axis values exist in TaxonomyLabel" → "parent path has ≥3 confirmed items AND path_confidence ≥0.85".
- 3-axis schema (type/from/context) STAYS as searchable metadata — claude still produces axes alongside the path; they don't drive the path anymore.
- The prompt instructs claude to prefer reusing existing folders, propose new branches only when needed, and prefer fewer levels for clarity.

Out of scope:
- No new Prisma schema migration. `Item.proposed_drive_path` and `Item.confirmed_drive_path` are both already strings; no changes needed.
- No Drive API crawl, no `/Documents` seed, no manual SQL seed. Fresh start. The first N items get human triage; the tree bootstraps from those confirmations.
- Triage UI changes (rendering proposed path, surfacing the tree to the user) are NOT in scope here. We ship the backend classification logic; UI improvements come separately.
- TaxonomyLabel-based auto-file guard from u47-3 is REPLACED by the new path-based rule. We don't need to seed TaxonomyLabel for auto-file to work.
- Reclassifying the items already in `pending_stage2`/`uncertain` — they keep their old proposed paths until a future cleanup task.

</domain>

<decisions>
## Implementation Decisions

### What claude sees: existing folder tree
- **Source:** `SELECT DISTINCT confirmed_drive_path FROM "Item" WHERE confirmed_drive_path IS NOT NULL` — confirmed paths only. Items in `pending_stage2`/`uncertain` may have provisional `proposed_drive_path` values, but those are intentionally NOT shown to claude — they'd pollute the tree with unsettled proposals.
- **Format injected into prompt:** flat list of unique parent directories (everything before the filename) with confirmed-item count per parent. Example: `"/fonnit/invoices/" (12 items)`. This is more useful than full filenames and keeps the token budget bounded.
- **Token budget guard:** if more than ~50 unique parent dirs exist, send only the top-N by file count. Planner picks the cutoff (50 is a reasonable starting point; can be tuned).
- **Cold start:** no confirmed paths → empty list → prompt explicitly says "no existing folders yet; propose any path you think makes sense, low confidence is fine".

### Stage 2 output shape
- Schema gains a sibling field next to `axes`: `path_confidence: number` (0–1). The existing `proposed_drive_path: string` field stays.
- Per-axis confidences and values stay unchanged (still used for searchable metadata; no longer drive the path).
- New full Stage 2 response shape:
  ```ts
  {
    decision: 'auto_file' | 'ignore' | 'uncertain',  // (from u47-2; unchanged)
    axes: { type: AxisVal, from: AxisVal, context: AxisVal },  // unchanged
    proposed_drive_path: string,  // unchanged column, new semantics — model-defined depth
    path_confidence: number       // NEW
  }
  ```
- Schema: NO Prisma migration needed. The `axis_*` columns stay; `proposed_drive_path` already accommodates any string. `path_confidence` lives only in `Item.classification_trace` (jsonb), not as a top-level column.

### Auto-file precondition (replaces u47-3's existing-label check)
- **Trigger auto-file when ALL of:**
  1. `decision === 'auto_file'` (from u47-2's prompt change), AND
  2. `path_confidence >= 0.85`, AND
  3. **Parent of `proposed_drive_path` has ≥3 confirmed items** in the database (`SELECT COUNT(*) FROM "Item" WHERE confirmed_drive_path LIKE '<parent>%' AND status IN (terminal-confirmed-statuses)`).
- The `axis_*` non-null + all-existing-labels rule from u47-3 is **removed** — it's superseded by the new rule. Axes can have null/new values without blocking auto-file.
- **Cold-start safety by construction:** with zero filed items, no path has ≥3 confirmed items, so nothing auto-files. After the user manually files the first ~3-9 items into 1-3 folders, those folders become "stable" and future similar items can auto-file.

### Drive bootstrap
- No bootstrap. No Drive API crawl, no /Documents scan, no manual seed.
- The system starts cold; the first 5-15 items will go to `uncertain` and require human triage. As the user files them via the triage UI (existing flow), `confirmed_drive_path` populates and the tree grows.
- Acceptable consequence: low classification velocity for the first ~1 week; auto-file kicks in once a few folders are stable.

### Claude's Discretion (planner picks)
- Exact parent-extraction logic (probably: drop everything after the last `/`).
- Whether the "parent has ≥3" SQL uses `LIKE '<parent>/%'` or a stricter `confirmed_drive_path LIKE '<parent>/[^/]+'` — leave to planner.
- What "confirmed" means for the count query — likely `status='certain'` (the auto-filed terminal status from u47-3) plus any human-confirmed terminal status. Planner reads the state machine and picks the right filter.
- The exact prompt language. Suggested phrasing: "Here are folders that already contain confirmed items. Reuse one if this item belongs there. Create a new branch if not, but prefer fewer levels (2-3) over deeply nested paths. Return path_confidence proportional to how sure you are about the placement."
- Top-N cutoff for prompt injection (suggested: 50 most-populated parents).

</decisions>

<specifics>
## Specific Ideas

- The "parent of `/foo/bar/file.pdf`" is `/foo/bar/`. The parent of `/foo/file.pdf` is `/foo/`. The parent of `/file.pdf` is `/`. Auto-file at the root requires a special case (count of items with `confirmed_drive_path LIKE '/[^/]+'` ≥3) — most likely YAGNI; document as a known edge.
- Threshold constant naming suggestion: `PATH_AUTO_FILE_MIN_SIBLINGS = 3`, `PATH_AUTO_FILE_MIN_CONFIDENCE = 0.85`.
- Existing test `__tests__/classify-auto-actions.test.ts` from u47-3 will need updates: the cold-start guard tests that asserted "fails when value not in TaxonomyLabel" should now assert "fails when parent path has < 3 confirmed items". Several test cases will need new mock data (an Item with confirmed_drive_path matching a populated parent).
- Existing test `agent/__tests__/consumer-stage2-prompt.test.ts` (from wgk) will need updates to assert: prompt mentions existing folders, prompt does NOT use the old `<type>/<from>/<context>` template, prompt instructs flexible depth.

</specifics>

<canonical_refs>
## Canonical References

- Stage 2 prompt: `agent/src/consumer/prompts.ts` (line 87 example template, line 86 closed-vocab line — already relaxed by wgk)
- Stage 2 worker: `agent/src/consumer/stage2.ts`
- Stage 2 schema: `agent/src/consumer/stage2.ts` (Stage2ResultSchema), `agent/src/http/types.ts` (ClassifyRequest)
- Cold-start guard: `app/api/classify/route.ts` (the `allLabelsExist` check from u47-3)
- Existing-label SQL: search `app/api/classify/route.ts` for `taxonomyLabel.findMany` — that's the call this task is replacing
- Auto-file tests: `__tests__/classify-auto-actions.test.ts`
- Prompt tests: `agent/__tests__/consumer-stage2-prompt.test.ts`
- TaxonomyLabel: still used for axis-metadata search (separate concern); not touched by this task

</canonical_refs>
