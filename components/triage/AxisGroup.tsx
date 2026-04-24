interface Proposal {
  value: string
  conf: number
}

interface AxisGroupProps {
  axis: string
  proposals: Proposal[]
  confident: string[]
  picked: string | undefined
  onPick: (axis: string, val: string) => void
  newOpen: string | null
  setNewOpen: (a: string | null) => void
}

function ConfBar({ v }: { v: number }) {
  return (
    <span className="cx-confbar" aria-hidden>
      <span className="cx-confbar-fill" style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  )
}

function Kbd({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <kbd className={'cx-kbd' + (dim ? ' cx-kbd-faint' : '')}>{children}</kbd>
  )
}

export function AxisGroup({
  axis,
  proposals,
  confident,
  picked,
  onPick,
  newOpen,
  setNewOpen,
}: AxisGroupProps) {
  const isConfident = confident.includes(axis)
  const isResolved = !!picked || isConfident

  return (
    <div className={'cx-axis ' + (isResolved ? 'is-resolved' : 'is-unresolved')}>
      <div className="cx-axis-head">
        <span className="cx-axis-name">{axis}</span>
        {isConfident && !picked && (
          <span className="cx-axis-status">
            <i className="cx-check" />
            auto-archived
          </span>
        )}
        {picked && (
          <span className="cx-axis-status">
            <i className="cx-check" />
            {picked}
          </span>
        )}
        {!isResolved && (
          <span className="cx-axis-status cx-axis-status-alert">needs review</span>
        )}
      </div>

      {!isResolved && (
        <div className="cx-axis-body">
          {proposals.map((p, i) => (
            <button
              key={p.value}
              className="cx-prop"
              onClick={(e) => {
                e.stopPropagation()
                onPick(axis, p.value)
              }}
            >
              <span className="cx-prop-n">{i + 1}</span>
              <span className="cx-prop-v">{p.value}</span>
              <span className="cx-prop-conf">
                <ConfBar v={p.conf} />
                <span className="cx-prop-confn">{Math.round(p.conf * 100)}</span>
              </span>
            </button>
          ))}

          {newOpen === axis ? (
            <form
              className="cx-prop cx-prop-new-open"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault()
                const form = e.target as HTMLFormElement
                const v = (form.elements.namedItem('v') as HTMLInputElement).value.trim()
                if (v) onPick(axis, v)
                setNewOpen(null)
              }}
            >
              <span className="cx-prop-n">+</span>
              <input
                name="v"
                autoFocus
                placeholder={`new ${axis.toLowerCase()}…`}
                className="cx-prop-newinput"
                onBlur={() => setTimeout(() => setNewOpen(null), 100)}
              />
              <span className="cx-prop-conf">
                <Kbd>↵</Kbd>
              </span>
            </form>
          ) : (
            <button
              className="cx-prop cx-prop-new"
              onClick={(e) => {
                e.stopPropagation()
                setNewOpen(axis)
              }}
            >
              <span className="cx-prop-n">n</span>
              <span className="cx-prop-v cx-muted">new {axis.toLowerCase()}…</span>
              <span className="cx-prop-conf">
                <Kbd dim>N</Kbd>
              </span>
            </button>
          )}
        </div>
      )}

      {isConfident && !picked && (
        <div className="cx-axis-body cx-axis-confident">
          <div className="cx-conf-pick">{proposals[0]?.value}</div>
          <div className="cx-conf-meta">
            {Math.round((proposals[0]?.conf ?? 0) * 100)}% · rule-match
          </div>
        </div>
      )}
    </div>
  )
}
