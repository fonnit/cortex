# Deferred Items — Phase 05

## Pre-existing failures observed during 05-02 execution

### `__tests__/triage-api.test.ts` — TS2740 type errors

**Status when 05-02 started:** Already failing.
**Root cause:** Prisma client regeneration likely added new required fields to `Item`; the test fixtures in `triage-api.test.ts` use partial Item shapes with `// @ts-ignore` directives that no longer suppress `TS2740`.
**Out of scope for 05-02:** Per deviation Rule scope boundary, only auto-fix issues directly caused by current task changes. This file was not touched by 05-02.
**Suggested owner:** Whoever next touches `app/api/triage/route.ts` or its tests; or a dedicated test-debt sweep.
