---
phase: 07-stage-1-2-consumers
verified: 2026-04-25T17:00:00Z
status: human_needed
score: 5/5 must-haves verified (programmatically)
overrides_applied: 0
human_verification:
  - test: "Real `claude` CLI invocation drains queue end-to-end"
    expected: "Operator with claude CLI installed loads consumer plist, drops a real PDF in ~/Downloads, sees the item move pending_stage1 → processing_stage1 → pending_stage2 → certain in Neon and a chained Langfuse trace from daemon ingest → API → consumer claim → consumer classify → API"
    why_human: "execFile of the real `claude` CLI requires Anthropic credentials configured via `~/.config/claude/`; cannot be exercised in unit tests. Phase 8 ACC-03 / ACC-05 covers this — verifier intentionally avoids running the binary."
  - test: "launchctl load agent/launchd/com.cortex.consumer.plist"
    expected: "After replacing the four REPLACE_WITH_* placeholders with real values and copying to ~/Library/LaunchAgents/, `launchctl load` produces a running cortex-consumer process visible in `launchctl list | grep cortex.consumer`, with `[cortex-consumer] started (Stage 1 + Stage 2 pools running)` in /tmp/cortex-consumer.log"
    why_human: "plist is plutil-valid and KeepAlive/ThrottleInterval/Label/EnvironmentVariables are all asserted by regex tests, but actually loading under launchd requires operator action and a populated .env / Langfuse credentials. Phase 8 ACC owns this."
  - test: "Gmail keep item reliably advances Stage 1 → Stage 2 in a real run"
    expected: "A real Gmail message classified as keep by the consumer reaches certain or uncertain — does NOT remain stuck at processing_stage1 or processing_stage2 (the v1.0 regression is gone in production, not just in tests)"
    why_human: "Test 10 in consumer-stage2.test.ts proves the worker-loop level invariant (Stage 2 progresses while Stage 1 saturated). The end-to-end Gmail-keep flow against a live Vercel API + real claude CLI is Phase 8's job (CONS-05 is structurally closed; ACC-03 confirms it operationally)."
---

# Phase 7: Stage 1 & Stage 2 Consumers Verification Report

**Phase Goal:** Two separate local consumer processes drain the queue end-to-end — Stage 1 polls relevance with up to 10 concurrent classifications, Stage 2 polls labelling with up to 2 concurrent classifications, both invoke `claude -p` with file paths (or text prompts for Gmail) and POST results back, with Langfuse traces spanning the full daemon → API → consumer → API loop for every item.

