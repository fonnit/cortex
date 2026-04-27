'use client'

import { useEffect, useId, useRef, useState, type ReactElement } from 'react'

export interface CxComboboxProps {
  value: string
  onChange: (next: string) => void
  options: string[]
  placeholder?: string
  className?: string
  inputClassName?: string
  autoFocus?: boolean
  disabled?: boolean
  id?: string
}

export function CxCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputClassName,
  autoFocus,
  disabled,
  id,
}: CxComboboxProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number>(-1)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listboxRef = useRef<HTMLUListElement | null>(null)

  const reactId = useId()
  const listboxId = `cx-combobox-list-${reactId}`
  const optionId = (i: number) => `cx-combobox-option-${reactId}-${i}`

  // Filter options case-insensitively (substring match). Empty input → all options.
  const needle = value.toLowerCase()
  const filtered = needle
    ? options.filter((o) => o.toLowerCase().includes(needle))
    : options.slice()

  // Outside-click handler: close on mousedown outside wrapper
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!wrapperRef.current) return
      if (target && !wrapperRef.current.contains(target)) {
        setOpen(false)
        setHighlight(-1)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [])

  // Optional: scroll the highlighted option into view
  useEffect(() => {
    if (!open || highlight < 0) return
    const list = listboxRef.current
    if (!list) return
    const child = list.children[highlight] as HTMLElement | undefined
    if (child && typeof child.scrollIntoView === 'function') {
      child.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlight])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setHighlight(filtered.length > 0 ? 0 : -1)
        return
      }
      setHighlight((h) => Math.min(filtered.length - 1, h + 1))
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((h) => Math.max(0, h - 1))
      return
    }

    if (e.key === 'Enter') {
      if (open && highlight >= 0 && highlight < filtered.length) {
        e.preventDefault()
        onChange(filtered[highlight])
        setOpen(false)
        setHighlight(-1)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setHighlight(-1)
      return
    }

    if (e.key === 'Tab') {
      // Allow natural tab order; just close popover.
      setOpen(false)
      setHighlight(-1)
      return
    }
  }

  const wrapperClass = 'cx-combobox' + (className ? ' ' + className : '')
  const inputClass = inputClassName ?? 'cx-prop-newinput'

  return (
    <div ref={wrapperRef} className={wrapperClass}>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlight >= 0 ? optionId(highlight) : undefined
        }
        className={inputClass}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          className="cx-combobox-list"
        >
          {filtered.map((opt, i) => (
            <li
              id={optionId(i)}
              key={opt}
              role="option"
              aria-selected={highlight === i}
              className="cx-combobox-option"
              onMouseDown={(e) => {
                // Prevent the input from blurring before our click lands.
                e.preventDefault()
                onChange(opt)
                setOpen(false)
                setHighlight(-1)
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
