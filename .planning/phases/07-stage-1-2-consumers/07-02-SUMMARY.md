---
phase: 07-stage-1-2-consumers
plan: 02
subsystem: agent/consumer + launchd
tags: [consumer, stage1, stage2, semaphore, langfuse-traces, launchd, keepalive, signal-handlers]

requires:
  - phase: 07-stage-1-2-consumers/01
    provides: Semaphore, invokeClaude, assertClaudeOnPath, buildStage1Prompt, buildStage2Prompt, getQueue, postClassify, getTaxonomyInternal, /api/taxonomy/internal route

provides:
  - runStage1Worker(deps) — async loop polling stage=1, limit=10, concurrency=10
  - runStage2Worker(deps) — async loop polling stage=2, limit=2, concurrency=2, fresh taxonomy per batch
  - bootstrapConsumer(opts?) — process entry point with env check + claude-on-PATH precheck + dual-pool start + signal handlers
  - validateConsumerEnv() — pure check returning { ok, missing[] }
  - com.cortex.consumer.plist — launchd job spec (KeepAlive=true, ThrottleInterval=10)

affects:
  - phase 08 (operational acceptance) — `launchctl load agent/launchd/com.cortex.consumer.plist` is the deploy step

tech-stack:
  added: [] # zero new runtime deps; uses existing Semaphore + invokeClaude + http client
  patterns:
    - cancellable-sleep: stop() resolves the current cadence sleep early so tests + real shutdown exit within microseconds, not 5s/30s ticks
    - per-item try/catch isolation: a single bad item NEVER crashes the loop (T-07-11 mitigation, asserted by Test 7-9)
    - all-three-axes-or-error: Stage 2 success payload constructed from Zod-validated invokeClaude output only; partial axes path is unreachable
    - independent-pools: Stage 1 and Stage 2 each hold their own Semaphore + their own loop; Test 10 proves Stage 2 advances while Stage 1 is saturated (CONS-05)
    - DI-seams everywhere: getQueueImpl / postClassifyImpl / invokeClaudeImpl / getTaxonomyInternalImpl / runStage1 / runStage2 / assertClaudeOnPathImpl — no node:child_process or fetch calls reach the test harness
    - regex-based plist tests: no XML parser dep; assert structure + secrets-absence via fs.readFileSync + .toContain / .toMatch

key-files:
  created:
    - agent/src/consumer/stage1.ts (~285 lines)
    - agent/src/consumer/stage2.ts (~325 lines)
    - agent/src/consumer/index.ts (~165 lines)
    - agent/launchd/com.cortex.consumer.plist (~45 lines)
    - agent/__tests__/consumer-stage1.test.ts (~565 lines, 14 tests)
    - agent/__tests__/consumer-stage2.test.ts (~545 lines, 12 tests)
    - agent/__tests__/consumer-bootstrap.test.ts (~420 lines, 21 tests)
  modified: [] # zero changes to existing files

key-decisions:
  - "Cancellable sleep on stop(): tests can drain in <100ms instead of waiting for the full 5s/30s cadence tick"
  - "Stage 2 success payload normalises axis.value to `string | null` (Zod inference can yield `string | null | undefined`); the API contract requires non-undefined"
  - "Plist binary path: ~/.local/bin/node FIRST (the working v22.12.0; system node has broken icu library per phase brief)"
  - "Plist EnvironmentVariables intentionally OMITS DATABASE_URL (T-07-15 mitigation), ANTHROPIC_API_KEY, OPENAI_API_KEY (claude CLI handles its own credentials)"
  - "uncaughtException handler wraps shutdown in `void (async ...)()` so the synchronous handler signature is correct (Node's emitter expects `(err: Error) => void`, not async)"

requirements-completed: [CONS-01, CONS-02, CONS-05, CONS-06]

duration: 19min
completed: 2026-04-25
---

# Phase 7 Plan 02: Stage 1 & Stage 2 Consumer Workers Summary

