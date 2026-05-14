'use client'

// v1 TriageView — pending_review queue with top-proposal CTA + ranked
// quick-pick (ranks 2-5) + folder picker + create-folder modal + Failed tab.

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { basename as pathBasename } from './path'
import { SourceBadge } from './SourceBadge'

type Proposal =
  | { kind: 'existing'; folderId: string; path: string; confidence: number }
  | { kind: 'new'; path: string; confidence: number }
type FolderRow = { id: string; name: string; path: string; parentId: string | null; isSeed: boolean }

type PendingItem = {
  id: string
  sourcePath: string
  mimeType: string | null
  sizeBytes: number
  capturedAt: string
  proposalCandidates: Proposal[] | null
  proposedFolderId: string | null
  confidence: number | null
  extractionKind: 'text' | 'image' | 'pdf_native' | 'unsupported' | null
}

type FailedItem = {
  id: string
  sourcePath: string
  mimeType: string | null
  status: 'classification_failed' | 'move_failed' | 'source_missing' | 'source_changed' | 'unsupported_type'
  extractionKind: 'text' | 'image' | 'pdf_native' | 'unsupported' | null
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

export function TriageView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'failed'>('pending')
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [createOpenFor, setCreateOpenFor] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

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

  const approve = useMutation({
    mutationFn: ({ itemId, rank }: { itemId: string; rank: number }) =>
      fetch(`/api/items/${itemId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chosenProposalRank: rank }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      }),
    onSuccess: () => { showToast('approved'); queryClient.invalidateQueries({ queryKey: ['triage'] }) },
    onError: (e) => showToast(`error: ${(e as Error).message.slice(0, 80)}`),
  })

  const move = useMutation({
    mutationFn: ({ itemId, folderId }: { itemId: string; folderId: string }) =>
      fetch(`/api/items/${itemId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
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
    mutationFn: ({ itemId, name, parentId }: { itemId: string; name: string; parentId: string | null }) =>
      fetch(`/api/items/${itemId}/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
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

  // Keyboard shortcuts on the pending tab: 1-5 picks proposal N on the first card.
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
        approve.mutate({ itemId: first.id, rank: idx + 1 })
      } else if (e.key.toLowerCase() === 'r') {
        reject.mutate(first.id)
      } else if (e.key.toLowerCase() === 'n') {
        setCreateOpenFor(first.id); setCreateParentId(null); setCreateName('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, tab])

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
          <span><Kbd>1-5</Kbd> approve rank N</span>
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

                  {isActive && top && (
                    <div className="cx-axes">
                      <div className="cx-axis">
                        <div className="cx-axis-head">
                          <span className="cx-axis-name">Top proposal</span>
                          <span className="cx-axis-status cx-axis-confident">
                            confidence {(top.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="cx-axis-body">
                          <button
                            className="cx-action cx-action-primary"
                            onClick={() => approve.mutate({ itemId: it.id, rank: 1 })}
                          >
                            <Kbd>1</Kbd>{' '}
                            {top.kind === 'existing'
                              ? <>Approve into <span className="cx-mono">{top.path}</span></>
                              : <>Create + file in <span className="cx-mono">{top.path}</span></>}
                          </button>
                        </div>
                      </div>

                      {candidates.length > 1 && (
                        <div className="cx-axis">
                          <div className="cx-axis-head">
                            <span className="cx-axis-name">Other ranked options</span>
                          </div>
                          <div className="cx-axis-body">
                            {candidates.slice(1).map((c, idx) => {
                              const rank = idx + 2
                              const key = c.kind === 'existing' ? c.folderId : `new-${c.path}`
                              return (
                                <button
                                  key={key}
                                  className="cx-action cx-action-sm cx-action-ghost"
                                  onClick={() => approve.mutate({ itemId: it.id, rank })}
                                >
                                  <Kbd>{rank}</Kbd>{' '}
                                  {c.kind === 'new' && <span className="cx-mono cx-muted">[new] </span>}
                                  {c.path} · <span className="cx-mono cx-muted">{(c.confidence * 100).toFixed(0)}%</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div className="cx-card-actions">
                        <button
                          className="cx-action cx-action-ghost"
                          onClick={() => setPickerOpenFor(it.id)}
                        >
                          Pick different folder
                        </button>
                        <button
                          className="cx-action cx-action-ghost"
                          onClick={() => {
                            setCreateOpenFor(it.id)
                            setCreateParentId(null)
                            setCreateName('')
                          }}
                        >
                          <Kbd>N</Kbd> Create new folder
                        </button>
                        <button
                          className="cx-action cx-action-ghost"
                          onClick={() => reject.mutate(it.id)}
                        >
                          <Kbd>R</Kbd> Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {pickerOpenFor === it.id && (
                    <div className="cx-prop-newinput" style={{ marginTop: '1rem' }}>
                      <input
                        className="cx-ask-input"
                        type="text"
                        list="folder-paths"
                        placeholder="Type a folder path, e.g. /Finance/Taxes/2025"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const value = (e.target as HTMLInputElement).value.trim()
                            const f = folders.find((f) => f.path === value)
                            if (f) move.mutate({ itemId: it.id, folderId: f.id })
                            else showToast('no folder with that exact path')
                          } else if (e.key === 'Escape') {
                            setPickerOpenFor(null)
                          }
                        }}
                        autoFocus
                      />
                      <datalist id="folder-paths">
                        {folders.map((f) => (
                          <option key={f.id} value={f.path} />
                        ))}
                      </datalist>
                      <button className="cx-linkbtn" onClick={() => setPickerOpenFor(null)}>cancel</button>
                    </div>
                  )}

                  {createOpenFor === it.id && (
                    <div className="cx-prop-newinput" style={{ marginTop: '1rem' }}>
                      <label className="cx-card-sub">
                        Parent: <span className="cx-mono">{createParentId ? folderById[createParentId]?.path : '(top-level)'}</span>
                      </label>
                      <input
                        className="cx-ask-input"
                        type="text"
                        list="folder-parents"
                        placeholder="Parent folder path or blank for top-level"
                        onBlur={(e) => {
                          const value = e.target.value.trim()
                          if (!value) { setCreateParentId(null); return }
                          const f = folders.find((f) => f.path === value)
                          setCreateParentId(f?.id ?? null)
                        }}
                      />
                      <datalist id="folder-parents">
                        {folders.map((f) => (
                          <option key={f.id} value={f.path} />
                        ))}
                      </datalist>
                      <input
                        className="cx-ask-input"
                        type="text"
                        placeholder="New folder name (letters / digits / space / - / _ — max 60 chars)"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && createName.trim()) {
                            createFolder.mutate({ itemId: it.id, name: createName.trim(), parentId: createParentId })
                          } else if (e.key === 'Escape') {
                            setCreateOpenFor(null)
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="cx-action cx-action-sm cx-action-primary"
                        disabled={!createName.trim()}
                        onClick={() => createFolder.mutate({ itemId: it.id, name: createName.trim(), parentId: createParentId })}
                      >Create + file</button>
                      <button className="cx-linkbtn" onClick={() => setCreateOpenFor(null)}>cancel</button>
                    </div>
                  )}
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
