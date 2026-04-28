---
phase: quick-260428-jrt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/queue-config.ts
  - app/api/ingest/route.ts
  - __tests__/ingest-routing.test.ts
  - agent/src/consumer/index.ts
  - agent/src/consumer/prompts.ts
  - agent/__tests__/consumer-prompts.test.ts
  - agent/__tests__/consumer-bootstrap.test.ts
autonomous: true
requirements:
  - JRT-01  # Rename STAGE1_MIN_SIZE_BYTES → TRIAGE_MIN_SIZE_BYTES (semantic shift)
  - JRT-02  # /api/ingest routes <1MiB → pending_stage2, ≥1MiB → uncertain (no Stage 1)
  - JRT-03  # Drop Stage 1 worker (stage1.ts + buildStage1Prompt + consumer wiring)
  - JRT-04  # Delete Stage 1 tests; rewrite ingest-routing tests for the new rule
  - JRT-05  # Keep /api/classify stage:1 schema + QUEUE_STATUSES.{PENDING,PROCESSING}_STAGE_1 untouched (back-compat)

must_haves:
  truths:
    - "POST /api/ingest with size_bytes < 1 MiB creates an Item with status='pending_stage2' (unchanged)."
    - "POST /api/ingest with size_bytes >= 1 MiB creates an Item with status='uncertain' (was 'pending_stage1')."
    - "POST /api/ingest for downloads with NO size_bytes creates an Item with status='uncertain' (defensive: unknown size goes to triage, not Stage 1)."
    - "POST /api/ingest for gmail with at least one attachment > 1 MiB creates status='uncertain' (was 'pending_stage1')."
    - "agent/src/consumer/stage1.ts no longer exists; agent/src/consumer/index.ts boots only the Stage 2 worker."
    - "buildStage1Prompt is no longer exported from agent/src/consumer/prompts.ts; buildStage2Prompt is unchanged."
    - "agent/__tests__/consumer-stage1.test.ts no longer exists."
    - "agent/__tests__/consumer-prompts.test.ts no longer references buildStage1Prompt; Stage 2 prompt tests stay intact."
    - "agent/__tests__/consumer-bootstrap.test.ts no longer asserts runStage1; bootstrap happy-path asserts only Stage 2."
    - "lib/queue-config.ts exports TRIAGE_MIN_SIZE_BYTES = 1_048_576 (the old STAGE1_MIN_SIZE_BYTES symbol is removed)."
    - "QUEUE_STATUSES.PENDING_STAGE_1 / PROCESSING_STAGE_1 still exist (back-compat for in-flight items + /api/queue legacy-reclaim path)."
    - "app/api/classify/route.ts stage:1 schema is unchanged (back-compat — no callers expected after this change)."
    - "Full repo test suites (web app + agent) pass with zero unrelated failures."
  artifacts:
    - path: "lib/queue-config.ts"
      provides: "Renamed constant TRIAGE_MIN_SIZE_BYTES; QUEUE_STATUSES enum unchanged."
      contains: "TRIAGE_MIN_SIZE_BYTES"
    - path: "app/api/ingest/route.ts"
      provides: "Routing rule: <1 MiB → pending_stage2, ≥1 MiB or unknown → uncertain."
      contains: "QUEUE_STATUSES.UNCERTAIN"
    - path: "agent/src/consumer/index.ts"
      provides: "Consumer bootstrap that starts Stage 2 only."
    - path: "agent/src/consumer/prompts.ts"
      provides: "buildStage2Prompt (unchanged behavior); no buildStage1Prompt export."
    - path: "__tests__/ingest-routing.test.ts"
      provides: "Test coverage for the new routing rule (small→stage2, large/unknown→uncertain)."
  key_links:
    - from: "app/api/ingest/route.ts"
      to: "lib/queue-config.ts"
      via: "import { TRIAGE_MIN_SIZE_BYTES, QUEUE_STATUSES }"
      pattern: "TRIAGE_MIN_SIZE_BYTES"
    - from: "app/api/ingest/route.ts"
      to: "Item.status"
      via: "prisma.item.create({ data: { status: 'pending_stage2' | 'uncertain' } })"
      pattern: "QUEUE_STATUSES\\.(PENDING_STAGE_2|UNCERTAIN)"
    - from: "agent/src/consumer/index.ts"
      to: "agent/src/consumer/stage2.ts"
      via: "runStage2Worker (only worker now)"
      pattern: "runStage2Worker"