**Two-pool consumer process — Stage 1 (relevance gate, 10 concurrent) and Stage 2 (label classifier, 2 concurrent, fresh taxonomy per batch) running as independent async loops in a single Node process under `com.cortex.consumer.plist` (KeepAlive=true). Closes the v1.0 stuck-keeps regression (CONS-05) by proving Stage 2 advances even while Stage 1 is fully saturated.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-04-25T13:59:40Z
- **Completed:** 2026-04-25T14:18:21Z
- **Tasks:** 3
- **Files created:** 7 (3 source + 1 plist + 3 unit tests)
- **Files modified:** 0

## Accomplishments

- **Two-pool consumer is end-to-end runnable.** `bootstrapConsumer()` validates required env (CORTEX_API_URL, CORTEX_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY), runs `assertClaudeOnPath()` precheck, then spins up Stage 1 + Stage 2 workers as independent async loops sharing one Langfuse instance. SIGTERM/SIGINT trigger orderly drain (5s cap), flushAsync, and `process.exit(0)`. (CONS-01, CONS-02 closed.)

- **Independence is verifiable, not just claimed.** `consumer-stage2.test.ts` Test 10 (CONS-05) instantiates BOTH workers in the same test. Stage 1 is saturated with 10 paused invocations. Stage 2 still processes its 1 item — the assertion `expect(stage2Post).toHaveBeenCalledTimes(1)` AND `expect(stage1Post).not.toHaveBeenCalled()` proves the v1.0 stuck-keeps bug cannot recur.

- **Per-item failure isolation is mandatory, not optional.** Every per-item handler is wrapped in try/catch/finally. Tests 4-9 in `consumer-stage1.test.ts` walk through parse_error / exit_error / timeout / postClassify-conflict / postClassify-skip / prompt-build-error and assert the loop keeps polling for all of them. T-07-11 mitigation made executable.

- **Langfuse trace chaining works.** `consumer-stage1-item` and `consumer-stage2-item` traces are opened with `metadata.inbound_trace_id` set to the X-Trace-Id surfaced on the queue response. Test 12 in stage1 asserts the chain.

- **Stage 2 fresh-taxonomy contract enforced.** `getTaxonomyInternal` is called ONCE per non-empty batch (Test 4 in consumer-stage2). Empty polls do NOT fetch taxonomy. Two consecutive non-empty polls fire two fetches. No caching across cycles (D-no-cache-taxonomy).

- **Plist hardened against secret leakage.** `grep -RE "DATABASE_URL|ANTHROPIC_API_KEY|OPENAI_API_KEY" agent/launchd/com.cortex.consumer.plist` returns nothing. `plutil -lint` passes. Auto-asserted by 4 separate plist regex tests in `consumer-bootstrap.test.ts`.

## Task Commits

1. **Task 1: Stage 1 worker (relevance pool, 10 concurrent)** — `3f0f44a` (feat)
   - 2 files, 909 insertions
   - 14 tests; covers concurrency cap, error mappings, 409 conflict, adaptive cadence, X-Trace-Id propagation, clean shutdown
2. **Task 2: Stage 2 worker (label pool, 2 concurrent, fresh taxonomy per batch)** — `5d1dd78` (feat)
   - 2 files, 904 insertions
   - 12 tests; including the CONS-05 independence test (Test 10)
3. **Task 3: Consumer entry point + launchd plist** — `018ab0a` (feat)
   - 3 files, 646 insertions
   - 21 tests; bootstrap contract + 11 plist regex assertions

**Plan-level metadata commit will follow this SUMMARY** (docs commit).

## Files Created/Modified

### Created