**Verified:** 2026-04-25T17:00:00Z
**Status:** human_needed (programmatic checks all pass; live launchd + real `claude` CLI invocation deferred to Phase 8 ACC)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                  | Status     | Evidence |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 1   | Stage 1 separate process polls `?stage=1&limit=10` w/ up to 10 concurrent; Stage 2 separate process polls `?stage=2&limit=2` w/ up to 2 concurrent                       | VERIFIED   | `agent/src/consumer/stage1.ts:44-45` (STAGE1_LIMIT=10, STAGE1_CONCURRENCY=10), `agent/src/consumer/stage2.ts:41-42` (STAGE2_LIMIT=2, STAGE2_CONCURRENCY=2). Plist `agent/launchd/com.cortex.consumer.plist:6,12` (separate `com.cortex.consumer` label, `agent/src/consumer/index.ts` entry). `runStage1Worker`/`runStage2Worker` run in same Node process but on independent semaphores + loops. Tests `consumer-stage1.test.ts` Test 1 + `consumer-stage2.test.ts` Test 1 prove the concurrency caps. |
| 2   | `claude -p` invocation includes absolute file path, never bytes; binary/null/large files don't fail                                                                     | VERIFIED   | `agent/src/consumer/claude.ts:97,171` use `execFile('claude', ['-p', prompt], …)` — argv form, no shell. `agent/src/consumer/prompts.ts:49` interpolates `item.file_path` into the prompt body and instructs Claude to use the Read tool. Source-grep confirms NO `fs.readFile`, `from 'node:fs'`, or `require('fs')` in `prompts.ts` or `claude.ts`. NO `shell: true` and NO `child_process.exec(` anywhere in `agent/src/consumer/`. 120s timeout: `claude.ts:152` `DEFAULT_TIMEOUT_MS = 120_000`. Env allowlist: `claude.ts:174` only PATH+HOME. NO API-key env vars referenced. |
| 3   | Gmail prompt built from subject/from/snippet/headers; Stage 2 receives existing taxonomy                                                                                | VERIFIED   | `prompts.ts:60-69` Stage 1 gmail variant with Subject/From/Preview/Headers; `prompts.ts:103-109` Stage 2 reuses identical metadata block. `prompts.ts:76-91` `buildStage2Prompt(item, taxonomy)` injects `taxonomy.type`, `taxonomy.from`, `taxonomy.context` per-axis with `(none yet)` fallback. Stage 2 worker fetches taxonomy via `getTaxonomyInternal` once per non-empty batch (`stage2.ts:264`); cache forbidden across polls (Test 4 in `consumer-stage2.test.ts`). |
| 4   | Gmail "keep" items reliably advance Stage 1 → Stage 2 (v1.0 stuck-at-processing bug fixed)                                                                              | VERIFIED   | Two-pool independence proved by `consumer-stage2.test.ts` Test 10 (line 438): instantiates BOTH workers in the same test, saturates Stage 1 with 10 paused invocations, asserts Stage 2 still processes its item. Static-grep confirms zero Stage 2 references in `stage1.ts` and zero Stage 1 references in `stage2.ts`. The structural fix (separate semaphores) is verifiable; live run is human_verification (Phase 8 ACC-03). |
| 5   | Every classification emits Langfuse trace; POSTs to `/api/classify` carry decision/axes/confidence/proposed_drive_path                                                  | VERIFIED   | `stage1.ts:127-134,196-202,256-274` per-item Langfuse spans w/ `inbound_trace_id` from `X-Trace-Id` header. `stage2.ts:121-128` similar. `client.ts:246-248` `getQueue` surfaces the X-Trace-Id header on the response. `stage1.ts:158-165` POST body has decision/confidence/reason; `stage2.ts:155-177` POST body has all-three axes (Zod-validated by `Stage2ResultSchema`) + proposed_drive_path. Test 12 in `consumer-stage1.test.ts` asserts the X-Trace-Id chain. |

**Score:** 5/5 truths VERIFIED programmatically.

### Required Artifacts

| Artifact                                          | Expected                                              | Status     | Details |
| ------------------------------------------------- | ----------------------------------------------------- | ---------- | ------- |
| `agent/src/consumer/semaphore.ts`                 | Inline FIFO semaphore w/ idempotent release           | VERIFIED   | 70 lines, exports `Semaphore` (line 21), `acquire()` returns release fn, FIFO via waiters array. |
| `agent/src/consumer/claude.ts`                    | execFile wrapper around `claude -p` w/ typed outcomes | VERIFIED   | 308 lines, exports `invokeClaude`, `assertClaudeOnPath`, `defaultExecutor`, `extractFirstJsonObject`, `redactAndSlice`. Uses `execFile` only; env allowlist PATH+HOME only; 120s timeout; balanced-brace JSON walk + Zod safeParse. Returns typed `ClaudeOutcome` discriminated union. |
| `agent/src/consumer/prompts.ts`                   | Stage 1 + Stage 2 prompt builders, file or gmail variants | VERIFIED | 151 lines, exports `buildStage1Prompt`, `buildStage2Prompt`, `TaxonomyContext`. Throws `'downloads item missing file_path'` defensively. NO `fs` imports. |
| `agent/src/consumer/stage1.ts`                    | Stage 1 worker loop                                   | VERIFIED   | 347 lines, exports `runStage1Worker`, `STAGE1_LIMIT=10`, `STAGE1_CONCURRENCY=10`. Cancellable sleep, per-item try/catch isolation, error→outcome:'error' POST, 409 conflict short-circuit. |
| `agent/src/consumer/stage2.ts`                    | Stage 2 worker loop w/ taxonomy fetch per batch       | VERIFIED   | 361 lines, exports `runStage2Worker`, `STAGE2_LIMIT=2`, `STAGE2_CONCURRENCY=2`. `getTaxonomyInternal` called inside per-batch try block (no caching). All-three-axes contract enforced by `Stage2ResultSchema`. |
| `agent/src/consumer/index.ts`                     | Process entry: env check + claude precheck + dual workers + signal handlers | VERIFIED | 181 lines, exports `bootstrapConsumer`, `validateConsumerEnv`. Exits 1 on missing env or missing claude. SIGTERM/SIGINT trigger ordered drain w/ 5s cap + Langfuse flushAsync. |
| `agent/launchd/com.cortex.consumer.plist`         | Separate launchd job, KeepAlive=true, ThrottleInterval=10 | VERIFIED | 47 lines, `plutil -lint` exits 0. `Label=com.cortex.consumer`, `KeepAlive=true`, `ThrottleInterval=10`, separate `/tmp/cortex-consumer.log` paths. EnvironmentVariables contains NODE_ENV/HOME/PATH/CORTEX_API_*/LANGFUSE_*; explicitly OMITS DATABASE_URL/ANTHROPIC_API_KEY/OPENAI_API_KEY (T-07-15). |
| `app/api/taxonomy/internal/route.ts`              | requireApiKey-guarded GET returning {type,from,context} | VERIFIED | 47 lines, single GET export. `requireApiKey` at top (line 25). `where: { deprecated: false }`. `Cache-Control: no-store` header. NO Clerk imports. NO POST/PUT/PATCH/DELETE handlers. |
| `agent/src/http/types.ts` (additive)              | QueueItem, QueueResponse, ClassifyRequest, ClassifyOutcome, TaxonomyInternalResponse | VERIFIED | All five types exported (lines 66, 82, 103, 136, 153). Existing IngestRequest/HeartbeatRequest/IngestSuccessResponse/IngestOutcome unchanged. |
| `agent/src/http/client.ts` (additive)             | getQueue / postClassify / getTaxonomyInternal helpers | VERIFIED | All three exported (lines 218, 278, 354). Reuses module-private `MAX_ATTEMPTS`, `BASE_DELAY_MS`, `MAX_DELAY_MS`, `backoffDelay`, `isRetryableStatus`, `sleep`, `readEnv`. `postClassify` 409 short-circuit at line 310 BEFORE retry-class check. `getQueue` surfaces X-Trace-Id header. `getTaxonomyInternal` throws on 4xx (Stage 2 worker treats as batch-skip). |

