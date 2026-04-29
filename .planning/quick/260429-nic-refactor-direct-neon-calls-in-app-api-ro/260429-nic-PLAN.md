---
phase: quick-260429-nic
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/api/queue/route.ts
  - app/api/ask/route.ts
  - app/api/cron/embed/route.ts
  - __tests__/queue-api.test.ts
autonomous: true
requirements:
  - NIC-01  # Replace neon() with prisma.$queryRaw in app/api/queue/route.ts (atomic claim, stale reclaim, legacy reclaim)
  - NIC-02  # Replace neon() with prisma.$queryRaw in app/api/ask/route.ts (halfvec ANN search)
  - NIC-03  # Replace neon() with prisma.$queryRaw in app/api/cron/embed/route.ts (halfvec writes)
  - NIC-04  # Audit confirms zero remaining neon() function calls in app code (only neonConfig in lib/prisma.ts)
  - NIC-05  # Existing test regression net stays green: queue-api.test.ts (unit), queue-api-integration.test.ts (pg-mem), api-key.test.ts (smoke)

must_haves:
  truths:
    - "GET /api/queue against a vanilla Postgres on localhost:5433 succeeds (no 500 from missing neon WS protocol)"
    - "POST /api/ask against a vanilla Postgres returns ANN results via prisma.$queryRaw (halfvec literal works)"
    - "POST /api/cron/embed writes halfvec embeddings via prisma.$queryRaw"
    - "QUE-02 invariant preserved: parallel /api/queue callers never receive the same Item id (atomic UPDATE…WHERE IN…FOR UPDATE SKIP LOCKED)"
    - "X-Trace-Id header still set on every queue response, preserving Langfuse correlation"
    - "No file in app/ or lib/ (excluding lib/prisma.ts) imports neon (the function) from @neondatabase/serverless"
  artifacts:
    - path: "app/api/queue/route.ts"
      provides: "Queue read/claim endpoint backed by prisma.$queryRaw"
      contains: "prisma.$queryRaw"
      forbidden_contains: "neon(process.env.DATABASE_URL"
    - path: "app/api/ask/route.ts"
      provides: "Ask synthesis endpoint backed by prisma.$queryRaw for ANN retrieval"
      contains: "prisma.$queryRaw"
      forbidden_contains: "neon(process.env.DATABASE_URL"
    - path: "app/api/cron/embed/route.ts"
      provides: "Embed cron endpoint backed by prisma.$queryRaw for halfvec writes"
      contains: "prisma.$queryRaw"
      forbidden_contains: "neon(process.env.DATABASE_URL"
    - path: "__tests__/queue-api.test.ts"
      provides: "Updated unit-test mock surface targeting @/lib/prisma instead of @neondatabase/serverless"
      contains: "jest.mock('../lib/prisma'"
    - path: "lib/queue-sql.ts"
      provides: "buildClaimParams helper (unchanged)"
    - path: "lib/prisma.ts"
      provides: "Adapter routing (unchanged); still imports neonConfig (NOT neon function) for WS configuration"
  key_links:
    - from: "app/api/queue/route.ts"
      to: "lib/prisma"
      via: "import { prisma } from '@/lib/prisma'"
      pattern: "import \\{ prisma \\} from '@/lib/prisma'"
    - from: "app/api/queue/route.ts"
      to: "Postgres (any URL)"
      via: "prisma.$queryRaw on adapter (PrismaNeon for Neon URL, PrismaPg for vanilla)"
      pattern: "prisma\\.\\$queryRaw"
    - from: "__tests__/queue-api.test.ts"
      to: "@/lib/prisma"
      via: "jest.mock('../lib/prisma', ...) replacing prior jest.mock('@neondatabase/serverless', ...)"
      pattern: "jest\\.mock\\(['\"]\\.\\./lib/prisma['\"]"
    - from: "__tests__/queue-api-integration.test.ts"
      to: "_atomicClaimSqlForTest / _staleReclaimSqlForTest / _legacyReclaimSqlForTest exports"
      via: "named imports from app/api/queue/route (UNCHANGED — exports must remain)"
      pattern: "_atomicClaimSqlForTest|_staleReclaimSqlForTest|_legacyReclaimSqlForTest"