- `agent/src/consumer/stage1.ts` — `runStage1Worker(deps)` returning `{ stop }`. Imports: `Semaphore` (07-01), `invokeClaude` (07-01), `buildStage1Prompt` (07-01), `getQueue` / `postClassify` (07-01). STAGE1_LIMIT=10, STAGE1_CONCURRENCY=10.
- `agent/src/consumer/stage2.ts` — `runStage2Worker(deps)` returning `{ stop }`. Same shape as stage1.ts plus `getTaxonomyInternal` per non-empty batch and `Stage2ResultSchema` enforcing all-3-axes. STAGE2_LIMIT=2, STAGE2_CONCURRENCY=2.
- `agent/src/consumer/index.ts` — `validateConsumerEnv()`, `bootstrapConsumer(opts?)`. Auto-starts under non-test environments via `JEST_WORKER_ID` gate.
- `agent/launchd/com.cortex.consumer.plist` — `Label=com.cortex.consumer`, `KeepAlive=true`, `ThrottleInterval=10`, separate `/tmp/cortex-consumer.log` and `/tmp/cortex-consumer-error.log`. PATH puts `~/.local/bin` first. EnvironmentVariables: NODE_ENV, HOME, PATH, CORTEX_API_URL, CORTEX_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST.
- `agent/__tests__/consumer-stage1.test.ts` — 14 tests
- `agent/__tests__/consumer-stage2.test.ts` — 12 tests
- `agent/__tests__/consumer-bootstrap.test.ts` — 21 tests

### Modified

None. The plan deliberately did not touch the daemon (`agent/src/index.ts`, scan, heartbeat, collectors) or any Next.js routes. `git diff HEAD~3 --name-only` confirms only new files under `agent/src/consumer/`, `agent/__tests__/consumer-*.test.ts`, and `agent/launchd/com.cortex.consumer.plist`.

## CONS-XX Traceability

| Requirement | Proof | Test |
|---|---|---|
| **CONS-01** Stage 1 process w/ concurrency=10 | `consumer-stage1.test.ts` | Test 1 (concurrency cap), Constants test |
| **CONS-02** Stage 2 process w/ concurrency=2 | `consumer-stage2.test.ts` | Test 1 (concurrency cap), Constants test |
| **CONS-05** Gmail keeps reliably advance | `consumer-stage2.test.ts` Test 10 | Stage 1 saturated → Stage 2 still processes |
| **CONS-06** Langfuse end-to-end + classify POSTs | `consumer-stage1.test.ts` Test 12 (X-Trace-Id), Tests 2/3/4-6/7 (every classify path); `consumer-stage2.test.ts` similar | Trace chained from queue's X-Trace-Id; success + error + conflict paths all wired |

## Locked Decisions Honored

| Decision | Where | Test |
|---|---|---|
| **D-process-layout** | `STAGE1_LIMIT=10`, `STAGE1_CONCURRENCY=10`, `STAGE2_LIMIT=2`, `STAGE2_CONCURRENCY=2` | Constants tests in both stage suites |
| **D-poll-cadence** | 5s items / 30s empty in `cancellableSleep` calls | stage1 Test 11, stage2 Test 9 |
| **D-error-path** | `safePostClassify` maps parse/exit/timeout to outcome:'error'; conflict + skip log + move on | stage1 Tests 4-8 |
| **D-no-cache-taxonomy** | `getTaxonomyInternal` called inside the per-batch try block, never cached | stage2 Test 4 |
| **D-claude-not-on-path-exit-1** | `assertClaudeOnPath()` precheck → consumer_bootstrap_fatal + exit(1) | bootstrap Test 3 |
| **D-langfuse-traces** | Per-item trace `consumer-stage{N}-item` with metadata.inbound_trace_id | stage1 Test 12 |
| **D-postClassify-no-retry-409** | `kind === 'conflict'` short-circuits with a Langfuse log; no retry | stage1 Test 7, stage2 Test 8 |

## Anti-Patterns Audited (07-CONTEXT.md)

