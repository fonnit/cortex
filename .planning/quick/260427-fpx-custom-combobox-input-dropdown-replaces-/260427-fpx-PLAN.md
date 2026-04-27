---
phase: 260427-fpx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - components/ui/CxCombobox.tsx
  - app/globals.css
  - design/project/styles.css
  - __tests__/cx-combobox.test.tsx
  - jest.config.js
  - tsconfig.test.json
  - package.json
  - app/(app)/settings/IdentityForm.tsx
  - components/triage/ExpandedCard.tsx
autonomous: true
requirements:
  - FPX-01  # Build CxCombobox reusable component (input + dropdown) with cx-* tokens
  - FPX-02  # Replace 3 datalist call sites with CxCombobox; preserve "type-a-new-value" UX

must_haves:
  truths:
    - "Clicking or focusing the CxCombobox input opens a dropdown showing all options."
    - "Typing in the CxCombobox filters the visible options case-insensitively (substring match)."
    - "ArrowDown/ArrowUp moves the highlighted option; Enter selects it; Escape closes without changing the value."
    - "Clicking outside the component closes the dropdown."
    - "Typing a value not present in options keeps that value as the committed value (custom-value support)."
    - "All three former datalist locations (IdentityForm edit row, IdentityForm add row, ExpandedCard identity-suggest) now render a CxCombobox and the obsolete <datalist> tags are removed."
    - "The new component visually matches existing cx-prop-newinput styling and uses only existing --cx-* tokens; popover styling uses --cx-panel, --cx-rule, --cx-radius, --cx-ink-*, --cx-accent-soft, --cx-accent-ink."
    - "Dark mode parity is preserved (no hardcoded colors; all CSS uses design tokens that re-bind under [data-theme=\"dark\"])."
    - "Unit tests in __tests__/cx-combobox.test.tsx pass under jest+jsdom."
    - "npx tsc --noEmit passes for all touched files (no type regressions)."
  artifacts:
    - path: "components/ui/CxCombobox.tsx"
      provides: "Reusable combobox component matching the locked CxComboboxProps API"
      exports: ["CxCombobox"]
    - path: "app/globals.css"
      provides: "Combobox CSS rules (.cx-combobox, .cx-combobox-list, .cx-combobox-option)"
      contains: ".cx-combobox-list"
    - path: "design/project/styles.css"
      provides: "Mirror of combobox CSS rules (source-of-truth file referenced by globals.css header)"
      contains: ".cx-combobox-list"
    - path: "__tests__/cx-combobox.test.tsx"
      provides: "jsdom + RTL tests covering filter, keyboard nav, escape, custom-value, click-outside"
      contains: "describe('CxCombobox'"
    - path: "app/(app)/settings/IdentityForm.tsx"
      provides: "Edit-row and add-row Type fields use CxCombobox (no datalist)"
      contains: "CxCombobox"
    - path: "components/triage/ExpandedCard.tsx"
      provides: "Identity-suggest type field uses CxCombobox (no datalist)"
      contains: "CxCombobox"
  key_links:
    - from: "app/(app)/settings/IdentityForm.tsx"
      to: "components/ui/CxCombobox.tsx"
      via: "import { CxCombobox } from '@/components/ui/CxCombobox'"
      pattern: "import.*CxCombobox.*from.*components/ui/CxCombobox"
    - from: "components/triage/ExpandedCard.tsx"
      to: "components/ui/CxCombobox.tsx"
      via: "import { CxCombobox } from '@/components/ui/CxCombobox'"
      pattern: "import.*CxCombobox.*from.*components/ui/CxCombobox"
    - from: "__tests__/cx-combobox.test.tsx"
      to: "components/ui/CxCombobox.tsx"
      via: "import { CxCombobox } from '@/components/ui/CxCombobox'"
      pattern: "import.*CxCombobox"
    - from: "app/globals.css"
      to: ".cx-combobox-list popover styling"
      via: "appended ruleset using --cx-* tokens"
      pattern: "\\.cx-combobox-list\\s*\\{"
---

