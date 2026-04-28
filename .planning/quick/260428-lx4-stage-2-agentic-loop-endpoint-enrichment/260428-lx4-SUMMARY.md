---
phase: quick-260428-lx4
plan: 01
subsystem: stage-2-classifier
tags: [mcp, claude-cli, stage2, endpoints, agentic-loop]
requires:
  - /lib/api-key.ts requireApiKey
  - /lib/prisma Item.{status, axis_*, proposed_drive_path, confirmed_drive_path}
  - @modelcontextprotocol/sdk@^1.29.0 (new agent dep)
provides:
  - /api/labels/samples (GET, requireApiKey)
  - /api/path-feedback (GET, requireApiKey)
  - agent stdio MCP server `cortex-tools` (3 tools)
  - claude.ts MCP plumbing: --mcp-config + --strict-mcp-config + --allowedTools + --max-budget-usd
  - extractFinalJsonObject for multi-turn stdout
affects:
  - Stage 2 prompt no longer inlines path tree; declares 3 MCP tools instead
  - Stage 2 worker no longer fetches paths; Claude calls cortex_paths_internal on demand
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@^1.29.0 (ESM, Node ≥18, Zod ≥3.25 || ≥4)"
  patterns:
    - "requireApiKey-guarded GET routes (mirrors /api/paths/internal posture)"
    - "Stdio MCP server as a thin fetch proxy (returns isError on non-2xx)"
key-files:
  created:
    - "app/api/labels/samples/route.ts"
    - "app/api/path-feedback/route.ts"
    - "__tests__/labels-samples-api.test.ts"
    - "__tests__/path-feedback-api.test.ts"
    - "agent/src/mcp/cortex-tools.ts"
    - "agent/__tests__/mcp-cortex-tools.test.ts"
  modified:
    - "agent/package.json (+@modelcontextprotocol/sdk)"
    - "agent/package-lock.json"
    - "agent/src/consumer/claude.ts (MCP plumbing + extractFinalJsonObject)"
    - "agent/src/consumer/prompts.ts (PathContext removed, tool declarations added)"
    - "agent/src/consumer/stage2.ts (getPathsInternalImpl removed)"
    - "agent/__tests__/consumer-claude.test.ts (Tests A1–A4 + A7)"
    - "agent/__tests__/consumer-prompts.test.ts (drops PATHS arg)"
    - "agent/__tests__/consumer-stage2-prompt.test.ts (Tests P1–P6)"
    - "agent/__tests__/consumer-stage2.test.ts (paths fixture + impl removed)"
    - "__tests__/queue-api-integration.test.ts (route-list snapshot updated)"
decisions:
  - "D1 confirmed: derive path-feedback from row-level diff between proposed and confirmed paths on filed Items — no PathCorrection table"
  - "D2 confirmed: @modelcontextprotocol/sdk@^1.29.0 — installable, ESM-native, Node ≥18, Zod 4 compatible"
  - "D3 confirmed: no native iteration cap in claude -p; use --max-budget-usd $0.50 + existing 120s timeout"
  - "D4 confirmed: tool errors return { isError, content } so model can fall back to 'uncertain'; server stays alive across transient API hiccups"
metrics:
  tasks_completed: 3
  duration_minutes: 75
  completed_date: 2026-04-28
---

# Quick Task 260428-lx4: Stage 2 Agentic Loop + Endpoint Enrichment Summary

Convert Stage 2 from single-shot `claude -p` into a tool-call loop: the model
now calls 3 MCP tools (cortex_paths_internal / cortex_label_samples /
cortex_path_feedback) on demand instead of receiving a static prompt-byte
dump. The /api/classify contract is unchanged — only the prompt-construction
path and claude.ts argv shape changed.

## Files Created / Modified

### Endpoints (Task 1)

- `app/api/labels/samples/route.ts` — GET requireApiKey-guarded; 5 most-recent
  filed items by axis label; clamp limit ≤20.
- `app/api/path-feedback/route.ts` — GET requireApiKey-guarded; user-move
  signal derived from row-level diff between proposed_drive_path and
  confirmed_drive_path on filed Items; default 30d window, default limit 20,
  hard cap 50.
- `__tests__/labels-samples-api.test.ts` — 13 jest assertions.
- `__tests__/path-feedback-api.test.ts` — 10 jest assertions.

### Stdio MCP Server (Task 2)

- `agent/src/mcp/cortex-tools.ts` — McpServer factory + 3 tools
  (cortex_paths_internal, cortex_label_samples, cortex_path_feedback) +
  validateMcpEnv + auto-start gated on JEST_WORKER_ID. Each tool is a thin
  fetch proxy with Bearer auth; non-2xx → `{ isError, content: text }`.
- `agent/__tests__/mcp-cortex-tools.test.ts` — 13 jest assertions including
  factory wiring (in-memory transport pair), URL construction with URL-encoded
  label, error-result shape, isolated env validation.
- `agent/package.json` — `@modelcontextprotocol/sdk: ^1.29.0`.

### Claude Plumbing + Prompt + Worker (Task 3)

- `agent/src/consumer/claude.ts`:
  - New `writeMcpConfigTmpfile()` writes a randomized JSON file under
    `os.tmpdir()` with the cortex MCP server config (T-lx4-01: cleanup in
    finally).
  - invokeClaude args = `['-p', prompt, '--mcp-config', tmpPath,
    '--strict-mcp-config', '--allowedTools', ALLOWED_TOOLS,
    '--max-budget-usd', '0.5']`.
  - New `extractFinalJsonObject` walks all balanced top-level brace ranges
    and returns the LAST one that JSON.parses cleanly — multi-turn output
    after tool calls puts the decision JSON last.
  - `extractFirstJsonObject` kept exported for backwards compat (no
    consumers; still used by some tests).