| Anti-pattern | Audit |
|---|---|
| 1. File content as argv | N/A — Plan 07-02 doesn't touch claude.ts. 07-01's static-grep guards still hold. |
| 2. Clerk on internal taxonomy route | N/A — route shipped by 07-01, not modified here. |
| 3. Modify existing taxonomy/triage/rules/admin routes | None — `git diff HEAD~3 app/api/` is empty. |
| 4. Parallel queue/classify route | None — workers consume the existing 07-01 helpers. |
| 5. Stage 1 blocking on Stage 2 | Refuted by stage2 Test 10 + static grep `getTaxonomyInternal\|stage2\|Stage2` returning 0 in stage1.ts. |
| 6. Cache taxonomy across polls | Refuted by stage2 Test 4 — fresh fetch per non-empty batch. |
| 7. Store classification results locally | None — workers POST to /api/classify only. No fs writes. |
| 8. spawn-with-shell / DATABASE_URL in plist | Plist regex tests assert absence; 07-01 claude.ts static-grep still asserts no `shell: true`. |

## Decisions Made

| Decision | Rationale |
|---|---|
| Cancellable sleep via Promise + clearTimeout | Tests with `await worker.stop()` would otherwise block up to 30s waiting for the empty-cadence sleep. The cancellable sleep makes shutdown deterministic in tests AND production. |
| Stage 2 success payload normalises `axis.value ?? null` | Zod 4's `z.string().nullable()` infers as `string \| null \| undefined` in some contexts; the `ClassifyAxis` interface requires `string \| null`. The `?? null` is a defensive normalisation that costs nothing and unblocks the typed POST. |
| `process.on('uncaughtException')` wraps shutdown in `void (async ...)()` | Node's `'uncaughtException'` listener signature is `(err: Error) => void` (sync). An `async` function would create an unhandled rejection if the inner shutdown throws. The `void (async ...)()` form is the recommended pattern. |
| 21 bootstrap tests (not 6) | The plan listed 6 behaviour bullets + 11 plist assertions; I split the env-validation test into 4 (per-axis presence/absence) + 1 happy-path = 21 total. The plist assertions remain 11. |
| Plist test uses `path.resolve(__dirname, '..', 'launchd', '...')` | Robust to jest's cwd, which is the project root in our setup but might differ in future ci configs. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Initial Stage 1 / Stage 2 implementation hung in test cleanup**

- **Found during:** Task 1, first jest run on `consumer-stage1.test.ts`
- **Issue:** `runStage1Worker(...).stop()` would resolve only after the current `sleep(POLL_INTERVAL_EMPTY_MS)` completed — Tests 12, 13, and Constants timed out at 5s because the loop was inside a 30s sleep. Without fake timers (Test 13 is real-time), `await worker.stop()` blocked indefinitely from jest's perspective.
- **Fix:** Added a `cancellableSleep(ms)` helper inside both worker factories. It returns a Promise whose resolution function is captured in `wakeCurrentSleep`. `stop()` calls `wakeCurrentSleep()` after setting `stopped = true`, so the loop exits the current sleep within microseconds and the `while (!stopped)` check terminates.
- **Files modified:** `agent/src/consumer/stage1.ts`, `agent/src/consumer/stage2.ts`
- **Verification:** All 14 stage1 + 12 stage2 tests pass; total run is 9.5s (was timing out at >85s). The cancellable-sleep also makes real-world SIGTERM drain near-instant.
- **Committed in:** `3f0f44a` (Task 1) and `5d1dd78` (Task 2 inherited the same pattern)

**2. [Rule 1 - Bug] Stage 2 success payload TS overload mismatch on `axes` shape**

