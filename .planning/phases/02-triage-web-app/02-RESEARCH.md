# Phase 2: Triage & Web App — Research

**Researched:** 2026-04-24
**Domain:** Next.js 16 App Router web app — Clerk auth, triage queue UI, Drive resolve cron, pixel-faithful design handoff
**Confidence:** HIGH

---

## Summary

Phase 2 stands up the Next.js web application and its three core layers: Clerk authentication, the app shell (sidebar + topbar + metrics strip), and the triage queue. The Phase 1 agent and schema are already in place — this phase is pure web app work. The design is not generic: a full Claude Design handoff exists at `design/project/` with exact CSS custom properties, component JSX, and interaction logic. Implementation is translation work, not design work.

The triage surface is load-bearing. Inline-expanding queue, two modes (relevance / label), keyboard shortcuts, undo, and Drive path display all have explicit requirements and exact prototype references. The Drive resolve job (DRV-02 through DRV-05) is a Vercel cron that reads `certain` items from Neon, calls the Drive API to move blobs from `_Inbox` to `confirmed_drive_path`, and updates item status to `filed`. The metrics strip (OBS-05) reads from `MetricSnapshot` + live counts.

The critical implementation risk is keyboard event routing: the triage view must capture global keydown events without conflicting with Clerk modals, browser shortcuts, or inline text inputs (the "new category" flow opens an input mid-keyboard-session).

**Primary recommendation:** Translate the prototype JSX directly into Next.js App Router components using the CSS custom properties from `styles.css` as a global stylesheet. Do not re-architect — the prototype structure maps cleanly to App Router page/layout composition.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Clerk auth with MFA for web app | Clerk 7 App Router middleware + `<ClerkProvider>` wrapping layout |
| AUTH-02 | Google OAuth for Drive/Gmail scopes handled by Mac agent (separate from Clerk) | No web app work — already in agent/src/auth/. Note only: Clerk handles identity, not Drive scopes. |
| AUTH-03 | User-initiated delete: removes Drive blob + Neon rows + embeddings | Server Action or Route Handler; Drive files.delete + Prisma cascade |
| TRI-01 | Inline-expanding queue list | Single `<ol>` with `is-active` / `is-collapsed` per item; prototype in triage.jsx |
| TRI-02 | Relevance mode: K keep / X ignore / S skip | Global keydown handler in TriageView; prototype exact |
| TRI-03 | Label mode: 3 axis fields, unresolved highlighted, confident axes show auto-archived | AxisGroup component; prototype exact |
| TRI-04 | Label mode controls: 1/2/3 pick proposal, N new category inline, S skip, Enter confirm, A archive-as-is, I ignore | keydown handler in triage.jsx; prototype exact |
| TRI-05 | J/K (or J/H) queue navigation with scroll-into-view | `rowRefs` + `scrollIntoView({ block: "nearest" })`; prototype exact |
| TRI-06 | Undo via U key with toast notification | `lastAction.current` ref + `cx-toast`; prototype exact |
| TRI-07 | Cards have no background/border/rule — content only, subtle hover on collapsed | `background: transparent; border: 0` on `.cx-card`; `is-collapsed:hover` has `cx-ink-10` background |
| TRI-08 | Whole collapsed card is clickable | `onClick` on `<li>` when `!isActive`; prototype exact |
| TRI-09 | Proposed Drive path displayed under axes in label mode | `cx-path` block inside ExpandedCard; prototype exact |
| TRI-10 | Target median decision time < 3s once taxonomy matures | Instrumentation: record `decided_at - opened_at` per item; store in MetricSnapshot or separate column |
| DRV-02 | Background resolve job moves filed items to proposed_drive_path; drive_file_id stays stable | Vercel cron Route Handler: `files.update` (move via `addParents`/`removeParents`) not re-upload |
| DRV-03 | Cascading moves on taxonomy rename/merge/split — batched, rate-limited 3 ops/sec | Drive API limit is 3 write ops/sec per user; use sequential delay loop in cron |
| DRV-04 | Per-item state tracking in Neon for cascade moves | Item.status transitions: `certain → resolving → filed`; add `resolve_error` column or use `classification_trace` JSON |
| DRV-05 | Collision handling: append short hash suffix on same-name-in-folder | Query `files.list` before move; append `content_hash.slice(0,6)` suffix on conflict |
| DSN-01 | Newsreader / Inter Tight / JetBrains Mono fonts | Load via `next/font` or direct Google Fonts `<link>` in root layout |
| DSN-02 | Warm ivory / ink / umber palette; dark mode | CSS custom properties in `globals.css`; `[data-theme="dark"]` selector from styles.css |
| DSN-03 | Sidebar: Cortex logo, nav with kbd shortcuts + queue counts, connection status footer | `Sidebar` component from shell.jsx; translates directly |
| DSN-04 | Metrics strip (6 cells) below topbar | `MetricsStrip` component from shell.jsx; reads from `/api/metrics` |
| DSN-05 | Pixel-faithful implementation of Claude Design handoff prototype | Source of truth: `design/project/styles.css`, `shell.jsx`, `triage.jsx` |
| OBS-05 | Metrics strip on main layout: north star + 5 leading indicators | 6 cells: cited answers/wk, relevance auto %, label auto-archive %, median decision s, rules count, dormant % |
</phase_requirements>