---

<objective>
Replace direct `neon()` tagged-template calls in three API routes with `prisma.$queryRaw` so the whole web app runs against any Postgres URL — Neon WS in production via `lib/prisma`'s `PrismaNeon` adapter, vanilla `pg` locally via the `PrismaPg` adapter conditional already merged in 0097354.

Purpose: Unblock end-to-end testability against the local docker-compose Postgres on `localhost:5433`. Currently `/api/queue`, `/api/ask`, and `/api/cron/embed` 500 against vanilla Postgres because `neon()` requires the Neon WS wire protocol. After this refactor, the same routes exercise the adapter selected by URL pattern in `lib/prisma.ts`, so local dev and prod both work without code changes.

Output: Three routes using `prisma.$queryRaw` (typed where the prior `neon()` call was implicitly `unknown[]`-cast). Updated `queue-api.test.ts` mock surface (the route no longer imports `neon`, so its mock target moves to `@/lib/prisma`). The `_*ForTest` exports on `app/api/queue/route.ts` remain — they are the regression net for the SQL itself via pg-mem.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@lib/prisma.ts
@lib/queue-sql.ts
@app/api/queue/route.ts
@app/api/ask/route.ts
@app/api/cron/embed/route.ts
@__tests__/queue-api.test.ts
@__tests__/queue-api-integration.test.ts

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From lib/prisma.ts (current, unchanged by this plan):
```typescript
// Conditional adapter routing — already correct after commit 0097354.
// neonConfig.webSocketConstructor = ws stays.
// PrismaNeon for *.neon.tech / pooler URLs, PrismaPg for everything else (incl. localhost:5433).
export const prisma: PrismaClient
```

From @prisma/client (relevant API surface):
```typescript
// Tagged-template form — drop-in replacement for neon()'s tagged-template.
// Same ${} parameter binding semantics. Returns Promise<T[]>.
prisma.$queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>
// Do NOT use $queryRawUnsafe — that takes a string and breaks parameterization.
```

From app/api/queue/route.ts (existing exports — MUST stay exported):
```typescript
// Used by __tests__/queue-api-integration.test.ts (pg-mem path).
// These return positional-param SQL strings that mirror the route's tagged-template SQL.
// If the route's SQL changes, update these helpers in lockstep — the integration test will catch drift.
export function _atomicClaimSqlForTest(stage: 1 | 2, limit: number, nowIso: string): { text: string; values: unknown[] }
export function _staleReclaimSqlForTest(stage: 1 | 2, cutoffIso: string): { text: string; values: unknown[] }
export function _legacyReclaimSqlForTest(cutoffIso: string): { text: string; values: unknown[] }
```

From lib/queue-sql.ts (unchanged):
```typescript
export function buildClaimParams(stage: 1 | 2, limit: number): {
  pendingStatus: string; processingStatus: string; stageKey: 'stage1'|'stage2';
  limit: number; nowIso: string; stage: 1 | 2
}
```

ItemRow type used by /api/queue (defined inline in route.ts, keep the same shape):
```typescript
type ItemRow = {
  id: string
  source: string
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  content_hash: string
  source_metadata: Record<string, unknown> | null
}
```
</interfaces>

<refactor_recipe>
For each route, the surgery is mechanical:

1. Delete `import { neon } from '@neondatabase/serverless'`
2. Add `import { prisma } from '@/lib/prisma'` (if not already present)
3. Delete `const sql = neon(process.env.DATABASE_URL!)`
4. Each `await sql\`...\`` → `await prisma.$queryRaw<RowType[]>\`...\`` (template body unchanged — same `${}` interpolation)
5. Type the row shape on the generic so downstream code keeps its current narrowing (replaces the implicit `unknown[]` cast)

