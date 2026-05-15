'use client'

// v1 TriageView — pending_review queue with top-proposal CTA + ranked
// quick-pick (ranks 2-5) + folder picker + create-folder modal + Failed tab.

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { basename as pathBasename } from './path'
import { SourceBadge } from './SourceBadge'
import { FolderCombobox } from './FolderCombobox'

type Proposal =
  | { kind: 'existing'; folderId: string; path: string; confidence: number }
  | { kind: 'new'; path: string; confidence: number }
type FolderRow = { id: string; name: string; path: string; parentId: string | null; isSeed: boolean }

type ExtractionKind =
  | 'plain_text' | 'docx' | 'pdf_text' | 'ocr_image' | 'ocr_pdf'
  | 'text' | 'image' | 'pdf_native' | 'unsupported'

type PendingItem = {
  id: string
  sourcePath: string
  mimeType: string | null
  sizeBytes: number
  capturedAt: string
  proposalCandidates: Proposal[] | null
  proposedFolderId: string | null
  confidence: number | null
  extractionKind: ExtractionKind | null
  suggestedFilename: string | null
  finalFilename: string | null
}

type FailedItem = {
  id: string
  sourcePath: string
  mimeType: string | null
  status: 'classification_failed' | 'move_failed' | 'source_missing' | 'source_changed' | 'unsupported_type'
  extractionKind: ExtractionKind | null
  attempts: number
  capturedAt: string
}

type TriageResponse = {
  pending: PendingItem[]
  failed: FailedItem[]
  folders: FolderRow[]
  folderById: Record<string, FolderRow>
}

const STATUS_LABEL: Record<FailedItem['status'], string> = {
  classification_failed: 'classify failed',
  move_failed: 'move failed',
  source_missing: 'source missing',
  source_changed: 'source changed',
  unsupported_type: 'unsupported',
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="cx-kbd">{children}</kbd>
}

// Mirror of lib/final-filename.ts — strip extension, collapse whitespace,
// allowlist. Lets the input show real-time errors before POST.
function sanitizeFilenameDraft(raw: string): { value: string; valid: boolean; reason?: string } {
  const stripped = raw.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim()
  if (stripped.length === 0) return { value: '', valid: false, reason: 'required' }
  if (stripped.length > 60) return { value: stripped, valid: false, reason: 'max 60 chars' }
  if (!/^[A-Za-z0-9 _-]+$/.test(stripped)) {
    return { value: stripped, valid: false, reason: 'letters / digits / space / - / _ only' }
  }
  return { value: stripped, valid: true }
}

// Default the input to the model's suggestion; fall back to the source basename
// (extension stripped) if Haiku didn't supply one (legacy rows pre-v2).
function defaultFilename(it: PendingItem): string {
  if (it.finalFilename) return it.finalFilename
  if (it.suggestedFilename) return it.suggestedFilename
  const base = it.sourcePath.split('/').pop() ?? ''
  return base.replace(/\.[^.]+$/, '')
}

// The user's currently-selected destination for an item. Three shapes:
//   - 'rank': accept one of the model's ranked proposals (existing or new)
//   - 'folder': override with a specific existing folder (from FolderCombobox)
//   - 'newPath': override with a typed nested path (resolved to absolute)
// Default per-item is { kind: 'rank', rank: 1 } — i.e., the top proposal.
type FolderChoice =
  | { kind: 'rank'; rank: number }
  | { kind: 'folder'; folderId: string }
  | { kind: 'newPath'; absolutePath: string }

function destinationLabel(
  choice: FolderChoice,
  it: PendingItem,
  folderById: Record<string, FolderRow>,
): string {
  if (choice.kind === 'rank') {
    return it.proposalCandidates?.[choice.rank - 1]?.path ?? '(no proposal)'
  }
  if (choice.kind === 'folder') return folderById[choice.folderId]?.path ?? '(unknown folder)'
  return choice.absolutePath
}

// Resolve a "create new folder" panel state into an absolute path:
//   "fonnit/branding" under parent /business → "/business/fonnit/branding"
//   "fonnit/branding" with no parent          → "/fonnit/branding"
function resolveCreatePath(
  name: string,
  parentId: string | null,
  folderById: Record<string, FolderRow>,
): string {
  const cleaned = name.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
  if (!cleaned) return ''
  if (parentId) {
    const parent = folderById[parentId]
    if (parent) return parent.path.replace(/\/$/, '') + '/' + cleaned
  }
  return '/' + cleaned
}