---

## Standard Stack

All packages are already declared in `package.json`. No new dependencies required for this phase.

### Core (already installed)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| next | 16.2.4 | Web framework + cron via `vercel.json` | App Router, Turbopack dev |
| react | 19.2.5 | UI runtime | React Compiler active in Next 16 |
| tailwindcss | 4.2.4 | Utility CSS (supplemental) | Primary styling via CSS custom props from design system |
| @clerk/nextjs | 7.2.5 | Auth + MFA | `clerkMiddleware`, `<ClerkProvider>` |
| prisma | 7.8.0 | ORM | Schema already migrated in Phase 1 |
| @prisma/adapter-neon | 7.8.0 | Neon serverless transport | Required for Vercel Functions |
| @tanstack/react-query | 5.100.1 | Client-side queue state | Triage queue polling + optimistic updates |
| zod | 4.3.6 | API route validation | Triage action payloads |
| langfuse | 3.38.20 | Observability | Span on every triage action (for decision time tracking) |

### New dependency needed
| Library | Purpose | Install |
|---------|---------|---------|
| `googleapis` | Drive resolve cron needs `files.update` (move blob) | Already in `agent/package.json` — add to web app `package.json` as well, OR extract Drive move logic to a shared module the cron imports. Simpler: duplicate the Drive move call in the web app cron handler, using a service account JSON (not the Mac agent's user OAuth). |

**Decision point for planner:** The Drive resolve cron runs on Vercel (not the Mac). It needs Drive API access. Options:
1. Service account with Drive access — cleanest for server-to-server; requires Drive folder to be shared with service account email. [ASSUMED — confirm with Daniel]
2. Store user OAuth refresh token in Neon (encrypted) and use it from the cron. Matches the existing `auth/google.ts` pattern.

The existing `agent/src/drive.ts` uses user OAuth. The cron on Vercel needs the same credentials. Storing the refresh token in Neon (already done via agent auth flow) is the simpler path.

---

## Architecture Patterns

### Project Structure (web app)
```
app/
├── layout.tsx             # Root layout — ClerkProvider, fonts, globals.css
├── globals.css            # CSS custom props from styles.css verbatim
├── middleware.ts           # clerkMiddleware — protect all routes
├── sign-in/[[...sign-in]]/
│   └── page.tsx
├── (app)/                 # Route group — authenticated shell
│   ├── layout.tsx         # AppShell: Sidebar + Topbar + MetricsStrip
│   ├── triage/
│   │   └── page.tsx       # TriageView
│   └── page.tsx           # Redirect to /triage
└── api/
    ├── triage/
    │   └── route.ts       # GET queue items, POST decision
    ├── metrics/
    │   └── route.ts       # GET metrics strip data
    ├── delete/
    │   └── route.ts       # DELETE item (AUTH-03)
    └── cron/
        └── resolve/
            └── route.ts   # POST — Drive resolve job (called by Vercel cron)
```

### Pattern 1: Clerk App Router middleware
**What:** `clerkMiddleware` in `middleware.ts` protects all routes under `/(app)`. Sign-in page is public.
**When to use:** Every request. Middleware runs on edge.
```typescript
// Source: https://clerk.com/docs/references/nextjs/clerk-middleware
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
const isPublicRoute = createRouteMatcher(['/sign-in(.*)'])
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect()
})
export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)'],
}
```
[CITED: https://clerk.com/docs/references/nextjs/clerk-middleware]

### Pattern 2: Triage queue — client component with global keydown
**What:** `TriageView` is a Client Component (`'use client'`). Global `keydown` listener on `window`. State: `activeIdx`, `decided` map, `picks` (per-item axis selections), `lastAction` ref for undo.
**When to use:** The prototype's keyboard routing model is the canonical pattern — copy it directly.

Key implementation rules from prototype:
- Guard: `if (newOpen) return` — suppress all shortcuts when inline input is open
- Guard: `if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return`
- Guard: `if (e.metaKey || e.ctrlKey || e.altKey) return`
- Navigation: `j` = next, `h` = prev (not `k` — `k` is "keep")
- Undo: single-level only; `lastAction.current` stores previous `decided` state

```typescript
// Source: design/project/triage.jsx — TriageView keyboard handler
React.useEffect(() => {
  const onKey = (e) => {
    if (newOpen) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j') { setActiveIdx(i => Math.min(items.length - 1, i + 1)); e.preventDefault(); return; }
    if (k === 'h') { setActiveIdx(i => Math.max(0, i - 1)); e.preventDefault(); return; }
    // ... mode-specific handlers
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [items, item, picks, newOpen, decided]);
```

### Pattern 3: Design system — CSS custom properties as globals
**What:** The entire visual system lives in CSS custom properties defined in `globals.css`. Components use class names prefixed `cx-`. No Tailwind utilities for layout or typography — use the design system classes verbatim.
**When to use:** Every component. Never override `--cx-*` values inline.

The `styles.css` file in `design/project/` is the source of truth. Copy it verbatim as `app/globals.css` (or import it). Add the Google Fonts `<link>` in `layout.tsx`.

```css
/* Source: design/project/styles.css */
:root {
  --cx-bg: #f6f2ea;
  --cx-ink: #201d17;
  --cx-accent: #8a4f1c;
  --cx-radius: 6px;
  --cx-radius-lg: 10px;
  --cx-pad: 22px;
  --cx-ff-serif: "Newsreader", "Source Serif 4", Georgia, serif;
  --cx-ff-sans: "Inter Tight", "Helvetica Neue", Arial, sans-serif;
  --cx-ff-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;
}
[data-theme="dark"] {
  --cx-bg: #17150f;
  --cx-ink: #ece6d8;
  --cx-accent: #d7a36a;
}
```

### Pattern 4: Drive resolve cron
**What:** Vercel cron job hits `/api/cron/resolve` on a schedule. Finds `certain` items with `drive_inbox_id` set and `drive_filed_id` null. Moves each blob in Drive using `files.update` (not re-upload — `drive_file_id` must stay stable per DRV-02). Updates item status to `filed`.
**Rate limit:** Drive API allows 3 write ops/sec per user [CITED: https://developers.google.com/workspace/drive/api/guides/limits]. Implement a `sleep(350)` between each move.

```typescript
// Drive move — preserves file ID (DRV-02)
await drive.files.update({
  fileId: item.drive_inbox_id,
  addParents: targetFolderId,
  removeParents: inboxFolderId,
  fields: 'id, parents',
});
// Then: UPDATE Item SET status='filed', drive_filed_id=drive_inbox_id, confirmed_drive_path=...
```

### Pattern 5: Vercel cron configuration
**What:** `vercel.json` defines cron schedule. Route handler validates `Authorization: Bearer` header using `CRON_SECRET` env var.
```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/resolve", "schedule": "*/5 * * * *" }]
}
```
```typescript
// Route handler guard
if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 });
}
```
[CITED: https://vercel.com/docs/cron-jobs]

### Pattern 6: Metrics strip data
**What:** `/api/metrics` aggregates live counts from Neon + latest `MetricSnapshot`. The `MetricSnapshot` table (Phase 1, already in schema) tracks `uncertain_rate` and `auto_filed_rate`. Live queue depths come from a COUNT query on `Item` by status.

Six cells per prototype (`shell.jsx`):
1. `cited answers / wk` — Phase 4 data; show `—` until then
2. `relevance auto %` — `auto_filed_rate` from MetricSnapshot
3. `label auto-archive %` — ratio of `certain` items that skipped label triage
4. `median decision s` — requires per-decision timing (new column or MetricSnapshot extension)
5. `rules` count — TaxonomyLabel count (proxy until Phase 3 rule system)
6. `dormant %` — Phase 3 data; show `—` until then

### Anti-Patterns to Avoid
- **Re-designing the triage card:** The prototype defines exactly what the card is. Do not introduce card backgrounds, borders, or shadows. The `is-collapsed:hover` state adds only `cx-ink-10` background.
- **Separate card panel / detail view:** TRI-01 mandates inline expansion. No split-panel layout.
- **Using `<button>` for the card head:** The prototype uses `<div className="cx-card-head">` — a div, not a button. The whole `<li>` handles the click when collapsed.
- **Re-uploading files on Drive move:** DRV-02 requires `drive_file_id` stability. Use `files.update` with `addParents`/`removeParents`, never `files.create` + `files.delete`.
- **Polling for queue updates on a tight interval:** Use React Query with a 10-second refetch interval. No WebSocket needed.
- **Calling the Drive API from the client:** All Drive operations happen server-side (cron or Route Handler).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth session management | Custom JWT/session | Clerk 7 `auth()` + `clerkMiddleware` | MFA, session rotation, CSRF are handled |
| Drive file move | Re-upload + delete | `drive.files.update` with parent change | Preserves file ID (DRV-02 requirement) |
| Keyboard focus trap in Clerk modal | Custom modal focus manager | Clerk handles it | Clerk modals manage their own focus; app keydown guard fires only when no modal is open |
| Dark mode toggle state | Custom context | `[data-theme="dark"]` on `<html>` via localStorage | CSS custom props respond automatically |
| Optimistic queue updates | Custom state machine | React Query `onMutate` / `onSettled` | Rollback on API failure is built in |

---

## Common Pitfalls

### Pitfall 1: Keyboard handler fires inside Clerk sign-in modal
**What goes wrong:** User presses a key during MFA setup; `j`/`k`/`x` trigger triage actions.
**Why it happens:** Global `window.addEventListener('keydown')` fires regardless of modal presence.
**How to avoid:** Check `document.activeElement` — if it's inside a Clerk portal (`[data-clerk-portal]`), return early. Or check that no modal overlay is in the DOM: `if (document.querySelector('[data-clerk-modal]')) return`.
**Warning signs:** Triage state changes when typing MFA code.

### Pitfall 2: Drive resolve cron orphans items on partial batch failure
**What goes wrong:** Cron moves 5 items, fails on item 6, items 7-N never move. Items 1-5 are `filed`, item 6 is stuck `certain`.
**Why it happens:** No per-item error state; batch is fire-and-forget.
**How to avoid:** Wrap each move in try/catch. On failure, write `resolve_error` to the item row (JSON column or dedicated field) and continue to next item. Log via Langfuse span. The next cron run retries non-filed items automatically (no `filed` filter excludes them).
**Warning signs:** Items stuck in `certain` status with `drive_inbox_id` set.

### Pitfall 3: `files.update` on Drive fails silently if folder ID is wrong
**What goes wrong:** `addParents` receives a non-existent folder ID; Drive API returns 404; item stays in `_Inbox`.
**Why it happens:** `proposed_drive_path` is a string path like `Invoices/2026/March`. The resolve job must create intermediate folders first (same pattern as `uploadToInbox` in `agent/src/drive.ts`).
**How to avoid:** Reuse the `getOrCreateFolder` pattern from `drive.ts`. The resolve cron must walk the path segments and create folders before moving the file.
**Warning signs:** DRV-05 (collision) never triggers; all items appear to resolve but remain in `_Inbox`.

### Pitfall 4: Font loading causes layout shift on triage queue
**What goes wrong:** Newsreader (serif) loads late; card titles reflow; active card appears to jump.
**Why it happens:** Google Fonts loaded via `<link>` without `font-display: swap` tuned; CLS on heading transition.
**How to avoid:** Use `next/font/google` for Newsreader, Inter Tight, JetBrains Mono with `display: 'swap'`. Pre-load all three in root layout.

### Pitfall 5: `picks` state not reset on item navigation
**What goes wrong:** User picks "Type: Invoice" on item 3, navigates to item 4 with `j`, item 4 shows "Type: Invoice" pre-selected.
**Why it happens:** `picks` state persists across `activeIdx` change without reset.
**How to avoid:** The prototype's `useEffect` on `activeIdx` calls `setPicks({})` — copy this exactly.

### Pitfall 6: Triage API returns stale items after decision
**What goes wrong:** User decides item, queue re-fetches, decided item reappears (still `uncertain` in DB because mutation hasn't committed).
**Why it happens:** React Query refetch races the mutation.
**How to avoid:** Use React Query optimistic updates (`onMutate` removes item from local cache immediately; `onSettled` refetches). Alternatively, maintain local `decided` map (as the prototype does) and filter decided items client-side without waiting for refetch.

### Pitfall 7: `cx-card-head` is a div in the prototype — don't add `role="button"` without thought
**What goes wrong:** Screen readers announce heading + button redundantly if `role="button"` is added to a div that already contains an `<h2>`.
**Why it happens:** Accessibility retrofit on prototype structure.
**How to avoid:** The whole `<li>` element handles click when collapsed (TRI-08). The `cx-card-head` div gets `tabIndex` on the collapsed row's `<li>`, not on the inner div. The active card head has `cursor: default` — it is not interactive.

---

## Code Examples

### App shell grid (from styles.css)
```css
/* Source: design/project/styles.css */
.cx-app {
  display: grid;
  grid-template-columns: 232px 1fr;
  grid-template-rows: auto auto 1fr;
  min-height: 100vh;
}
.cx-sidebar { grid-column: 1; grid-row: 1 / span 3; position: sticky; top: 0; height: 100vh; }
.cx-topbar  { grid-column: 2; grid-row: 1; }
.cx-strip   { grid-column: 2; grid-row: 2; display: grid; grid-template-columns: repeat(6, 1fr); }
.cx-main    { grid-column: 2; grid-row: 3; }
```

### Source badge (dot + pill)
```tsx
// Source: design/project/triage.jsx — SourceBadge
function SourceBadge({ source }: { source: 'gmail' | 'downloads' }) {
  const map = {
    gmail:     { label: 'gmail',     dot: 'var(--cx-accent)' },
    downloads: { label: 'downloads', dot: 'var(--cx-ink-40)' },
  }
  const m = map[source] ?? map.downloads
  return (
    <span className="cx-badge">
      <i className="cx-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  )
}
```

### Triage API route — GET queue
```typescript
// app/api/triage/route.ts
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const items = await prisma.item.findMany({
    where: { user_id: userId, status: 'uncertain' },
    orderBy: { ingested_at: 'asc' },
    take: 50,
  })
  return Response.json(items)
}
```

### Drive resolve — move blob preserving file ID
```typescript
// app/api/cron/resolve/route.ts (simplified)
await drive.files.update({
  fileId: item.drive_inbox_id!,
  addParents: targetFolderId,
  removeParents: inboxMonthFolderId,
  fields: 'id, parents',
})
await prisma.item.update({
  where: { id: item.id },
  data: { status: 'filed', confirmed_drive_path: resolvedPath },
})
await sleep(350) // Stay under 3 ops/sec Drive limit
```

### Decision timing instrumentation (TRI-10)
```typescript
// Record opened_at when activeIdx changes; record decided_at on action dispatch
// Store duration in MetricSnapshot or emit as Langfuse event
const langfuse = new Langfuse()
langfuse.event({
  traceId: itemId,
  name: 'triage.decision',
  metadata: { type: decision, durationMs: Date.now() - openedAt },
})
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build / dev | ✓ | 22 LTS | — |
| Next.js | Web app | ✓ (package.json) | 16.2.4 | — |
| Clerk | Auth | ✓ (package.json) | 7.2.5 | — |
| Neon / DATABASE_URL | All DB ops | ✓ (.env.example present) | Postgres 16 | — |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Clerk auth | Listed in .env.example | — | Must be set before dev |
| CLERK_SECRET_KEY | Clerk server | Listed in .env.example | — | Must be set before dev |
| CRON_SECRET | Resolve cron auth | Not yet in .env.example | — | Add before Vercel deploy |
| Google OAuth credentials | Drive resolve cron | Listed in .env.example | — | Required for cron |

**Missing with no fallback:** `CRON_SECRET` must be added to `.env.example` and Vercel environment. Without it, the resolve cron has no auth protection.

---

## Validation Architecture

> `workflow.nyquist_validation` is disabled in config (nyquist_validation_enabled: false). Wave 0 test tasks are N/A.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test config files or test directories found |
| Config file | None |
| Quick run command | `npm test -- --passWithNoTests` (once configured) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Unauthenticated request to `/triage` redirects to sign-in | Integration (Playwright or route test) | Manual smoke | N/A (Nyquist disabled) |
| TRI-01 | Active card expands; collapsed cards show compact | Component unit | `npm test -- --testPathPattern=triage` | N/A (Nyquist disabled) |
| TRI-02 | K/X/S keys trigger correct decision type | Component unit | `npm test -- --testPathPattern=triage` | N/A (Nyquist disabled) |
| TRI-05 | J/H move activeIdx; scroll-into-view called | Component unit | `npm test -- --testPathPattern=triage` | N/A (Nyquist disabled) |
| TRI-06 | U key restores previous decided state; toast shown | Component unit | `npm test -- --testPathPattern=triage` | N/A (Nyquist disabled) |
| DRV-02 | Resolve cron calls `files.update` not `files.create` | Unit (mock googleapis) | `npm test -- --testPathPattern=resolve` | N/A (Nyquist disabled) |
| DRV-04 | Failed move writes error state; item not left silently stuck | Unit | `npm test -- --testPathPattern=resolve` | N/A (Nyquist disabled) |
| AUTH-03 | Delete route removes Drive blob + Neon row | Integration | Manual smoke | N/A (Nyquist disabled) |

### Sampling Rate
- **Per task commit:** grep-based acceptance criteria per task
- **Phase gate:** TypeScript zero-errors + human visual checkpoint before `/gsd-verify-work`

---

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Clerk 7 with MFA — `auth.protect()` in middleware |
| V3 Session Management | yes | Clerk handles session rotation and revocation |
| V4 Access Control | yes | All DB queries filter by `userId` from Clerk session |
| V5 Input Validation | yes | Zod schemas on all Route Handler request bodies |
| V6 Cryptography | no | No new crypto in this phase |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Triage action on another user's item | Tampering | All Prisma queries: `where: { id, user_id: userId }` — never by `id` alone |
| Cron endpoint called by external attacker | Tampering | `Authorization: Bearer $CRON_SECRET` header check; Vercel also IP-restricts cron callers |
| User-initiated delete exposes other user's Drive file | Information disclosure | Verify `item.user_id === userId` before Drive delete; catch Drive 404 gracefully |
| XSS via item filename/subject rendered in cards | XSS | React escapes by default; never use `dangerouslySetInnerHTML` for item content |

---

## Decisions (formerly Open Questions)

All three open questions are now closed.

**A1 — Drive cron auth (was LOW confidence):** Use user refresh token stored as `GOOGLE_REFRESH_TOKEN` Vercel env var (not Neon, not service account). Simplest for single-user app; matches existing agent OAuth flow. Token sourced from existing agent auth. Confidence: HIGH.

**TRI-10 — Decision timing storage:** Emit as Langfuse event only (`langfuse.event({ name: 'triage.decision', metadata: { durationMs } })`). No new Neon column in Phase 2. Phase 3 may add `MetricSnapshot.median_decision_ms` when admin page is built. Decision: Langfuse-only for Phase 2.

**Dark mode toggle:** Implement in sidebar footer as a `cx-linkbtn` button that toggles `document.documentElement.dataset.theme` between `'light'` and `'dark'`, persisted to `localStorage`. Label shows the mode you switch TO. In scope for Phase 2 (Plan 02-05, Task 1).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong | Status |
|---|-------|---------|---------------|--------|
| A1 | Drive resolve cron uses `GOOGLE_REFRESH_TOKEN` env var on Vercel (user OAuth, not service account) | Pattern 4 | If token not persisted, cron cannot call Drive | CLOSED — use env var |
| A2 | `CRON_SECRET` env var pattern is sufficient for cron auth on Vercel | Pattern 5 | Vercel already restricts cron caller IPs; additional token is defense-in-depth, not strictly required | ACCEPTED |
| A3 | Decision timing via Langfuse event only is acceptable for TRI-10 in Phase 2 | Decisions | If Daniel wants it queryable immediately, needs Neon column now | CLOSED — Langfuse-only |

---

## Sources

### Primary (HIGH confidence)
- `design/project/styles.css` — all CSS custom properties, class names, layout rules
- `design/project/triage.jsx` — keyboard handler, card structure, AxisGroup, ExpandedCard, TriageView
- `design/project/shell.jsx` — Sidebar, Topbar, MetricsStrip component structure
- `prisma/schema.prisma` — Item model, MetricSnapshot, TaxonomyLabel; confirmed Phase 1 schema
- `agent/src/drive.ts` — `getOrCreateFolder` pattern; `uploadToInbox` shows Drive API usage
- `agent/src/metrics.ts` — `computeMetrics` and `snapshotMetrics` — metrics strip data source
- `package.json` — confirmed all stack packages present, no new deps needed (except googleapis for cron)

### Secondary (MEDIUM confidence)
- [CITED: https://clerk.com/docs/references/nextjs/clerk-middleware] — `clerkMiddleware` + `createRouteMatcher` API
- [CITED: https://vercel.com/docs/cron-jobs] — cron schedule format, `CRON_SECRET` pattern, IP restriction behavior
- [CITED: https://developers.google.com/workspace/drive/api/guides/limits] — 3 write ops/sec per user limit; basis for `sleep(350)` between moves

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed in `package.json`; versions match STACK.md
- Architecture: HIGH — App Router patterns are from official Clerk/Vercel docs; shell structure directly from prototype
- Design system: HIGH — source files read verbatim; no inference
- Drive resolve: HIGH — pattern correct; auth strategy now closed (GOOGLE_REFRESH_TOKEN env var)
- Pitfalls: HIGH — derived from direct prototype code inspection and Drive API docs

**Research date:** 2026-04-24
**Revised:** 2026-04-24 (closed open questions A1/TRI-10/dark mode; marked Nyquist N/A)
**Valid until:** 2026-05-24 (Clerk, Next.js stable releases; design files are frozen)