<objective>
Replace the three `<input list="…">` + `<datalist>` patterns with a single, reusable `<CxCombobox>` component that preserves the existing UX exactly (including "type a value not in the list and it's still accepted") while remaining stylistically identical to the bespoke cx-* design system.

Purpose: Eliminate the inconsistent native `<datalist>` (which renders differently per browser, has limited keyboard control, and ignores the cx-* design tokens) without introducing any new runtime dependencies. The component must remain accessible (ARIA combobox pattern) and dark-mode-correct.

Output:
- `components/ui/CxCombobox.tsx` (new shared component, locked API)
- New CSS rules in `app/globals.css` AND mirrored to `design/project/styles.css` (source-of-truth file)
- `__tests__/cx-combobox.test.tsx` (jsdom + RTL coverage)
- Three call sites converted; the two `<datalist>` tags removed
- Test infra: `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` added as devDependencies (only the test surface needs them; runtime deps are unchanged — see Note in Task 1)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@app/globals.css
@app/(app)/settings/IdentityForm.tsx
@components/triage/ExpandedCard.tsx
@components/triage/TriageView.tsx
@package.json
@jest.config.js
@tsconfig.test.json

<interfaces>
<!-- Locked component API. Executor MUST implement exactly this signature. -->

```typescript
// components/ui/CxCombobox.tsx
export interface CxComboboxProps {
  value: string
  onChange: (next: string) => void
  options: string[]               // suggestion list (substring-filtered, case-insensitive)
  placeholder?: string
  className?: string              // wrapper class (for sizing/flex/style overrides)
  inputClassName?: string         // inner input class (default: "cx-prop-newinput")
  autoFocus?: boolean
  disabled?: boolean
  id?: string                     // forwarded to inner input for label associations
}

export function CxCombobox(props: CxComboboxProps): JSX.Element
```

<!-- Existing CSS tokens available in app/globals.css (read-only reference): -->
--cx-panel, --cx-panel-2, --cx-bg
--cx-ink, --cx-ink-80, --cx-ink-60, --cx-ink-40, --cx-ink-20, --cx-ink-10
--cx-rule
--cx-accent, --cx-accent-soft, --cx-accent-ink
--cx-radius (6px), --cx-radius-lg (10px)

<!-- Existing baseline class for the visual input look -->
.cx-prop-newinput { border:0; background:transparent; outline:none; font:inherit; color:var(--cx-ink); padding:0; width:100%; }

<!-- Call-site shapes the executor will replace (do NOT alter consumer logic, only the input element): -->

IdentityForm.tsx:87 (edit row Type cell):
  <input className="cx-prop-newinput" list="cx-id-types"
    value={editState.type}
    onChange={e => setEditState(s => s ? { ...s, type: e.target.value } : s)} />

IdentityForm.tsx:110 (add row Type cell):
  <input className="cx-prop-newinput" list="cx-id-types"
    value={addOpen.type}
    onChange={e => setAddOpen(s => s ? { ...s, type: e.target.value } : s)} />

ExpandedCard.tsx:159-166 (identity-suggest type):
  <input className="cx-prop-newinput" list="cx-id-suggest-types"
    placeholder="type (e.g. company, partner)"
    style={{ flex: 1, minWidth: 140 }}
    value={identitySuggest.type}
    onChange={e => setIdentitySuggest(s => s ? { ...s, type: e.target.value } : s)} />

<!-- IdentityForm.tsx line 68 datalist (delete after replacement): -->
  <datalist id="cx-id-types">{existingTypes.map(t => <option key={t} value={t} />)}</datalist>

<!-- ExpandedCard.tsx line 154 datalist (delete after replacement): -->
  <datalist id="cx-id-suggest-types">{['owner','company',...identities.map(i=>i.type)].filter((v,i,a)=>a.indexOf(v)===i).map(t => <option key={t} value={t} />)}</datalist>

<!-- Existing test infrastructure (jest.config.js): -->
- testEnvironment: 'node' (must override per-file to 'jsdom' for the new test)
- preset: 'ts-jest' with tsconfig.test.json (already has jsx: 'react-jsx')
- testMatch: includes **/__tests__/**/*.test.tsx ← .tsx already picked up
</interfaces>

