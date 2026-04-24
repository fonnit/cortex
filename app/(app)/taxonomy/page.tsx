'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface TaxonomyRow { name: string; count: number; lastUsed: string | null }
interface MergeProposal {
  id: string; axis: string; a: string; b: string
  evidence: string; suggested_canonical: string; status: string
}
interface TaxonomyData {
  types: TaxonomyRow[]; entities: TaxonomyRow[]; contexts: TaxonomyRow[]
  mergeProposals: MergeProposal[]
}

type ModalState = {
  op: 'rename' | 'merge' | 'split' | 'deprecate'
  axis: string
  name: string
} | null

export default function TaxonomyPage() {
  const [tab, setTab] = useState<'types' | 'entities' | 'contexts'>('types')
  const { data } = useQuery<TaxonomyData>({
    queryKey: ['taxonomy'],
    queryFn: () => fetch('/api/taxonomy').then(r => r.json()),
    refetchInterval: 30_000,
    placeholderData: { types: [], entities: [], contexts: [], mergeProposals: [] },
  })

  // Modal state
  const [modal, setModal] = useState<ModalState>(null)
  const [renameValue, setRenameValue] = useState('')
  const [mergeTargets, setMergeTargets] = useState<string[]>([])
  const [splitNewName, setSplitNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  function closeModal() { setModal(null) }

  async function handleRename(axis: string, name: string, newName: string) {
    await fetch(`/api/taxonomy/${axis}/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'rename', newName }),
    })
    await queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
    closeModal()
  }

  async function handleDeprecate(axis: string, name: string) {
    await fetch(`/api/taxonomy/${axis}/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'deprecate' }),
    })
    await queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
    closeModal()
  }

  async function handleMerge(axis: string, sources: string[], canonical: string) {
    await fetch('/api/taxonomy/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axis, sources, canonical }),
    })
    await queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
    closeModal()
  }

  async function handleSplit(axis: string, _sourceName: string, newName: string) {
    // Create the new TaxonomyLabel; item-level reassignment surfaces in triage queue
    await fetch('/api/taxonomy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axis, name: newName }),
    })
    await queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
    closeModal()
  }

  const tabs = [
    { id: 'types' as const, label: 'Types' },
    { id: 'entities' as const, label: 'Entities (from)' },
    { id: 'contexts' as const, label: 'Contexts' },
  ]
  const list = data?.[tab] ?? []
  const merges = data?.mergeProposals ?? []

  // axis value for API calls: 'types' → 'type', 'entities' → 'from', 'contexts' → 'context'
  const tabAxis: Record<typeof tab, string> = {
    types: 'type',
    entities: 'from',
    contexts: 'context',
  }

  return (
    <>
      <style>{`
        .cx-modal-overlay{position:fixed;inset:0;background:rgba(32,29,23,.45);z-index:50;display:flex;align-items:center;justify-content:center}
        .cx-modal{background:var(--cx-panel);border:1px solid var(--cx-rule);border-radius:10px;padding:24px;width:420px;max-width:90vw;display:flex;flex-direction:column;gap:14px}
        .cx-modal-head{font-family:var(--cx-ff-serif);font-size:18px;font-weight:500}
        .cx-modal-body{margin:0;font-size:13.5px;color:var(--cx-ink-80)}
        .cx-modal-foot{display:flex;gap:8px;padding-top:4px}
        .cx-input{border:1px solid var(--cx-rule);border-radius:6px;padding:8px 12px;font:inherit;font-size:14px;background:var(--cx-bg);color:var(--cx-ink);outline:none;width:100%;box-sizing:border-box}
      `}</style>

      <div className="cx-tax" data-screen-label="Taxonomy">
        <div className="cx-tax-main">
          <div className="cx-tabrow">
            {tabs.map(t => (
              <button key={t.id} className={'cx-tab ' + (tab === t.id ? 'is-active' : '')} onClick={() => setTab(t.id)}>
                {t.label}
                <span className="cx-tab-count">{data?.[t.id].length ?? 0}</span>
              </button>
            ))}
          </div>
          <table className="cx-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="cx-right">Items</th>
                <th>Last used</th>
                <th className="cx-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(row => (
                <tr key={row.name}>
                  <td className="cx-table-name">{row.name}</td>
                  <td className="cx-right cx-mono">{row.count}</td>
                  <td className="cx-mono cx-muted">{row.lastUsed ? new Date(row.lastUsed).toLocaleDateString() : '—'}</td>
                  <td className="cx-right">
                    <button className="cx-linkbtn" onClick={() => { setModal({ op: 'rename', axis: tabAxis[tab], name: row.name }); setRenameValue(row.name) }}>rename</button>
                    <button className="cx-linkbtn" onClick={() => { setModal({ op: 'merge', axis: tabAxis[tab], name: row.name }); setMergeTargets([]) }}>merge</button>
                    <button className="cx-linkbtn" onClick={() => { setModal({ op: 'split', axis: tabAxis[tab], name: row.name }); setSplitNewName('') }}>split</button>
                    <button className="cx-linkbtn cx-muted" onClick={() => setModal({ op: 'deprecate', axis: tabAxis[tab], name: row.name })}>deprecate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="cx-tax-side">
          <div className="cx-tax-side-head">
            suggested merges
            <span className="cx-tax-side-sub">{merges.length} pending · never auto</span>
          </div>
          <ul className="cx-merge-list">
            {merges.map(m => (
              <li key={m.id} className="cx-merge">
                <div className="cx-merge-kind cx-mono">{m.axis}</div>
                <div className="cx-merge-pair">
                  <span className="cx-merge-a">{m.a}</span>
                  <span className="cx-merge-arrow">⤳</span>
                  <span className="cx-merge-b">{m.b}</span>
                </div>
                <div className="cx-merge-ev cx-mono cx-muted">{m.evidence}</div>
                <div className="cx-merge-canon">canonical: <b>{m.suggested_canonical}</b></div>
                <div className="cx-merge-actions">
                  <button
                    className="cx-action cx-action-primary cx-action-sm"
                    onClick={() => {
                      setBusy(true)
                      handleMerge(m.axis, [m.a], m.suggested_canonical).finally(() => setBusy(false))
                    }}
                    disabled={busy}
                  ><span>Accept</span></button>
                  <button className="cx-action cx-action-sm"><span>Edit</span></button>
                  <button className="cx-action cx-action-ghost cx-action-sm"><span>Reject</span></button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {modal && (
        <div className="cx-modal-overlay" onClick={closeModal}>
          <div className="cx-modal" onClick={e => e.stopPropagation()}>
            {modal.op === 'rename' && (
              <>
                <div className="cx-modal-head">Rename &quot;{modal.name}&quot;</div>
                <input
                  className="cx-input"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  autoFocus
                />
                <div className="cx-modal-foot">
                  <button
                    className="cx-action cx-action-primary"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => { setBusy(true); handleRename(modal.axis, modal.name, renameValue).finally(() => setBusy(false)) }}
                  ><span>Rename</span></button>
                  <button className="cx-action cx-action-ghost" onClick={closeModal}><span>Cancel</span></button>
                </div>
              </>
            )}
            {modal.op === 'deprecate' && (
              <>
                <div className="cx-modal-head">Deprecate &quot;{modal.name}&quot;?</div>
                <p className="cx-modal-body">Hidden from autocomplete. Historical assignments kept.</p>
                <div className="cx-modal-foot">
                  <button
                    className="cx-action cx-action-primary"
                    disabled={busy}
                    onClick={() => { setBusy(true); handleDeprecate(modal.axis, modal.name).finally(() => setBusy(false)) }}
                  ><span>Deprecate</span></button>
                  <button className="cx-action cx-action-ghost" onClick={closeModal}><span>Cancel</span></button>
                </div>
              </>
            )}
            {modal.op === 'merge' && (
              <>
                <div className="cx-modal-head">Merge into canonical</div>
                <p className="cx-modal-body cx-muted cx-mono">Canonical: {modal.name}</p>
                <p className="cx-modal-body">Enter comma-separated label names to merge into &quot;{modal.name}&quot;:</p>
                <input
                  className="cx-input"
                  placeholder="Label A, Label B"
                  value={mergeTargets.join(', ')}
                  onChange={e => setMergeTargets(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                />
                <div className="cx-modal-foot">
                  <button
                    className="cx-action cx-action-primary"
                    disabled={busy || mergeTargets.length === 0}
                    onClick={() => { setBusy(true); handleMerge(modal.axis, mergeTargets, modal.name).finally(() => setBusy(false)) }}
                  ><span>Merge</span></button>
                  <button className="cx-action cx-action-ghost" onClick={closeModal}><span>Cancel</span></button>
                </div>
              </>
            )}
            {modal.op === 'split' && (
              <>
                <div className="cx-modal-head">Split &quot;{modal.name}&quot;</div>
                <p className="cx-modal-body">New category name:</p>
                <input
                  className="cx-input"
                  value={splitNewName}
                  onChange={e => setSplitNewName(e.target.value)}
                  autoFocus
                />
                <p className="cx-modal-body cx-muted">Item-level reassignment: select items in the triage queue after creating the new label.</p>
                <div className="cx-modal-foot">
                  <button
                    className="cx-action cx-action-primary"
                    disabled={busy || !splitNewName.trim()}
                    onClick={() => { setBusy(true); handleSplit(modal.axis, modal.name, splitNewName).finally(() => setBusy(false)) }}
                  ><span>Create &amp; split</span></button>
                  <button className="cx-action cx-action-ghost" onClick={closeModal}><span>Cancel</span></button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