- **Found during:** Task 2, first jest run on `consumer-stage2.test.ts`
- **Issue:** Zod 4's inference of `z.string().nullable()` yielded `string | null | undefined` for the axis `value` field in some contexts, which is incompatible with the `ClassifyAxis` interface's `value: string | null` (non-undefined). Direct assignment `axes: outcome.value.axes` failed `TS2322`.
- **Fix:** Added a normalisation block in the Stage 2 happy path that re-constructs the axes object explicitly: `value: outcome.value.axes.X.value ?? null`. The `?? null` is defensive against Zod's `string | undefined` slip — it costs nothing semantically (Zod's `.nullable()` already permits null).
- **Files modified:** `agent/src/consumer/stage2.ts`
- **Verification:** `npx tsc -p agent/tsconfig.json --noEmit` exits 0; all 12 stage2 tests pass.
- **Committed in:** `5d1dd78` (Task 2 commit)

**3. [Rule 1 - Bug] Test 5 (SIGTERM) crashed the test process**

- **Found during:** Task 3, first jest run on `consumer-bootstrap.test.ts`
- **Issue:** The mocked `process.exit` threw `__exit_0__` from inside the async signal-handler chain. The `process.exit` call lives inside `void (async () => { ... finally { process.exit(code) } })()` — when exit threw, the rejection propagated out of the IIFE as an unhandled promise rejection and killed the jest worker before assertions could run.
- **Fix:** Mock `process.exit` to a no-op (`((_code) => undefined as never) as never`) instead of throwing. The test asserts `expect(exitSpy).toHaveBeenCalledWith(0)` directly. The async chain completes cleanly, all stop() / flushAsync / exit assertions run before teardown.
- **Files modified:** `agent/__tests__/consumer-bootstrap.test.ts`
- **Verification:** All 21 bootstrap tests pass; no unhandled rejection warnings.
- **Committed in:** `018ab0a` (Task 3 commit)

**4. [Rule 1 - Bug] Bootstrap tests installed real signal handlers that survived between tests**

- **Found during:** Task 3, after Test 5 fix
- **Issue:** Tests 4 and 6 (happy path) called `bootstrapConsumer(...)` which calls `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` against the real process. Jest's worker reused those handlers across tests, leading to "Jest did not exit one second after the test run has completed" warnings and risking cross-test pollution if a real signal arrived during teardown.
- **Fix:** Stub `process.on` in the happy-path describe block's `beforeEach` so the real handlers are never installed. The dedicated SIGTERM test (Test 5) re-spies `process.on` to capture the handler explicitly.
- **Files modified:** `agent/__tests__/consumer-bootstrap.test.ts`
- **Verification:** No "Jest did not exit" warning under `--detectOpenHandles`; all 21 tests still pass.
- **Committed in:** `018ab0a` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (1 Rule 3 blocking, 3 Rule 1 bugs). All resolved within the originating task. Zero scope creep — every fix served a stated invariant.
**Impact on plan:** None. All three task commits in plan order; final test counts match plan goals.

## Issues Encountered

**1. "Jest worker process failed to exit gracefully" warning on consumer-bootstrap.test.ts.** Surfaces under `npx jest agent/__tests__/`. The leak is from internal langfuse-mock timers that don't `.unref()` themselves — does NOT affect test results (47/47 consumer tests pass). Same warning was present in 07-01's `consumer-http-client.test.ts`. Force-exit gracefully resolves; no functional impact.

**2. Pre-existing `__tests__/triage-api.test.ts` failures.** Documented in 07-01-SUMMARY.md as the known baseline. Confirmed unchanged: still 1 failed suite / 290 passed tests across the full project. No regression.

