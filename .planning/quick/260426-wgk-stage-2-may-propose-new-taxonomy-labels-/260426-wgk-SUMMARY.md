---
phase: 260426-wgk
plan: 01
status: complete
completed: "2026-04-26T21:35:00.000Z"
commit: f094216
tags: [stage2, prompt, taxonomy, classifier, agent]
key-files:
  modified:
    - agent/src/consumer/prompts.ts
    - agent/__tests__/consumer-stage2-prompt.test.ts
requirements:
  - QT-260426-wgk-01
---

# Quick Task 260426-wgk: Stage 2 May Propose New Taxonomy Labels — Summary

Relaxed the Stage 2 classifier prompt so Claude may PROPOSE a brand-new label
name on any axis when no existing label is a confident match — instead of
forcing `value=null`. Proposals carry confidence < 0.85 and the route's
pre-existing cold-start guard independently blocks auto-file on any value not
in TaxonomyLabel, providing defense in depth.

## What Shipped

### Prompt change (`agent/src/consumer/prompts.ts`)

The closed-vocab line was replaced. Before:

```
Propose 3-axis labels (use an existing label if confident match ≥ 0.85; else null with low confidence). Never invent labels outside the lists above.
```

After (single array entry — exact text now in `buildStage2Prompt`):

```
Propose 3-axis labels. If an existing label from the lists above is a confident match (confidence ≥ 0.85), use it. If no existing label fits, you may propose a new label name on that axis — pick a short lowercased name (hyphen- or underscore-separated) following the style of the existing labels — but mark it with confidence below 0.85 so a human can review and approve the new label before it is added to the taxonomy. If you have no plausible label for an axis, value may be null with low confidence.
```

The comment block above `return [` (lines 78–82 of the file) was refreshed to
point at this quick task (260426-wgk) and document the relaxation. No other
line in `buildStage2Prompt` was touched. `buildStage1Prompt`,
`buildStage2ItemBlock`, and the helpers (`metaString`, `stringOrNone`,
`listOrNoneYet`) are byte-for-byte unchanged.

### Test changes (`agent/__tests__/consumer-stage2-prompt.test.ts`)

Added four new tests inside the existing
`describe('buildStage2Prompt — decision field instructions (u47)')` block:

- **Test NEW-A** — prompt explicitly permits proposing a new label
  (case-insensitive substring match for `propose a new` / `propose new` /
  `propose a label` / `new label`).
- **Test NEW-B** — prompt instructs sub-0.85 confidence on proposed labels
  (case-insensitive substring match for `below 0.85` / `< 0.85` /
  `less than 0.85` / `under 0.85`).
- **Test NEW-C** (negative regression guard) — prompt MUST NOT contain the
  old hard-prohibition phrase `Never invent labels`.
- **Test NEW-D** — prompt still allows `null` as a valid axis value when
  Claude has no plausible name (case-insensitive substring match for
  `null is allowed` / `or null` / `may be null` / `can be null`).

Tests 1, 2, 3 (existing prompt-copy assertions) are unchanged. Tests 4–8
(`Stage2ResultSchema (via worker)` + `runStage2Worker — forwards decision in
classify payload`) are unchanged.

## Test Results

All assertions ran via `jest --rootDir=<worktree>`:

| Suite                                                         | Pass | Total | Notes                                          |
| ------------------------------------------------------------- | ---- | ----- | ---------------------------------------------- |
| `agent/__tests__/consumer-stage2-prompt.test.ts`              | 12   | 12    | 3 prompt-copy + 4 NEW-A/B/C/D + 3 schema + 2 worker |
| `__tests__/classify-auto-actions.test.ts` (cold-start guard)  | 12   | 12    | UNCHANGED — defense-in-depth verified          |

**Cold-start guard explicitly re-verified:** the `__tests__/classify-auto-actions.test.ts`
suite passed unchanged. This includes the test that exercises the
`allLabelsExist` blocker — when Stage 2 emits an axis value not present in
`TaxonomyLabel`, the route falls back to `status='uncertain'` even if the
`decision='auto_file'` and confidence ≥ 0.85. This is the defense-in-depth
contract that makes proposed labels safe: even if Claude IGNORES the
prompt's "below 0.85" instruction, the route still prevents an invented
name from auto-filing. **Task #1 of u47 was correctly future-proofed.**

## Deviations from Plan

None — the plan executed exactly as written. RED-then-GREEN TDD: the four
new tests fail against the unchanged prompt (3 expected hard fails for NEW-A
/ NEW-B / NEW-C; NEW-D incidentally passes against the original copy because
the unchanged JSON-shape line already contains `may be null`), then all 12
tests pass after the prompt copy is updated.

## Files Touched

- `agent/src/consumer/prompts.ts` — closed-vocab line replaced (single line in
  the array literal), plus the comment above the `return [` was refreshed.
  +7 / -5.
- `agent/__tests__/consumer-stage2-prompt.test.ts` — four new tests appended
  inside the first `describe` block. +44 / 0.

Files NOT touched (verified clean by `git diff` post-commit):

- `agent/src/consumer/stage2.ts` (Stage2ResultSchema is the contract; stays)
- `agent/src/http/types.ts` (ClassifyRequest shape stays)
- `app/api/classify/route.ts` (cold-start guard stays)
- `prisma/schema.prisma` (no migration)
- `__tests__/classify-auto-actions.test.ts` (cold-start tests stay UNCHANGED)

## Next Step (Out of Scope Here)

Sibling Task #3 — surfacing "this is a new label proposal" in the triage UI
(so Daniel can approve a proposed label and have it added to `TaxonomyLabel`
in one click) — is the natural follow-up and is **OUT OF SCOPE** for this
quick task. Today, a proposal lands in `Item.classification_trace.stage2.axes`
and the item routes to `status='uncertain'`; Daniel sees it in normal triage
but the UI does not yet visually distinguish a proposed label from a
no-confident-match `null`.

## Self-Check: PASSED

- `agent/src/consumer/prompts.ts` modified at `/Users/dfonnegrag/Projects/cortex/.claude/worktrees/agent-afd6c6a074ebc35e3/agent/src/consumer/prompts.ts` — verified.
- `agent/__tests__/consumer-stage2-prompt.test.ts` modified at
  `/Users/dfonnegrag/Projects/cortex/.claude/worktrees/agent-afd6c6a074ebc35e3/agent/__tests__/consumer-stage2-prompt.test.ts` — verified.
- Commit `f094216` exists in worktree branch `worktree-agent-afd6c6a074ebc35e3` — verified via `git log --oneline -3`.
- All 24 tests across both suites pass — verified via two `jest` invocations.
