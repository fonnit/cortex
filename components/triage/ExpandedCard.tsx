import { useState } from 'react'
import { AxisGroup } from './AxisGroup'

export interface TriageItem {
  id: string
  source: 'gmail' | 'downloads'
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  source_metadata: {
    subject?: string
    from?: string
    received?: string
    snippet?: string
  } | null
  classification_trace: {
    stage1?: { reason?: string; suggestedRule?: string }
    stage2?: {
      proposals?: {
        type?: Array<{ value: string; conf: number }>
        from?: Array<{ value: string; conf: number }>
        context?: Array<{ value: string; conf: number }>
      }
      confident?: string[]
    }
  } | null
  proposed_drive_path: string | null
  stage: 'relevance' | 'label'
  ingested_at: string
}

export type TriageDecisionType = 'keep' | 'ignore' | 'archive' | 'confirm' | 'skip'

export interface TriageAction {
  type: TriageDecisionType
  item: TriageItem
  picks?: Record<string, string>
}

interface ExpandedCardProps {
  item: TriageItem
  picks: Record<string, string>
  newOpen: string | null
  setNewOpen: (a: string | null) => void
  onPick: (axis: string, val: string) => void
  onAction: (a: TriageAction) => void
  identities?: Array<{ name: string; type: string }>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="cx-kbd">{children}</kbd>
}