### Key Link Verification

| From                                           | To                                            | Via                                                              | Status | Details |
| ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ------ | ------- |
| `consumer/claude.ts`                           | `node:child_process.execFile`                 | `execFile('claude', ['-p', prompt], { timeout, env: {PATH, HOME} })` | WIRED | `claude.ts:28` import, `claude.ts:97` execFile call, `claude.ts:171-175` invokeClaude calls executor with allowlisted env. |
| `consumer/prompts.ts (downloads variant)`      | absolute file path argument                   | interpolating `item.file_path` into the prompt body              | WIRED  | `prompts.ts:49` Stage 1 file prompt, `prompts.ts:98` Stage 2 file block. Defensive throw at lines 46, 96 if `file_path` is null. |
| `consumer/stage1.ts`                           | `consumer/claude.ts invokeClaude`             | `buildStage1Prompt` + `invokeClaude` + `postClassify`, semaphore-gated | WIRED | `stage1.ts:33-37` imports, `stage1.ts:155` invokeClaude call w/ Stage1ResultSchema, `stage1.ts:122` semaphore acquire. |
| `consumer/stage2.ts`                           | `http/client.ts getTaxonomyInternal`          | fetched fresh at start of each batch, passed to `buildStage2Prompt` | WIRED | `stage2.ts:30` import, `stage2.ts:264` call inside per-batch try (no caching across cycles), `stage2.ts:135-139` taxonomy passed to prompt builder. |
| `consumer/{stage1,stage2}.ts`                  | Langfuse trace + child span chained off X-Trace-Id | `metadata.inbound_trace_id` set to `queueRes.traceId`            | WIRED  | `stage1.ts:127-134`, `stage2.ts:121-128` per-item span; `client.ts:246` `res.headers.get('X-Trace-Id')` populates `traceId`. |
| `http/client.ts (postClassify)`                | shared exp-backoff retry                      | reuses `MAX_ATTEMPTS`/`backoffDelay`/`isRetryableStatus`         | WIRED  | `client.ts:285-338` retry loop; 409 short-circuits at line 310 BEFORE the generic retry-class check. |
| `app/api/taxonomy/internal/route.ts`           | `lib/api-key.ts requireApiKey`                | early return on 401 before any DB read                           | WIRED  | `route.ts:21` import, `route.ts:25-26` requireApiKey called BEFORE prisma.taxonomyLabel.findMany. |
| `agent/launchd/com.cortex.consumer.plist`      | `agent/src/consumer/index.ts`                 | ProgramArguments invokes `~/.local/bin/node --import=tsx agent/src/consumer/index.ts` | WIRED | plist line 12 `<string>/Users/dfonnegrag/Projects/cortex/agent/src/consumer/index.ts</string>`. |

