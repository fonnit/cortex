---
phase: 06-daemon-thin-client
plan: 01
subsystem: agent/http + app/api/ingest
tags: [daemon, http-client, buffer, heartbeat, langfuse, fetch, retry]
requires:
  - Phase 5 `/api/ingest` route (exists)
  - `lib/api-key.ts` shared-secret helper (exists)
  - Node 22 LTS native fetch (no new runtime deps)
provides:
  - postIngest / postHeartbeat client functions
  - IngestBuffer FIFO class
  - Heartbeat 204 short-circuit on POST /api/ingest
  - Langfuse warning traces: http_client_terminal_skip, buffer_overflow, buffer_drain_error
affects:
  - app/api/ingest/route.ts (heartbeat extension only — non-heartbeat paths unchanged)
tech-stack:
  added: []  # zero new runtime deps
  patterns:
    - exponential backoff with cap (1s base, 30s cap, 5 attempts)
    - retry-class split (5xx + 429 retry; 4xx never retry)
    - terminal-skip outcome (no throw into the daemon main loop)
    - dependency-injected langfuse + postIngest (keeps unit tests pure)
key-files:
  created:
    - agent/src/http/types.ts (53 lines)
    - agent/src/http/client.ts (184 lines)
    - agent/src/http/buffer.ts (119 lines)
    - agent/__tests__/http-client.test.ts (237 lines, 13 tests)
    - agent/__tests__/http-buffer.test.ts (210 lines, 9 tests)
  modified:
    - app/api/ingest/route.ts (+63 / -24 — heartbeat schema + short-circuit + lazy trace)
    - __tests__/ingest-api.test.ts (+44 / -7 — 3 new heartbeat tests)
decisions:
  - Heartbeat schema extension via `.refine()` (not parallel route file)
  - Lazy Langfuse trace creation — heartbeat path never opens a span
  - Buffer accepts postIngest by DI — buffer never imports the real client module
  - Skip outcomes from client are treated as drained (client owns its own telemetry)
  - No `.js` import suffixes in new agent/src/http files (extensionless; ts/jest happy)
metrics:
  duration_seconds: 470
  duration_human: 7m50s
  completed_at: 2026-04-25T12:28:08Z
  tasks_total: 3
  tasks_completed: 3
  tests_added: 25  # 3 heartbeat + 13 client + 9 buffer
  tests_passing: 105  # full Phase 5 + 6-01 regression
  commits:
    - 5a3b420 feat(06-01): heartbeat short-circuit on POST /api/ingest
    - 3e3ed5a feat(06-01): daemon HTTP client (fetch + retry + auth + terminal-skip)
    - 806c16d feat(06-01): in-memory FIFO buffer with overflow-drop-oldest telemetry
---

# Phase 6 Plan 1: Daemon Thin Client (HTTP foundation) Summary

Built the daemon's HTTP plumbing — a native-fetch client with auth + retry + terminal-skip semantics, an in-memory FIFO buffer with overflow-drop-oldest telemetry, and a `heartbeat: true` short-circuit on `POST /api/ingest` returning 204. Plan 02 will wire collectors and the main loop on top of this foundation.

## What Shipped

### Task 1 — Heartbeat short-circuit on `/api/ingest`

The existing route now accepts a heartbeat probe shape that's mutually exclusive with the standard ingest shape:

```ts
const IngestBodySchema = z
  .object({
    source: z.enum(['downloads', 'gmail']).optional(),
    content_hash: z.string().min(1).optional(),
    filename: z.string().optional(),
    mime_type: z.string().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    source_metadata: z.record(z.string(), z.unknown()).optional(),
    file_path: z.string().optional(),
    heartbeat: z.literal(true).optional(),
  })
  .refine(
    (b) => b.heartbeat === true || (b.source !== undefined && b.content_hash !== undefined),
    { message: 'source and content_hash are required when heartbeat is not set' },
  )
```

