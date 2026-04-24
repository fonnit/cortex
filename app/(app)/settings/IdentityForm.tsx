'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface IdentityProfile {
  id: string
  role: string
  name: string
  email: string | null
  company: string | null
  relationship: string | null
}

export function IdentityForm() {
  const queryClient = useQueryClient()

  const { data: profiles = [], isLoading } = useQuery<IdentityProfile[]>({
    queryKey: ['identity'],
    queryFn: () => fetch('/api/identity').then((r) => r.json()),
  })

  const [form, setForm] = useState({
    name: '',
    role: 'owner' as 'owner' | 'known_person',
    relationship: '',
    email: '',
    company: '',
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identity'] })
      setForm({ name: '', role: 'owner', relationship: '', email: '', company: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/identity?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identity'] }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    createMutation.mutate(form)
  }

  return (
    <div className="max-w-xl space-y-6">
      {isLoading ? (
        <p className="text-sm opacity-50">Loading...</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm opacity-50">No identity profiles yet.</p>
      ) : (
        <ul className="space-y-3">
          {profiles.map((p) => (
            <li key={p.id} className="border rounded p-3 flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-xs border rounded px-1.5 py-0.5 opacity-60">
                    {p.role === 'owner' ? 'owner' : 'known person'}
                  </span>
                  {p.relationship && (
                    <span className="text-xs opacity-50">{p.relationship}</span>
                  )}
                </div>
                {(p.email || p.company) && (
                  <div className="text-xs opacity-50">
                    {[p.company, p.email].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <button
                className="text-xs opacity-40 hover:opacity-80 shrink-0"
                onClick={() => deleteMutation.mutate(p.id)}
                disabled={deleteMutation.isPending}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="border rounded p-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide opacity-50">Add profile</p>

        <div className="space-y-2">
          <input
            className="w-full border rounded px-2 py-1.5 text-sm"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />

          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'owner' | 'known_person' }))}
          >
            <option value="owner">Owner</option>
            <option value="known_person">Known person</option>
          </select>

          {form.role === 'known_person' && (
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Relationship (e.g. partner, parent, colleague)"
              value={form.relationship}
              onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
            />
          )}

          <input
            className="w-full border rounded px-2 py-1.5 text-sm"
            placeholder="Email (optional)"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />

          {form.role === 'owner' && (
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Company (optional)"
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            />
          )}
        </div>

        <button
          type="submit"
          className="text-sm border rounded px-3 py-1.5 hover:opacity-70 disabled:opacity-30"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Saving...' : 'Add'}
        </button>
      </form>
    </div>
  )
}
