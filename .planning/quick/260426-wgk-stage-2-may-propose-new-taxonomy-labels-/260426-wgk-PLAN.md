---
phase: 260426-wgk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/src/consumer/prompts.ts
  - agent/__tests__/consumer-stage2-prompt.test.ts
autonomous: true
requirements:
  - QT-260426-wgk-01  # Relax Stage 2 prompt to permit proposed labels (closed-vocab → open-vocab)

must_haves:
  truths:
    - "Stage 2 prompt explicitly permits Claude to propose a brand-new label name when no existing label is a confident match (instead of returning null)."
    - "Proposed names appear inside `axes.{type|from|context}.value` exactly as a string — same shape as an existing label."
    - "Stage 2 prompt instructs Claude that confidence on a proposed (new) label MUST be < 0.85, so the auto-file confidence threshold is structurally never tripped by an invented name."
    - "Returning `null` for an axis is still allowed when Claude has no plausible label at all (proposals are encouraged, not required)."
    - "The all-three-axes JSON shape is unchanged — `decision` enum {auto_file, ignore, uncertain} is unchanged, `proposed_drive_path` is unchanged, schema is unchanged."
    - "The `__tests__/classify-auto-actions.test.ts` cold-start guard tests pass UNCHANGED — proposed labels naturally fail the `allLabelsExist` check and fall back to status='uncertain' (proves Task #1 was correctly future-proofed)."
  artifacts:
    - path: "agent/src/consumer/prompts.ts"
      provides: "buildStage2Prompt with the closed-vocab line REPLACED by proposal-permitting copy + the new <0.85 confidence rule for invented labels"
      contains: "buildStage2Prompt"
    - path: "agent/__tests__/consumer-stage2-prompt.test.ts"
      provides: "Updated assertions covering the new prompt copy (proposal permission + <0.85-on-new-label rule); existing schema/worker tests untouched"
      contains: "buildStage2Prompt — decision field instructions"
  key_links:
    - from: "agent/src/consumer/prompts.ts buildStage2Prompt"
      to: "app/api/classify cold-start guard (allLabelsExist check)"
      via: "natural-language constraint: invented labels return confidence < 0.85, AND the route's allLabelsExist check independently blocks auto-file even if Claude violates that instruction"
      pattern: "defense-in-depth: prompt instruction is advisory; cold-start guard is mandatory"
    - from: "buildStage2Prompt"
      to: "Stage2ResultSchema in agent/src/consumer/stage2.ts"
      via: "the JSON shape Claude is asked to produce — MUST stay identical (axes / proposed_drive_path / decision)"
      pattern: "schema is the contract; prompt copy changes are natural-language only"
---

<objective>
Relax the Stage 2 classifier prompt so Claude is permitted (and gently encouraged) to PROPOSE a new label name on any axis when no existing label is a confident match — instead of forcing a `null` value. The proposed name is emitted in `axes.{axis}.value` exactly as if it were an existing label, with confidence < 0.85 so the cold-start guard naturally routes the item to human triage.

Purpose: Today the Stage 2 prompt forbids inventing labels ("Never invent labels outside the lists above"), which means a brand-new sender or a never-seen-before document type forces Claude to return `value: null`. That signals "I don't know" when in reality Claude often has a strong opinion ("this looks like an invoice from a new vendor 'fonnit-co'"). Surfacing those opinions as proposals turns the human-triage step into a label-approval step rather than a label-from-scratch step — which is the whole feedback-loop premise of Cortex (Core Value: triage load trends down). u47 already built the auto-action plumbing (decision field) and the cold-start guard that makes proposals safe (an invented name can't be in TaxonomyLabel → can't auto-file → human reviews). This task is the prompt change that activates that latent capability.

Output: Updated `buildStage2Prompt` copy + updated prompt-copy assertions in the existing test file. No schema change, no DB change, no route change, no UI work.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@agent/src/consumer/prompts.ts
@agent/__tests__/consumer-stage2-prompt.test.ts
@agent/src/consumer/stage2.ts
@app/api/classify/route.ts
@__tests__/classify-auto-actions.test.ts

<interfaces>
<!-- Key contracts the executor needs. Do not re-explore the codebase. -->

The line being changed in agent/src/consumer/prompts.ts (line 90 of the file as it stands today):

```
'Propose 3-axis labels (use an existing label if confident match ≥ 0.85; else null with low confidence). Never invent labels outside the lists above.',
```

The schema this prompt must continue to satisfy (agent/src/consumer/stage2.ts, unchanged):

