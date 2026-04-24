// App shell: sidebar, header, metrics strip.

function Logo() {
  return (
    <div className="cx-logo">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="15" height="15" rx="2" stroke="currentColor" strokeWidth="1"/>
        <path d="M6 7h8M6 10h5M6 13h7" stroke="currentColor" strokeWidth="1" strokeLinecap="square"/>
      </svg>
      <span className="cx-logo-word">Cortex</span>
    </div>
  );
}

function Sidebar({ route, setRoute, queues }) {
  const items = [
    { id: "triage", label: "Triage", kbd: "T", count: queues.relevance + queues.label },
    { id: "ask", label: "Ask", kbd: "A" },
    { id: "taxonomy", label: "Taxonomy", kbd: "X" },
    { id: "rules", label: "Rules", kbd: "R" },
    { id: "admin", label: "Admin", kbd: "M" },
  ];
  return (
    <aside className="cx-sidebar" data-screen-label="Sidebar">
      <div className="cx-sidebar-top">
        <Logo />
      </div>
      <nav className="cx-nav">
        {items.map((it) => (
          <button
            key={it.id}
            className={"cx-nav-item " + (route === it.id ? "is-active" : "")}
            onClick={() => setRoute(it.id)}
          >
            <span className="cx-nav-label">{it.label}</span>
            <span className="cx-nav-meta">
              {it.count != null && <span className="cx-nav-count">{it.count}</span>}
              <kbd className="cx-kbd cx-kbd-faint">{it.kbd}</kbd>
            </span>
          </button>
        ))}
      </nav>
      <div className="cx-sidebar-foot">
        <div className="cx-foot-row"><span>user</span><b>daniel@fonnit.com</b></div>
        <div className="cx-foot-row"><span>agent</span><b>launchd · connected</b></div>
        <div className="cx-foot-row"><span>gmail</span><b>synced · 4m ago</b></div>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle, right }) {
  return (
    <header className="cx-topbar">
      <div>
        <div className="cx-topbar-eyebrow">Cortex / {title}</div>
        {subtitle && <div className="cx-topbar-sub">{subtitle}</div>}
      </div>
      <div className="cx-topbar-right">{right}</div>
    </header>
  );
}

function MetricsStrip({ metrics }) {
  const cells = [
    { k: "cited answers / wk", v: metrics.weekly.citedAnswers, sub: "target ≥ 20" },
    { k: "relevance auto", v: metrics.auto.relevanceAutoPct + "%", sub: "target ≥ 50%" },
    { k: "label auto-archive", v: metrics.auto.labelAutoPct + "%", sub: "target ≥ 60%" },
    { k: "median decision", v: metrics.weekly.medianDecisionSec + "s", sub: "target < 3s" },
    { k: "rules", v: metrics.auto.rules, sub: "median 9 in ctx" },
    { k: "dormant", v: Math.round(metrics.auto.dormantRatio * 100) + "%", sub: "of rule base" },
  ];
  return (
    <div className="cx-strip">
      {cells.map((c) => (
        <div className="cx-strip-cell" key={c.k}>
          <div className="cx-strip-v">{c.v}</div>
          <div className="cx-strip-k">{c.k}</div>
          <div className="cx-strip-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Kbd({ children, dim = false }) {
  return <kbd className={"cx-kbd " + (dim ? "cx-kbd-faint" : "")}>{children}</kbd>;
}

function EmptyHint({ title, children }) {
  return (
    <div className="cx-empty">
      <div className="cx-empty-title">{title}</div>
      <div className="cx-empty-body">{children}</div>
    </div>
  );
}

Object.assign(window, { Logo, Sidebar, Topbar, MetricsStrip, Kbd, EmptyHint });
