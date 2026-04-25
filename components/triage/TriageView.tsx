'use client'

import { useRef, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Langfuse } from 'langfuse'
import { ExpandedCard } from './ExpandedCard'
import { SourceBadge } from './SourceBadge'
import type { TriageItem, TriageAction } from './ExpandedCard'

interface TriageDecision {
  itemId: string
  type: 'keep' | 'ignore' | 'archive' | 'confirm' | 'skip'
  picks?: { Type?: string; From?: string; Context?: string }
}

interface ToastState {
  tag: string
  subject?: string
}

function Kbd({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <kbd className={'cx-kbd' + (dim ? ' cx-kbd-faint' : '')}>{children}</kbd>
}

function EmptyHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cx-empty">
      <div className="cx-empty-title">{title}</div>
      <div>{children}</div>
    </div>
  )
}

export function TriageView() {
  const queryClient = useQueryClient()

  const [activeIdx, setActiveIdx] = useState(0)
  const [decided, setDecided] = useState<Record<string, string>>({})
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [newOpen, setNewOpen] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const lastAction = useRef<{ prev: Record<string, string> } | null>(null)
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({})
  const openedAt = useRef<number>(Date.now())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: items = [] } = useQuery<TriageItem[]>({
    queryKey: ['triage'],
    queryFn: () => fetch('/api/triage').then((r) => r.json()),
    refetchInterval: 10_000,
  })

  const { data: identities = [] } = useQuery<Array<{ name: string; type: string }>>({
    queryKey: ['identity'],
    queryFn: () => fetch('/api/identity').then((r) => r.json()),
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: (d: TriageDecision) =>
      fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      }).then((r) => r.json()),
    onMutate: (vars) => {
      // Optimistic: mark item decided locally (skip does nothing)
      if (vars.type !== 'skip') {
        const tag =
          vars.type === 'keep' ? 'kept'
          : vars.type === 'ignore' ? 'ignored'
          : 'archived'
        setDecided((d) => ({ ...d, [vars.itemId]: tag }))
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['triage'] })
    },
  })

  // Reset per-item state and record openedAt when active item changes
  useEffect(() => {
    setPicks({})
    setNewOpen(null)
    openedAt.current = Date.now()
    const el = rowRefs.current[activeIdx]
    if (el && el.scrollIntoView) {
      const rect = el.getBoundingClientRect()
      if (rect.top < 80 || rect.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [activeIdx])

  // Clear stale decided entries when server no longer returns those items
  useEffect(() => {
    const serverIds = new Set(items.map((it) => it.id))
    setDecided((prev) => {
      const next: Record<string, string> = {}
      for (const [id, tag] of Object.entries(prev)) {
        if (serverIds.has(id)) next[id] = tag
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [items])

  const item = items[activeIdx]

  const showToast = (t: ToastState) => {
    setToast(t)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const advance = () => {
    const next = items.findIndex((it, i) => i > activeIdx && !decided[it.id])
    if (next >= 0) { setActiveIdx(next); return }
    const anyLeft = items.findIndex((it) => !decided[it.id])
    if (anyLeft >= 0) setActiveIdx(anyLeft)
  }

  const pickAxis = (axis: string, val: string) => {
    setPicks((p) => ({ ...p, [axis]: val }))
    setNewOpen(null)
  }

  const handleAction = (a: TriageAction) => {
    if (a.type === 'skip') {
      setActiveIdx((i) => Math.min(items.length - 1, i + 1))
      mutation.mutate({ itemId: a.item.id, type: 'skip' })
      return
    }

    const tag =
      a.type === 'keep' ? 'kept'
      : a.type === 'ignore' ? 'ignored'
      : a.type === 'archive' ? 'archived'
      : a.type === 'confirm' ? 'archived'
      : null
    if (!tag) return

    lastAction.current = { prev: decided }
    setDecided((d) => ({ ...d, [a.item.id]: tag }))
    showToast({ tag, subject: a.item.source_metadata?.subject ?? a.item.filename ?? '' })
    setTimeout(advance, 80)

    // Langfuse decision timing (TRI-10)
    const langfuse = new Langfuse()
    langfuse.event({
      traceId: a.item.id,
      name: 'triage.decision',
      metadata: { type: a.type, durationMs: Date.now() - openedAt.current },
    })

    mutation.mutate({
      itemId: a.item.id,
      type: a.type,
      picks: a.picks
        ? {
            Type: a.picks['Type'],
            From: a.picks['From'],
            Context: a.picks['Context'],
          }
        : undefined,
    })
  }

  // Global keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (newOpen) return
      if (e.target instanceof Element) {
        const tag = (e.target as Element).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('[data-clerk-modal]')) return

      const k = e.key.toLowerCase()

      if (k === 'j') {
        setActiveIdx((i) => Math.min(items.length - 1, i + 1))
        e.preventDefault()
        return
      }
      if (k === 'h') {
        setActiveIdx((i) => Math.max(0, i - 1))
        e.preventDefault()
        return
      }
      if (k === 'u' && lastAction.current) {
        setDecided(lastAction.current.prev)
        showToast({ tag: 'undone', subject: '' })
        lastAction.current = null
        return
      }

      if (!item) return
      const isLabel = item.stage === 'label'

      if (!isLabel) {
        if (k === 'k') handleAction({ type: 'keep', item })
        else if (k === 'x') handleAction({ type: 'ignore', item })
        else if (k === 's') handleAction({ type: 'skip', item })
      } else {
        if (k === 'a') handleAction({ type: 'archive', item })
        else if (k === 'i') handleAction({ type: 'ignore', item })
        else if (k === 's') handleAction({ type: 'skip', item })
        else if (['1', '2', '3'].includes(k)) {
          const axes = ['Type', 'From', 'Context']
          const confidentRaw = item.classification_trace?.stage2?.confident ?? []
          const confidentNorm = confidentRaw.map((c) => c[0].toUpperCase() + c.slice(1))
          const unresolved = axes.find((a) => !confidentNorm.includes(a) && !picks[a])
          if (unresolved) {
            const idx = Number(k) - 1
            const axisKey = unresolved.toLowerCase() as 'type' | 'from' | 'context'
            const props = item.classification_trace?.stage2?.proposals?.[axisKey]
            if (props && props[idx]) pickAxis(unresolved, props[idx].value)
          }
        } else if (k === 'n') {
          const axes = ['Type', 'From', 'Context']
          const confidentRaw = item.classification_trace?.stage2?.confident ?? []
          const confidentNorm = confidentRaw.map((c) => c[0].toUpperCase() + c.slice(1))
          const unresolved = axes.find((a) => !confidentNorm.includes(a) && !picks[a])
          if (unresolved) setNewOpen(unresolved)
        }
      }

      if (e.key === 'Enter') handleAction({ type: 'confirm', item, picks })
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, item, picks, newOpen, decided])

  const total = items.length
  const doneCount = Object.keys(decided).length
  const remaining = total - doneCount

  return (
    <div className="cx-triage-inline cx-density-regular">
      <div className="cx-triage-topbar">
        <div className="cx-triage-counts">
          <span className="cx-triage-remaining">{remaining}</span>
          <span className="cx-triage-remaining-k">left</span>
          <span className="cx-triage-dot">·</span>
          <span className="cx-mono cx-muted">{doneCount} decided</span>
          <span className="cx-triage-dot">·</span>
          <span className="cx-mono cx-muted">{total} total</span>
        </div>
        <div className="cx-legend">
          <span><Kbd>J</Kbd>/<Kbd>H</Kbd> navigate</span>
          <span><Kbd>K</Kbd> keep</span>
          <span><Kbd>X</Kbd> ignore</span>
          <span><Kbd>↵</Kbd> confirm</span>
          <span><Kbd>U</Kbd> undo</span>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyHint title="Queue clear.">
          You&apos;re at inbox zero. New items flow in automatically.
        </EmptyHint>
      ) : (
        <ol className="cx-qlist">
          {items.map((it, i) => {
            const isActive = i === activeIdx
            const d = decided[it.id]
            const isLabel = it.stage === 'label'
            return (
              <li
                key={it.id}
                ref={(el) => { rowRefs.current[i] = el }}
                onClick={isActive ? undefined : () => setActiveIdx(i)}
                className={
                  'cx-card ' +
                  (isActive ? 'is-active ' : 'is-collapsed ') +
                  (d ? 'is-decided ' : '')
                }
              >
                <div className="cx-card-rail">
                  <div className="cx-card-rail-n">{String(i + 1).padStart(2, '0')}</div>
                  <div className="cx-card-rail-of">/ {String(items.length).padStart(2, '0')}</div>
                  <div className="cx-card-rail-mode">
                    <span className={'cx-mode-pill ' + (isLabel ? 'cx-mode-label' : 'cx-mode-relevance')}>
                      {isLabel ? 'label' : 'relevance'}
                    </span>
                  </div>
                  {d && (
                    <span className={'cx-queue-tag cx-queue-tag-' + d}>{d}</span>
                  )}
                </div>

                <div className="cx-card-main">
                  <div className="cx-card-head">
                    <div className="cx-card-meta">
                      <SourceBadge source={it.source} />
                      <span className="cx-meta-sep">·</span>
                      <span className="cx-mono">{it.source_metadata?.received ?? it.ingested_at}</span>
                      {isActive && it.source_metadata?.from && (
                        <>
                          <span className="cx-meta-sep">·</span>
                          <span className="cx-mono cx-muted">from {it.source_metadata.from}</span>
                        </>
                      )}
                    </div>
                    <h2 className="cx-card-title">
                      {it.source_metadata?.subject ?? it.filename ?? it.id}
                    </h2>
                    <div className="cx-card-sub">
                      {it.source === 'gmail' && it.source_metadata?.from && (
                        <>
                          <span className="cx-mono">from</span>{' '}
                          {it.source_metadata.from}
                          <span className="cx-meta-sep">·</span>
                        </>
                      )}
                      <span className="cx-mono">{it.filename}</span>
                      {it.size_bytes && (
                        <>
                          <span className="cx-meta-sep">·</span>
                          <span className="cx-mono cx-muted">{it.mime_type} · {(it.size_bytes / 1000).toFixed(0)} KB</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isActive && !d && (
                    <ExpandedCard
                      item={it}
                      picks={picks}
                      newOpen={newOpen}
                      setNewOpen={setNewOpen}
                      onPick={pickAxis}
                      onAction={handleAction}
                      identities={identities}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {toast && (
        <div className={'cx-toast cx-toast-' + toast.tag}>
          <span className="cx-toast-tag">{toast.tag}</span>
          {toast.subject && <span className="cx-toast-sub">{toast.subject}</span>}
          <span className="cx-toast-undo"><Kbd>U</Kbd> undo</span>
        </div>
      )}
    </div>
  )
}