```typescript
const AxisSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})
const Stage2ResultSchema = z.object({
  axes: z.object({ type: AxisSchema, from: AxisSchema, context: AxisSchema }),
  proposed_drive_path: z.string(),
  decision: z.enum(['auto_file', 'ignore', 'uncertain']),
  confidence: z.number().min(0).max(1).optional(),
})
```

The cold-start guard in app/api/classify/route.ts (lines ~253–305, unchanged) — this is what makes proposals safe:

```typescript
const labels = await prisma.taxonomyLabel.findMany({
  where: { user_id: item.user_id, deprecated: false },
  select: { axis: true, name: true },
})
const labelSet = new Set(labels.map((l) => `${l.axis}:${l.name}`))
const isExistingLabel = (axis, value) => value !== null && labelSet.has(`${axis}:${value}`)
// auto-file requires:
//   data.decision === 'auto_file' && allHighConf && allValuesPresent && allLabelsExist
// A proposed label is NOT in labelSet → allLabelsExist is false → no auto-file → status='uncertain'.
```

The existing test assertions in agent/__tests__/consumer-stage2-prompt.test.ts that the new copy must keep satisfying:
- Test 1: prompt contains 'decision', 'auto_file', 'ignore', 'uncertain'
- Test 2: prompt mentions junk categories (spam / marketing / automated / junk) — at least one
- Test 3: prompt contains '0.85'
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Relax Stage 2 prompt to permit label proposals + update prompt-copy tests</name>
  <files>agent/src/consumer/prompts.ts, agent/__tests__/consumer-stage2-prompt.test.ts</files>

  <behavior>
Updated tests in agent/__tests__/consumer-stage2-prompt.test.ts for the prompt block (the existing `describe('buildStage2Prompt — decision field instructions (u47)')` block) MUST exercise the new copy:

  - Test 1 (UPDATE existing — keep decision-field assertion): unchanged — prompt still contains 'decision', 'auto_file', 'ignore', 'uncertain'.
  - Test 2 (UPDATE existing — keep junk-category assertion): unchanged.
  - Test 3 (UPDATE existing — confidence threshold): the prompt MUST still mention 0.85 (the auto-file confident-match threshold the route enforces). Keep `expect(p).toContain('0.85')`.
  - Test NEW-A: prompt explicitly permits proposing a NEW label when no existing label fits. Assert via case-insensitive substring match that at least one of these phrases is present: 'propose a new', 'propose new', 'propose a label', 'invent', 'new label'. Concretely:
      ```
      const lower = p.toLowerCase()
      const proposes =
        lower.includes('propose a new') ||
        lower.includes('propose new') ||
        lower.includes('propose a label') ||
        lower.includes('new label')
      expect(proposes).toBe(true)
      ```
  - Test NEW-B: prompt instructs that NEW (proposed) labels MUST carry confidence below 0.85 — assert via case-insensitive match for at least one of: 'below 0.85', '< 0.85', 'less than 0.85', 'under 0.85'. Concretely:
      ```
      const lower = p.toLowerCase()
      const subThreshold =
        lower.includes('below 0.85') ||
        lower.includes('< 0.85') ||
        lower.includes('less than 0.85') ||
        lower.includes('under 0.85')
      expect(subThreshold).toBe(true)
      ```
  - Test NEW-C (NEGATIVE — prevents regression): prompt MUST NOT contain the old hard-prohibition phrase 'Never invent labels'. This proves the relaxation actually shipped:
      ```
      expect(p).not.toContain('Never invent labels')
      ```
  - Test NEW-D: prompt still allows `null` as a valid axis value when Claude has no plausible name (proposals encouraged, not required). Assert via case-insensitive substring match for at least one of: 'null is allowed', 'or null', 'may be null', 'can be null'. Concretely:
      ```
      const lower = p.toLowerCase()
      const nullAllowed =
        lower.includes('null is allowed') ||
        lower.includes('or null') ||
        lower.includes('may be null') ||
        lower.includes('can be null')
      expect(nullAllowed).toBe(true)
      ```

The Stage2ResultSchema tests (Tests 4–6) and the worker-forwarding tests (Tests 7–8) further down in the same file are UNCHANGED — they cover schema/worker behavior, not prompt copy.
  </behavior>

  <action>