The `.refine()` keeps the existing 400 validation behaviour for non-heartbeat bodies (Tests 3/4/5 in `ingest-api.test.ts` still produce `validation_failed`). Auth still gates the heartbeat path (Test 12 — missing Bearer returns 401).

The short-circuit branch lives between Zod validation and dedup-check:

```ts
if (parsed.data.heartbeat === true) {
  return new Response(null, { status: 204 })
}
```

Critically, **Langfuse trace creation is now lazy**. The previous code called `lf.trace({ name: 'api-ingest' })` unconditionally at the top of the handler — that would have flooded Langfuse on every 60s heartbeat. Trace creation moved into an `ensureTrace()` helper that only fires after we know the body isn't a heartbeat ping. Test 11 asserts `__langfuseTraceMock.span` was never invoked on the heartbeat path.

### Task 2 — `agent/src/http/client.ts` (postIngest + postHeartbeat)

Native fetch-based client with these locked constants:

```ts
const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
```

Retry classifier:

| Outcome | Retry? |
|---|---|
| 2xx | No (return success) |
| 4xx (except 429) | **No** — return `{ kind: 'skip', reason: 'client_error', status }` |
| 429 | Yes |
| 5xx | Yes |
| network / TypeError 'fetch failed' | Yes |

After `MAX_ATTEMPTS` exhausted retries:

```ts
opts.langfuse.trace({
  name: 'http_client_terminal_skip',
  metadata: {
    content_hash, source, attempts: 5, last_status, last_error,
  },
})
return { kind: 'skip', reason: 'retries_exhausted', status, error }
```

The client **never throws** into the daemon main loop on transport errors. The only throw paths are misconfiguration (missing `CORTEX_API_KEY` / `CORTEX_API_URL`) — that's a fail-fast bootstrap bug, mirrors the server-side `requireApiKey` posture.

### Task 3 — `agent/src/http/buffer.ts` (IngestBuffer FIFO)

```ts
export const BUFFER_CAP = 100

class IngestBuffer {
  enqueue(payload: IngestRequest): void
  size(): number
  async drain(): Promise<void>  // sequential, concurrency = 1
}
```

On overflow:

```ts
this.deps.langfuse.trace({
  name: 'buffer_overflow',
  metadata: {
    buffer_size: 100,
    dropped_content_hash: dropped.payload.content_hash,
    dropped_age_seconds: Math.floor((now() - enqueued_at_ms) / 1000),
  },
})
```

DI surface: `{ postIngest, langfuse, now? }` — the buffer never imports the real client module. Tests inject a `jest.fn()` postIngest stub and a `{ trace: jest.fn() }` langfuse stub.

## Retry Sequence (Test 10 observed)

Backoff delays observed across 5 retryable failures (4 sleeps between 5 attempts):

```
attempt 1 → fail → sleep 1000 ms
attempt 2 → fail → sleep 2000 ms
attempt 3 → fail → sleep 4000 ms
attempt 4 → fail → sleep 8000 ms
attempt 5 → fail → terminal skip
```

All delays are bounded by `MAX_DELAY_MS = 30_000`. The 5th attempt would trigger a `16000 ms` sleep if it failed before the 6th, but `MAX_ATTEMPTS = 5` means we exhaust before that sleep is scheduled — verified by `setTimeoutSpy.mock.calls.length >= 4`.

## Test Counts

| Suite | Plan-required | Bonus | Total |
|---|---|---|---|
| `__tests__/ingest-api.test.ts` | 12 (9 pre-existing + 3 new heartbeat) | 0 | 12 |
| `agent/__tests__/http-client.test.ts` | 12 | 1 (heartbeat ack) | 13 |
| `agent/__tests__/http-buffer.test.ts` | 8 | 1 (BUFFER_CAP constant) | 9 |
| **Plan total** | **32** | **2** | **34** |

Full regression (Phase 5 + 6-01): **105 tests across 10 suites, all passing.**