What does NOT change:
- The SQL string body (every `${}` placeholder, every cast like `::halfvec`, `::timestamptz`, `::jsonb` survives verbatim)
- Langfuse trace/span calls (independent of SQL driver)
- try/catch error shape (Prisma errors land in the same catch and produce the same 500)
- Auth checks (requireApiKey / requireAuth / CRON_SECRET)
- Response shape (`Response.json(...)`, X-Trace-Id headers)
- The `_*ForTest` exports on the queue route — they keep using positional SQL for pg-mem
</refactor_recipe>

<halfvec_note>
The halfvec literal pattern works identically through both drivers because `${}` becomes a positional parameter and Postgres applies the cast:

ask route — current and post-refactor both work the same way:
```ts
const vecStr = `[${queryVec.join(',')}]`         // string
... ORDER BY embedding <#> ${vecStr}::halfvec    // $1::halfvec, Postgres casts
```

cron/embed route — same pattern:
```ts
SET embedding = ${`[${vector.join(',')}]`}::halfvec
```
No special casting code needed. The adapter passes the string through; Postgres parses it as a halfvec literal.
</halfvec_note>

<test_mock_change_rationale>
`__tests__/queue-api.test.ts` currently does:
```ts
jest.mock('@neondatabase/serverless', () => ({ neon: jest.fn() }))
const mockNeon = neon as jest.MockedFunction<typeof neon>
// ... mockNeon.mockReturnValue(fn)  where fn is a fake tagged-template
```

After the refactor, the route never imports `neon` from `@neondatabase/serverless` — `lib/prisma.ts` still imports `neonConfig` (NOT the same as `neon`), so mocking the package is the wrong surface. The new mock target is `@/lib/prisma` (resolving to `../lib/prisma` from `__tests__/`), exposing a `prisma` object whose `$queryRaw` is a jest fn that records tagged-template calls.

This is NOT writing new tests — it's preserving the EXISTING 13 test cases by relocating their mock target. The assertions on call ordering, parameter values, response shape, and error handling all stay; only the mock surface and the call-recording helper change.
</test_mock_change_rationale>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Refactor /api/queue route and migrate its unit-test mock surface to @/lib/prisma</name>
  <files>app/api/queue/route.ts, __tests__/queue-api.test.ts</files>
  <behavior>
    - The 13 existing test cases in `__tests__/queue-api.test.ts` continue to pass after relocating the mock from `@neondatabase/serverless` to `@/lib/prisma`.
    - `__tests__/queue-api-integration.test.ts` (pg-mem against `_*ForTest` helper exports) continues to pass without modification — the route's `_atomicClaimSqlForTest`, `_staleReclaimSqlForTest`, `_legacyReclaimSqlForTest` exports remain identical.
    - Test 1/2: 401 when auth missing or wrong; `prisma.$queryRaw` never called on auth fail.
    - Test 3/4/5: 400 validation_failed for bad stage / bad limit / limit > 100.
    - Test 6: stage=1 limit=10 issues exactly 3 SQL calls (stale, legacy, claim) with correct parameter values, returns `{ items, reclaimed }` with file_path hoisting.
    - Test 7: stage=2 parameterizes `pending_stage2` / `processing_stage2` / `stage2` correctly.
    - Test 9: call ordering is stale → legacy → claim.
    - Test 10: reclaimed = stale_count + legacy_count.
    - Test 11: X-Trace-Id header is set on every response.
    - Test 12: when `prisma.$queryRaw` rejects, route returns 500 with X-Trace-Id and console.error logged.
    - Test 13: zero claimed rows returns 200 with `{ items: [], reclaimed: 0 }`.
  </behavior>
  <action>
**Step A — Refactor `app/api/queue/route.ts`:**