1. Edit `agent/src/consumer/prompts.ts`. In `buildStage2Prompt` (the array of strings ending with the JSON-response line), REPLACE the single line currently reading:

       'Propose 3-axis labels (use an existing label if confident match ≥ 0.85; else null with low confidence). Never invent labels outside the lists above.',

   with copy that:
     - Keeps "Propose 3-axis labels."
     - Says: an existing label with confident match (confidence ≥ 0.85) is preferred when one fits.
     - Explicitly says: if no existing label is a confident match, you may PROPOSE A NEW label name on that axis (a short, lowercased, hyphen-or-underscore-separated name following the style of the existing labels).
     - Explicitly says: when proposing a NEW label, the confidence on that axis MUST be below 0.85 (so the system routes the item to human review for label approval — auto-file requires both confidence ≥ 0.85 AND the value to already exist in the taxonomy).
     - Explicitly says: if you have no plausible label name at all, `null` is still allowed for that axis (with low confidence).
     - Does NOT contain the phrase "Never invent labels" (verified by Test NEW-C).
     - Stays in a single array entry or splits into multiple array entries (your choice — only the joined string is asserted in tests).

   Suggested replacement copy (the executor may rewrite for clarity but must satisfy ALL assertions in the `<behavior>` block above):

       'Propose 3-axis labels. If an existing label from the lists above is a confident match (confidence ≥ 0.85), use it. If no existing label fits, you may propose a new label name on that axis — pick a short lowercased name following the style of the existing labels — but mark it with confidence below 0.85 so a human can review and approve the new label before it is added to the taxonomy. If you have no plausible label for an axis, value may be null with low confidence.',

   Do NOT change any other line in `buildStage2Prompt`. Specifically:
     - Do NOT touch the `Existing taxonomy:` block.
     - Do NOT touch the `Compute proposed_drive_path:` line.
     - Do NOT touch the `Decide one of:` block (auto_file / ignore / uncertain enum).
     - Do NOT touch the final JSON-response shape line.
     - Do NOT touch `buildStage1Prompt`, `buildStage2ItemBlock`, or any helper.

2. Edit `agent/__tests__/consumer-stage2-prompt.test.ts`. In the existing `describe('buildStage2Prompt — decision field instructions (u47)')` block, ADD the four new tests (NEW-A, NEW-B, NEW-C, NEW-D) per the `<behavior>` block. Tests 1, 2, 3 stay as-is. The remaining describe blocks (`Stage2ResultSchema (via worker)` and `runStage2Worker — forwards decision in classify payload`) are UNCHANGED — do not edit them.

3. Update the comment on prompts.ts line 78–81 (the comment block above the `return [` in `buildStage2Prompt`) to reflect that the closed-vocab rule has been RELAXED in this quick task. Replace the existing reference to "Task #2 of the sibling quick task changes that separately" with a one-line note pointing at this quick task (260426-wgk). Keep the comment short — one or two sentences.

4. Run the agent test suite focused on the prompt+worker file to confirm both old and new assertions pass.

5. Run the route-side cold-start tests UNCHANGED (no edits) to prove Task #1 of u47 was correctly future-proofed: an invented label still falls back to status='uncertain' via `allLabelsExist=false`. This is a guardrail check — if it fails, the cold-start guard regressed and we must NOT ship.

CONSTRAINTS:
- Do NOT modify `agent/src/consumer/stage2.ts` (Stage2ResultSchema is the contract; it stays).
- Do NOT modify `agent/src/http/types.ts` (ClassifyRequest shape stays).
- Do NOT modify `app/api/classify/route.ts` (cold-start guard stays).
- Do NOT add a TaxonomyLabelProposal table, migration, or any new endpoint.
- Do NOT weaken the cold-start guard — Test NEW-B (sub-threshold confidence) plus the unchanged route guard means even if Claude IGNORES the prompt instruction and emits confidence ≥ 0.85 on a proposed label, the route's `allLabelsExist` check still blocks auto-file. Defense in depth.
  </action>

  <verify>
    <automated>cd /Users/dfonnegrag/Projects/cortex/agent && npm test -- --testPathPattern=consumer-stage2-prompt</automated>
    <automated>cd /Users/dfonnegrag/Projects/cortex && npm test -- --testPathPattern=classify-auto-actions</automated>
  </verify>

  <done>