deletions:
  # Hard-deletes — these files MUST NOT exist after the plan executes.
  - agent/src/consumer/stage1.ts
  - agent/__tests__/consumer-stage1.test.ts
---

<objective>
Drop the Stage 1 relevance gate. The h9w model-defined evolving folder structure makes Stage 1
redundant: small files (<1 MiB) are cheap to send straight to Stage 2 (which reads content and
classifies axes + path), and large files (≥1 MiB) are already destined for human triage because
Stage 2 can't read content beyond `claude -p`'s Read tool budget. The new ingest routing rule is:

  - source='downloads', size_bytes < 1 MiB           → status='pending_stage2'
  - source='downloads', size_bytes >= 1 MiB          → status='uncertain'   (was: pending_stage1)
  - source='downloads', size_bytes undefined         → status='uncertain'   (was: pending_stage1; safe default — let a human triage rather than send to a worker that no longer exists)
  - source='gmail', no attachments / all small       → status='pending_stage2'  (unchanged)
  - source='gmail', any attachment > 1 MiB           → status='uncertain'   (was: pending_stage1)

The Stage 1 worker, the Stage 1 prompt builder, and all Stage 1 tests are deleted. The
`STAGE1_MIN_SIZE_BYTES` constant is renamed to `TRIAGE_MIN_SIZE_BYTES` to reflect the new
semantics ("files at or above this go straight to triage"). The /api/classify route's stage:1
schema is left untouched (cheap back-compat — no callers after this change). The
`QUEUE_STATUSES.PENDING_STAGE_1` / `PROCESSING_STAGE_1` enum entries remain so any in-flight
items continue to be valid and the /api/queue legacy-reclaim path stays functional.

Purpose: simpler state machine, fewer LLM calls per item, no behavior change for the user
(Stage 2's `decision='ignore'` already handles relevance signals; large items always went
to triage anyway).

Output: smaller queue/consumer surface, ~700 lines of code + tests removed, ingest test
suite rewritten for the new routing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@lib/queue-config.ts
@app/api/ingest/route.ts
@agent/src/consumer/index.ts
@agent/src/consumer/stage1.ts
@agent/src/consumer/prompts.ts
@__tests__/ingest-routing.test.ts
@agent/__tests__/consumer-prompts.test.ts
@agent/__tests__/consumer-bootstrap.test.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from the codebase so no exploration is required. -->

From lib/queue-config.ts (current — to be edited):
```ts
export const STAGE1_MIN_SIZE_BYTES = 1_048_576  // → rename to TRIAGE_MIN_SIZE_BYTES
export const QUEUE_STATUSES = {
  PENDING_STAGE_1: 'pending_stage1',     // KEEP — in-flight back-compat + queue legacy-reclaim
  PROCESSING_STAGE_1: 'processing_stage1', // KEEP — same reason
  PENDING_STAGE_2: 'pending_stage2',
  PROCESSING_STAGE_2: 'processing_stage2',
  IGNORED: 'ignored',
  UNCERTAIN: 'uncertain',                // ← new ingest routing target for ≥1 MiB
  CERTAIN: 'certain',
  FILED: 'filed',
  ERROR: 'error',
  LEGACY_PROCESSING: 'processing',
} as const
```

From app/api/ingest/route.ts (current routing — to be edited):
```ts
function computeInitialStatus(input: {...}):
  typeof QUEUE_STATUSES.PENDING_STAGE_1 | typeof QUEUE_STATUSES.PENDING_STAGE_2 {
  // ... currently returns PENDING_STAGE_1 for big or unknown-size items
}
// New return type after edit:
//   typeof QUEUE_STATUSES.PENDING_STAGE_2 | typeof QUEUE_STATUSES.UNCERTAIN
```

From agent/src/consumer/index.ts (current bootstrap — Stage 1 import + invocation must be removed):
```ts
import { runStage1Worker } from './stage1.js'
// ...
const stage1 = (opts?.runStage1 ?? runStage1Worker)({ langfuse })
// ...
await Promise.all([stage1.stop(), stage2.stop()]),
```

From agent/src/consumer/prompts.ts:
```ts
export function buildStage1Prompt(item: QueueItem): string { ... }   // DELETE this function
export function buildStage2Prompt(item: QueueItem, taxonomy: TaxonomyContext, paths: PathContext): string { ... }  // KEEP unchanged
```

