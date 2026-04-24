// Ask / retrieval surface. Claude is the sole retrieval surface per §5.7.

function Sparkline({ values, w = 120, h = 28 }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="cx-spark" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function AskView({ thread }) {
  const [q, setQ] = React.useState(thread.question);
  const [submitted, setSubmitted] = React.useState(true);

  return (
    <div className="cx-ask" data-screen-label="Ask">
      <div className="cx-ask-main">
        <form
          className="cx-ask-input"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <span className="cx-ask-prompt">ask</span>
          <input
            className="cx-ask-field"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ask anything — Cortex will cite its sources."
          />
          <button className="cx-action cx-action-primary" type="submit">
            <span>Answer</span><Kbd>↵</Kbd>
          </button>
        </form>

        {submitted && (
          <div className="cx-answer">
            <div className="cx-answer-head">
              <span className="cx-answer-label">answer</span>
              <span className="cx-mono cx-muted">
                claude-haiku · 4 citations · 412 ms
              </span>
            </div>
            <div className="cx-answer-body">
              {thread.answer.map((p, i) => (
                <p key={i}>
                  {p.text}{" "}
                  {p.cites.map((n) => (
                    <a key={n} href={`#src-${n}`} className="cx-cite">
                      {n}
                    </a>
                  ))}
                </p>
              ))}
            </div>
            <div className="cx-answer-foot">
              <button className="cx-action cx-action-ghost"><span>Useful</span><Kbd>Y</Kbd></button>
              <button className="cx-action cx-action-ghost"><span>Off</span><Kbd>N</Kbd></button>
              <button className="cx-action cx-action-ghost"><span>Refine</span></button>
            </div>
          </div>
        )}

        {submitted && (
          <div className="cx-sources">
            <div className="cx-sources-head">sources</div>
            <ol className="cx-sources-list">
              {thread.sources.map((s) => (
                <li key={s.n} id={`src-${s.n}`} className="cx-source">
                  <span className="cx-source-n">{s.n}</span>
                  <div className="cx-source-body">
                    <div className="cx-source-title">{s.title}</div>
                    <div className="cx-source-path cx-mono">{s.path}</div>
                  </div>
                  <div className="cx-source-when cx-mono">{s.when}</div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <aside className="cx-ask-side">
        <div className="cx-ask-side-head">recent</div>
        <ul className="cx-ask-history">
          {thread.history.map((h, i) => (
            <li key={i}>
              <button className="cx-ask-hist" onClick={() => { setQ(h); setSubmitted(true); }}>
                {h}
              </button>
            </li>
          ))}
        </ul>
        <div className="cx-ask-side-head cx-ask-side-head-2">this week</div>
        <div className="cx-ask-stats">
          <div className="cx-stat">
            <div className="cx-stat-v">23</div>
            <div className="cx-stat-k">cited answers</div>
          </div>
          <div className="cx-stat">
            <div className="cx-stat-v">87%</div>
            <div className="cx-stat-k">marked useful</div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function TaxonomyView({ taxonomy, merges }) {
  const [tab, setTab] = React.useState("types");
  const tabs = [
    { id: "types", label: "Types" },
    { id: "entities", label: "Entities (from)" },
    { id: "contexts", label: "Contexts" },
  ];
  const list = taxonomy[tab] || [];

  return (
    <div className="cx-tax" data-screen-label="Taxonomy">
      <div className="cx-tax-main">
        <div className="cx-tabrow">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"cx-tab " + (tab === t.id ? "is-active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="cx-tab-count">{taxonomy[t.id].length}</span>
            </button>
          ))}
        </div>
        <table className="cx-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="cx-right">Items</th>
              <th>Last used</th>
              <th className="cx-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={row.name}>
                <td className="cx-table-name">{row.name}</td>
                <td className="cx-right cx-mono">{row.count}</td>
                <td className="cx-mono cx-muted">{row.lastUsed}</td>
                <td className="cx-right">
                  <button className="cx-linkbtn">rename</button>
                  <button className="cx-linkbtn">merge</button>
                  <button className="cx-linkbtn">split</button>
                  <button className="cx-linkbtn cx-muted">deprecate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="cx-tax-side">
        <div className="cx-tax-side-head">
          suggested merges
          <span className="cx-tax-side-sub">{merges.length} pending · never auto</span>
        </div>
        <ul className="cx-merge-list">
          {merges.map((m) => (
            <li key={m.id} className="cx-merge">
              <div className="cx-merge-kind cx-mono">{m.kind}</div>
              <div className="cx-merge-pair">
                <span className="cx-merge-a">{m.a}</span>
                <span className="cx-merge-arrow">⤳</span>
                <span className="cx-merge-b">{m.b}</span>
              </div>
              <div className="cx-merge-ev cx-mono cx-muted">{m.evidence}</div>
              <div className="cx-merge-canon">
                canonical: <b>{m.suggestedCanonical}</b>
              </div>
              <div className="cx-merge-actions">
                <button className="cx-action cx-action-primary cx-action-sm"><span>Accept</span></button>
                <button className="cx-action cx-action-sm"><span>Edit</span></button>
                <button className="cx-action cx-action-ghost cx-action-sm"><span>Reject</span></button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function RulesView({ rules }) {
  const [filter, setFilter] = React.useState("all");
  const filtered = rules.filter((r) =>
    filter === "all" ? true : filter === "active" ? r.status === "active" : r.status === "dormant"
  );
  return (
    <div className="cx-rules" data-screen-label="Rules">
      <div className="cx-rules-head">
        <div className="cx-tabrow">
          {[
            { id: "all", label: "All" },
            { id: "active", label: "Active" },
            { id: "dormant", label: "Dormant" },
          ].map((t) => (
            <button
              key={t.id}
              className={"cx-tab " + (filter === t.id ? "is-active" : "")}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
              <span className="cx-tab-count">
                {t.id === "all" ? rules.length : rules.filter((r) => r.status === t.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="cx-rules-note cx-muted">
          hard cap: 20 rules / classification prompt · weekly consolidation job active
        </div>
      </div>
      <ol className="cx-rules-list">
        {rules.filter((r) =>
          filter === "all" ? true : r.status === filter
        ).map((r) => (
          <li key={r.id} className={"cx-rule cx-rule-" + r.status}>
            <div className="cx-rule-head">
              <span className="cx-mono cx-muted">{r.id}</span>
              <span className={"cx-rule-status cx-rule-status-" + r.status}>{r.status}</span>
            </div>
            <code className="cx-rule-text">{r.text}</code>
            <div className="cx-rule-foot cx-mono cx-muted">
              <span>{r.fires} fires</span>
              <span>last {r.lastFired}</span>
              <span>{r.provenance}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AdminView({ metrics }) {
  const rows = [
    { k: "Cited answers / wk", v: metrics.weekly.citedAnswers, target: "≥ 20", pass: true },
    { k: "NL queries / wk", v: "31", target: "≥ 5", pass: true },
    { k: "Triage days active / wk", v: "5 of 7", target: "≥ 5", pass: true },
    { k: "% inbound via Cortex", v: "97%", target: "≥ 95%", pass: true },
    { k: "Relevance auto-decision", v: metrics.auto.relevanceAutoPct + "%", target: "≥ 50%", pass: true },
    { k: "Label auto-archive", v: metrics.auto.labelAutoPct + "%", target: "≥ 60%", pass: true },
    { k: "Median triage decision", v: metrics.weekly.medianDecisionSec + " s", target: "< 3 s", pass: true },
    { k: "Retrieval correctness", v: "72%", target: "≥ 70%", pass: true },
  ];
  return (
    <div className="cx-admin" data-screen-label="Admin">
      <div className="cx-admin-top">
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">queue depths</div>
          <div className="cx-admin-card-body">
            <div className="cx-qdepth">
              <div className="cx-qdepth-n">{metrics.queues.relevance}</div>
              <div className="cx-qdepth-k">relevance</div>
            </div>
            <div className="cx-qdepth">
              <div className="cx-qdepth-n">{metrics.queues.label}</div>
              <div className="cx-qdepth-k">label</div>
            </div>
            <div className="cx-qdepth cx-qdepth-trend">
              <Sparkline values={metrics.queueTrend} w={140} h={36} />
              <div className="cx-qdepth-k">8-wk trend</div>
            </div>
          </div>
        </div>
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">rule system health</div>
          <div className="cx-admin-card-body cx-admin-card-body-text">
            <div className="cx-kv"><span>rule count</span><b>{metrics.auto.rules}</b></div>
            <div className="cx-kv"><span>median rules in context</span><b>{metrics.auto.medianRulesInCtx}</b></div>
            <div className="cx-kv"><span>dormant ratio</span><b>{Math.round(metrics.auto.dormantRatio * 100)}%</b></div>
            <div className="cx-kv"><span>next consolidation</span><b>Sun 03:00</b></div>
          </div>
        </div>
        <div className="cx-admin-card">
          <div className="cx-admin-card-head">pulse (wk 4)</div>
          <div className="cx-admin-card-body cx-admin-card-body-text">
            <div className="cx-pulse">
              <div className="cx-pulse-n">8<span className="cx-pulse-of"> / 10</span></div>
              <div className="cx-pulse-q">"Is Cortex working for you?"</div>
            </div>
          </div>
        </div>
      </div>
      <table className="cx-table cx-admin-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="cx-right">Value</th>
            <th className="cx-right">Target</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="cx-right cx-mono">{r.v}</td>
              <td className="cx-right cx-mono cx-muted">{r.target}</td>
              <td>
                <span className={"cx-admin-dot " + (r.pass ? "is-pass" : "is-fail")} />
                <span className="cx-mono">{r.pass ? "on track" : "off"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

Object.assign(window, { AskView, TaxonomyView, RulesView, AdminView, Sparkline });
