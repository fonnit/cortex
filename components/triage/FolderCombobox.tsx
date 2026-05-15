'use client'

// Lightweight folder combobox: a text input + a filtered listbox below it.
// Replaces native <datalist> so the dropdown styling actually matches the
// design system. Keyboard-first: ↑/↓ moves the active row, Enter selects,
// Esc closes.

import { useEffect, useMemo, useRef, useState } from 'react'

export type ComboFolder = { id: string; path: string }

type Props = {
  folders: ComboFolder[]
  value: string | null                      // selected folderId, or null
  onChange: (folderId: string | null) => void
  /** Called when the user confirms a selection (Enter on highlighted row). */
  onConfirm?: (folderId: string | null) => void
  /** When true, an extra "(none)" row is selectable and maps to null. */
  allowNone?: boolean
  noneLabel?: string
  placeholder?: string
  autoFocus?: boolean
  /** Optional callback when user presses Escape with the input focused. */
  onEscape?: () => void
}

type Row =
  | { kind: 'none'; label: string }
  | { kind: 'folder'; id: string; path: string }

export function FolderCombobox({
  folders,
  value,
  onChange,
  onConfirm,
  allowNone = false,
  noneLabel = '(none)',
  placeholder = 'Type to filter folders',
  autoFocus = false,
  onEscape,
}: Props) {
  // The visible query is independent from `value`; we sync it when value
  // changes externally so the input reflects the current selection.
  const selectedPath = useMemo(() => {
    if (value === null) return allowNone ? '' : ''
    return folders.find((f) => f.id === value)?.path ?? ''
  }, [value, folders, allowNone])

  const [query, setQuery] = useState<string>(selectedPath)
  const [open, setOpen] = useState<boolean>(false)
  const [activeIdx, setActiveIdx] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // Sync the input when external `value` changes.
  useEffect(() => {
    setQuery(selectedPath)
  }, [selectedPath])

  // Filter rows by the query (case-insensitive substring on path).
  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q.length === 0
      ? folders
      : folders.filter((f) => f.path.toLowerCase().includes(q))
    const out: Row[] = matched.map((f) => ({ kind: 'folder', id: f.id, path: f.path }))
    if (allowNone) out.unshift({ kind: 'none', label: noneLabel })
    return out
  }, [folders, query, allowNone, noneLabel])

  // Clamp the active index when the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= rows.length) setActiveIdx(Math.max(0, rows.length - 1))
  }, [rows.length, activeIdx])

  // Scroll the active row into view inside the listbox.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLLIElement>(`li[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const select = (row: Row) => {
    if (row.kind === 'none') {
      onChange(null)
      setQuery('')
    } else {
      onChange(row.id)
      setQuery(row.path)
    }
    setOpen(false)
    onConfirm?.(row.kind === 'none' ? null : row.id)
  }

  return (
    <div className="cx-combobox" onBlur={(e) => {
      // Only close when focus leaves the whole combobox (input → listbox is still inside).
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
    }}>
      <input
        ref={inputRef}
        className="cx-ask-input cx-combobox-input"
        type="text"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) { setOpen(true); return }
            setActiveIdx((i) => Math.min(rows.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIdx((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const row = rows[activeIdx]
            if (row) select(row)
          } else if (e.key === 'Escape') {
            if (open) {
              setOpen(false)
            } else {
              onEscape?.()
            }
          }
        }}
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
      />
      {open && rows.length > 0 && (
        <ul ref={listRef} className="cx-combobox-list" role="listbox">
          {rows.map((row, idx) => {
            const active = idx === activeIdx
            const key = row.kind === 'none' ? '__none__' : row.id
            return (
              <li
                key={key}
                data-idx={idx}
                role="option"
                aria-selected={active}
                className="cx-combobox-option"
                onMouseDown={(e) => {
                  // mousedown not click — prevent blur on input before select fires
                  e.preventDefault()
                  select(row)
                }}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                {row.kind === 'none'
                  ? <span className="cx-mono cx-muted">{row.label}</span>
                  : <span className="cx-mono">{row.path}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {open && rows.length === 0 && (
        <ul className="cx-combobox-list">
          <li className="cx-combobox-empty cx-mono cx-muted">No folder matches.</li>
        </ul>
      )}
    </div>
  )
}