- `agent/src/consumer/prompts.ts`: `PathContext` interface + `paths` arg
  REMOVED from `buildStage2Prompt`. Replaced inline path-tree dump with a
  "Tools available" section listing the 3 MCP tools and a final-message-must-
  be-only-JSON instruction. Decision rules + JSON shape sentence preserved.
- `agent/src/consumer/stage2.ts`: `getPathsInternalImpl` removed from
  `Stage2Deps` and the loop body. ClassifyRequest shape unchanged.
- Test updates across consumer-claude / consumer-stage2 / consumer-stage2-
  prompt / consumer-prompts.

## Decisions Taken

| ID | Decision | Confirmed |
|----|----------|-----------|
| D1 | Derive path-feedback from row-level diff between proposed/confirmed paths on filed Items — no `PathCorrection` table | ✓ |
| D2 | `@modelcontextprotocol/sdk@^1.29.0` — installable, ESM-native, Zod 4 compatible | ✓ |
| D3 | No native iteration cap in `claude -p`; use `--max-budget-usd 0.50` + existing 120s timeout | ✓ |
| D4 | Tool errors return `{ isError, content: text }` so the model can fall back to `'uncertain'`; server stays alive across transient API hiccups | ✓ |

## Deviations from Plan

### Rule 3 — Auto-fix blocking issues

**1. queue-api-integration route-list snapshot needed updating**
- **Found during:** Task 1 verification (full-suite regression run)
- **Issue:** `__tests__/queue-api-integration.test.ts` locks the `app/api/`
  directory entries to a 12-route snapshot from Phase 5. Adding `labels/` +
  `path-feedback/` (lx4) made the assertion fail. The h9w `paths/` directory
  was also missing from the snapshot — the prior plan never updated it.
- **Fix:** Updated the snapshot to include all current routes (15 entries
  including paths, labels, path-feedback).
- **Files modified:** `__tests__/queue-api-integration.test.ts`.
- **Commit:** `76e5fc4`

**2. claude.ts source-file invariants relaxed for new posture**
- **Found during:** Task 3 (running consumer-claude.test.ts)
- **Issue:** Two pre-existing static-source guards conflicted with the
  required new posture:
  1. "does NOT reference any API key env var" — but `CORTEX_API_KEY` MUST
     appear because the MCP config tmpfile sets it in the spawned cortex-
     tools server's env.
  2. "does NOT import from fs / node:fs" — but `writeMcpConfigTmpfile()` MUST
     write a JSON file before spawn.
- **Fix:** Updated guards to preserve original intent — still no
  `OPENAI_API_KEY`; `ANTHROPIC_API_KEY` only allowed in `delete out.` form
  (the scrub helper); fs imports allowed but constrained to `os.tmpdir()` per
  T-lx4-01.
- **Files modified:** `agent/__tests__/consumer-claude.test.ts`.
- **Commit:** `76e5fc4`

**3. Pre-existing 'allowlists ONLY PATH and HOME' test rewritten**
- **Found during:** Task 3 baseline (the test was already failing pre-existing
  from the 260428-jrt env-scrubbing change).
- **Issue:** Source had been changed to pass full env (scrubbed of Anthropic
  keys) for macOS Keychain access via securityd, but the test was never
  updated.
- **Fix:** Replaced with `'scrubs Anthropic-bound API keys from subprocess
  env'` — same intent (don't bill against API credits) but compatible with
  the post-jrt source.
- **Files modified:** `agent/__tests__/consumer-claude.test.ts`.

### Pre-existing issues NOT fixed (out of scope)

- `__tests__/triage-api.test.ts` fails to compile under ts-jest (TS2740 —
  inline `Item` literals missing required fields). Reproduces with all lx4
  changes stashed. Logged in `deferred-items.md`.

## Verification

- `npx jest __tests__/labels-samples-api.test.ts __tests__/path-feedback-api.test.ts __tests__/paths-internal-api.test.ts` — **33/33 green**.
- `npx jest agent/__tests__/mcp-cortex-tools.test.ts agent/__tests__/consumer-claude.test.ts agent/__tests__/consumer-stage2.test.ts agent/__tests__/consumer-stage2-prompt.test.ts` — **88/88 green**.
- `cd agent && npx tsc` — TypeScript compiles clean.
- Static greps:
  - `grep -r 'getPathsInternalImpl' agent/src` — 0 hits.
  - `grep -r 'PathContext' agent/src` — 0 hits.
  - `grep -n 'extractFinalJsonObject' agent/src/consumer/claude.ts` — present at lines 28, 344, 416, 502.
- Full-suite regression: 392/393 pass; the single fail is the pre-existing
  triage-api compile error (out of scope).

## Live Smoke-Test

Not run — requires a deployed Vercel preview with the new endpoints AND a
local `claude -p` subprocess that can resolve `agent/dist/mcp/cortex-tools.js`.
The toolkit is ready for the operator to exercise during live acceptance.

## Self-Check: PASSED

- All created files exist:
  - `app/api/labels/samples/route.ts` — FOUND
  - `app/api/path-feedback/route.ts` — FOUND
  - `__tests__/labels-samples-api.test.ts` — FOUND
  - `__tests__/path-feedback-api.test.ts` — FOUND
  - `agent/src/mcp/cortex-tools.ts` — FOUND
  - `agent/__tests__/mcp-cortex-tools.test.ts` — FOUND
- All commits exist on disk:
  - `fa8ac18` Task 1 — FOUND
  - `ab647aa` Task 2 — FOUND
  - `76e5fc4` Task 3 — FOUND