1. Replace `import { neon } from '@neondatabase/serverless'` with `import { prisma } from '@/lib/prisma'`.
2. Delete the line `const sql = neon(process.env.DATABASE_URL!)` (line 80).
3. For each of the three SQL blocks (stale reclaim ~lines 88-97, legacy reclaim ~lines 104-113, atomic claim ~lines 121-143):
   - Replace `await sql\`...\`` with `await prisma.$queryRaw<RowType[]>\`...\``.
   - The template body is identical — every `${}` interpolation, every `::timestamptz`, `::text`, `::jsonb` cast, every `ARRAY[...]` constructor, every `FOR UPDATE SKIP LOCKED` survives verbatim.
   - Row types:
     - stale reclaim: `{ id: string }[]`
     - legacy reclaim: `{ id: string }[]`
     - atomic claim: `ItemRow[]` (the existing inline type, lines 37-45)
4. With typed generics, the existing `(claimedRows as ItemRow[])` cast on line 146 is now redundant — keep it OR remove it; either is fine. Recommend removing it since the generic provides the type.
5. The `_atomicClaimSqlForTest`, `_staleReclaimSqlForTest`, `_legacyReclaimSqlForTest` exports (lines 196-278) MUST remain unchanged — they are consumed by the pg-mem integration test and use positional-param SQL strings that exist precisely because the tagged-template form cannot be string-built. Update the leading comment block (lines 182-194) to explain the new context: "the route handler now uses `prisma.$queryRaw` for production paths; these helpers retain positional-param SQL because pg-mem's pg-Client adapter takes positional params, not Prisma's tagged-template form."
6. Update the comment in `lib/queue-sql.ts` only if it directly contradicts the new code — the example block in lines 22-46 references `neon()` but is documentation for callers; either leave as-is (it's still accurate for the helper's design intent) or update the example to show the prisma.$queryRaw form. Planner's note: leaving as-is is fine; do not touch lib/queue-sql.ts in this plan to keep the diff focused on the four files declared in `files_modified`.

**Step B — Migrate `__tests__/queue-api.test.ts` mock to `@/lib/prisma`:**

1. Replace the top-level `jest.mock('@neondatabase/serverless', ...)` (lines 18-20) with:
   ```ts
   jest.mock('../lib/prisma', () => ({
     prisma: {
       $queryRaw: jest.fn(),
     },
   }))
   ```
2. Replace `import { neon } from '@neondatabase/serverless'` (line 38) with `import { prisma } from '../lib/prisma'`.
3. Replace `const mockNeon = neon as jest.MockedFunction<typeof neon>` (line 40) with `const mockQueryRaw = prisma.$queryRaw as jest.MockedFunction<typeof prisma.$queryRaw>`.
4. Adapt `makeSqlMock` (lines 46-59): instead of returning a single `fn` that's set as the return value of `neon()`, return a fake `$queryRaw` implementation that pulls the next response from the queue on each call. The `calls` recorder still captures `text` (reconstructed from `strings`) and `values`. Reuse the same string-reconstruction logic — `prisma.$queryRaw` receives `(strings: TemplateStringsArray, ...values: unknown[])` exactly like neon's bound function. Pseudocode:
   ```ts
   function makeSqlMock(responses: Array<Array<Record<string, unknown>>>) {
     let i = 0
     const calls: Array<{ text: string; values: unknown[] }> = []
     const impl = (strings: TemplateStringsArray, ...values: unknown[]) => {
       const text = strings.reduce((acc, str, idx) => acc + str + (idx < values.length ? `$${idx + 1}` : ''), '')
       calls.push({ text, values })
       return Promise.resolve(responses[i++] ?? [])
     }
     return { impl, calls }
   }
   ```