export function ExpandedCard({
  item,
  picks,
  newOpen,
  setNewOpen,
  onPick,
  onAction,
  identities = [],
}: ExpandedCardProps) {
  const isLabel = item.stage === 'label'
  const axes = isLabel ? ['Type', 'From', 'Context'] : []

  const [identitySuggest, setIdentitySuggest] = useState<{ name: string; type: string; email: string } | null>(null)
  const [identityBusy, setIdentityBusy] = useState(false)
  const [identitySaved, setIdentitySaved] = useState<string | null>(null)

  // Normalize confident axes to Title Case to match axis names
  const confidentRaw = item.classification_trace?.stage2?.confident ?? []
  const confident = isLabel
    ? confidentRaw.map((k) => k[0].toUpperCase() + k.slice(1))
    : []

  const proposals = item.classification_trace?.stage2?.proposals

  // Snippet from source_metadata or stage1 reason
  const snippet = item.source_metadata?.snippet
  const reason = item.classification_trace?.stage1?.reason
  const suggestedRule = item.classification_trace?.stage1?.suggestedRule
  const proposedPath = item.proposed_drive_path

  function handlePick(axis: string, val: string) {
    onPick(axis, val)
    if (axis === 'From') {
      const known = identities.some(i => i.name.toLowerCase() === val.toLowerCase())
      if (!known) {
        setIdentitySuggest({ name: val, type: '', email: '' })
        setIdentitySaved(null)
      }
    }
  }

  return (
    <div className="cx-expanded" onClick={(e) => e.stopPropagation()}>
      <div className="cx-card-preview">
        <div className="cx-preview-label">preview</div>
        <p className="cx-preview-body">{snippet}</p>
      </div>

      {!isLabel && (
        <div className="cx-card-reason">
          <div className="cx-reason-label">why uncertain</div>
          <p className="cx-reason-body">{reason}</p>
          {suggestedRule && (
            <div className="cx-suggested-rule">
              <span className="cx-reason-label">draft rule</span>
              <code className="cx-mono">{suggestedRule}</code>
              <button className="cx-linkbtn">promote to rule →</button>
            </div>
          )}
        </div>
      )}

      {isLabel && (
        <div className="cx-axes">
          {axes.map((a) => (
            <AxisGroup
              key={a}
              axis={a}
              proposals={
                proposals?.[a.toLowerCase() as keyof typeof proposals] ?? []
              }
              confident={confident}
              picked={picks[a]}
              onPick={handlePick}
              newOpen={newOpen}
              setNewOpen={setNewOpen}
            />
          ))}
          {proposedPath && (
            <div className="cx-path">
              <div className="cx-path-label">proposed drive path</div>
              <div className="cx-path-body cx-mono">
                {proposedPath.split('/').map((seg, i, arr) =>
                  seg ? (
                    <span key={i}>
                      <span className="cx-path-seg">{seg}</span>
                      {i < arr.length - 1 && (
                        <span className="cx-path-sep">/</span>
                      )}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {identitySuggest && !identitySaved && (
        <div className="cx-axis" style={{ marginTop: 12 }}>
          <div className="cx-axis-head">
            <span className="cx-axis-name">add identity — {identitySuggest.name}</span>
            <span className="cx-axis-status cx-axis-status-alert">new</span>
          </div>
          <div className="cx-axis-body">
            {['owner', 'company', ...new Set(identities.map(i => i.type))].filter((v, i, a) => a.indexOf(v) === i).map((t, i) => (
              <button key={t} className="cx-prop" onClick={() => setIdentitySuggest(s => s ? { ...s, type: t } : s)}>
                <span className="cx-prop-n">{i + 1}</span>
                <span className="cx-prop-v">{t}</span>
                <span className="cx-prop-conf">
                  {identitySuggest.type === t && <span className="cx-check" />}
                </span>
              </button>
            ))}
            <div className="cx-prop" style={{ cursor: 'default' }}>
              <span className="cx-prop-n">n</span>
              <input
                className="cx-prop-newinput"
                placeholder="custom type…"
                value={!['owner', 'company', ...identities.map(i => i.type)].includes(identitySuggest.type) ? identitySuggest.type : ''}
                onChange={e => setIdentitySuggest(s => s ? { ...s, type: e.target.value } : s)}
              />
            </div>
            <div className="cx-prop" style={{ cursor: 'default' }}>
              <span className="cx-prop-n">@</span>
              <input
                className="cx-prop-newinput"
                type="email"
                placeholder="email (optional)"
                value={identitySuggest.email}
                onChange={e => setIdentitySuggest(s => s ? { ...s, email: e.target.value } : s)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '8px 6px' }}>
            <button
              className="cx-action cx-action-sm cx-action-primary"
              disabled={identityBusy || !identitySuggest.type.trim()}
              onClick={async () => {
                setIdentityBusy(true)
                try {
                  await fetch('/api/identity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: identitySuggest.name,
                      type: identitySuggest.type.trim(),
                      email: identitySuggest.email.trim() || null,
                    }),
                  })
                  setIdentitySaved(identitySuggest.name)
                } finally {
                  setIdentityBusy(false)
                }
              }}
            ><span>Save identity</span></button>
            <button className="cx-action cx-action-ghost cx-action-sm" onClick={() => setIdentitySuggest(null)}><span>Skip</span></button>
          </div>
        </div>
      )}
      {identitySaved && (
        <div className="cx-mono cx-muted" style={{ fontSize: '12.5px', padding: '8px 14px' }}>
          &ldquo;{identitySaved}&rdquo; saved as identity.
        </div>
      )}

      <div className="cx-card-actions">
        {!isLabel ? (
          <>
            <button
              className="cx-action cx-action-primary"
              onClick={() => onAction({ type: 'keep', item })}
            >
              <span>Keep</span>
              <Kbd>K</Kbd>
            </button>
            <button
              className="cx-action"
              onClick={() => onAction({ type: 'ignore', item })}
            >
              <span>Ignore</span>
              <Kbd>X</Kbd>
            </button>
            <button
              className="cx-action cx-action-ghost"
              onClick={() => onAction({ type: 'skip', item })}
            >
              <span>Skip</span>
              <Kbd>S</Kbd>
            </button>
          </>
        ) : (
          <>
            <button
              className="cx-action cx-action-primary"
              onClick={() => onAction({ type: 'confirm', item, picks })}
            >
              <span>Confirm</span>
              <Kbd>↵</Kbd>
            </button>
            <button
              className="cx-action"
              onClick={() => onAction({ type: 'archive', item })}
            >
              <span>Archive as-is</span>
              <Kbd>A</Kbd>
            </button>
            <button
              className="cx-action cx-action-ghost"
              onClick={() => onAction({ type: 'ignore', item })}
            >
              <span>Ignore</span>
              <Kbd>I</Kbd>
            </button>
            <button
              className="cx-action cx-action-ghost"
              onClick={() => onAction({ type: 'skip', item })}
            >
              <span>Skip</span>
              <Kbd>S</Kbd>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
