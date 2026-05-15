// Cortex worker — stateless poll loops (classify + move).
//
// Each tick: POST /api/items/claim → if 200, process; if 204, sleep.
// On any failure, log and leave the server-side lease set; the sweep inside
// /api/items/claim resets stale leases on the next poll. After 3 attempts the
// sweep transitions the item to a terminal failure state, surfaced in the UI
// Failed tab with Retry / Re-add / Delete.
//
// Runs foreground via `npm run worker` from agent/, or under macOS launchd
// via agent/launchd/com.cortex.daemon.plist (uses agent/.env.daemon).

import { apiFetch } from './clerk-m2m.js'
import { extract, type ExtractResult } from './text-extract.js'
import { classify } from './classify.js'
import { fetchFolders } from './taxonomy-cache.js'
import { sha256File } from './hash.js'
import { rename, mkdir, stat, access } from 'node:fs/promises'
import { join, dirname, basename, sep } from 'node:path'
import { homedir, constants as fsConstants } from 'node:os'
import * as fsConstantsNS from 'node:fs/promises'

const POLL_MS = 30_000  // 30 seconds between ticks
const STAGES = ['classification', 'move'] as const

type Stage = (typeof STAGES)[number]

type ClaimedItem = {
  id: string
  sourcePath: string
  sha256: string
  mimeType: string | null
  sizeBytes: number
  folderId: string | null
  attempts: number
}

async function tickStage(stage: Stage): Promise<'worked' | 'idle' | 'error'> {
  let claimRes: Response
  try {
    claimRes = await apiFetch('/api/items/claim', { method: 'POST', json: { stage } })
  } catch (e) {
    console.error(`[${stage}] claim fetch threw:`, e)
    return 'error'
  }

  if (claimRes.status === 204) return 'idle'
  if (claimRes.status !== 200) {
    const text = await claimRes.text().catch(() => '')
    console.error(`[${stage}] claim returned ${claimRes.status}: ${text.slice(0, 200)}`)
    return 'error'
  }

  const { item } = (await claimRes.json()) as { item: ClaimedItem }
  console.log(`[${stage}] claimed ${item.id} attempts=${item.attempts}`)

  if (stage === 'classification') return await classifyItem(item)
  if (stage === 'move') return await moveItem(item)
  return 'error'
}

async function classifyItem(item: ClaimedItem): Promise<'worked' | 'error'> {
  // 0) Re-hash to detect source-changed; if file is gone → source_missing
  try {
    await access(item.sourcePath, fsConstantsNS.constants.R_OK)
  } catch {
    await apiFetch(`/api/items/${item.id}/source-missing`, { method: 'POST' })
    return 'worked'
  }
  const currentHash = await sha256File(item.sourcePath).catch(() => null)
  if (currentHash === null) {
    await apiFetch(`/api/items/${item.id}/source-missing`, { method: 'POST' })
    return 'worked'
  }
  if (currentHash !== item.sha256) {
    // Source file changed since cortex add. Treat as source_changed (we don't have
    // a route for that on the classification side; surface via source-missing for v1
    // and the Failed-tab handles re-add).
    await apiFetch(`/api/items/${item.id}/source-missing`, { method: 'POST' })
    return 'worked'
  }

  // 1) Extract
  let extracted: ExtractResult
  try {
    extracted = await extract(item.sourcePath)
  } catch (e) {
    console.error(`[classify] extract failed for ${item.id}:`, e)
    return 'error'  // lease will expire; sweep handles retry
  }

  if (extracted.kind === 'unsupported') {
    await apiFetch(`/api/items/${item.id}/unsupported`, { method: 'POST' })
    return 'worked'
  }

  // 2) Fetch folder tree
  const folders = await fetchFolders()
  if (folders.length === 0) {
    console.error(`[classify] no folders for user — run prisma seed first`)
    return 'error'
  }

  // 3) Classify
  let result
  try {
    result = await classify(extracted, folders, {
      basename: basename(item.sourcePath),
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
    })
  } catch (e) {
    console.error(`[classify] classify call failed for ${item.id}:`, (e as Error).message)
    return 'error'
  }

  // 4) Post classification back
  // extracted.kind is always 'text' here (unsupported short-circuits above);
  // extracted.source carries the actual ExtractionKind enum value.
  const postRes = await apiFetch(`/api/items/${item.id}/classification`, {
    method: 'POST',
    json: {
      proposalCandidates: result.proposals,
      suggestedFilename: result.suggestedFilename,
      extractionKind: extracted.source,
      extractionMs: extracted.ms,
      extractedCharCount: extracted.extractedCharCount,
      extractedText: extracted.content,
    },
  })
  if (!postRes.ok) {
    const text = await postRes.text().catch(() => '')
    console.error(`[classify] POST classification ${postRes.status}: ${text.slice(0, 200)}`)
    return 'error'
  }
  console.log(`[classify] ${item.id} → pending_review (${result.proposals.length} proposals)`)
  return 'worked'
}