export function TriageView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'failed'>('pending')
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [createOpenFor, setCreateOpenFor] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Per-item filename draft. Keyed by Item.id. Absent = use defaultFilename(it).
  const [filenameDrafts, setFilenameDrafts] = useState<Record<string, string>>({})
  // Per-item folder selection. Keyed by Item.id. Absent = default to rank 1.
  const [folderChoices, setFolderChoices] = useState<Record<string, FolderChoice>>({})

  const { data, refetch } = useQuery<TriageResponse>({
    queryKey: ['triage'],
    queryFn: () => fetch('/api/triage').then((r) => r.json()),
    refetchInterval: 10_000,
  })

  const pending = data?.pending ?? []
  const failed = data?.failed ?? []
  const folderById = data?.folderById ?? {}
  const folders = data?.folders ?? []

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2400)
  }

  // Pull the latest filename for an item — draft if user edited, else default.
  const currentFilename = (it: PendingItem): string =>
    filenameDrafts[it.id] ?? defaultFilename(it)

  // Pull the latest folder choice for an item — explicit if user changed it,
  // else the default (top proposal, rank 1).
  const currentChoice = (it: PendingItem): FolderChoice =>
    folderChoices[it.id] ?? { kind: 'rank', rank: 1 }

  // Commit the current selection. Branches by choice kind to the correct
  // backend route. All three paths accept finalFilename.
  function commitApprove(it: PendingItem) {
    const s = sanitizeFilenameDraft(currentFilename(it))
    if (!s.valid) { showToast(`fix filename: ${s.reason}`); return }
    const choice = currentChoice(it)
    if (choice.kind === 'rank') {
      const candidate = it.proposalCandidates?.[choice.rank - 1]
      if (!candidate) { showToast('proposal not found'); return }
      approve.mutate({ itemId: it.id, rank: choice.rank, finalFilename: s.value })
    } else if (choice.kind === 'folder') {
      move.mutate({ itemId: it.id, folderId: choice.folderId, finalFilename: s.value })
    } else {
      // newPath: send the absolute path (sans leading /) with parentId=null;
      // the create-folder route handles nested creation via ensureFolderPath.
      const rel = choice.absolutePath.replace(/^\/+/, '')
      if (!rel) { showToast('enter a folder path'); return }
      createFolder.mutate({ itemId: it.id, name: rel, parentId: null, finalFilename: s.value })
    }
  }

  const approve = useMutation({
    mutationFn: ({ itemId, rank, finalFilename }: { itemId: string; rank: number; finalFilename: string }) =>
      fetch(`/api/items/${itemId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chosenProposalRank: rank, finalFilename }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('approved'); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
    onError: (e) => showToast(`error: ${(e as Error).message.slice(0, 80)}`),
  })

  const move = useMutation({
    mutationFn: ({ itemId, folderId, finalFilename }: { itemId: string; folderId: string; finalFilename: string }) =>
      fetch(`/api/items/${itemId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, finalFilename }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('moved'); setPickerOpenFor(null); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
    onError: (e) => showToast(`error: ${(e as Error).message.slice(0, 80)}`),
  })

  const reject = useMutation({
    mutationFn: (itemId: string) =>
      fetch(`/api/items/${itemId}/reject`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('rejected'); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
    onError: (e) => showToast(`error: ${(e as Error).message.slice(0, 80)}`),
  })

  const createFolder = useMutation({
    mutationFn: ({ itemId, name, parentId, finalFilename }: { itemId: string; name: string; parentId: string | null; finalFilename: string }) =>
      fetch(`/api/items/${itemId}/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId, finalFilename }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => {
      showToast('folder created + filed')
      setCreateOpenFor(null); setCreateName(''); setCreateParentId(null)
      queryClient.invalidateQueries({ queryKey: ['triage'] })
    },
    onError: (e) => showToast(`error: ${(e as Error).message.slice(0, 80)}`),
  })

  const retry = useMutation({
    mutationFn: (itemId: string) =>
      fetch(`/api/items/${itemId}/retry`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('retrying'); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
  })

  const delItem = useMutation({
    mutationFn: (itemId: string) =>
      fetch(`/api/items/${itemId}/delete`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('deleted'); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
  })

  // Keyboard shortcuts on the pending tab. Distinct from form-input typing:
  //   1-5  select rank N as the destination (no submit)
  //   Enter approve with the current destination + filename
  //   R    reject
  //   N    open the create-new-folder panel
  // Inputs/textareas swallow these on their own (so typing in the filename
  // field doesn't trigger global shortcuts), except Enter — handled inline
  // on the filename input via onKeyDown.
  useEffect(() => {
    if (tab !== 'pending') return
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as Element
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const first = pending[0]
      if (!first || !first.proposalCandidates) return
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < first.proposalCandidates.length) {
        setFolderChoices((prev) => ({ ...prev, [first.id]: { kind: 'rank', rank: idx + 1 } }))
      } else if (e.key === 'Enter') {
        commitApprove(first)
      } else if (e.key.toLowerCase() === 'r') {
        reject.mutate(first.id)
      } else if (e.key.toLowerCase() === 'n') {
        setCreateOpenFor(first.id); setPickerOpenFor(null)
        setCreateParentId(null); setCreateName('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // commitApprove closes over state; rebind when relevant pieces change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, tab, filenameDrafts, folderChoices])

  return (
    <div className="cx-triage-inline">
      <div className="cx-triage-topbar">
        <div className="cx-triage-counts">
          <button
            className={tab === 'pending' ? 'cx-action cx-action-primary' : 'cx-action cx-action-ghost'}
            onClick={() => setTab('pending')}
          >
            Pending <span className="cx-mono">{pending.length}</span>
          </button>
          <button
            className={tab === 'failed' ? 'cx-action cx-action-primary' : 'cx-action cx-action-ghost'}
            onClick={() => setTab('failed')}
          >
            Failed <span className="cx-mono">{failed.length}</span>
          </button>
        </div>
        <div className="cx-legend">
          <span><Kbd>1-5</Kbd> select rank</span>
          <span><Kbd>↵</Kbd> approve</span>
          <span><Kbd>N</Kbd> new folder</span>
          <span><Kbd>R</Kbd> reject</span>
        </div>
      </div>

      {tab === 'pending' && pending.length === 0 && (
        <div className="cx-empty">
          <div className="cx-empty-title">Queue clear.</div>
          <div>Drop a file with <span className="cx-mono">cortex add &lt;path&gt;</span> on your Mac.</div>
        </div>
      )}

      {tab === 'pending' && pending.length > 0 && (
        <ol className="cx-qlist">
          {pending.map((it, i) => {
            const isActive = i === 0
            const candidates = (it.proposalCandidates ?? []).slice(0, 5)
            const top = candidates[0]
            return (
              <li key={it.id} className={'cx-card ' + (isActive ? 'is-active' : 'is-collapsed')}>
                <div className="cx-card-rail">
                  <div className="cx-card-rail-n">{String(i + 1).padStart(2, '0')}</div>
                  <div className="cx-card-rail-of">/ {String(pending.length).padStart(2, '0')}</div>
                  <div className="cx-card-rail-mode">
                    <span className="cx-mode-pill cx-mode-label">{it.extractionKind ?? 'text'}</span>
                  </div>
                </div>

                <div className="cx-card-main">
                  <div className="cx-card-head">
                    <div className="cx-card-meta">
                      <SourceBadge source="downloads" />
                      <span className="cx-meta-sep">·</span>
                      <span className="cx-mono">{new Date(it.capturedAt).toLocaleString()}</span>
                    </div>
                    <h2 className="cx-card-title">{pathBasename(it.sourcePath)}</h2>
                    <div className="cx-card-sub">
                      <span className="cx-mono">{it.sourcePath}</span>
                      {it.sizeBytes > 0 && (
                        <>
                          <span className="cx-meta-sep">·</span>
                          <span className="cx-mono cx-muted">{it.mimeType ?? '?'} · {(it.sizeBytes / 1024).toFixed(1)} KB</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isActive && top && (() => {
                    const draft = currentFilename(it)
                    const s = sanitizeFilenameDraft(draft)
                    const ext = (it.sourcePath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
                    const choice = currentChoice(it)
                    const destLabel = destinationLabel(choice, it, folderById)

                    return (
                      <div className="cx-axes">
                        {/* Filename row */}
                        <div className="cx-axis">
                          <div className="cx-axis-head">
                            <span className="cx-axis-name">Filename on disk</span>
                            {!s.valid && (
                              <span className="cx-axis-status" style={{ color: '#c33' }}>
                                {s.reason}
                              </span>
                            )}
                          </div>
                          <div className="cx-axis-body">
                            <div className="cx-filename-row">
                              <input
                                className="cx-ask-input"
                                type="text"
                                value={draft}
                                onChange={(e) =>
                                  setFilenameDrafts((prev) => ({ ...prev, [it.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    commitApprove(it)
                                  }
                                }}
                                placeholder={it.suggestedFilename ?? 'enter a filename'}
                                spellCheck={false}
                              />
                              <span className="cx-mono cx-muted">{ext || '(no extension)'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Where to file: all proposals + picker + create-folder all SELECT, none submit. */}
                        <div className="cx-axis">
                          <div className="cx-axis-head">
                            <span className="cx-axis-name">Where to file</span>
                          </div>
                          <div className="cx-axis-body">
                            {candidates.map((c, idx) => {
                              const rank = idx + 1
                              const selected = choice.kind === 'rank' && choice.rank === rank
                              const key = c.kind === 'existing' ? c.folderId : `new-${c.path}`
                              return (
                                <button
                                  key={key}
                                  className={'cx-action cx-action-sm ' + (selected ? 'cx-action-selected' : 'cx-action-ghost')}
                                  onClick={() =>
                                    setFolderChoices((prev) => ({ ...prev, [it.id]: { kind: 'rank', rank } }))
                                  }
                                >
                                  <Kbd>{rank}</Kbd>{' '}
                                  {c.kind === 'new' && <span className="cx-mono cx-muted">[new] </span>}
                                  {c.path} · <span className="cx-mono cx-muted">{(c.confidence * 100).toFixed(0)}%</span>
                                </button>
                              )
                            })}

                            {/* Show overrides (picked existing folder / typed new path) as selectable chips. */}
                            {choice.kind === 'folder' && (
                              <button
                                className="cx-action cx-action-sm cx-action-selected"
                                onClick={() => { /* no-op; it's already selected */ }}
                              >
                                {folderById[choice.folderId]?.path ?? '(unknown)'} <span className="cx-mono cx-muted">(picked)</span>
                              </button>
                            )}
                            {choice.kind === 'newPath' && (
                              <button
                                className="cx-action cx-action-sm cx-action-selected"
                                onClick={() => { /* no-op; it's already selected */ }}
                              >
                                <span className="cx-mono cx-muted">[new]</span> {choice.absolutePath} <span className="cx-mono cx-muted">(typed)</span>
                              </button>
                            )}

                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <button
                                className="cx-action cx-action-ghost"
                                onClick={() => {
                                  setPickerOpenFor(it.id === pickerOpenFor ? null : it.id)
                                  setCreateOpenFor(null)
                                }}
                              >
                                {pickerOpenFor === it.id ? 'Close picker' : 'Pick a different folder'}
                              </button>
                              <button
                                className="cx-action cx-action-ghost"
                                onClick={() => {
                                  setCreateOpenFor(it.id === createOpenFor ? null : it.id)
                                  setPickerOpenFor(null)
                                  setCreateParentId(null)
                                  setCreateName('')
                                }}
                              >
                                <Kbd>N</Kbd> {createOpenFor === it.id ? 'Close new folder' : 'Create a new folder'}
                              </button>
                            </div>

                            {pickerOpenFor === it.id && (
                              <div className="cx-prop-newinput" style={{ marginTop: '0.75rem' }}>
                                <div className="cx-card-sub cx-muted" style={{ marginBottom: 6 }}>
                                  Pick a folder. It becomes the destination; click Approve to commit.
                                </div>
                                <FolderCombobox
                                  folders={folders}
                                  value={choice.kind === 'folder' ? choice.folderId : null}
                                  autoFocus
                                  placeholder="Type to filter folders, e.g. finance"
                                  onChange={(folderId) => {
                                    if (folderId) {
                                      setFolderChoices((prev) => ({ ...prev, [it.id]: { kind: 'folder', folderId } }))
                                    }
                                  }}
                                  onConfirm={(folderId) => {
                                    if (folderId) {
                                      setFolderChoices((prev) => ({ ...prev, [it.id]: { kind: 'folder', folderId } }))
                                      setPickerOpenFor(null)
                                    }
                                  }}
                                  onEscape={() => setPickerOpenFor(null)}
                                />
                              </div>
                            )}

                            {createOpenFor === it.id && (() => {
                              const absolutePath = resolveCreatePath(createName, createParentId, folderById)
                              const syncChoice = (path: string) => {
                                if (path) {
                                  setFolderChoices((prev) => ({ ...prev, [it.id]: { kind: 'newPath', absolutePath: path } }))
                                }
                              }
                              return (
                                <div className="cx-prop-newinput" style={{ marginTop: '0.75rem' }}>
                                  <div className="cx-card-sub cx-muted" style={{ marginBottom: 6 }}>
                                    New folder. Pick a parent + type a name (or nested path). Click Approve to create + file.
                                  </div>
                                  <label className="cx-card-sub">
                                    Parent: <span className="cx-mono">{createParentId ? folderById[createParentId]?.path : '(top-level)'}</span>
                                  </label>
                                  <FolderCombobox
                                    folders={folders}
                                    value={createParentId}
                                    allowNone
                                    noneLabel="(top-level)"
                                    placeholder="Parent folder path or leave blank for top-level"
                                    onChange={(folderId) => {
                                      setCreateParentId(folderId)
                                      syncChoice(resolveCreatePath(createName, folderId, folderById))
                                    }}
                                  />
                                  <input
                                    className="cx-ask-input"
                                    type="text"
                                    placeholder="New folder — single name or nested path (e.g. fonnit/branding)"
                                    value={createName}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setCreateName(v)
                                      syncChoice(resolveCreatePath(v, createParentId, folderById))
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        syncChoice(absolutePath)
                                        commitApprove(it)
                                      } else if (e.key === 'Escape') {
                                        setCreateOpenFor(null)
                                      }
                                    }}
                                    autoFocus
                                  />
                                  {absolutePath && (
                                    <div className="cx-card-sub">
                                      Will create: <span className="cx-mono">{absolutePath}</span>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        </div>

                        {/* Single commit row — always last in the card. */}
                        <div className="cx-card-actions">
                          <button
                            className="cx-action cx-action-primary"
                            onClick={() => commitApprove(it)}
                          >
                            <Kbd>↵</Kbd>{' '}
                            Approve into <span className="cx-mono">{destLabel}</span>
                          </button>
                          <button
                            className="cx-action cx-action-ghost"
                            onClick={() => reject.mutate(it.id)}
                          >
                            <Kbd>R</Kbd> Reject
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {tab === 'failed' && failed.length === 0 && (
        <div className="cx-empty">
          <div className="cx-empty-title">No failures.</div>
          <div>Anything that fails classification or move appears here.</div>
        </div>
      )}

      {tab === 'failed' && failed.length > 0 && (
        <ul className="cx-qlist">
          {failed.map((it) => (
            <li key={it.id} className="cx-card is-collapsed">
              <div className="cx-card-rail">
                <span className="cx-mode-pill cx-mode-label">{STATUS_LABEL[it.status]}</span>
              </div>
              <div className="cx-card-main">
                <div className="cx-card-head">
                  <h2 className="cx-card-title">{pathBasename(it.sourcePath)}</h2>
                  <div className="cx-card-sub">
                    <span className="cx-mono">{it.sourcePath}</span>
                    <span className="cx-meta-sep">·</span>
                    <span className="cx-mono cx-muted">attempts: {it.attempts}</span>
                    {it.extractionKind && (
                      <>
                        <span className="cx-meta-sep">·</span>
                        <span className="cx-mono cx-muted">kind: {it.extractionKind}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="cx-card-actions">
                  {(it.status === 'classification_failed' || it.status === 'move_failed') && (
                    <button className="cx-action cx-action-sm cx-action-primary" onClick={() => retry.mutate(it.id)}>
                      Retry
                    </button>
                  )}
                  {(it.status === 'unsupported_type' || it.status === 'source_missing' || it.status === 'source_changed') && (
                    <button className="cx-action cx-action-sm cx-action-ghost" onClick={() => delItem.mutate(it.id)}>
                      Delete record
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="cx-toast">
          <span className="cx-toast-tag">{toast}</span>
        </div>
      )}
    </div>
  )
}