Routing rule after edit (the only behavior change):
```
downloads:  size < 1 MiB → pending_stage2;  size >= 1 MiB OR undefined → uncertain
gmail:      any attachment > 1 MiB → uncertain;  otherwise → pending_stage2
```
</interfaces>

Notes for the executor:
- /api/classify/route.ts stage:1 branch is intentionally left intact (back-compat). Do NOT
  touch app/api/classify/route.ts. Do NOT remove `stage1` keys from `classification_trace`
  reads (the triage route uses them, see app/api/triage/route.ts:8-16).
- /api/queue/route.ts uses QUEUE_STATUSES.PENDING_STAGE_1 in its legacy-reclaim CASE
  expression and in route-tests; do NOT touch /api/queue. Items already in pending_stage1
  remain claimable by a Stage 1 worker that no longer exists — that's intentional during
  the transition; a future cleanup task can drain them by hand.
- agent/src/index.ts (the daemon) does NOT import Stage 1; do not edit it.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rename constant + retarget /api/ingest routing + rewrite routing tests</name>
  <files>
    lib/queue-config.ts,
    app/api/ingest/route.ts,
    __tests__/ingest-routing.test.ts
  </files>
  <behavior>
    Tests in __tests__/ingest-routing.test.ts (rewritten):
    - Test 1 (small downloads — 500 KB): status='pending_stage2'   (unchanged)
    - Test 2 (large downloads — 2 MiB): status='uncertain'         (was: pending_stage1)
    - Test 3 (downloads exactly 1 MiB): status='pending_stage2'    (boundary unchanged — strict >)
    - Test 4 (gmail no attachments): status='pending_stage2'        (unchanged)
    - Test 5 (gmail all attachments ≤ 1 MiB): status='pending_stage2' (unchanged)
    - Test 6 (gmail one attachment > 1 MiB): status='uncertain'    (was: pending_stage1)
    - Test 7 (downloads NO size_bytes): status='uncertain'         (was: pending_stage1 — defensive default flipped: with no Stage 1 worker, unknown-size items must land in human triage rather than queue for a worker that no longer exists)
    - Test 8 (heartbeat path): 204 with no Item.create               (unchanged)
    - Test 9 (dedup path): returns existing id, no recompute          (unchanged)
    - Defensive (gmail malformed attachments non-array): status='pending_stage2' (unchanged)
    - Defensive (gmail attachments non-numeric size_bytes): status='pending_stage2' (unchanged)
    The describe block header should be updated to reference quick task 260428-jrt
    instead of 260426-u47, and comments referencing "Stage 1 (relevance gate)" should
    be replaced with "triage threshold". The defensive-default comment for unknown
    size_bytes should now read "unknown size — route to triage so a human handles it".

    Source contracts:
    - lib/queue-config.ts: rename `STAGE1_MIN_SIZE_BYTES` → `TRIAGE_MIN_SIZE_BYTES`
      (same value, 1_048_576). Update the doc-comment to reflect the new semantics
      ("files at or above this go straight to triage; smaller files go to Stage 2").
      Note: the threshold is still strict-greater-than (size_bytes > TRIAGE_MIN_SIZE_BYTES),
      so a file at exactly 1 MiB still goes to pending_stage2. Reference quick task
      260428-jrt instead of 260426-u47 in the doc-comment.
    - QUEUE_STATUSES.PENDING_STAGE_1 / PROCESSING_STAGE_1 stay (back-compat — see
      app/api/queue/route.ts legacy-reclaim path).
    - app/api/ingest/route.ts:
        - Update the import to `TRIAGE_MIN_SIZE_BYTES` (drop STAGE1_MIN_SIZE_BYTES).
        - Change `computeInitialStatus`'s return type to
          `typeof QUEUE_STATUSES.PENDING_STAGE_2 | typeof QUEUE_STATUSES.UNCERTAIN`.
        - Replace every PENDING_STAGE_1 return with QUEUE_STATUSES.UNCERTAIN.
        - For downloads with `size_bytes === undefined`, return UNCERTAIN (was PENDING_STAGE_1).
        - Update doc-comments / span input fields to reflect "Stage 1 → triage" rename
          (e.g. the routeSpan name can stay 'route-decision'; the comment block above it
          should say "Routing decision (quick task 260428-jrt). Small / metadata-only items
          go straight to Stage 2; large or unknown-size items go to triage (status='uncertain').").
  </behavior>
  <action>
    1. Edit `lib/queue-config.ts`:
       - Rename the export `STAGE1_MIN_SIZE_BYTES` to `TRIAGE_MIN_SIZE_BYTES` (same numeric
         value 1_048_576). Replace the existing doc-comment with one reflecting the new
         semantics: items with `size_bytes > TRIAGE_MIN_SIZE_BYTES` skip Stage 2 and
         land in `uncertain` (human triage). Preserve the strict-greater-than note (1 MiB
         exactly still goes to Stage 2). Reference "quick task 260428-jrt".
       - Leave QUEUE_STATUSES exactly as-is. Specifically PENDING_STAGE_1 and
         PROCESSING_STAGE_1 must remain — they are still referenced by /api/queue's
         legacy-reclaim CASE and by the LEGACY_PROCESSING doc-comment. Update only
         the JSDoc on PENDING_STAGE_1 / PROCESSING_STAGE_1 to add a one-line note:
         "Retained for back-compat with in-flight items and the /api/queue legacy-reclaim
          path; new ingests no longer produce this status (quick task 260428-jrt)."

    2. Edit `app/api/ingest/route.ts`:
       - Change the import line `import { QUEUE_STATUSES, STAGE1_MIN_SIZE_BYTES } from '@/lib/queue-config'`
         to `import { QUEUE_STATUSES, TRIAGE_MIN_SIZE_BYTES } from '@/lib/queue-config'`.
       - In `computeInitialStatus`:
           - Update the return type annotation to
             `typeof QUEUE_STATUSES.PENDING_STAGE_2 | typeof QUEUE_STATUSES.UNCERTAIN`.
           - Replace every reference to `STAGE1_MIN_SIZE_BYTES` with `TRIAGE_MIN_SIZE_BYTES`.
           - Replace each `return QUEUE_STATUSES.PENDING_STAGE_1` with
             `return QUEUE_STATUSES.UNCERTAIN`. There are three such returns to update:
               (a) downloads with size_bytes > threshold,
               (b) downloads with size_bytes === undefined (defensive default; flip from
                   "potentially large → Stage 1" to "unknown → triage"),
               (c) gmail with any attachment > threshold (the ternary in `hasLarge ?`).
           - Update the function-level doc-comment to reflect the new rule
             ("`UNCERTAIN` for large/unknown items; `PENDING_STAGE_2` otherwise") and
             reference "quick task 260428-jrt (D-stage1-removal)".
       - Update the inline comment block above `const initialStatus = computeInitialStatus(...)`
         to read: "Routing decision (quick task 260428-jrt). Small / metadata-only items
         go straight to Stage 2; large or unknown-size items go to triage (status='uncertain').
         Stage 1 was removed because Stage 2's `decision='ignore'` already handles relevance signals."
       - Do NOT change anything else in this file (heartbeat path, dedup, item-create
         span, error path, OWNER_USER_ID — all unchanged).

    3. Rewrite `__tests__/ingest-routing.test.ts`:
       - Change the file-level docstring at the top to reference quick task 260428-jrt
         and describe the new rule (no Stage 1; >=1 MiB or unknown → 'uncertain').
       - Change the outer describe text from "(quick task 260426-u47)" to
         "(quick task 260428-jrt)".
       - For each existing test, update the expected status string per the behavior
         table above. Concretely:
           - Test 2: change `expect(statusFromCreate()).toBe('pending_stage1')` →
             `expect(statusFromCreate()).toBe('uncertain')`.
           - Test 6: same change as Test 2.
           - Test 7 (no size_bytes): same change — unknown size now defaults to 'uncertain'.
             Update its inline comment to "Unknown size — route to triage so a human handles it
             (no Stage 1 worker exists)."
           - Test 9 (dedup): the `size_bytes: 5_000_000` body comment "would have routed to
             stage1" should become "would have routed to 'uncertain' if recomputed". The
             assertion (no Item.create) is unchanged.
           - All other tests: unchanged.
       - Add a brief inline comment at the top of the describe block stating that the
         old PENDING_STAGE_1 cases now resolve to 'uncertain' so the diff is clear.

    4. Run the web-app jest suite to confirm the rewrite passes:
         `npm test -- __tests__/ingest-routing.test.ts`
       The 11 tests in the rewritten file must all pass. Also run
         `npm test -- __tests__/queue-config.test.ts`
       to confirm the constant rename did not break the queue-config invariants test.
  </action>
  <verify>
    <automated>npm test -- __tests__/ingest-routing.test.ts __tests__/queue-config.test.ts __tests__/ingest-api.test.ts</automated>
  </verify>
  <done>
    - `lib/queue-config.ts` exports `TRIAGE_MIN_SIZE_BYTES` (the symbol `STAGE1_MIN_SIZE_BYTES`
      no longer exists; verified by `grep -rn "STAGE1_MIN_SIZE_BYTES" lib app __tests__` returning zero hits).
    - `app/api/ingest/route.ts` no longer references `STAGE1_MIN_SIZE_BYTES` and never returns
      `QUEUE_STATUSES.PENDING_STAGE_1` from `computeInitialStatus`.
    - `__tests__/ingest-routing.test.ts` is updated with all PENDING_STAGE_1 expectations
      flipped to `uncertain`. The full suite passes.
    - `__tests__/queue-config.test.ts` and `__tests__/ingest-api.test.ts` still pass (no
      collateral damage to neighbouring routes).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Drop Stage 1 worker, prompt builder, and all Stage 1 tests</name>
  <files>
    agent/src/consumer/stage1.ts (DELETE),
    agent/src/consumer/prompts.ts,
    agent/src/consumer/index.ts,
    agent/__tests__/consumer-stage1.test.ts (DELETE),
    agent/__tests__/consumer-prompts.test.ts,
    agent/__tests__/consumer-bootstrap.test.ts
  </files>
  <action>
    1. DELETE the Stage 1 worker:
       - `rm agent/src/consumer/stage1.ts`
       - `rm agent/__tests__/consumer-stage1.test.ts`
       Use `git rm` if the executor prefers staged deletes; either works.

    2. Edit `agent/src/consumer/prompts.ts`:
       - Remove the `buildStage1Prompt` function entirely (lines defining the function plus
         its preceding "Stage 1" section divider comment).
       - Update the file-level docstring: drop the "Stage 1 (relevance gate)" wording and
         the `D-stage1-prompt:` section. Keep the Stage 2 section and the security
         constraint block intact (the no-fs-imports invariant still applies).
       - Keep `buildStage2Prompt`, `buildStage2ItemBlock`, `metaString`, `stringOrNone`,
         `listOrNoneYet`, and `renderPathsBlock` exactly as-is. Do NOT touch their bodies.
       - Confirm `import type { QueueItem }` is still used (it is — `buildStage2Prompt`
         needs it).

    3. Edit `agent/src/consumer/index.ts`:
       - Remove the `import { runStage1Worker } from './stage1.js'` line.
       - Remove the `STAGE1_LIMIT` / `STAGE1_CONCURRENCY` mention from the file-level
         comment (line 6: "Runs Stage 1 (limit=10, concurrency=10) and Stage 2 (limit=2,
         concurrency=2) worker loops in parallel" → "Runs the Stage 2 worker loop, draining
         /api/queue?stage=2 end-to-end."). Update step 3 of the bootstrap contract from
         "Start Stage 1 + Stage 2 workers (independent loops)." → "Start the Stage 2 worker
         (single pool, /api/queue?stage=2 only)."
       - In `BootstrapOpts`, remove the `runStage1?` field. Keep `runStage2?`,
         `assertClaudeOnPathImpl?`, `langfuse?`.
       - In the body of `bootstrapConsumer`, replace
           `const stage1 = (opts?.runStage1 ?? runStage1Worker)({ langfuse })`
           `const stage2 = (opts?.runStage2 ?? runStage2Worker)({ langfuse })`
         with just:
           `const stage2 = (opts?.runStage2 ?? runStage2Worker)({ langfuse })`
       - Replace the console.log
           `console.log('[cortex-consumer] started (Stage 1 + Stage 2 pools running)')`
         with:
           `console.log('[cortex-consumer] started (Stage 2 pool running)')`
       - In the `shutdown` closure, replace the `Promise.all([stage1.stop(), stage2.stop()])`
         with `stage2.stop()`. The `Promise.race` against the SHUTDOWN_DRAIN_TIMEOUT_MS
         must remain — adapt to:
           ```ts
           await Promise.race([
             stage2.stop(),
             new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)),
           ])
           ```
       - Update the SHUTDOWN_DRAIN_TIMEOUT_MS doc-comment: it currently mentions
         "Stage 1's invokeClaude has its own 120s timeout"; rewrite to mention
         "Stage 2's invokeClaude has its own 120s timeout" instead. The 5_000 ms cap
         and rationale are unchanged.

    4. Edit `agent/__tests__/consumer-prompts.test.ts`:
       - Remove the entire `describe('buildStage1Prompt — file', ...)` block.
       - Remove the entire `describe('buildStage1Prompt — gmail', ...)` block.
       - In the import line at the top, drop `buildStage1Prompt` from the import
         destructure. Keep `buildStage2Prompt`, `TaxonomyContext`, `PathContext`.
       - In the `describe('source-file invariants (prompts.ts)', ...)` block at the
         bottom:
           - Remove the test `'contains both confidence thresholds (Stage 1 0.75 and Stage 2 0.85)'`
             — rewrite it as a Stage-2-only test:
               `it('contains the Stage 2 0.85 confidence threshold', () => { expect(src).toMatch(/0\.85/) })`
           - Keep the other invariants (no fs imports, no fs.readFile, "downloads item
             missing file_path" still thrown, `(none yet)` still present).
       - Update the file-level docstring at the top to drop the four Stage 1 bullets
         and renumber accordingly.

    5. Edit `agent/__tests__/consumer-bootstrap.test.ts`:
       - In every test that currently injects `runStage1`, drop the `runStage1` field
         from the `bootstrapConsumer({ ... })` call. Concretely:
           - Test 4 ('Stage 1 + Stage 2 workers each started exactly once with langfuse'):
             rename to 'Stage 2 worker started exactly once with langfuse'. Drop the
             `runStage1` mock entirely (declaration + injection). Drop the
             `expect(runStage1).toHaveBeenCalledTimes(1)` and the
             `expect(runStage1.mock.calls[0]![0]).toEqual(...)` assertions. Keep the
             Stage 2 assertions.
           - Test 5 ('SIGTERM triggers stop() on both workers + flushAsync + exit(0)'):
             rename to 'SIGTERM triggers stop() on the Stage 2 worker + flushAsync +
             exit(0)'. Drop `stage1Stop` (declaration + the `runStage1: (() => ({ stop:
             stage1Stop }))` injection). Drop the `expect(stage1Stop).toHaveBeenCalled()`
             assertion. Keep stage2Stop assertions and the flushAsync / exit(0) checks.
           - Test 6 ('consumer_start trace emitted on successful boot'): drop the
             `runStage1: (() => ({ stop: ... })) as never,` line. Keep `runStage2`.
       - Update the file-level docstring's bullet
           "bootstrapConsumer happy path: Stage 1 + Stage 2 workers both start..."
         to
           "bootstrapConsumer happy path: Stage 2 worker starts exactly once with the
            langfuse instance passed."
         and the SIGTERM bullet
           "SIGTERM handler triggers stop() on both workers + flushes Langfuse..."
         to
           "SIGTERM handler triggers stop() on the Stage 2 worker + flushes Langfuse..."

    6. Sanity-grep — after edits, run from the repo root:
         `grep -rn "buildStage1Prompt\|runStage1Worker\|consumer/stage1" agent/src agent/__tests__`
       Expected output: no matches anywhere except possibly in this PLAN.md file (which
       is not under agent/). If anything else surfaces, fix it before declaring done.
       Also run:
         `grep -rn "STAGE1_MIN_SIZE_BYTES" lib app __tests__ agent`
       Expected output: zero matches.

    7. Run both test suites:
         `npm test -- agent/__tests__/consumer-prompts.test.ts agent/__tests__/consumer-bootstrap.test.ts agent/__tests__/consumer-stage2.test.ts agent/__tests__/consumer-stage2-prompt.test.ts`
       Then run the full agent suite to catch any unrelated breakage:
         `npm test -- agent/__tests__`
       Then the full web-app suite:
         `npm test -- __tests__`
       All previously green tests must remain green. The deleted test file (consumer-stage1.test.ts)
       must be absent from the test runner output.
  </action>
  <verify>
    <automated>npm test -- agent/__tests__ __tests__</automated>
  </verify>
  <done>
    - `agent/src/consumer/stage1.ts` does not exist.
    - `agent/__tests__/consumer-stage1.test.ts` does not exist.
    - `agent/src/consumer/prompts.ts` does not export `buildStage1Prompt`; `buildStage2Prompt`
      is unchanged (verified by `grep -n "buildStage1Prompt" agent/src` returning zero matches).
    - `agent/src/consumer/index.ts` does not import or invoke `runStage1Worker`; bootstrap
      starts only the Stage 2 worker, and shutdown calls `stage2.stop()` with the same
      SHUTDOWN_DRAIN_TIMEOUT_MS race.
    - `agent/__tests__/consumer-prompts.test.ts` no longer references `buildStage1Prompt`.
    - `agent/__tests__/consumer-bootstrap.test.ts` no longer asserts `runStage1`.
    - The full agent suite passes; the full web-app suite passes (Task 1's changes still
      green from this end as well).
    - Sanity greps return no matches for `buildStage1Prompt`, `runStage1Worker`,
      `consumer/stage1`, or `STAGE1_MIN_SIZE_BYTES` anywhere outside `.planning/`.
  </done>
</task>

</tasks>

<verification>
Phase-level checks (run after both tasks complete):

1. Symbol cleanup (no stragglers):
     `grep -rn "STAGE1_MIN_SIZE_BYTES\|buildStage1Prompt\|runStage1Worker\|consumer/stage1" lib app __tests__ agent`
   MUST return zero matches.

2. Stage 1 files gone:
     `ls agent/src/consumer/stage1.ts agent/__tests__/consumer-stage1.test.ts 2>&1`
   MUST report both files missing.

3. New constant present:
     `grep -n "TRIAGE_MIN_SIZE_BYTES" lib/queue-config.ts app/api/ingest/route.ts`
   MUST show one export in queue-config.ts and one import + one usage site in ingest route.

4. Routing rule correct:
     `grep -n "QUEUE_STATUSES.UNCERTAIN" app/api/ingest/route.ts`
   MUST appear in the `computeInitialStatus` return paths (3 occurrences: large downloads,
   unknown-size downloads, gmail-with-large-attachment).
   `grep -n "QUEUE_STATUSES.PENDING_STAGE_1" app/api/ingest/route.ts`
   MUST return zero matches.

5. Back-compat preserved (NOT touched):
     `grep -n "QUEUE_STATUSES.PENDING_STAGE_1\|QUEUE_STATUSES.PROCESSING_STAGE_1" lib/queue-config.ts app/api/queue/route.ts`
   MUST still find them — these are the back-compat enum entries + queue-route legacy-reclaim
   case.
     `grep -n "stage:.*z.literal(1)\|data.stage === 1" app/api/classify/route.ts`
   MUST still find the stage:1 schema branch (untouched by this plan).

6. Test suites:
     `npm test -- __tests__ agent/__tests__`
   MUST pass with zero unrelated failures. The `consumer-stage1.test.ts` file MUST NOT
   appear in the runner output.

7. TypeScript still typechecks:
     `npx tsc --noEmit -p tsconfig.json`
   (or whatever `npm run typecheck` is configured as; the executor should pick the
    project's standard typecheck command.) MUST exit 0.
</verification>

<success_criteria>
- All 7 verification checks pass.
- `git status` shows the expected file changes only:
    M  lib/queue-config.ts
    M  app/api/ingest/route.ts
    M  __tests__/ingest-routing.test.ts
    M  agent/src/consumer/index.ts
    M  agent/src/consumer/prompts.ts
    M  agent/__tests__/consumer-prompts.test.ts
    M  agent/__tests__/consumer-bootstrap.test.ts
    D  agent/src/consumer/stage1.ts
    D  agent/__tests__/consumer-stage1.test.ts
- The web-app and agent test suites are both green end-to-end.
- No regression in `consumer-stage2.test.ts`, `consumer-stage2-prompt.test.ts`,
  `classify-api.test.ts`, `queue-api.test.ts`, `triage-api.test.ts`, or
  `ingest-api.test.ts` — Stage 2 and the surrounding API surface are unaffected.
</success_criteria>

<output>
After completion, append a one-line entry to .planning/STATE.md "Quick Tasks Completed" table:

| 260428-jrt | Stage 1 removal: <1 MiB → pending_stage2, ≥1 MiB → uncertain (no LLM); deleted runStage1Worker + buildStage1Prompt + Stage 1 tests; renamed STAGE1_MIN_SIZE_BYTES → TRIAGE_MIN_SIZE_BYTES | 2026-04-28 | <commit-sha> | [260428-jrt-stage-1-removal-ingest-routing-change-fi](./quick/260428-jrt-stage-1-removal-ingest-routing-change-fi/) |

No SUMMARY.md required for quick tasks.
</output>
