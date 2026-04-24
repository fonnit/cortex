'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface TaxonomyRow { name: string; count: number; lastUsed: string | null }
interface MergeProposal {
  id: string; axis: string; a: string; b: string
  evidence: string; suggested_canonical: string; status: string
}
interface TaxonomyData {
  types: TaxonomyRow[]; entities: TaxonomyRow[]; contexts: TaxonomyRow[]
  mergeProposals: MergeProposal[]
}

export default function TaxonomyPage() {
  const [tab, setTab] = useState<'types' | 'entities' | 'contexts'>('types')
  const { data } = useQuery<TaxonomyData>({
    queryKey: ['taxonomy'],
    queryFn: () => fetch('/api/taxonomy').then(r => r.json()),
    refetchInterval: 30_000,
    placeholderData: { types: [], entities: [], contexts: [], mergeProposals: [] },
  })
  const tabs = [
    { id: 'types' as const, label: 'Types' },
    { id: 'entities' as const, label: 'Entities (from)' },
    { id: 'contexts' as const, label: 'Contexts' },
  ]
  const list = data?.[tab] ?? []
  const merges = data?.mergeProposals ?? []

  return (
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
                  <button className="cx-linkbtn" data-action="rename" data-name={row.name} data-axis={tab}>rename</button>
                  <button className="cx-linkbtn" data-action="merge" data-name={row.name} data-axis={tab}>merge</button>
                  <button className="cx-linkbtn" data-action="split" data-name={row.name} data-axis={tab}>split</button>
                  <button className="cx-linkbtn cx-muted" data-action="deprecate" data-name={row.name} data-axis={tab}>deprecate</button>
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
                <button className="cx-action cx-action-primary cx-action-sm"><span>Accept</span></button>
                <button className="cx-action cx-action-sm"><span>Edit</span></button>
                <button className="cx-action cx-action-ghost cx-action-sm"><span>Reject</span></button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
