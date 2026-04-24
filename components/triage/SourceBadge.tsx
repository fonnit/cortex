interface SourceBadgeProps {
  source: 'gmail' | 'downloads'
}

const SOURCE_MAP: Record<string, { label: string; dot: string }> = {
  gmail: { label: 'gmail', dot: 'var(--cx-accent)' },
  downloads: { label: 'downloads', dot: 'var(--cx-ink-40)' },
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const m = SOURCE_MAP[source] ?? SOURCE_MAP.downloads
  return (
    <span className="cx-badge">
      <i className="cx-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  )
}