```
$ npx jest __tests__/api-key.test.ts __tests__/queue-config.test.ts \
  __tests__/queue-sql.test.ts __tests__/ingest-api.test.ts \
  __tests__/classify-api.test.ts __tests__/queue-api.test.ts \
  __tests__/queue-api-integration.test.ts \
  __tests__/queue-claim-sql.integration.test.ts agent/__tests__/
Test Suites: 10 passed, 10 total
Tests:       105 passed, 105 total
```

## Type-check

```
$ npx tsc --noEmit -p agent/tsconfig.json
TypeScript compilation completed
```

Zero errors in the new `agent/src/http/*` files.

## Deviations from Plan

None for Tasks 1, 2, 3. Three minor execution refinements documented for Plan 02 awareness:

**1. [Refinement] Trace creation is now lazy in `app/api/ingest/route.ts`.**
The plan said "AFTER `parsed.success` validation passes, but BEFORE the `trace.span({ name: 'dedup-check' })` call, add the heartbeat short-circuit." The literal reading would still call `lf.trace({ name: 'api-ingest' })` at the top of the handler — that'd flood Langfuse with one trace per 60s heartbeat. Fixed by moving trace creation into an `ensureTrace()` helper that fires only on non-heartbeat paths (and on the catch / 400 paths so X-Trace-Id stays populated for those). Test 11 explicitly asserts `__langfuseTraceMock.span` is never called on the heartbeat path.

**2. [Refinement] Imports use no `.js` suffix in `agent/src/http/{client,buffer}.ts`.**
The agent's other source files (`agent/src/index.ts`) use `.js` import suffixes for ESM-runtime compatibility. The new HTTP files use extensionless imports because ts-jest's `moduleResolution: node` (from `tsconfig.test.json`) doesn't strip `.js` and would fail to resolve. The agent's own `tsconfig.json` uses `moduleResolution: bundler` which accepts both. This means the new files cannot be directly executed under raw Node ESM yet — Plan 02's wiring will either: (a) keep extensionless imports and rely on `tsc` output, or (b) add `.js` suffixes if direct ESM execution becomes a constraint, paired with a `moduleNameMapper` in jest config.

**3. [Refinement] Test 10 (backoff) uses `setTimeout` spy instead of wall-clock measurement.**
The plan suggested asserting "5 attempts complete in approximately the expected window via `jest.advanceTimersByTime`". With fake timers fully active, asserting wall-clock duration is not meaningful. The implemented test spies on `setTimeout`, captures the delay arguments, and asserts both the exact sequence (1000, 2000, 4000, 8000) and the cap invariant (every delay ≤ 30000). This is a stricter assertion of the same property.

## Known Stubs

None. Every code path in the new files is wired to its real production target (Langfuse, fetch, postIngest). Plan 02 will wire the buffer + client into the daemon main loop and collectors.

## Threat Flags

None. The new client tightens the daemon's auth surface — every fetch call carries `Authorization: Bearer ${CORTEX_API_KEY}` and the daemon now fails-fast on missing credentials. The route extension only adds a 204-no-op path that is auth-gated identically to existing requests.

## Self-Check: PASSED

Files created (all confirmed present):
- `agent/src/http/types.ts` — FOUND
- `agent/src/http/client.ts` — FOUND
- `agent/src/http/buffer.ts` — FOUND
- `agent/__tests__/http-client.test.ts` — FOUND
- `agent/__tests__/http-buffer.test.ts` — FOUND

Files modified (additive, confirmed via diff):
- `app/api/ingest/route.ts` — heartbeat schema + lazy trace + 204 short-circuit
- `__tests__/ingest-api.test.ts` — 3 new tests (10/11/12)

Commits (all present in `git log`):
- `5a3b420` — Task 1
- `3e3ed5a` — Task 2
- `806c16d` — Task 3

Plan-level verification:
- 105/105 tests passing across 10 suites
- `npx tsc --noEmit -p agent/tsconfig.json` → clean
- No parallel `app/api/ingest/heartbeat/` route file
- No new runtime deps in `agent/package.json`