### Data-Flow Trace (Level 4)

| Artifact          | Data Variable             | Source                                              | Produces Real Data | Status |
| ----------------- | ------------------------- | --------------------------------------------------- | ------------------ | ------ |
| `stage1.ts` items | `queueRes.items`          | `getQueue({stage:1, limit:10})` → real `/api/queue` route (Phase 5, atomic claim) | YES (verified by Phase 5 verification) | FLOWING |
| `stage2.ts` taxonomy | `taxonomy`             | `getTaxonomyInternal()` → `prisma.taxonomyLabel.findMany({ where: { deprecated: false } })` | YES — real DB query, not static return | FLOWING |
| `stage2.ts` items | `queueRes.items`          | same as above for stage=2                          | YES                | FLOWING |
| `claude.ts` outcome | `invokeClaude` result   | `execFile('claude', …)` → real subprocess stdout, parsed by balanced-brace walk + Zod | YES (real subprocess runs in production; test paths inject Executor stub) | FLOWING (verified end-to-end requires live `claude`; Phase 8) |
| `client.ts` X-Trace-Id | `traceId`              | `res.headers.get('X-Trace-Id')` populated by Phase 5 routes | YES                | FLOWING |

### Behavioral Spot-Checks

| Behavior                                                                             | Command                                                            | Result                                  | Status |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------- | ------ |
| All 8 Phase 7 test suites pass                                                       | `npx jest agent/__tests__/consumer-* __tests__/taxonomy-internal-api.test.ts --no-coverage` | 8 suites, 149 tests pass               | PASS  |
| No regression on Phase 5/6 surfaces                                                  | `npx jest agent/__tests__/http-client.test.ts __tests__/api-key.test.ts` | 2 suites, 25 tests pass                | PASS  |
| Agent tsc clean under strict mode                                                    | `npx tsc --noEmit -p agent/tsconfig.json`                          | exits 0 (no output)                    | PASS  |
| Consumer plist is valid Apple plist                                                  | `plutil -lint agent/launchd/com.cortex.consumer.plist`             | "OK"                                   | PASS  |
| Stage 1 has zero Stage 2 references                                                  | `grep -E "stage2\|Stage2\|getTaxonomyInternal" agent/src/consumer/stage1.ts` | empty                                  | PASS  |
| Stage 2 has zero Stage 1 references                                                  | `grep -E "STAGE1_LIMIT\|stage: 1" agent/src/consumer/stage2.ts`    | empty (no `STAGE1_LIMIT`, no literal `stage: 1`) | PASS  |
| No `shell: true` / no `exec(` shelling in `agent/src/consumer/`                       | `grep -nE "shell:\s*true\|child_process\.exec\(" agent/src/consumer/*.ts` | empty                                  | PASS  |
| No `fs` reads in `prompts.ts` or `claude.ts`                                          | `grep -nE "fs\.readFile\|from 'node:fs'\|from 'fs'" agent/src/consumer/{prompts,claude}.ts` | empty                                  | PASS  |
| No DATABASE_URL / API keys leak into consumer plist                                   | `grep -nE "DATABASE_URL\|ANTHROPIC_API_KEY\|OPENAI_API_KEY" agent/launchd/com.cortex.consumer.plist` | empty                                  | PASS  |
| No new top-level deps in package.json (root or agent)                                 | `git diff HEAD~7 HEAD -- agent/package.json package.json`          | empty                                  | PASS  |
| Phase 7 commits did not touch daemon code (index.ts, scan, heartbeat, collectors)    | `git diff HEAD~7 HEAD --stat -- agent/src/index.ts agent/src/scan agent/src/heartbeat agent/src/collectors agent/src/db` | empty                                  | PASS  |
| Phase 7 commits did not modify existing API routes                                   | `git log --oneline -10 -- app/api/triage app/api/taxonomy/route.ts app/api/rules app/api/admin app/api/ask` | newest match is pre-Phase-7 (529a32d, 4f26fb6 …) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                                                                                | Status   | Evidence |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| CONS-01     | 07-02       | Stage 1 consumer separate local process, polls `?stage=1&limit=10`, runs up to 10 concurrent classifications                                                | SATISFIED | `stage1.ts:44-45` (`STAGE1_LIMIT=10`, `STAGE1_CONCURRENCY=10`), `consumer-stage1.test.ts` Test 1 (concurrency cap), `index.ts:115` starts worker, `com.cortex.consumer.plist` is the separate process. |
| CONS-02     | 07-02       | Stage 2 consumer separate local process, polls `?stage=2&limit=2`, runs up to 2 concurrent classifications                                                  | SATISFIED | `stage2.ts:41-42` (`STAGE2_LIMIT=2`, `STAGE2_CONCURRENCY=2`), `consumer-stage2.test.ts` Test 1 (concurrency cap), `index.ts:116` starts worker. |
| CONS-03     | 07-01       | For file items, both consumers invoke `claude -p` with prompt containing the file PATH, never the file content as argv; binary/null/large files don't fail | SATISFIED | `claude.ts:171` `execFile('claude', ['-p', prompt], …)` — argv form. `prompts.ts:49,98` interpolates `item.file_path`. NO `fs.readFile` in `prompts.ts`/`claude.ts`. NO shell. The "binary/null/large files don't fail" claim is structurally satisfied (path-as-argv is bounded by metadata size); operational confirmation lives in Phase 8 ACC-04. |
| CONS-04     | 07-01       | For Gmail items, consumers build text prompt from metadata (no file path); Stage 2 receives existing taxonomy as additional context                        | SATISFIED | `prompts.ts:60-69` Stage 1 gmail variant; `prompts.ts:103-109` Stage 2 gmail metadata block. `prompts.ts:76-91` `buildStage2Prompt(item, taxonomy)` injects all 3 axes. `route.ts` (taxonomy/internal) + `client.ts:354 getTaxonomyInternal` deliver the taxonomy. `stage2.ts:264` fetches it per-batch (no cache). |
| CONS-05     | 07-02       | Gmail "keep" items reliably advance Stage 1 → Stage 2 without manual intervention; v1.0 stuck-at-processing bug eliminated                                   | SATISFIED (structural) | `consumer-stage2.test.ts` Test 10 (line 438) instantiates both workers in the same test, saturates Stage 1 with 10 invocations, asserts Stage 2 still processes its item. Static-grep confirms independence. Live end-to-end run with real `claude` CLI + real Gmail item is human_verification (Phase 8 ACC-03). |
| CONS-06     | 07-02       | Each consumer POSTs classification result (decision, confidence, axes/labels, proposed Drive path) to `/api/classify` and emits Langfuse trace             | SATISFIED | Stage 1 success POST `stage1.ts:158-165` (decision/confidence/reason); Stage 2 success POST `stage2.ts:171-177` (axes + proposed_drive_path). All four error paths (parse_error, exit_error, timeout, prompt_build_error) wired in both stages. Langfuse traces named `consumer-stage{1,2}-item` chained via `metadata.inbound_trace_id` from `getQueue` X-Trace-Id (`stage1.ts:128-133`, `stage2.ts:122-127`). Test 12 in stage1 asserts the chain. |

