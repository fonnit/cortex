'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

interface SidebarProps {
  route: string
  onRouteChange: (r: string) => void
  queues: { relevance: number; label: number }
}

interface StatusResponse {
  daemon: { connected: boolean; lastSeen: string }
  gmail: { connected: boolean; lastSync: string }
}

function Logo() {
  return (
    <div className="cx-logo">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="15" height="15" rx="2" stroke="currentColor" strokeWidth="1" />
        <path d="M6 7h8M6 10h5M6 13h7" stroke="currentColor" strokeWidth="1" strokeLinecap="square" />
      </svg>
      <span className="cx-logo-word">Cortex</span>
    </div>
  )
}

export function Sidebar({ route, onRouteChange, queues }: SidebarProps) {
  const { user } = useUser()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const { data: status } = useQuery<StatusResponse>({
    queryKey: ['status'],
    queryFn: () => fetch('/api/status').then((r) => r.json()),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored)
    }
  }, [])

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  const items = [
    { id: 'triage', label: 'Triage', kbd: 'T', count: queues.relevance + queues.label },
    { id: 'ask', label: 'Ask', kbd: 'A' },
    { id: 'taxonomy', label: 'Taxonomy', kbd: 'X' },
    { id: 'rules', label: 'Rules', kbd: 'R' },
    { id: 'admin', label: 'Admin', kbd: 'M' },
  ] as const

  const daemonLabel = status
    ? status.daemon.connected
      ? `connected · ${status.daemon.lastSeen}`
      : `disconnected · ${status.daemon.lastSeen}`
    : 'checking...'

  const gmailLabel = status
    ? status.gmail.connected
      ? `synced · ${status.gmail.lastSync}`
      : `not synced · ${status.gmail.lastSync}`
    : 'checking...'

  return (
    <aside className="cx-sidebar" data-screen-label="Sidebar">
      <div className="cx-sidebar-top">
        <Logo />
      </div>
      <nav className="cx-nav">
        {items.map((it) => (
          <button
            key={it.id}
            className={'cx-nav-item ' + (route === it.id ? 'is-active' : '')}
            onClick={() => onRouteChange(it.id)}
          >
            <span className="cx-nav-label">{it.label}</span>
            <span className="cx-nav-meta">
              {'count' in it && it.count != null && (
                <span className="cx-nav-count">{it.count}</span>
              )}
              <kbd className="cx-kbd cx-kbd-faint">{it.kbd}</kbd>
            </span>
          </button>
        ))}
      </nav>
      <div className="cx-sidebar-foot">
        <div className="cx-foot-row">
          <span>user</span>
          <b>{user?.primaryEmailAddress?.emailAddress ?? 'loading...'}</b>
        </div>
        <div className="cx-foot-row">
          <span>agent</span>
          <b>{daemonLabel}</b>
        </div>
        <div className="cx-foot-row">
          <span>gmail</span>
          <b>{gmailLabel}</b>
        </div>
        <div className="cx-foot-row">
          <button className="cx-linkbtn" onClick={toggleTheme}>
            {theme === 'light' ? 'dark' : 'light'}
          </button>
        </div>
      </div>
    </aside>
  )
}