- `buildStage2Prompt` no longer contains the phrase "Never invent labels".
- `buildStage2Prompt` contains explicit permission to propose a new label.
- `buildStage2Prompt` contains an explicit "below 0.85" rule for proposed labels.
- `buildStage2Prompt` still contains the substring '0.85' AND 'auto_file' AND 'ignore' AND 'uncertain' AND a junk category word (existing tests 1–3 still pass).
- All 4 new tests (NEW-A, NEW-B, NEW-C, NEW-D) pass.
- Tests 4–8 (schema + worker forwarding) pass UNCHANGED.
- All `__tests__/classify-auto-actions.test.ts` tests pass UNCHANGED — including the "cold-start guard blocks auto-file when label not in TaxonomyLabel → status='uncertain'" case (proves Task #1 of u47 future-proofed correctly).
- `agent/src/consumer/stage2.ts`, `agent/src/http/types.ts`, `app/api/classify/route.ts`, `prisma/schema.prisma` are UNCHANGED in this task.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Mac agent → Claude CLI (Stage 2 prompt) | The agent injects the (now relaxed) Stage 2 prompt into the Claude CLI subprocess. Prompt content is built from in-process taxonomy + item metadata — no untrusted user-typed strings cross this boundary. |
| Mac agent → /api/classify | The agent POSTs Stage2ResultSchema-shaped JSON, which now may contain attacker-influenced (or hallucinated) label NAMES inside `axes.{axis}.value`. The route persists these into `Item.classification_trace` and (only when auto-file fires) `axis_*` columns. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-wgk-01 | Tampering | buildStage2Prompt | mitigate | Prompt copy is hardcoded in source; no template-injection surface. The relaxation only changes natural-language wording — no new dynamic substitutions. The existing source-grep test (per prompts.ts header comment) already forbids `fs` imports here, so prompt construction cannot read attacker-controlled files. |
| T-wgk-02 | Elevation of Privilege | /api/classify auto-file path | mitigate | An invented (proposed) label MUST NOT be able to escalate to auto-file (status='filed'). Defense in depth: (a) prompt instructs confidence < 0.85 for proposals; (b) the route's pre-existing cold-start guard `allLabelsExist` independently blocks auto-file when ANY axis value is not in TaxonomyLabel — so even a prompt-disobedient model cannot auto-file an invented name. The existing `__tests__/classify-auto-actions.test.ts` "blocked — cold-start guard, axis_type 'newlabel' not in TaxonomyLabel → status='uncertain'" test pins this. |
| T-wgk-03 | Information Disclosure | classification_trace.stage2.axes | accept | Hallucinated label names land in the JSON trace column. They are visible only to the single operator (Daniel) via the triage UI he already controls. No PII boundary crossed; no third-party recipient. |
| T-wgk-04 | Denial of Service | Stage 2 prompt size | accept | The new copy adds ~3 sentences (well under the prompt-byte budget that ACC-04 / T-07-02 already enforces for argv). No new dynamic substitutions are introduced. |
| T-wgk-05 | Repudiation | Auto-action audit trail | mitigate | Existing route already persists `decision` and `confidence` into `classification_trace.stage2` plus emits a Langfuse `auto-file` span with `blocked_by` reason. A proposal-based block surfaces as `blocked_by='unknown_label'` — no new instrumentation needed; the existing audit trail covers it. |
</threat_model>

<verification>
- Both `npm test` invocations in `<verify>` pass.
- `git diff agent/src/consumer/prompts.ts` shows ONLY changes to the single closed-vocab line + the comment block above the `return [` in `buildStage2Prompt`. No edits to `buildStage1Prompt`, helpers, or imports.
- `git diff agent/__tests__/consumer-stage2-prompt.test.ts` shows ONLY additions inside the first `describe` block (Tests NEW-A through NEW-D). No edits to Tests 4–8.
- `git diff` is empty for: `agent/src/consumer/stage2.ts`, `agent/src/http/types.ts`, `app/api/classify/route.ts`, `prisma/schema.prisma`, `__tests__/classify-auto-actions.test.ts`.
- Manual smoke (optional, only if dev env is up): run `npx tsc --noEmit` from the agent package to confirm no type drift from the comment edits.
</verification>

<success_criteria>
- Stage 2 prompt explicitly permits proposing new labels (substring check passes).
- Stage 2 prompt explicitly requires sub-0.85 confidence on proposed labels (substring check passes).
- Stage 2 prompt no longer contains "Never invent labels" (negative substring check passes).
- All Stage 2 schema and worker-forwarding behavior is unchanged (Tests 4–8 unchanged and passing).
- Cold-start guard tests pass UNCHANGED (proves the route correctly future-proofs invented labels into status='uncertain').
- No schema migration, no new table, no new endpoint, no UI change in this task.
</success_criteria>

<output>
After completion, create `.planning/quick/260426-wgk-stage-2-may-propose-new-taxonomy-labels-/260426-wgk-SUMMARY.md` covering:
- The exact replacement copy that shipped in `buildStage2Prompt`.
- Confirmation that all 4 new tests + 3 existing prompt tests + 5 unchanged schema/worker tests pass.
- Confirmation that the cold-start guard tests in `__tests__/classify-auto-actions.test.ts` passed UNCHANGED (defense-in-depth verified).
- One-line note that sibling Task #3 (triage UI surfacing of "this is a new label proposal") is the next step and is OUT OF SCOPE here.
</output>
