'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface Identity { id: string; name: string; type: string; email: string | null }
type EditState = { id: string; name: string; type: string; email: string } | null
type AddState = { name: string; type: string; email: string } | null

export function IdentityForm() {
  const queryClient = useQueryClient()
  const { data: identities = [] } = useQuery<Identity[]>({
    queryKey: ['identity'],
    queryFn: () => fetch('/api/identity').then(r => r.json()),
  })

  const [editState, setEditState] = useState<EditState>(null)
  const [addOpen, setAddOpen] = useState<AddState>(null)
  const [busy, setBusy] = useState(false)

  const baseTypes = ['owner', 'company']
  const existingTypes = [...new Set([...baseTypes, ...identities.map(i => i.type).filter(Boolean)])]

  async function handleAdd() {
    if (!addOpen || !addOpen.name.trim() || !addOpen.type.trim()) return
    setBusy(true)
    try {
      await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addOpen.name.trim(), type: addOpen.type.trim(), email: addOpen.email.trim() || null }),
      })
      await queryClient.invalidateQueries({ queryKey: ['identity'] })
      setAddOpen(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleEdit() {
    if (!editState || !editState.name.trim() || !editState.type.trim()) return
    setBusy(true)
    try {
      await fetch('/api/identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editState.id, name: editState.name.trim(), type: editState.type.trim(), email: editState.email.trim() || null }),
      })
      await queryClient.invalidateQueries({ queryKey: ['identity'] })
      setEditState(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/identity?id=${id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['identity'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{`
        .cx-id-addrow td { background: var(--cx-panel-2); }
        .cx-input { border:1px solid var(--cx-rule); border-radius:6px; padding:6px 10px;
          font:inherit; font-size:13.5px; background:var(--cx-bg); color:var(--cx-ink);
          outline:none; width:100%; box-sizing:border-box; }
      `}</style>

      <datalist id="cx-id-types">
        {existingTypes.map(t => <option key={t} value={t} />)}
      </datalist>

      <table className="cx-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Email</th>
            <th className="cx-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {identities.map(row => (
            <tr key={row.id}>
              {editState?.id === row.id ? (
                <>
                  <td><input className="cx-input" value={editState.name} onChange={e => setEditState(s => s ? { ...s, name: e.target.value } : s)} /></td>
                  <td><input className="cx-input" list="cx-id-types" value={editState.type} onChange={e => setEditState(s => s ? { ...s, type: e.target.value } : s)} /></td>
                  <td><input className="cx-input" type="email" value={editState.email} onChange={e => setEditState(s => s ? { ...s, email: e.target.value } : s)} /></td>
                  <td className="cx-right">
                    <button className="cx-linkbtn" onClick={handleEdit} disabled={busy}>save</button>
                    <button className="cx-linkbtn cx-muted" onClick={() => setEditState(null)}>cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="cx-table-name">{row.name}</td>
                  <td className="cx-mono cx-muted">{row.type}</td>
                  <td className="cx-mono cx-muted">{row.email ?? '—'}</td>
                  <td className="cx-right">
                    <button className="cx-linkbtn" onClick={() => setEditState({ id: row.id, name: row.name, type: row.type, email: row.email ?? '' })}>edit</button>
                    <button className="cx-linkbtn cx-muted" onClick={() => handleDelete(row.id)} disabled={busy}>delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {addOpen && (
            <tr className="cx-id-addrow">
              <td><input className="cx-input" placeholder="Name" value={addOpen.name} onChange={e => setAddOpen(s => s ? { ...s, name: e.target.value } : s)} /></td>
              <td>
                <input className="cx-input" placeholder="Type" list="cx-id-types" value={addOpen.type} onChange={e => setAddOpen(s => s ? { ...s, type: e.target.value } : s)} />
              </td>
              <td><input className="cx-input" type="email" placeholder="Email (optional)" value={addOpen.email} onChange={e => setAddOpen(s => s ? { ...s, email: e.target.value } : s)} /></td>
              <td className="cx-right">
                <button className="cx-linkbtn" onClick={handleAdd} disabled={busy || !addOpen.name.trim() || !addOpen.type.trim()}>save</button>
                <button className="cx-linkbtn cx-muted" onClick={() => setAddOpen(null)}>cancel</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!addOpen && (
        <button className="cx-linkbtn" style={{ marginTop: 12 }} onClick={() => setAddOpen({ name: '', type: '', email: '' })}>+ add identity</button>
      )}
    </>
  )
}