async function moveItem(item: ClaimedItem): Promise<'worked' | 'error'> {
  if (!item.folderId) {
    console.error(`[move] item ${item.id} has no folderId; cannot move`)
    return 'error'
  }

  // Re-hash to detect source-changed
  try {
    await access(item.sourcePath, fsConstantsNS.constants.R_OK)
  } catch {
    await apiFetch(`/api/items/${item.id}/move-failed`, {
      method: 'POST',
      json: { reason: 'source missing at move time', kind: 'source_missing' },
    })
    return 'worked'
  }
  const currentHash = await sha256File(item.sourcePath).catch(() => null)
  if (currentHash !== item.sha256) {
    await apiFetch(`/api/items/${item.id}/move-failed`, {
      method: 'POST',
      json: { reason: 'sha256 mismatch at move time', kind: 'source_changed' },
    })
    return 'worked'
  }

  // Resolve destination via the cached folder tree
  const folders = await fetchFolders()
  const target = folders.find((f) => f.id === item.folderId)
  if (!target) {
    await apiFetch(`/api/items/${item.id}/move-failed`, {
      method: 'POST',
      json: { reason: `folderId ${item.folderId} not in current taxonomy`, kind: 'move_failed' },
    })
    return 'worked'
  }

  const archiveRoot = resolveArchiveRoot()
  // target.path is "/Finance/Taxes/2025" — strip leading slash and split.
  const folderDir = join(archiveRoot, ...target.path.replace(/^\/+/, '').split('/'))
  const finalPath = join(folderDir, basename(item.sourcePath))

  await mkdir(folderDir, { recursive: true })

  // Idempotent mv: if destination already exists with matching sha256, skip mv
  let destExists = false
  try {
    await access(finalPath, fsConstantsNS.constants.R_OK)
    destExists = true
  } catch {}
  if (destExists) {
    const destHash = await sha256File(finalPath).catch(() => null)
    if (destHash === item.sha256) {
      // Already moved; just acknowledge
      const ack = await apiFetch(`/api/items/${item.id}/moved`, {
        method: 'POST',
        json: { finalPath },
      })
      if (!ack.ok) {
        const t = await ack.text().catch(() => '')
        console.error(`[move] ack ${ack.status}: ${t.slice(0, 200)}`)
        return 'error'
      }
      console.log(`[move] ${item.id} idempotent (destination already matches)`)
      return 'worked'
    }
    await apiFetch(`/api/items/${item.id}/move-failed`, {
      method: 'POST',
      json: { reason: `destination exists with different sha256`, kind: 'move_failed' },
    })
    return 'worked'
  }

  try {
    await rename(item.sourcePath, finalPath)
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code || 'rename failed'
    await apiFetch(`/api/items/${item.id}/move-failed`, {
      method: 'POST',
      json: { reason, kind: 'move_failed' },
    })
    return 'worked'
  }

  // POST /moved with 3 retries on 5xx
  let posted = false
  for (let attempt = 1; attempt <= 3 && !posted; attempt++) {
    const r = await apiFetch(`/api/items/${item.id}/moved`, {
      method: 'POST',
      json: { finalPath },
    })
    if (r.ok) {
      posted = true
      break
    }
    if (r.status < 500) {
      const t = await r.text().catch(() => '')
      console.error(`[move] POST /moved ${r.status} non-retryable: ${t.slice(0, 200)}`)
      break
    }
    await new Promise((res) => setTimeout(res, Math.pow(3, attempt) * 1000))
  }
  if (!posted) {
    console.error(`[move] failed to POST /moved after retries (file moved on disk)`)
    return 'error'  // sweep will retry — mv is now idempotent above
  }

  console.log(`[move] ${item.id} → filed at ${finalPath}`)
  return 'worked'
}

function resolveArchiveRoot(): string {
  // Prefer iCloud Documents if Desktop & Documents Folders toggle is ON,
  // otherwise fall back to ~/Documents/CortexArchive
  const home = homedir()
  const iCloudDocs = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents')
  const localDocs = join(home, 'Documents')

  const override = process.env.CORTEX_ARCHIVE_ROOT
  if (override) return override

  try {
    // Sync; ok during one-time worker startup
    const fs = require('node:fs') as typeof import('node:fs')
    if (fs.existsSync(iCloudDocs)) return join(iCloudDocs, 'CortexArchive')
  } catch {}
  return join(localDocs, 'CortexArchive')
}

async function main() {
  console.log(`cortex worker starting; poll interval ${POLL_MS}ms`)
  console.log(`archive root: ${resolveArchiveRoot()}`)

  // Run both stages in lockstep — each tick checks classify, then move.
  while (true) {
    let workedAny = false
    for (const stage of STAGES) {
      try {
        const r = await tickStage(stage)
        if (r === 'worked') workedAny = true
      } catch (e) {
        console.error(`[${stage}] tick threw:`, e)
      }
    }
    // If we did work this round, immediately try another round (drain bursts).
    // Otherwise sleep the full interval.
    if (!workedAny) await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

main().catch((e) => {
  console.error('worker crashed:', e)
  process.exit(1)
})
