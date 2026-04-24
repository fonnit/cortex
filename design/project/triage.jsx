// Triage surface — inline-expanding queue. Active row expands into the full card.
// Keyboard-first. Navigation: j/k move; K/X/S (relevance) or 1/2/3/N/A/I/⏎ (label).

function SourceBadge({ source }) {
  const map = {
    gmail: { label: "gmail", dot: "var(--cx-accent)" },
    downloads: { label: "downloads", dot: "var(--cx-ink-40)" },
  };
  const m = map[source] || map.downloads;
  return (
    <span className="cx-badge">
      <i className="cx-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function ConfBar({ v }) {
  return (
    <span className="cx-confbar" aria-hidden>
      <span className="cx-confbar-fill" style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}

function AxisGroup({ axis, proposals, confident, picked, onPick, newOpen, setNewOpen }) {
  const isConfident = confident.includes(axis);
  const isResolved = !!picked || isConfident;
  return (
    <div className={"cx-axis " + (isResolved ? "is-resolved" : "is-unresolved")}>
      <div className="cx-axis-head">
        <span className="cx-axis-name">{axis}</span>
        {isConfident && !picked && (
          <span className="cx-axis-status"><i className="cx-check" />auto-archived</span>
        )}
        {picked && (
          <span className="cx-axis-status"><i className="cx-check" />{picked}</span>
        )}
        {!isResolved && <span className="cx-axis-status cx-axis-status-alert">needs review</span>}
      </div>
      {!isResolved && (
        <div className="cx-axis-body">
          {proposals.map((p, i) => (
            <button key={p.value} className="cx-prop" onClick={(e) => { e.stopPropagation(); onPick(axis, p.value); }}>
              <span className="cx-prop-n">{i + 1}</span>
              <span className="cx-prop-v">{p.value}</span>
              <span className="cx-prop-conf">
                <ConfBar v={p.conf} />
                <span className="cx-prop-confn">{Math.round(p.conf * 100)}</span>
              </span>
            </button>
          ))}
          {newOpen === axis ? (
            <form className="cx-prop cx-prop-new-open"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const v = e.target.elements.v.value.trim();
                if (v) onPick(axis, v);
                setNewOpen(null);
              }}>
              <span className="cx-prop-n">+</span>
              <input name="v" autoFocus placeholder={`new ${axis.toLowerCase()}…`} className="cx-prop-newinput"
                onBlur={() => setTimeout(() => setNewOpen(null), 100)} />
              <span className="cx-prop-conf"><Kbd>↵</Kbd></span>
            </form>
          ) : (
            <button className="cx-prop cx-prop-new" onClick={(e) => { e.stopPropagation(); setNewOpen(axis); }}>
              <span className="cx-prop-n">n</span>
              <span className="cx-prop-v cx-muted">new {axis.toLowerCase()}…</span>
              <span className="cx-prop-conf"><Kbd dim>N</Kbd></span>
            </button>
          )}
        </div>
      )}
      {isConfident && !picked && (
        <div className="cx-axis-body cx-axis-confident">
          <div className="cx-conf-pick">{proposals[0].value}</div>
          <div className="cx-conf-meta">{Math.round(proposals[0].conf * 100)}% · rule-match</div>
        </div>
      )}
    </div>
  );
}