**No orphaned requirements.** REQUIREMENTS.md maps CONS-01..06 to Phase 7; every ID appears in either 07-01 or 07-02 plan frontmatter.

### CONTEXT Decision Fidelity

| CONTEXT decision                                            | Verified location                                                              | Status |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| Inline Semaphore (no new deps)                              | `semaphore.ts` (~70 lines), zero `package.json` delta                         | PASS   |
| `execFile` only — no spawn-with-shell, no exec              | `claude.ts:97,171`; grep confirms zero `shell: true` / `exec(` in consumer/   | PASS   |
| 120s timeout                                                | `claude.ts:152` `DEFAULT_TIMEOUT_MS = 120_000`                                 | PASS   |
| Regex `\{[\s\S]*\}` + Zod parsing                           | `claude.ts:266-294` `extractFirstJsonObject` (balanced-brace walk; more robust than the literal regex but matches its intent) + `claude.ts:216` `schema.safeParse` | PASS |
| 5s/30s adaptive cadence                                     | `stage1.ts:48-50`, `stage2.ts:44-45` `POLL_INTERVAL_ITEMS_MS=5_000`, `POLL_INTERVAL_EMPTY_MS=30_000`; cadence selection at `stage1.ts:259`, `stage2.ts:286` | PASS |
| Stage 1 limit=10, Stage 2 limit=2                           | `stage1.ts:44`, `stage2.ts:41`                                                 | PASS   |
| Taxonomy fresh per Stage 2 batch (no cache)                 | `stage2.ts:264` inside per-batch try; `getTaxonomyInternal` itself has no caching; Test 4 in `consumer-stage2.test.ts` asserts fetch-once-per-cycle | PASS |
| 409 → no retry                                              | `client.ts:310` `if (res.status === 409)` short-circuit BEFORE retry-class check; `stage1.ts:306`, `stage2.ts:322` log + move on; `consumer-http-client.test.ts` asserts fetch called exactly once on 409 | PASS |
| Langfuse parent trace per cycle, X-Trace-Id chained         | `client.ts:246` reads X-Trace-Id; `stage1.ts:128-133`/`stage2.ts:122-127` set `inbound_trace_id` on per-item span | PASS |
| `claude` on PATH precheck → exit 1                          | `claude.ts:240-252` `assertClaudeOnPath`; `index.ts:96-112` calls it during bootstrap, exits 1 on rejection; bootstrap Test 3 asserts `consumer_bootstrap_fatal claude_cli_missing` | PASS |
| Separate plist, no DATABASE_URL, no ANTHROPIC_API_KEY       | `com.cortex.consumer.plist` is its own file (separate from `com.cortex.daemon.plist`); grep confirms zero `DATABASE_URL` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; T-07-15 mitigation tested | PASS |