5. Update each test:
   - `mockNeon.mockReturnValue(fn)` becomes `mockQueryRaw.mockImplementation(impl as any)` (the `as any` is fine — Prisma's overloaded `$queryRaw` signature is awkward to satisfy with a plain mock; the test only needs the runtime call signature).
   - `expect(mockNeon).not.toHaveBeenCalled()` becomes `expect(mockQueryRaw).not.toHaveBeenCalled()`.
   - Test 12's `() => Promise.reject(new Error('db connection lost'))` is now wired via `mockQueryRaw.mockImplementation(() => Promise.reject(...))` — the route's catch produces the same 500 / X-Trace-Id outcome.
6. The test no longer needs `process.env.DATABASE_URL = 'postgres://test'` for the `neon()` constructor (since prisma is fully mocked), but leave it in `beforeEach` — `lib/prisma` may still try to read `DATABASE_URL` at module-evaluation time if the mock factory isn't hoisted before. Safer to keep the env stub.
7. The descriptive comment block (lines 1-15) should be updated to reflect the new mock target. Adjust the wording from "`neon()` client is mocked here" to "`prisma.$queryRaw` is mocked via `@/lib/prisma`" and update the explanation of how the SQL is reconstructed (template strings and positional placeholders — same mechanism, different mock surface).
8. Test 12's it() title currently says "returns 500 when neon() throws" — rename to "returns 500 when prisma.$queryRaw rejects".

**Step C — Verify the integration test still works without modification.**

`__tests__/queue-api-integration.test.ts` mocks `@neondatabase/serverless` and `langfuse` defensively but only consumes `_atomicClaimSqlForTest`, `_staleReclaimSqlForTest`, `_legacyReclaimSqlForTest` — pure functions returning `{ text, values }`. The route file still imports `prisma` from `@/lib/prisma` at the top, which the test doesn't mock. To prevent `lib/prisma`'s module-load side effects (creating a real PrismaClient against an unset DATABASE_URL) from firing during this test, do NOT add a new mock — instead, verify the test still passes (it already mocks `@neondatabase/serverless` defensively, but the route's import of `prisma` may now load `lib/prisma` for real). If the test fails because of `lib/prisma` module-load, add a `jest.mock('@/lib/prisma', () => ({ prisma: {} }))` stub at the top of `queue-api-integration.test.ts` — even though the test doesn't invoke `prisma`, importing the route module triggers the import chain. The integration test's existing `jest.mock('@neondatabase/serverless', ...)` line was added for this same reason. Document the addition with a comment matching the existing inline-rationale style. **Note: this is a test-only mock addition for module-load defence, not a test-logic change. The 5 `it` blocks (Tests 14-18) and their assertions are completely untouched.**

**Step D — Commit:**
```bash
git add app/api/queue/route.ts __tests__/queue-api.test.ts
# If integration test needed the prisma mock stub, also: git add __tests__/queue-api-integration.test.ts
git commit -m "refactor(nic-1): /api/queue uses prisma.\$queryRaw; tests mock @/lib/prisma

Drop direct neon() tagged-template, route through Prisma so the same code
runs against PrismaNeon (prod Neon URL) or PrismaPg (vanilla localhost
Postgres) without changes. _*ForTest exports retained for pg-mem
integration test (still uses positional-param SQL).

Tests: queue-api.test.ts mock surface migrated from
@neondatabase/serverless → @/lib/prisma; 13 cases unchanged."
```
  </action>
  <verify>
<automated>npx jest __tests__/queue-api.test.ts __tests__/queue-api-integration.test.ts __tests__/queue-claim-sql.integration.test.ts __tests__/queue-config.test.ts __tests__/queue-sql.test.ts --runInBand</automated>
  </verify>
  <done>
- `grep -n "neon(" app/api/queue/route.ts` returns zero matches (the standalone `neon()` function call is gone; comments referencing the old form may remain in updated/replaced explanatory comments only).
- `grep -n "from '@neondatabase/serverless'" app/api/queue/route.ts` returns zero matches.
- `app/api/queue/route.ts` contains exactly 3 occurrences of `prisma.$queryRaw`.
- `__tests__/queue-api.test.ts` contains `jest.mock('../lib/prisma'` and zero occurrences of `jest.mock('@neondatabase/serverless'`.
- `_atomicClaimSqlForTest`, `_staleReclaimSqlForTest`, `_legacyReclaimSqlForTest` exports still present in `app/api/queue/route.ts` (verify with `grep -n "_atomicClaimSqlForTest\|_staleReclaimSqlForTest\|_legacyReclaimSqlForTest" app/api/queue/route.ts` returns 3 export sites).
- All five queue-related test files pass: `queue-api.test.ts` (13 unit cases), `queue-api-integration.test.ts` (5 pg-mem cases), `queue-claim-sql.integration.test.ts`, `queue-config.test.ts`, `queue-sql.test.ts`.
- Atomic commit on the queue refactor (one commit, per-task atomicity constraint).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Refactor /api/ask and /api/cron/embed routes; final audit + regression pass</name>
  <files>app/api/ask/route.ts, app/api/cron/embed/route.ts</files>
  <action>
**Why no `tdd="true"`:** Neither `/api/ask` nor `/api/cron/embed` has a dedicated test file (`grep` confirms no `ask-api.test.ts` and no `cron-embed.test.ts` in `__tests__/`). The existing `__tests__/api-key.test.ts` regression smoke imports `cron/embed`'s `POST` and asserts only auth behavior (it returns 401 before any SQL fires), so it's auth-driven, not SQL-driven. The refactor is mechanical — the same SQL body, same parameter binding, same trace spans. Verification is via typecheck + the existing api-key.test.ts smoke + the no-op confirmation that `prisma.$queryRaw` accepts the tagged template form (which the queue refactor already proved in Task 1).

**Step A — Refactor `app/api/ask/route.ts`:**

1. Delete `import { neon } from '@neondatabase/serverless'` (line 1).
2. Add `import { prisma } from '@/lib/prisma'` near the other imports.
3. Delete `const sql = neon(process.env.DATABASE_URL!)` (line 54).
4. Replace `const rows = await sql\`...\`` (lines 56-66) with:
   ```ts
   const rows = await prisma.$queryRaw<Array<{
     id: string
     filename: string | null
     axis_type: string | null
     axis_from: string | null
     axis_context: string | null
     confirmed_drive_path: string | null
     proposed_drive_path: string | null
     ingested_at: string | Date
     source_metadata: Record<string, unknown> | null
   }>>`
     SELECT id, filename, axis_type, axis_from, axis_context,
            confirmed_drive_path, proposed_drive_path, ingested_at,
            source_metadata
     FROM "Item"
     WHERE user_id = ${userId}
       AND status = 'filed'
       AND embedding IS NOT NULL
     ORDER BY embedding <#> ${vecStr}::halfvec
     LIMIT 20
   `
   ```
5. Downstream `(row.confirmed_drive_path as string | null)` casts (lines 73-122) can be loosened to plain property access since the typed generic narrows the row shape. Recommend keeping the casts — the existing code is conservative and removing them is out of scope (a stylistic cleanup that adds review surface). The minimum-viable change is just the SQL call site.
6. Note on `ingested_at`: the prior `neon()` call returned strings; Prisma's `$queryRaw` may return `Date` for timestamptz columns depending on the column type and driver. The downstream code does `new Date(row.ingested_at as string).toISOString()` and `.toLocaleDateString(...)` — `new Date(Date)` is safe (returns the same Date). Type the field as `string | Date` and the `as string` casts continue to type-check (TypeScript allows narrowing a wider union via assertion). If runtime breaks here, the executor can change the field to `Date` and adjust the casts; this is a known soft-edge of the Prisma-vs-neon type contract.

**Step B — Refactor `app/api/cron/embed/route.ts`:**

1. Delete `import { neon } from '@neondatabase/serverless'` (line 2).
2. `import { prisma } from '@/lib/prisma'` is already present (line 4) — leave it.
3. Delete `const sql = neon(process.env.DATABASE_URL!)` (line 49).
4. Replace the inner `await sql\`...\`` (lines 53-57) with `await prisma.$queryRaw\`UPDATE "Item" SET embedding = ${\`[${vector.join(',')}]\`}::halfvec WHERE id = ${item.id}\``. The template body is identical — `prisma.$queryRaw` for a non-SELECT (UPDATE) returns the affected count cast in a tuple-shape `unknown[]` that the loop body discards. No row type generic needed; an `await` of any return value is fine. (Aside: Prisma technically prefers `$executeRaw` for non-returning UPDATEs since `$queryRaw` always SELECTs the result set. Both work for this UPDATE — the route doesn't read the return value. Keep `$queryRaw` to mirror the queue route refactor and minimize signature drift; if `$queryRaw` errors on no result set under PrismaPg, fall back to `$executeRaw` — same template-tag form, same parameter binding.)

**Step C — Audit + final regression pass:**

1. Confirm zero remaining direct `neon()` calls in the app:
   ```bash
   grep -rn "from '@neondatabase/serverless'" app/ lib/ --include="*.ts"
   ```
   Expected output: ONLY `lib/prisma.ts:4:import { neonConfig } from '@neondatabase/serverless'` (the `neonConfig.webSocketConstructor = ws` setup, which is correct — `neonConfig` is package-level configuration, not a SQL-executing client).
   ```bash
   grep -rn "neon(" app/ lib/ --include="*.ts" | grep -v "neonConfig"
   ```
   Expected output: empty (no `neon()` function calls anywhere in app code).
2. Run the full Jest suite:
   ```bash
   npx jest --runInBand
   ```
   All tests must pass. The api-key.test.ts case that imports `cron/embed`'s POST handler must stay green — it stops at auth (401) and never reaches the SQL site.
3. Typecheck the agent (per the bg-of-planning verification list):
   ```bash
   cd agent && npx tsc --noEmit
   ```
   Should be clean — agent doesn't import the routes we changed.
4. Typecheck the web app:
   ```bash
   npx tsc --noEmit
   ```
   Should be clean — the only signature changes are in the SQL call sites, and the typed generics narrow more tightly than the prior implicit-`unknown[]`. If a downstream consumer was relying on a now-narrower type and breaks, fix the cast at the consumption site (most likely in `app/api/ask/route.ts`, the docLines/sources mappers) or widen the generic to `Record<string, unknown>` to match the prior loose shape.

**Step D — Commit (one atomic commit covering both routes):**
```bash
git add app/api/ask/route.ts app/api/cron/embed/route.ts
git commit -m "refactor(nic-2): /api/ask + /api/cron/embed use prisma.\$queryRaw

Both routes drop neon() in favor of prisma.\$queryRaw so they work
against any Postgres URL (Neon WS in prod, vanilla pg locally). Halfvec
cast literals (\${vecStr}::halfvec) are unchanged — the parameter binding
is identical between drivers.

No new tests added; existing api-key.test.ts (cron/embed auth smoke) and
the full Jest suite stay green. Audit confirms only neonConfig (lib/prisma.ts)
remains from @neondatabase/serverless in app code."
```
  </action>
  <verify>
<automated>grep -rn "neon(" app/ lib/ --include="*.ts" | grep -v "neonConfig" | grep -v "// " | (! grep .) && grep -rn "from '@neondatabase/serverless'" app/ lib/ --include="*.ts" | grep -v "neonConfig" | (! grep .) && npx jest --runInBand && npx tsc --noEmit && cd agent && npx tsc --noEmit</automated>
  </verify>
  <done>
- `grep -rn "neon(" app/ lib/ --include="*.ts" | grep -v "neonConfig"` returns no matches outside of comments (the production `neon()` call sites are all gone).
- `grep -rn "from '@neondatabase/serverless'" app/ lib/ --include="*.ts"` shows ONLY `lib/prisma.ts` importing `neonConfig`.
- `app/api/ask/route.ts` contains exactly 1 occurrence of `prisma.$queryRaw`.
- `app/api/cron/embed/route.ts` contains exactly 1 occurrence of `prisma.$queryRaw` (or `prisma.$executeRaw` if the executor needed the fallback for UPDATE — note the choice in the commit message).
- Full `npx jest --runInBand` passes (all 15 test files green).
- `npx tsc --noEmit` (web app) passes.
- `cd agent && npx tsc --noEmit` passes.
- Atomic commit on the ask + cron/embed refactor.
  </done>
</task>

</tasks>

<verification>
End-to-end gate (post-execution, run by orchestrator after both task commits):

1. **Unit & integration regression net (executor verifies inside Task 2):**
   - `npx jest --runInBand` — full suite green.
   - All 13 cases in `queue-api.test.ts` pass after mock relocation.
   - All 5 cases in `queue-api-integration.test.ts` pass without modification (or with at most a defensive `jest.mock('@/lib/prisma', ...)` stub for module-load — see Task 1 Step C).
   - All 5 cases in `queue-claim-sql.integration.test.ts` pass (this test exercises richer pg-mem scenarios; same `_*ForTest` helpers).
   - `api-key.test.ts` cases that import the cron/embed route still pass at the auth layer (they never reach the SQL site).

2. **Typecheck:**
   - `npx tsc --noEmit` — web app types clean.
   - `cd agent && npx tsc --noEmit` — agent types clean (defensive; agent doesn't import these routes but the planner spec asks for it).

3. **Audit:**
   - `grep -rn "neon(" app/ lib/ --include="*.ts" | grep -v "neonConfig"` returns no production-code matches.
   - The only remaining `@neondatabase/serverless` import in `app/` and `lib/` is the `neonConfig` import in `lib/prisma.ts`.

4. **Out-of-scope smoke (orchestrator runs, NOT executor):**
   - `curl` each refactored route with auth against the running local docker-compose Postgres on `localhost:5433`. Expected: each route succeeds where it previously 500'd.
   - Run `process-files.ts` on the invoice file — final integration confirmation.
</verification>

<success_criteria>
- Three routes (`/api/queue`, `/api/ask`, `/api/cron/embed`) use `prisma.$queryRaw` — zero direct `neon()` SQL clients in app code.
- `lib/prisma.ts` still imports `neonConfig` (the package-level WS config) — that import is correct and should NOT be removed.
- `__tests__/queue-api.test.ts` mock surface migrated to `@/lib/prisma`; all 13 cases green.
- `__tests__/queue-api-integration.test.ts` and `__tests__/queue-claim-sql.integration.test.ts` (pg-mem path) green — the `_*ForTest` exports on the queue route are preserved as the SQL regression net.
- Full Jest suite green; web app and agent typecheck clean.
- Two atomic commits — one per task — mirroring the two-task plan structure.
- Behavior preserved: QUE-02 invariant (no id overlap on parallel claims), X-Trace-Id headers, auth gates (`requireApiKey` / `requireAuth` / `CRON_SECRET`), error semantics (500 on DB failure, 401 on auth failure, 400 on validation failure, 200 on success).
</success_criteria>

<output>
After completion, create `.planning/quick/260429-nic-refactor-direct-neon-calls-in-app-api-ro/260429-nic-SUMMARY.md` per the GSD quick-task summary template, with sections for:
- What changed (per route + test mock relocation)
- Audit result (grep transcript showing no remaining `neon()` call sites)
- Test outcomes (Jest counts, typecheck status)
- Open follow-ups (e.g., out-of-scope `lib/queue-sql.ts` doc-comment refresh that references the old `neon()` example — leave as a follow-up, not a v1.1 blocker)
- Update `.planning/STATE.md` Quick Tasks Completed table with the 260429-nic entry.
</output>