// Expanded body used inline within the active queue row.
function ExpandedCard({ item, picks, newOpen, setNewOpen, onPick, onAction }) {
  const isLabel = item.stage === "label";
  const axes = isLabel ? ["Type", "From", "Context"] : [];
  const confident = isLabel ? item.confident.map((k) => k[0].toUpperCase() + k.slice(1)) : [];

  return (
    <div className="cx-expanded" onClick={(e) => e.stopPropagation()}>
      <div className="cx-card-preview">
        <div className="cx-preview-label">preview</div>
        <p className="cx-preview-body">{item.snippet}</p>
      </div>

      {!isLabel && (
        <div className="cx-card-reason">
          <div className="cx-reason-label">why uncertain</div>
          <p className="cx-reason-body">{item.reason}</p>
          {item.suggestedRule && (
            <div className="cx-suggested-rule">
              <span className="cx-reason-label">draft rule</span>
              <code className="cx-mono">{item.suggestedRule}</code>
              <button className="cx-linkbtn">promote to rule →</button>
            </div>
          )}
        </div>
      )}

      {isLabel && (
        <div className="cx-axes">
          {axes.map((a) => (
            <AxisGroup key={a} axis={a}
              proposals={item.proposals[a.toLowerCase()]}
              confident={confident}
              picked={picks[a]}
              onPick={onPick}
              newOpen={newOpen}
              setNewOpen={setNewOpen}
            />
          ))}
          {item.proposedPath && (
            <div className="cx-path">
              <div className="cx-path-label">proposed drive path</div>
              <div className="cx-path-body cx-mono">
                {item.proposedPath.split("/").map((seg, i, arr) =>
                  seg ? (
                    <span key={i}>
                      <span className="cx-path-seg">{seg}</span>
                      {i < arr.length - 1 && <span className="cx-path-sep">/</span>}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="cx-card-actions">
        {!isLabel ? (
          <>
            <button className="cx-action cx-action-primary" onClick={() => onAction({ type: "keep", item })}>
              <span>Keep</span><Kbd>K</Kbd>
            </button>
            <button className="cx-action" onClick={() => onAction({ type: "ignore", item })}>
              <span>Ignore</span><Kbd>X</Kbd>
            </button>
            <button className="cx-action cx-action-ghost" onClick={() => onAction({ type: "skip", item })}>
              <span>Skip</span><Kbd>S</Kbd>
            </button>
          </>
        ) : (
          <>
            <button className="cx-action cx-action-primary" onClick={() => onAction({ type: "confirm", item, picks })}>
              <span>Confirm</span><Kbd>↵</Kbd>
            </button>
            <button className="cx-action" onClick={() => onAction({ type: "archive", item })}>
              <span>Archive as-is</span><Kbd>A</Kbd>
            </button>
            <button className="cx-action cx-action-ghost" onClick={() => onAction({ type: "ignore", item })}>
              <span>Ignore</span><Kbd>I</Kbd>
            </button>
            <button className="cx-action cx-action-ghost" onClick={() => onAction({ type: "skip", item })}>
              <span>Skip</span><Kbd>S</Kbd>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TriageView({ items, density }) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [decided, setDecided] = React.useState({});
  const [picks, setPicks] = React.useState({});
  const [newOpen, setNewOpen] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const lastAction = React.useRef(null);
  const rowRefs = React.useRef({});

  const item = items[activeIdx];

  // Reset per-item edit state when the active item changes.
  React.useEffect(() => {
    setPicks({});
    setNewOpen(null);
    const el = rowRefs.current[activeIdx];
    if (el && el.scrollIntoView) {
      // keep active row visible without jumping the whole page
      const rect = el.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [activeIdx]);

  const showToast = (t) => {
    setToast(t);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 2200);
  };

  const advance = () => {
    const next = items.findIndex((it, i) => i > activeIdx && !decided[it.id]);
    if (next >= 0) { setActiveIdx(next); return; }
    const anyLeft = items.findIndex((it) => !decided[it.id]);
    if (anyLeft >= 0) setActiveIdx(anyLeft);
  };

  const pickAxis = (axis, val) => {
    setPicks((p) => ({ ...p, [axis]: val }));
    setNewOpen(null);
  };

  const handleAction = (a) => {
    if (a.type === "next") { setActiveIdx((i) => Math.min(items.length - 1, i + 1)); return; }
    if (a.type === "prev") { setActiveIdx((i) => Math.max(0, i - 1)); return; }
    if (a.type === "skip") { setActiveIdx((i) => Math.min(items.length - 1, i + 1)); return; }
    const tag =
      a.type === "keep" ? "kept"
      : a.type === "ignore" ? "ignored"
      : a.type === "archive" ? "archived"
      : a.type === "confirm" ? "archived"
      : null;
    if (!tag) return;
    lastAction.current = { prev: decided };
    setDecided((d) => ({ ...d, [a.item.id]: tag }));
    showToast({ tag, subject: a.item.subject });
    setTimeout(advance, 80);
  };

  // Global keyboard — routed here so row doesn't need focus.
  React.useEffect(() => {
    const onKey = (e) => {
      if (newOpen) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") { setActiveIdx((i) => Math.min(items.length - 1, i + 1)); e.preventDefault(); return; }
      if (k === "h") { setActiveIdx((i) => Math.max(0, i - 1)); e.preventDefault(); return; }
      if (k === "u" && lastAction.current) {
        setDecided(lastAction.current.prev);
        showToast({ tag: "undone", subject: "" });
        lastAction.current = null;
        return;
      }
      if (!item) return;
      const isLabel = item.stage === "label";
      if (!isLabel) {
        if (k === "k") handleAction({ type: "keep", item });
        else if (k === "x") handleAction({ type: "ignore", item });
        else if (k === "s") handleAction({ type: "skip", item });
      } else {
        if (k === "a") handleAction({ type: "archive", item });
        else if (k === "i") handleAction({ type: "ignore", item });
        else if (k === "s") handleAction({ type: "skip", item });
        else if (["1","2","3"].includes(k)) {
          const axes = ["Type","From","Context"];
          const confident = item.confident.map((c) => c[0].toUpperCase() + c.slice(1));
          const unresolved = axes.find((a) => !confident.includes(a) && !picks[a]);
          if (unresolved) {
            const idx = Number(k) - 1;
            const props = item.proposals[unresolved.toLowerCase()];
            if (props && props[idx]) pickAxis(unresolved, props[idx].value);
          }
        } else if (k === "n") {
          const axes = ["Type","From","Context"];
          const confident = item.confident.map((c) => c[0].toUpperCase() + c.slice(1));
          const unresolved = axes.find((a) => !confident.includes(a) && !picks[a]);
          if (unresolved) setNewOpen(unresolved);
        }
      }
      if (e.key === "Enter") handleAction({ type: "confirm", item, picks });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, item, picks, newOpen, decided]);

  const total = items.length;
  const remaining = total - Object.keys(decided).length;
  const doneCount = Object.keys(decided).length;

  return (
    <div className={"cx-triage-inline cx-density-" + density}>
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
          <span><Kbd>⏎</Kbd> confirm</span>
          <span><Kbd>U</Kbd> undo</span>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyHint title="Queue clear.">You're at inbox zero. New items flow in automatically.</EmptyHint>
      ) : (
        <ol className="cx-qlist">
          {items.map((it, i) => {
            const isActive = i === activeIdx;
            const d = decided[it.id];
            const isLabel = it.stage === "label";
            return (
              <li key={it.id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  onClick={isActive ? undefined : () => setActiveIdx(i)}
                  className={
                    "cx-card " +
                    (isActive ? "is-active " : "is-collapsed ") +
                    (d ? "is-decided " : "")
                  }>
                <div className="cx-card-rail">
                  <div className="cx-card-rail-n">{String(i + 1).padStart(2, "0")}</div>
                  <div className="cx-card-rail-of">/ {String(items.length).padStart(2, "0")}</div>
                  <div className="cx-card-rail-mode">
                    <span className={"cx-mode-pill " + (isLabel ? "cx-mode-label" : "cx-mode-relevance")}>
                      {isLabel ? "label" : "relevance"}
                    </span>
                  </div>
                  {d && (
                    <span className={"cx-queue-tag cx-queue-tag-" + d}>{d}</span>
                  )}
                </div>

                <div className="cx-card-main">
                  <div className="cx-card-head">
                    <div className="cx-card-meta">
                      <SourceBadge source={it.source} />
                      <span className="cx-meta-sep">·</span>
                      <span className="cx-mono">{it.received}</span>
                      {isActive && (
                        <>
                          <span className="cx-meta-sep">·</span>
                          <span className="cx-mono cx-muted">hash {it.hash}</span>
                        </>
                      )}
                    </div>
                    <h2 className="cx-card-title">{it.subject}</h2>
                    <div className="cx-card-sub">
                      {it.source === "gmail" && (
                        <>
                          <span className="cx-mono">from</span> {it.from}
                          <span className="cx-meta-sep">·</span>
                        </>
                      )}
                      <span className="cx-mono">{it.filename}</span>
                      <span className="cx-meta-sep">·</span>
                      <span className="cx-mono cx-muted">{it.ext} · {it.size}</span>
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
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {toast && (
        <div className={"cx-toast cx-toast-" + toast.tag}>
          <span className="cx-toast-tag">{toast.tag}</span>
          {toast.subject && <span className="cx-toast-sub">{toast.subject}</span>}
          <span className="cx-toast-undo"><Kbd>U</Kbd> undo</span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TriageView });
