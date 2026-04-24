interface TopbarProps {
  title: string
  subtitle?: string
  right?: React.ReactNode
}

export function Topbar({ title, subtitle, right }: TopbarProps) {
  return (
    <header className="cx-topbar">
      <div>
        <div className="cx-topbar-eyebrow">Cortex / {title}</div>
        {subtitle && <div className="cx-topbar-sub">{subtitle}</div>}
      </div>
      <div className="cx-topbar-right">{right}</div>
    </header>
  )
}
