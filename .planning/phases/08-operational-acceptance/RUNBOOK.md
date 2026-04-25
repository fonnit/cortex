# v1.1 Operational Acceptance — RUNBOOK

**Phase:** 08-operational-acceptance
**Audience:** Daniel (single operator) — running this end-to-end on macOS to certify v1.1 is production-ready.
**Companion file:** [`ACCEPTANCE.md`](./ACCEPTANCE.md) — every step below has a row there to fill in.
**Self-contained:** every command, expected output, log path, and fallback is inline. No external doc lookups required.

---

## §A — Prerequisites (one-time setup)

Before running any audit, confirm these are in place. Each is a 30-second check.

### A.1 — Vercel deployment URL + CORTEX_API_KEY

- Vercel dashboard → cortex project → Settings → Environment Variables.
- Note the production URL (e.g. `https://cortex-XXXX.vercel.app`).
- Note the value of `CORTEX_API_KEY` (it's the same secret the daemon and consumer share with the API middleware).
- These two values replace `REPLACE_WITH_VERCEL_URL` and `REPLACE_WITH_API_KEY_FROM_VERCEL` in both plists.

### A.2 — Langfuse project credentials

- Langfuse cloud → Project Settings → API Keys.
- Copy `LANGFUSE_PUBLIC_KEY` (`pk-…`) and `LANGFUSE_SECRET_KEY` (`sk-…`).
- These replace `REPLACE_WITH_LANGFUSE_PUBLIC_KEY` and `REPLACE_WITH_LANGFUSE_SECRET_KEY` in `agent/launchd/com.cortex.consumer.plist`.
- `LANGFUSE_HOST` defaults to `https://cloud.langfuse.com`; override only if self-hosted.

### A.3 — Google OAuth (Gmail)

- The daemon expects an OAuth2 token in macOS keychain under service `cortex-gmail` (set up during Phase 1; see `agent/src/auth/google.ts`).
- Verify with `security find-generic-password -s cortex-gmail -a default 2>/dev/null && echo OK || echo MISSING`.
- If MISSING, run the agent's auth bootstrap (one-time browser flow) before continuing — outside the scope of this runbook because Phase 1 already shipped.

### A.4 — `claude` CLI on PATH

```bash
command -v claude && claude --version
```

If this fails, the consumer cannot classify. Install Claude Code per the standard distribution instructions (Phase 7 precondition).

### A.5 — Working directory

All commands below assume:

```bash
cd /Users/dfonnegrag/Projects/cortex
```

### A.6 — Sample expected outputs

Each script's PASS line below is what the corresponding ACCEPTANCE.md row should capture verbatim.

| Script                              | Expected PASS line (excerpt)                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `audit-daemon-env.sh`               | `PASS ACC-04 (daemon-env) — DATABASE_URL absent; required keys present`                              |
| `audit-consumer-argv.sh`            | `PASS ACC-04 (consumer-argv) — N 'claude -p' invocations sampled, all clean`                          |
| `audit-langfuse-trace.mjs --item-id`| `PASS ACC-05 (langfuse-trace) — chain: api-ingest → api-queue → consumer-stage1-item → api-classify` |
| `soak-daemon.sh`                    | `PASS ACC-01 (soak-daemon) — zero error lines in 3600s`                                              |
| `gmail-backfill.mjs --watch`        | `PASS ACC-02 (gmail-backfill) — consumer log idle for 5 minutes`                                      |

---

## §B — Daemon boot + ACC-04 audit (first half)

**Goal:** ACC-04 first half — confirm `DATABASE_URL` is absent from the daemon's runtime env.

1. Edit the plist source so the placeholders are filled in:

   ```bash
   sed -i '' \
     -e "s|REPLACE_WITH_VERCEL_URL.vercel.app|$YOUR_VERCEL_HOST|" \
     -e "s|REPLACE_WITH_API_KEY_FROM_VERCEL|$YOUR_API_KEY|" \
     agent/launchd/com.cortex.daemon.plist
   ```

   (Or edit by hand — the file lives at `agent/launchd/com.cortex.daemon.plist` and the placeholders are clearly marked.)

2. Copy into LaunchAgents:

   ```bash
   cp agent/launchd/com.cortex.daemon.plist ~/Library/LaunchAgents/
   ```

3. Bootstrap (loads + starts):

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.daemon.plist
   ```

4. Wait 5–10 seconds for the daemon to settle, then run the audit:

   ```bash
   bash scripts/acc/audit-daemon-env.sh
   ```

   Expected output:
   ```
   PASS ACC-04 (daemon-env) — DATABASE_URL absent; required keys present
         Source:   launchctl print gui/501/com.cortex.daemon
         Captured: /tmp/cortex-acc-daemon-env.block.txt
   ```

5. Record this PASS/FAIL line in `ACCEPTANCE.md` row **ACC-04a**.

**If FAIL:**
- Output `FAIL: forbidden key present in daemon env: DATABASE_URL` → the `.env` file at `/Users/dfonnegrag/Projects/cortex/.env` is being read by the daemon (`--env-file=` in the plist) and contains `DATABASE_URL`. Remove that line from `.env`. The daemon must not need it (DAEMON-01).
- Output `FAIL: required key missing from daemon env: CORTEX_API_URL` → the plist edit step (B.1) was incomplete. Re-run the `sed` and redeploy.

---

## §C — Gmail backfill (ACC-02)

**Goal:** trigger a multi-month backfill, watch the consumer drain it.

1. Stop the daemon (we're about to mutate its cursor):

   ```bash
   launchctl bootout gui/$(id -u)/com.cortex.daemon
   ```

2. Choose a strategy:

   **Strategy A — full-sync fallback (recommended for first acceptance run):**

   ```bash
   node scripts/acc/gmail-backfill.mjs --clear
   ```

   This deletes `~/.config/cortex/gmail-cursor.json`. On the next daemon poll, the historyId-404 fallback (ING-06) kicks in and the daemon re-enumerates the entire Gmail inbox. The first poll takes longer because of the unbounded scan; subsequent polls converge.

   **Strategy B — explicit historyId rewind:**

   1. Open Gmail webmail, find an email from ~6 months ago.
   2. View its raw headers (More → Show Original) and copy the `X-GM-MSGID` value.
   3. Convert to a historyId by querying Gmail's API one-shot from a Vercel function or local Node REPL — the brief calls this out as "operator effort", not script-automatable, because Gmail historyIds are opaque.
   4. Then:

      ```bash
      node scripts/acc/gmail-backfill.mjs --history-id <THE_OLD_HISTORY_ID>
      ```

   **NOT supported:** `--rewind=6mo` exits with guidance — Gmail historyIds are opaque counters with no API for "6 months ago".

3. Restart the daemon:

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.daemon.plist
   ```

4. In a separate terminal, run the watcher:

   ```bash
   node scripts/acc/gmail-backfill.mjs --watch
   ```

   This blocks until the consumer log (`/tmp/cortex-consumer.log`) has been idle for 5 consecutive minutes — the operator-grade signal that the backfill drained. On a 6-month backfill expect this to take from ~20 minutes (small inbox) up to several hours (large inbox).

5. Sanity-check the queue depth in Vercel/Neon. Open the Vercel project's connected Neon console and run:

   ```sql
   SELECT status, COUNT(*) FROM "Item"
   WHERE source = 'gmail'
     AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY status ORDER BY status;
   ```

   PASS criterion: zero rows in `processing_stage1` or `processing_stage2` after 5min idle. Every Gmail Item is either `pending_*`, `certain`, `uncertain`, or `ignored`. The runbook does not run this SQL — the operator does, in the Vercel/Neon console (preserves the audit boundary: scripts have no DATABASE_URL).

6. Record the outcome in `ACCEPTANCE.md` row **ACC-02**.

---

## §D — Stage 1+2 consumer + ACC-04 audit (second half)

**Goal:** ACC-04 second half — confirm `claude -p` argv never contains file content.

1. Edit the consumer plist:

   ```bash
   sed -i '' \
     -e "s|REPLACE_WITH_VERCEL_URL.vercel.app|$YOUR_VERCEL_HOST|" \
     -e "s|REPLACE_WITH_API_KEY_FROM_VERCEL|$YOUR_API_KEY|" \
     -e "s|REPLACE_WITH_LANGFUSE_PUBLIC_KEY|$LF_PUB|" \
     -e "s|REPLACE_WITH_LANGFUSE_SECRET_KEY|$LF_SEC|" \
     agent/launchd/com.cortex.consumer.plist
   ```

2. Copy + bootstrap:

   ```bash
   cp agent/launchd/com.cortex.consumer.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.consumer.plist
   ```

3. Seed Stage 1 by dropping a real PDF into `~/Downloads`:

   ```bash
   curl -L -o ~/Downloads/sample-report.pdf https://www.example.com/some-public-pdf.pdf
   # Or just any existing PDF on disk: cp ~/some.pdf ~/Downloads/
   ```

4. Run the argv audit (gives 120s for the consumer cycle to fire and pick the item up):

   ```bash
   bash scripts/acc/audit-consumer-argv.sh --watch-for=120
   ```

   Expected:
   ```
   Sampling ps -wwo pid,command for 120s …
   Captured 120 samples; running heuristics check …
   PASS ACC-04 (consumer-argv) — N 'claude -p' invocations sampled, all clean
   ```

5. Record outcome in `ACCEPTANCE.md` row **ACC-04b**.

**If FAIL** (size or null_byte hit):
- The consumer is regressing on CONS-03/CONS-04. Look at `agent/src/consumer/claude.ts` lines 90–180 — the `execFile('claude', ['-p', prompt])` call must use the file PATH, not contents.

---

## §E — Triage UI flow (ACC-03)

**Goal:** confirm items dropped via Downloads/Gmail surface in `/triage` without manual intervention.

1. Re-use the items from §C (Gmail backfill) and §D (Downloads PDF).

2. Open `https://<your-vercel-host>/triage` in a browser. Sign in with Clerk (MFA).

3. Verify:
   - The PDF from §D appears in the relevance-triage queue (or auto-archived if Stage 2 confidence was high — both count as PASS).
   - At least one Gmail message from §C appears in either relevance- or label-triage queue.

4. Take a screenshot or note the item IDs in `ACCEPTANCE.md` row **ACC-03**.

**This is a visual checkpoint** — no script. The runbook stops short of automating browser interaction (out of scope; v1.1 is single-operator).

---

## §F — End-to-end Langfuse trace (ACC-05)

**Goal:** reconstruct the daemon → API → consumer → API span chain in Langfuse for one item.

1. Pick one item ID from §E. Get it from the Vercel/Neon console:

   ```sql
   SELECT id, source, file_name, status FROM "Item"
   WHERE created_at > NOW() - INTERVAL '1 hour'
     AND status IN ('certain', 'uncertain')
   ORDER BY created_at DESC LIMIT 5;
   ```

2. Export Langfuse credentials in your shell (one-time per shell):

   ```bash
   export LANGFUSE_PUBLIC_KEY="pk-..."
   export LANGFUSE_SECRET_KEY="sk-..."
   # Optional: export LANGFUSE_HOST="https://cloud.langfuse.com"
   ```

3. Run the audit:

   ```bash
   node scripts/acc/audit-langfuse-trace.mjs --item-id <ID>
   ```

   Expected:
   ```
   PASS ACC-05 (langfuse-trace) — chain: api-ingest → api-queue → consumer-stage1-item → api-classify
   ```

   The script retries up to 12 × 5s = 60s for Langfuse eventual consistency. If a span is genuinely missing, FAIL output names which spans are missing or which inbound-trace links are broken.

4. For Gmail keep items the chain ends at `consumer-stage2-item` (run with `--require-stage2`).

5. Record outcome in `ACCEPTANCE.md` row **ACC-05**.

---

## §G — 1-hour soak (ACC-01)

**Goal:** ACC-01 — daemon runs for 1 hour with zero error log lines.

1. Make sure both daemon and consumer are loaded (§B step 3, §D step 2).

2. Start the soak:

   ```bash
   bash scripts/acc/soak-daemon.sh
   ```

   This blocks for 3600 seconds (default; override with `--duration=N`). The script truncates `/tmp/cortex-daemon-error.log` at start so only THIS run's lines count.

   At end:
   ```
   PASS ACC-01 (soak-daemon) — zero error lines in 3600s
         Log: /tmp/cortex-daemon-error.log
   ```

3. Record outcome in `ACCEPTANCE.md` row **ACC-01**.

**Allow-list rationale:** The script's allow-list `heartbeat_ping_unexpected_error|http_client_terminal_skip` covers two known transient warning paths from Phase 6 — both are recorded as warnings in Langfuse (not hard errors) and both are expected during transient network outages. If you observe persistent matches against the allow-list during a soak, that's a degradation signal worth investigating, but it does not fail ACC-01.

**If FAIL:** the script prints up to 20 matched error lines. Cross-reference timestamps against `/tmp/cortex-daemon.log` (stdout) for context, then file a Phase 9 issue.

---

## §H — Cleanup / shutdown

After acceptance is recorded:

```bash
launchctl bootout gui/$(id -u)/com.cortex.daemon
launchctl bootout gui/$(id -u)/com.cortex.consumer
```

Or leave both loaded for ongoing operation — the v1.1 happy path.

Optional cleanup of audit artefacts:

```bash
rm -f /tmp/cortex-acc-daemon-env.txt /tmp/cortex-acc-daemon-env.block.txt
# /tmp/cortex-acc-argv.* are auto-deleted on script exit (mktemp + trap).
```

The captured env block contains the daemon's actual env values (including `CORTEX_API_KEY`), so removing it after the run is good hygiene.

---

## §I — Troubleshooting

### `launchctl bootstrap` errors "service already loaded"

```bash
launchctl bootout gui/$(id -u)/com.cortex.daemon
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.daemon.plist
```

### `audit-daemon-env.sh` exits 2 ("daemon not loaded")

The plist isn't bootstrapped. Run §B step 3.

### `audit-consumer-argv.sh` reports zero invocations

The consumer cycle hadn't fired during the 60s window. Either:
- Increase `--watch-for=300` (5 minutes) to give the polling cycle more chances, OR
- Drop a fresh item into `~/Downloads` immediately before running the audit.

A zero-invocations sample is treated as PASS (technically nothing was suspicious), but for a meaningful acceptance the operator should see at least 1 invocation.

### `audit-langfuse-trace.mjs` fails with `FAIL: missing env LANGFUSE_PUBLIC_KEY`

Set the env vars in your shell (see §F step 2). The script does NOT read from `.env` because it runs from the operator's shell, not the daemon process.

### `audit-langfuse-trace.mjs` retries all 12 attempts

- Either Langfuse hasn't received the spans yet (wait 1–2 minutes, retry), OR
- The item never made it through the full pipeline. Check the Item status in Neon (`status = 'pending_stage1'` for >5 min suggests Stage 1 consumer is wedged).

### `soak-daemon.sh` reports error lines from a previous session

The script truncates the log at start, so this should not happen. If it does, your `/tmp` is on a filesystem that doesn't honor truncation (rare). Manually `rm /tmp/cortex-daemon-error.log` and retry.

### `gmail-backfill.mjs --watch` never exits

The 5-minute idle threshold is checked against the consumer log's mtime. If the consumer is silently looping on an item without writing to the log, this watcher will hang. Mitigation: `Ctrl-C` and inspect `/tmp/cortex-consumer.log` directly with `tail -f`.

### Where each `REPLACE_WITH_*` placeholder is filled

| Placeholder                       | Source                                          |
| --------------------------------- | ----------------------------------------------- |
| `REPLACE_WITH_VERCEL_URL`         | Vercel dashboard → cortex project → URL          |
| `REPLACE_WITH_API_KEY_FROM_VERCEL`| Vercel project env → `CORTEX_API_KEY`            |
| `REPLACE_WITH_LANGFUSE_PUBLIC_KEY`| Langfuse cloud → API Keys → public (pk-…)        |
| `REPLACE_WITH_LANGFUSE_SECRET_KEY`| Langfuse cloud → API Keys → secret (sk-…)        |

---

## Final acceptance gate

When all six rows in `ACCEPTANCE.md` show `PASS`, write a one-paragraph **v1.1 Ship Decision** at the bottom of `ACCEPTANCE.md` and tag the milestone. If any row shows `FAIL`, file a Phase 9 issue and either reschedule the soak or block the ship.

Time budget for this runbook end-to-end: ~2 hours (1h soak + ~30min Gmail backfill watching + ~30min everything else). Plan accordingly.