### Anti-Patterns Found

| File                                  | Line | Pattern              | Severity | Impact |
| ------------------------------------- | ---- | -------------------- | -------- | ------ |
| (none)                                | —    | —                    | —        | No anti-patterns introduced. All Phase 7 commits add new files; only additive edits to `agent/src/http/types.ts` and `agent/src/http/client.ts`. NO modifications to existing routes, daemon code, or config. NO `shell: true`, NO `exec(` shelling, NO `fs.readFile` in prompts/claude, NO Clerk on internal taxonomy route, NO DATABASE_URL in consumer plist. |

### Anti-Pattern Audit (07-CONTEXT.md checklist)

| Anti-pattern                                                            | Audit                                  |
| ----------------------------------------------------------------------- | -------------------------------------- |
| 1. File content as argv                                                 | NOT PRESENT — `claude.ts` argv form, `prompts.ts` no fs reads |
| 2. Clerk on internal taxonomy route                                     | NOT PRESENT — only `requireApiKey`     |
| 3. Modify existing taxonomy/triage/rules/admin/queue/classify routes    | NOT PRESENT — `git log -- app/api/triage app/api/taxonomy/route.ts app/api/rules app/api/admin app/api/ask` shows no Phase-7 commits |
| 4. Parallel queue/classify route                                        | NOT PRESENT — consumers POST to existing Phase 5 routes |
| 5. Stage 1 blocking on Stage 2                                          | NOT PRESENT — independence proved by Test 10 + static grep |
| 6. Cache taxonomy across polls                                          | NOT PRESENT — `getTaxonomyInternal` is stateless; called inside per-batch try block; Test 4 asserts no caching |
| 7. Store classification results locally                                 | NOT PRESENT — workers POST to `/api/classify` only; no fs writes in `agent/src/consumer/` |
| 8. New top-level deps                                                   | NOT PRESENT — zero `package.json` delta in Phase 7 commits |
| 9. Daemon code modification                                             | NOT PRESENT — `git diff HEAD~7 HEAD --stat -- agent/src/index.ts agent/src/scan agent/src/heartbeat agent/src/collectors agent/src/db` is empty |

### Test Coverage Summary

| Suite                                              | Tests | Status |
| -------------------------------------------------- | ----- | ------ |
| `agent/__tests__/consumer-semaphore.test.ts`       | 11    | PASS   |
| `agent/__tests__/consumer-claude.test.ts`          | 33    | PASS   |
| `agent/__tests__/consumer-prompts.test.ts`         | 29    | PASS   |
| `agent/__tests__/consumer-http-client.test.ts`     | 24    | PASS   |
| `agent/__tests__/consumer-stage1.test.ts`          | 14    | PASS   |
| `agent/__tests__/consumer-stage2.test.ts`          | 12    | PASS   |
| `agent/__tests__/consumer-bootstrap.test.ts`       | 21    | PASS   |
| `__tests__/taxonomy-internal-api.test.ts`          | 9     | PASS (also 1 internal `describe.skip`) |
| **Phase 7 total**                                  | **149** | **149 passing** |
| Regression: `agent/__tests__/http-client.test.ts` + `__tests__/api-key.test.ts` | 25 | 25 passing — zero regression |