**3. Root tsc error count.** Went from 525 → 556 (+31). All 31 added errors are inside `__tests__/taxonomy-internal-api.test.ts` (07-01 surface, NOT a 07-02 file). Verified by grepping the tsc output for "consumer" — zero matches. My new test files inherit the same pre-existing baseline (root tsconfig.json doesn't list `@types/jest` in compilerOptions.types) but compile cleanly under `tsconfig.test.json` which jest uses.

## Test Counts

| Suite | Tests |
|---|---|
| `agent/__tests__/consumer-stage1.test.ts` | 14 |
| `agent/__tests__/consumer-stage2.test.ts` | 12 |
| `agent/__tests__/consumer-bootstrap.test.ts` | 21 |
| **Plan total** | **47** |

Full project regression: **290 tests pass across 22 suites.** The 1 failing suite is the documented pre-existing `__tests__/triage-api.test.ts`. **Zero regression** vs Phase 5 / 6 / 7-01 baselines.

## User Setup Required

After plan-level commit, the operator needs to:

1. Edit `agent/launchd/com.cortex.consumer.plist` and replace `REPLACE_WITH_VERCEL_URL`, `REPLACE_WITH_API_KEY_FROM_VERCEL`, `REPLACE_WITH_LANGFUSE_PUBLIC_KEY`, `REPLACE_WITH_LANGFUSE_SECRET_KEY` with real values.
2. Verify `claude` CLI is installed and on PATH: `which claude` and `claude login` if needed.
3. `cp agent/launchd/com.cortex.consumer.plist ~/Library/LaunchAgents/com.cortex.consumer.plist`
4. `launchctl load ~/Library/LaunchAgents/com.cortex.consumer.plist`
5. Verify with `tail -f /tmp/cortex-consumer.log` — should see `[cortex-consumer] started (Stage 1 + Stage 2 pools running)`.

(Phase 8 acceptance test will exercise this loop end-to-end.)

## Next Phase Readiness

Phase 8 (operational acceptance) can now exercise:
- Daemon (Phase 6) running under `com.cortex.daemon.plist` posts metadata to `/api/ingest`.
- Vercel API (Phase 5) buffers items in pending_stage1.
- Consumer (this plan) under `com.cortex.consumer.plist` drains pending_stage1 → processing_stage1 → (decision) → pending_stage2 → processing_stage2 → certain/uncertain.
- Langfuse dashboard reconstructs ingest → claim → invokeClaude → classify chain via X-Trace-Id propagation.

## Threat Flags

None. The two new surfaces introduced by this plan are:
1. The consumer process — covered by the plan's `<threat_model>` (T-07-10..T-07-17) and tested via per-item isolation (T-07-11), redacted-stderr re-use from 07-01 (T-07-12), and 409 short-circuit (T-07-13).
2. The launchd plist — covered by T-07-15 (DATABASE_URL leak) which has a dedicated regex test in `consumer-bootstrap.test.ts`, plus tests asserting absence of API keys.

Both are new but enumerated in the plan's threat register; no NEW external surfaces emerged from implementation.

## Self-Check: PASSED

Files created (all confirmed present):
- `agent/src/consumer/stage1.ts` — FOUND
- `agent/src/consumer/stage2.ts` — FOUND
- `agent/src/consumer/index.ts` — FOUND
- `agent/launchd/com.cortex.consumer.plist` — FOUND
- `agent/__tests__/consumer-stage1.test.ts` — FOUND
- `agent/__tests__/consumer-stage2.test.ts` — FOUND
- `agent/__tests__/consumer-bootstrap.test.ts` — FOUND

Commits (all present in `git log --oneline`):
- `3f0f44a` — Task 1
- `5d1dd78` — Task 2
- `018ab0a` — Task 3

Verification:
- 47/47 Phase 7 Plan 2 tests pass
- 199/199 agent test suite passes (Phase 6 + 7-01 + 7-02)
- 290/290 full project tests pass (excluding the documented pre-existing triage-api.test.ts)
- `npx tsc -p agent/tsconfig.json --noEmit` exits 0
- `plutil -lint agent/launchd/com.cortex.consumer.plist` exits 0
- Stage 1 / Stage 2 cross-contamination grep: 0 matches each direction
- Plist DATABASE_URL / ANTHROPIC_API_KEY / OPENAI_API_KEY grep: 0 matches each
- `git diff HEAD~3 --name-only` (excluding pre-existing working tree changes): only consumer files + plist + 3 new tests

---
*Phase: 07-stage-1-2-consumers*
*Plan: 2 of 2*
*Completed: 2026-04-25*