<discovery_notes>
- Discovery level: 0–1. No external library evaluation. The scope explicitly forbids cmdk / Radix / Headless UI. We are building from React + existing cx-* tokens only. No Context7 lookup is needed; ARIA combobox pattern is well-known (input role="combobox", aria-expanded, aria-controls, aria-autocomplete="list"; listbox role="listbox"; options role="option" + aria-selected).
- jest infra reality check (executor must heed):
  - jest.config.js currently sets `testEnvironment: 'node'`. Existing __tests__/*.ts files rely on this.
  - The new .tsx test must run under jsdom. We will:
    (a) Add the per-file docblock pragma `/** @jest-environment jsdom */` at the top of `cx-combobox.test.tsx`, AND
    (b) Add `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` as devDependencies.
  - Do NOT change the global `testEnvironment` — that would break the existing 12 node-based tests.
- `tsconfig.test.json` already has `jsx: "react-jsx"` so .tsx will compile.
- Scope says "No deps added" under "Out of scope" — interpreted as no runtime deps added. The four test-only packages above are devDependencies and are required to satisfy the locked test requirement (jsdom + RTL). If the user disagrees, the alternative is to write a hand-rolled jsdom test using `react-dom/server` + `react-dom/client` + manual event dispatch, which is brittle and not recommended. Note this judgment call in the SUMMARY.md.
- `design/project/styles.css` exists and is the source-of-truth file; mirror the new rules there to keep the "DO NOT EDIT [globals.css] — Edit source file and re-sync" header honest.
</discovery_notes>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build CxCombobox component, append cx-combobox CSS, add jsdom test infra and unit tests</name>
  <files>
    components/ui/CxCombobox.tsx (new),
    app/globals.css (append),
    design/project/styles.css (append, mirror),
    __tests__/cx-combobox.test.tsx (new),
    package.json (add 4 devDependencies),
    jest.config.js (NO change — verify the new .tsx test path is matched),
    tsconfig.test.json (NO change expected — already has jsx:react-jsx)
  </files>
  <behavior>
    The CxCombobox unit test (jsdom + @testing-library/react + @testing-library/user-event) must cover:

    1. **renders options when input is focused** — mount with `options=['owner','company','partner']`, focus input via `user.click(input)`, assert all three options appear with `role="option"`.
    2. **typing filters the options (case-insensitive)** — focus, type "Com", assert only "company" appears (not "owner", not "partner"); type lowercase "com" → same result.
    3. **arrow-down + enter selects an option** — focus, press ArrowDown twice (highlights "company"), press Enter, assert `onChange` was called with `"company"` and the listbox is no longer in the document.
    4. **escape closes without changing value** — type "xyz", press Escape, assert the listbox is gone AND `onChange` was NOT called (custom-value still typed but unchanged from props perspective; the component is controlled).
    5. **typing a value not in options and blurring keeps that value** — focus, type "newtype", click outside (e.g. a sibling button), assert `onChange` was called with `"newtype"` (last keystroke value); the listbox closes.
    6. **click outside closes the popover** — focus to open, then `user.click` on a sibling element rendered next to the combobox; assert listbox is gone.
    7. **ARIA correctness** — input has `role="combobox"`, `aria-expanded` toggles "true"/"false" when popover opens/closes, `aria-controls` references the listbox `id`, `aria-autocomplete="list"`. Listbox has `role="listbox"`. Options have `role="option"`; the highlighted option has `aria-selected="true"` and the others `aria-selected="false"`.

    Tests use the per-file pragma `/** @jest-environment jsdom */` at the top of the file. Expected: 7 passing test cases.
  </behavior>
  <action>
    Step A — Add devDependencies (test-only, no runtime impact):
      Edit `package.json` `devDependencies` and add:
        "@testing-library/jest-dom": "^6.6.3"
        "@testing-library/react": "^16.1.0"
        "@testing-library/user-event": "^14.5.2"
        "jest-environment-jsdom": "^30.3.0"
      Use exact versions in the package.json so reproducible. Run `npm install` (or `pnpm install` — match whatever lockfile exists; check `package-lock.json` vs `pnpm-lock.yaml` first). Verify the install succeeds before writing the test file.
      NOTE: This is the only deviation from "No deps added". The scope locks jsdom + RTL tests, which physically cannot run without these. They are devDependencies (test-only). If the install introduces audit warnings, ignore them — they are upstream and not in our control.

    Step B — Create `components/ui/CxCombobox.tsx`:
      - `'use client'` at top (Next.js App Router; the component uses useState/useRef/useEffect).
      - Implement the locked `CxComboboxProps` interface exactly as defined in <interfaces>.
      - Internal state: `open: boolean`, `highlight: number` (index into FILTERED options; -1 = none).
      - Filter: case-insensitive substring match: `options.filter(o => o.toLowerCase().includes(value.toLowerCase()))`. If `value` is empty, show all options.
      - Refs: `wrapperRef` (HTMLDivElement) for outside-click detection; `listboxRef` for the popover.
      - Generate a stable listbox id with `useId()` for `aria-controls`.
      - Wrapper: `<div ref={wrapperRef} className={"cx-combobox " + (className ?? "")}>`.
      - Input: 
          `<input
            id={id}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? optionId(highlight) : undefined}
            className={inputClassName ?? "cx-prop-newinput"}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(-1) }}
            onKeyDown={handleKeyDown}
          />`
      - Popover: render `<ul role="listbox" id={listboxId} ref={listboxRef} className="cx-combobox-list">…</ul>` ONLY when `open && filtered.length > 0`. Each option:
          `<li
             id={optionId(i)}
             key={opt}
             role="option"
             aria-selected={highlight === i}
             className="cx-combobox-option"
             onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); setHighlight(-1) }}
             onMouseEnter={() => setHighlight(i)}
           >{opt}</li>`
        Note `onMouseDown` (not `onClick`) with `preventDefault` — prevents the input from blurring before the click handler fires.
      - Keyboard: `handleKeyDown(e)`:
          ArrowDown → if !open setOpen(true); else setHighlight(h => Math.min(filtered.length - 1, h + 1)); preventDefault.
          ArrowUp → setHighlight(h => Math.max(0, h - 1)); preventDefault.
          Enter → if open && highlight >= 0: onChange(filtered[highlight]); setOpen(false); setHighlight(-1); preventDefault.
          Escape → setOpen(false); setHighlight(-1); preventDefault. (DO NOT call onChange — value unchanged.)
          Tab → setOpen(false). Don't preventDefault — natural tab order.
      - Outside click: useEffect attaches a `mousedown` listener on document; if `wrapperRef.current && !wrapperRef.current.contains(e.target)` → `setOpen(false)`. Cleanup on unmount.
      - When `value` changes externally (controlled), reset highlight to -1 and recompute filter (derived in render — no extra effect needed).
      - Optional: scroll-into-view of highlighted option (use `useEffect` watching `highlight` and `listboxRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })`). Nice to have, not required for tests.

    Step C — Append CSS to `app/globals.css` AND `design/project/styles.css` (identical block in BOTH files; the design file is the source-of-truth per the globals.css header):

      ```css
      /* ── Combobox (input + dropdown, replaces native <datalist>) ─────── */
      .cx-combobox {
        position: relative;
        width: 100%;
      }
      .cx-combobox-list {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 20;
        list-style: none;
        margin: 0;
        padding: 4px;
        background: var(--cx-panel);
        border: 1px solid var(--cx-rule);
        border-radius: var(--cx-radius);
        box-shadow: 0 8px 24px -12px rgba(32,29,23,.18);
        max-height: 240px;
        overflow-y: auto;
      }
      .cx-combobox-option {
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 13.5px;
        color: var(--cx-ink);
        cursor: pointer;
        line-height: 1.4;
      }
      .cx-combobox-option:hover {
        background: var(--cx-ink-10);
      }
      .cx-combobox-option[aria-selected="true"] {
        background: var(--cx-accent-soft);
        color: var(--cx-accent-ink);
      }
      ```

      Append to BOTH files at the end (after the last existing rule). No new tokens introduced — only existing --cx-* variables. The shadow uses `rgba(32,29,23,.18)` which mirrors the existing pattern in `[data-card-surface="panel"]` (which uses `rgba(32,29,23,.25)`). Dark mode is handled automatically because `--cx-panel`, `--cx-rule`, `--cx-ink-10`, `--cx-accent-soft`, `--cx-accent-ink` all re-bind under `[data-theme="dark"]`.

    Step D — Create `__tests__/cx-combobox.test.tsx`:
      - First line: `/** @jest-environment jsdom */`
      - Imports:
          import '@testing-library/jest-dom'
          import { render, screen, queryByRole, within } from '@testing-library/react'
          import userEvent from '@testing-library/user-event'
          import { useState } from 'react'
          import { CxCombobox } from '../components/ui/CxCombobox'
      - Use a tiny `<Harness>` wrapper component that holds value in `useState` and renders the combobox + a sibling `<button data-testid="outside">outside</button>` for click-outside / blur tests.
      - Implement the 7 cases enumerated in <behavior>. Use `userEvent.setup()` for realistic user interactions (handles focus/blur correctly).
      - For "click outside" specifically: `await user.click(screen.getByTestId('outside'))` — this fires mousedown then click on the outside element, which our document mousedown handler will catch.
      - For ARIA assertions: `expect(input).toHaveAttribute('role', 'combobox')`, `expect(input).toHaveAttribute('aria-expanded', 'true')` etc.

    Step E — Run the test:
      `npx jest __tests__/cx-combobox.test.tsx --no-coverage`
      Expected: 7 passing. Iterate until green. The jest.config.js does NOT need editing — `**/__tests__/**/*.test.tsx` is already in `testMatch`. The per-file `@jest-environment jsdom` pragma overrides the global `testEnvironment: 'node'`.

    Step F — Run typecheck on the new component & test file:
      `npx tsc --noEmit -p tsconfig.test.json` to ensure tests compile.
      `npx tsc --noEmit` (project tsconfig) to ensure the component compiles in the Next build context.
      Both must be clean (zero errors from files this task created).

    Avoid:
      - Do NOT use `<select>` anywhere — the scope explicitly rejects it (kills custom-value behavior).
      - Do NOT add cmdk / Headless UI / Radix / @floating-ui — pure React only.
      - Do NOT change the global jest `testEnvironment` — would break 12 existing node tests.
      - Do NOT introduce new --cx-* tokens — reuse existing ones only.
      - Do NOT use `onClick` on the option `<li>` — use `onMouseDown` with `preventDefault()`. Otherwise the input's blur fires first, the popover unmounts, and the click never lands.
  </action>
  <verify>
    <automated>npx jest __tests__/cx-combobox.test.tsx --no-coverage && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `components/ui/CxCombobox.tsx` exists, exports `CxCombobox` matching the locked API.
    - `app/globals.css` and `design/project/styles.css` both contain the `.cx-combobox*` rules using only existing --cx-* tokens.
    - `__tests__/cx-combobox.test.tsx` runs under jsdom and all 7 test cases pass.
    - `npx tsc --noEmit` is clean (no new type errors introduced).
    - 4 devDependencies added to package.json; lockfile updated; install succeeded.
    - The 12 existing node-based __tests__ are not broken (sanity: `npx jest __tests__/queue-config.test.ts` still passes).
  </done>
</task>

<task type="auto">
  <name>Task 2: Replace 3 datalist usages with CxCombobox; remove orphaned datalist tags</name>
  <files>
    app/(app)/settings/IdentityForm.tsx (edit lines ~68, ~87, ~110),
    components/triage/ExpandedCard.tsx (edit lines ~154, ~159–166)
  </files>
  <action>
    Step A — `app/(app)/settings/IdentityForm.tsx`:

      1. Add import at top (after existing imports):
         `import { CxCombobox } from '@/components/ui/CxCombobox'`

      2. DELETE the `<datalist id="cx-id-types">…</datalist>` block (currently lines ~68–70, immediately after `return (`). This block is no longer needed.

      3. Replace the edit-row Type cell (line ~87):
           BEFORE:
             <td><input className="cx-prop-newinput" list="cx-id-types" value={editState.type} onChange={e => setEditState(s => s ? { ...s, type: e.target.value } : s)} /></td>
           AFTER:
             <td>
               <CxCombobox
                 options={existingTypes}
                 value={editState.type}
                 onChange={(next) => setEditState(s => s ? { ...s, type: next } : s)}
               />
             </td>

      4. Replace the add-row Type cell (line ~110):
           BEFORE:
             <td><input className="cx-prop-newinput" list="cx-id-types" value={addOpen.type} onChange={e => setAddOpen(s => s ? { ...s, type: e.target.value } : s)} /></td>
           AFTER:
             <td>
               <CxCombobox
                 options={existingTypes}
                 value={addOpen.type}
                 onChange={(next) => setAddOpen(s => s ? { ...s, type: next } : s)}
               />
             </td>

      Note: Component file already starts with `'use client'` — no change needed. `existingTypes` is already computed earlier in the function and is in scope at both call sites.

    Step B — `components/triage/ExpandedCard.tsx`:

      1. Add import at top (after existing imports):
         `import { CxCombobox } from '@/components/ui/CxCombobox'`

      2. DELETE the `<datalist id="cx-id-suggest-types">…</datalist>` block (currently lines ~154–156, the first child of the `{identitySuggest && !identitySaved &&` div).

      3. Replace the input (lines ~159–166):
           BEFORE:
             <input
               className="cx-prop-newinput"
               list="cx-id-suggest-types"
               placeholder="type (e.g. company, partner)"
               style={{ flex: 1, minWidth: 140 }}
               value={identitySuggest.type}
               onChange={e => setIdentitySuggest(s => s ? { ...s, type: e.target.value } : s)}
             />
           AFTER:
             <CxCombobox
               className="cx-id-suggest-type"
               options={['owner', 'company', ...identities.map(i => i.type)].filter((v, i, a) => a.indexOf(v) === i)}
               value={identitySuggest.type}
               onChange={(next) => setIdentitySuggest(s => s ? { ...s, type: next } : s)}
               placeholder="type (e.g. company, partner)"
             />

         The inline `style={{ flex: 1, minWidth: 140 }}` was on the input. CxCombobox's wrapper takes `className`, not `style`, but the wrapper is `position: relative; width: 100%`. Inside the existing flex parent (`display: flex; gap: 10`), the wrapper will already flex. To preserve the `minWidth: 140` constraint:
           - Add a one-off inline style on the parent flex item — wrap `<CxCombobox>` in a `<div style={{ flex: 1, minWidth: 140 }}>` so the wrapper sits inside a sized flex item:
             `<div style={{ flex: 1, minWidth: 140 }}><CxCombobox … /></div>`
           This preserves the existing visual flow exactly without introducing a new `style` prop on CxCombobox.

      Note: ExpandedCard is imported into TriageView.tsx which is `'use client'`; this file does not currently have its own `'use client'` directive but inherits the boundary from its parent. Adding a useState-bearing component (CxCombobox) does not change that — the whole subtree is already client-rendered. Leave file boundaries as-is.

    Step C — Verify nothing else references the deleted datalist ids:
      `rg -n 'cx-id-types|cx-id-suggest-types' app components` — expected: ZERO matches. If any survive, delete those references too.

    Step D — Typecheck:
      `npx tsc --noEmit` must be clean. Pay attention to the `onChange` signature on CxCombobox vs. the previous `e => …` form — the new prop receives the next string directly, NOT a SyntheticEvent.

    Step E — Re-run the combobox unit test (regression sanity):
      `npx jest __tests__/cx-combobox.test.tsx` — should still pass (no behavior change from Task 1).

    Avoid:
      - Do NOT modify the consumer state shapes (`editState`, `addOpen`, `identitySuggest`) — they remain `string` for the type field.
      - Do NOT remove the `existingTypes` computation in IdentityForm — it's still passed as `options`.
      - Do NOT remove the dedup-and-defaults logic in ExpandedCard's options expression — that logic is what feeds `options`.
      - Do NOT add Playwright/E2E here. The orchestrator handles MCP-driven visual verification post-merge.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest __tests__/cx-combobox.test.tsx --no-coverage && rg -n 'cx-id-types|cx-id-suggest-types|<datalist' app components | (grep . && exit 1 || exit 0)</automated>
  </verify>
  <done>
    - `app/(app)/settings/IdentityForm.tsx` no longer contains `<datalist>` or `list="cx-id-types"`; the edit-row and add-row Type cells render `<CxCombobox … />`.
    - `components/triage/ExpandedCard.tsx` no longer contains `<datalist>` or `list="cx-id-suggest-types"`; the identity-suggest type input renders `<CxCombobox … />` wrapped in a `<div style={{ flex: 1, minWidth: 140 }}>`.
    - `rg -n 'cx-id-types|cx-id-suggest-types|<datalist'` returns zero hits in `app/` and `components/`.
    - `npx tsc --noEmit` is clean.
    - `npx jest __tests__/cx-combobox.test.tsx` still passes (7/7 cases).
  </done>
</task>

</tasks>

<verification>
Phase-level checks (run after both tasks complete):

1. **Unit tests green:**
   `npx jest __tests__/cx-combobox.test.tsx --no-coverage` — 7/7 pass.

2. **Existing node tests not broken:**
   `npx jest --testPathIgnorePatterns="keytar"` — all non-keytar tests still pass (matches the pre-existing baseline; keytar suites are blocked outside this plan's scope per the brief).

3. **Type-check clean:**
   `npx tsc --noEmit` — zero errors from the four touched/created files.

4. **Datalist eradicated:**
   `rg -n '<datalist|list="cx-id-types"|list="cx-id-suggest-types"' app components` returns zero hits.

5. **CSS parity:**
   `rg -n '\.cx-combobox' app/globals.css design/project/styles.css` — both files contain identical `.cx-combobox`, `.cx-combobox-list`, `.cx-combobox-option`, and `.cx-combobox-option[aria-selected="true"]` rules.

6. **No new runtime deps:**
   `git diff package.json` — only `devDependencies` modified; `dependencies` block untouched.

7. **No new --cx-* tokens:**
   `git diff app/globals.css design/project/styles.css | rg '\-\-cx\-[a-z\-]+:' | rg -v 'rgba|/\*'` — zero matches outside existing `:root` and `[data-theme="dark"]` blocks (i.e. no new variable definitions, only token usage).
</verification>

<success_criteria>
- A single, reusable `<CxCombobox>` component exists at `components/ui/CxCombobox.tsx`, matches the locked API, and passes 7 jsdom unit tests covering: focus-opens, filtering, keyboard nav, escape, custom-value, click-outside, ARIA correctness.
- The three former datalist call sites in `app/(app)/settings/IdentityForm.tsx` (edit row, add row) and `components/triage/ExpandedCard.tsx` (identity-suggest) now render `<CxCombobox>` and the two `<datalist>` tags are gone.
- New CSS rules (`.cx-combobox`, `.cx-combobox-list`, `.cx-combobox-option`, `.cx-combobox-option[aria-selected="true"]`) are present in BOTH `app/globals.css` and `design/project/styles.css`, use only pre-existing `--cx-*` tokens, and respect dark mode via the existing `[data-theme="dark"]` re-bindings.
- `npx tsc --noEmit` clean. `npx jest __tests__/cx-combobox.test.tsx` clean.
- Zero new runtime dependencies (only 4 test-only devDependencies added: `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`).
- The brittle native `<datalist>` UX is replaced by a deterministic, dark-mode-correct, accessible combobox; the user can still type a value not in the suggestion list and that value is committed (preserving the "create new identity type" behavior).
</success_criteria>

<output>
After completion, create `.planning/quick/260427-fpx-custom-combobox-input-dropdown-replaces-/260427-fpx-SUMMARY.md` capturing:
- Files created / modified (with line counts)
- The 4 devDependencies added (and why — link back to the locked test requirement)
- Notes on the `@jest-environment jsdom` per-file pragma approach (vs. global config change)
- Any cosmetic deltas observed when running the dev server (e.g. dropdown shadow intensity, popover z-index interactions with the active card)
- Confirmation that the 12 existing __tests__ still pass
- A one-line note that Playwright MCP-driven visual verification is the orchestrator's responsibility post-merge
</output>