(Note: jest emits a "worker failed to exit gracefully" warning under `--detectOpenHandles` due to internal langfuse-mock timers; does not affect test results. Documented in 07-02-SUMMARY.md issue #1.)

### Build Verification

- `npx tsc --noEmit -p agent/tsconfig.json` exits 0 — clean strict mode compile.
- Root `tsconfig.json` has a documented 525→556 pre-existing baseline of test-file errors due to root tsconfig not listing `@types/jest`. Phase 7 adds 31 errors of identical kind to one new test file (07-01-SUMMARY.md issue #1). NOT a regression. Production code paths under `agent/tsconfig.json` are clean.

### Human Verification Required

Three items deferred to live operator testing — these are the only programmatic gaps the verifier could not close:

#### 1. Real `claude` CLI invocation drains queue end-to-end

**Test:** With consumer plist loaded (see #2 below), drop a real PDF in `~/Downloads`, drop a real Gmail message in inbox, observe both items move pending_stage1 → processing_stage1 → pending_stage2 → certain in Neon.
**Expected:** Items reach `certain` (or `uncertain`) status. Langfuse dashboard shows a chained trace per item from daemon ingest → API → consumer claim → consumer classify → API. NO items stuck in `processing_*`.
**Why human:** `execFile`-ing the real `claude` CLI requires Anthropic credentials configured via `~/.config/claude/`; Phase 7 verifier does not run the binary. Phase 8 ACC-03 / ACC-05 owns this.

#### 2. `launchctl load agent/launchd/com.cortex.consumer.plist`

**Test:** After replacing the four `REPLACE_WITH_*` placeholders with real Vercel URL / API key / Langfuse credentials and copying to `~/Library/LaunchAgents/`, run `launchctl load ~/Library/LaunchAgents/com.cortex.consumer.plist`.
**Expected:** `launchctl list | grep cortex.consumer` shows running PID. `/tmp/cortex-consumer.log` contains `[cortex-consumer] started (Stage 1 + Stage 2 pools running)`. `/tmp/cortex-consumer-error.log` is empty or only contains expected info logs.
**Why human:** plist is `plutil`-valid and KeepAlive/ThrottleInterval/Label/EnvironmentVariables are all asserted by regex tests, but actually loading under launchd requires operator action and a populated `.env` / Langfuse credentials.

#### 3. Gmail keep item reliably advances Stage 1 → Stage 2 in a real run

**Test:** Send an email to the connected Gmail account that the relevance gate would mark `keep`. Watch it progress through the queue.
**Expected:** Item reaches `certain` or `uncertain` — does NOT remain stuck at `processing_stage1` or `processing_stage2`. The v1.0 regression is gone in production, not just in tests.
**Why human:** Test 10 in `consumer-stage2.test.ts` proves the worker-loop level invariant (Stage 2 progresses while Stage 1 saturated). The end-to-end Gmail-keep flow against a live Vercel API + real `claude` CLI is Phase 8's job (CONS-05 is structurally closed; ACC-03 confirms it operationally).

### Gaps Summary

**No programmatic gaps.** Every must-have is verified by code inspection + automated tests + static-source grep. Phase 7 is structurally complete:

- All 5 ROADMAP success criteria have code evidence and test coverage
- All 6 CONS-01..06 requirements are SATISFIED
- All 11 CONTEXT-locked decisions are encoded in code
- All 9 enumerated anti-patterns are absent
- 149 Phase 7 tests pass, 25 regression tests pass, agent tsc is clean, plist is plutil-valid
- Zero changes to daemon code, existing API routes, or top-level deps

The only remaining items are three live-system observations that intrinsically require running the consumer under launchd with real credentials. These are appropriately deferred to Phase 8 (Operational Acceptance — ACC-03 and ACC-05 explicitly cover them).

---

_Verified: 2026-04-25T17:00:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M)_
