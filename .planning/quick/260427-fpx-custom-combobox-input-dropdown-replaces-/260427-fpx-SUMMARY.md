---
phase: 260427-fpx
plan: 01
subsystem: ui-components
tags: [combobox, identity, datalist-replacement, accessibility, design-tokens]
dependency_graph:
  requires:
    - existing cx-* CSS tokens (--cx-panel, --cx-rule, --cx-radius, --cx-ink-*, --cx-accent-soft, --cx-accent-ink)
    - existing .cx-prop-newinput baseline input class
  provides:
    - components/ui/CxCombobox.tsx — reusable controlled combobox with custom-value support
    - .cx-combobox / .cx-combobox-list / .cx-combobox-option CSS rules
  affects:
    - app/(app)/settings/IdentityForm.tsx (Type field UX in edit + add rows)
    - components/triage/ExpandedCard.tsx (identity-suggest Type field UX)
tech_stack:
  added: []
  patterns:
    - "ARIA combobox pattern (role=combobox + aria-expanded/controls/autocomplete=list/activedescendant)"
    - "Controlled input with onChange(string) signature (not SyntheticEvent)"
    - "onMouseDown + preventDefault on options to beat input blur"
    - "useEffect-bound document mousedown listener for click-outside detection"
key_files:
  created:
    - components/ui/CxCombobox.tsx
  modified:
    - app/globals.css
    - design/project/styles.css
    - app/(app)/settings/IdentityForm.tsx
    - components/triage/ExpandedCard.tsx
decisions:
  - Skipped jsdom + RTL test infra and unit tests per orchestrator override (verification deferred to Playwright post-merge)
  - Wrapped ExpandedCard's CxCombobox in <div style={{ flex: 1, minWidth: 140 }}> rather than extending CxComboboxProps with a style prop — keeps the locked API minimal
  - Used React.ReactElement as the return type instead of JSX.Element (React 19 removed the global JSX namespace; React.ReactElement is the supported equivalent)
metrics:
  tasks: 2
  commits: 2
  duration_min: ~10
  files_created: 1
  files_modified: 4
  completed_date: 2026-04-27
requirements: [FPX-01, FPX-02]
---

# Phase 260427-fpx Plan 01: Custom Combobox (datalist replacement) Summary

A reusable `<CxCombobox>` (input + dropdown) replaces the three native `<input list="…">` + `<datalist>` pairs across IdentityForm and ExpandedCard, preserving custom-value entry while making the popover dark-mode-correct and styled exclusively with existing `--cx-*` tokens.

## What changed

### `components/ui/CxCombobox.tsx` (new, 173 lines)

Client component (`'use client'`) implementing the locked `CxComboboxProps` API exactly:

- `value: string` / `onChange: (next: string) => void` (controlled).
- `options: string[]` filtered case-insensitively by substring; empty input shows all.
- Optional `placeholder`, `className`, `inputClassName`, `autoFocus`, `disabled`, `id`.
- ARIA: input has `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and `aria-activedescendant` pointing at the highlighted option id when one is highlighted; the popover `<ul>` has `role="listbox"`; options have `role="option"` and `aria-selected={highlight === i}`.
- Keyboard: `ArrowDown`/`ArrowUp` move highlight (and open if closed), `Enter` commits the highlighted option, `Escape` closes without changing the value, `Tab` closes without `preventDefault` (natural focus order preserved).
- `onMouseDown(e) { e.preventDefault(); … }` on each option — not `onClick` — so the input's blur doesn't unmount the popover before the click lands.
- Outside-click: a single `document.mousedown` listener attached in `useEffect`, scoped to `wrapperRef.contains(target)`, with cleanup on unmount.
- Optional UX nicety: highlighted option is scrolled into view via `scrollIntoView({ block: 'nearest' })`.
- Returns `React.ReactElement` (not `JSX.Element`) for React 19 compatibility — the global `JSX` namespace was removed there.

### `app/globals.css` + `design/project/styles.css` (+38 lines each, identical)

Appended `.cx-combobox`, `.cx-combobox-list`, `.cx-combobox-option`, and `.cx-combobox-option[aria-selected="true"]` rules. The new rules use only pre-existing tokens — `var(--cx-panel)`, `var(--cx-rule)`, `var(--cx-radius)`, `var(--cx-ink)`, `var(--cx-ink-10)`, `var(--cx-accent-soft)`, `var(--cx-accent-ink)` — plus a single `rgba(32,29,23,.18)` shadow value that mirrors the existing `[data-card-surface="panel"]` pattern. Dark mode therefore inherits automatically through the existing `[data-theme="dark"]` re-bindings.

### `app/(app)/settings/IdentityForm.tsx`

- Added `import { CxCombobox } from '@/components/ui/CxCombobox'`.
- Deleted the `<datalist id="cx-id-types">` tag.
- Replaced both Type cells (edit row + add row) with `<CxCombobox options={existingTypes} value={…} onChange={(next) => setX(s => …)} />`. The `existingTypes` computation is untouched; consumer state shape (`{ name, type, email }`) remains string-typed.

### `components/triage/ExpandedCard.tsx`

- Added `import { CxCombobox } from '@/components/ui/CxCombobox'`.
- Deleted the `<datalist id="cx-id-suggest-types">` tag.
- Replaced the identity-suggest type input with `<CxCombobox>` wrapped in `<div style={{ flex: 1, minWidth: 140 }}>` — preserving the original sibling-flex sizing without polluting the locked `CxComboboxProps` API with a `style` prop. The dedup-and-defaults options expression (`['owner','company',…identities.map(i=>i.type)].filter(unique)`) is unchanged.

## Deviations from Plan

The orchestrator explicitly trimmed the plan's scope before execution. Two changes vs. the original plan:

### 1. Skipped 4 testing devDependencies
- **Source:** orchestrator override ("no new framework dependencies").
- **What:** `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` were NOT added.
- **Effect:** `package.json` is untouched. The existing jest baseline (318 passing, 1 pre-existing failure) is preserved exactly — no install, no lockfile churn.

### 2. Skipped `__tests__/cx-combobox.test.tsx`
- **Source:** orchestrator override ("verification will happen via Playwright at the orchestrator level after merge").
- **What:** The 7-case jsdom + RTL unit test file was NOT created.
- **Effect:** The locked behaviors (focus opens, filtering, keyboard nav, escape, custom value, click outside, ARIA correctness) are still implemented in the component itself — they just don't have a jsdom unit test guarding them. The orchestrator will validate via Playwright MCP post-merge.

### 3. (Implementation note, not really a deviation) `JSX.Element` → `React.ReactElement`
- **Why:** React 19 removed the ambient `JSX` namespace. The locked API in the plan stated `JSX.Element` but that no longer compiles under the project's `react@19.2.5`. Using the imported `ReactElement` type alias preserves the same observable contract (it's a React element). This is invisible to call sites — they don't write the return type.

## Verification

- **Type-check (`npx tsc --noEmit`):** Zero new errors from any of the four touched files. Baseline pre-existing errors in `__tests__/*.ts` (jest globals not picked up by the project tsconfig) are unchanged.
- **Unit tests (`npx jest`):** 318 passed / 1 failed / 26 suites — identical to baseline before this work. The 1 pre-existing failure is `consumer-prompts.test.ts › buildStage2Prompt — file › forbids inventing labels…`, unrelated to this plan.
- **Datalist eradicated (`rg -n '<datalist' app components`):** zero JSX matches; the only hit is the explanatory comment in `app/globals.css`.
- **No new runtime deps (`git diff package.json`):** package.json untouched.
- **No new `--cx-*` tokens defined:** new CSS only consumes existing tokens — no `:root` or `[data-theme="dark"]` additions.

## Notes for the orchestrator's Playwright verification

When validating post-merge, the user-visible flows to exercise are:

1. **Settings → Identity → edit row Type cell** — clicking the input opens the popover; typing filters; Enter / click commits; typing a brand-new value (not in `existingTypes`) and saving still POSTs the new type to `/api/identity`.
2. **Settings → Identity → + add identity → Type cell** — same behavior on the add row.
3. **Triage → expand a card requiring identity-suggest → Type field** — same behavior, plus visual check that the popover doesn't get cut off by the card's `cx-card-reason` panel (z-index: 20 on the list, which is above the card surface).
4. **Dark mode parity** — toggle `[data-theme="dark"]` and confirm the popover background/border/highlight all flip without hardcoded color leakage.

## Self-Check: PASSED

- `components/ui/CxCombobox.tsx` exists.
- `9e7c414` (Task 1 commit) and `dd2c64b` (Task 2 commit) both present in `git log`.
- `app/globals.css` and `design/project/styles.css` both contain `.cx-combobox-list { … }`.
- `app/(app)/settings/IdentityForm.tsx` and `components/triage/ExpandedCard.tsx` both import `CxCombobox` and contain `<CxCombobox` JSX usages.
- Zero `<datalist>` JSX tags remain in `app/` or `components/`.
