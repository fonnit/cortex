# lx4 — Deferred Items (out of scope, pre-existing)

## __tests__/triage-api.test.ts — TS compile failures (pre-existing)

**Symptom:** ts-jest fails to compile `__tests__/triage-api.test.ts` with TS2740 — the inline `Item` literals at lines 53, 82, 107 are missing many required fields (`content_hash`, `filename`, `mime_type`, `size_bytes`, and ~14 more).

**Verified pre-existing:** stashing all lx4 changes still reproduces the same error. The Prisma `Item` model gained required fields in some prior migration; the test fixtures were never updated.

**Why not fixed here:** out of scope for lx4 (no /api/triage changes). Fix belongs in a follow-up that updates the inline fixtures with the missing required fields (use `jest.MockedFunction` with cast or fill in placeholder values).

**Impact:** the test suite never exercises the triage route assertions. No runtime regression — just unverified surface.
