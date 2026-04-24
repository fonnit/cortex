// Sample data for Cortex — Daniel's world per the brief.

const SAMPLE_ITEMS = [
  {
    id: "i_7fa2",
    hash: "b4f9c2…",
    source: "gmail",
    from: "billing@acme.com",
    subject: "Invoice #A-2041 — January services",
    filename: "invoice-A-2041.pdf",
    ext: "pdf",
    size: "184 KB",
    sizeBytes: 184_000,
    received: "2h ago",
    snippet:
      "Hi Daniel — attached is January's invoice for professional services rendered. Net 30. Thanks — Acme AP.",
    attachments: 1,
    stage: "label",
    proposals: {
      type: [
        { value: "Financial / Invoice", conf: 0.94 },
        { value: "Financial / Receipt", conf: 0.31 },
        { value: "Correspondence", conf: 0.08 },
      ],
      from: [
        { value: "Acme Co.", conf: 0.97 },
        { value: "Acme AP", conf: 0.42 },
      ],
      context: [
        { value: "FonnIT / Clients / Acme", conf: 0.88 },
        { value: "FonnIT / Billing", conf: 0.22 },
      ],
    },
    proposedPath: "/Cortex/FonnIT/Clients/Acme/Invoices/2026/invoice-A-2041.pdf",
    confident: ["type", "from"], // label mode: only 'context' highlighted as uncertain
  },
  {
    id: "i_8c31",
    hash: "9e02a1…",
    source: "downloads",
    from: "—",
    subject: "Screenshot 2026-04-23 at 14.22.09.png",
    filename: "Screenshot 2026-04-23 at 14.22.09.png",
    ext: "png",
    size: "2.1 MB",
    sizeBytes: 2_100_000,
    received: "12m ago",
    snippet: "Image · 1890×1024 · captured from Preview",
    attachments: 0,
    stage: "relevance",
    proposals: null,
    proposedPath: null,
    reason:
      "Screenshots from /Desktop — no recurring pattern yet. Consider an ignore rule for ad-hoc screenshots?",
  },
  {
    id: "i_0a44",
    hash: "2c11ee…",
    source: "downloads",
    from: "—",
    subject: "Figma-124.2.0.dmg",
    filename: "Figma-124.2.0.dmg",
    ext: "dmg",
    size: "312 MB",
    sizeBytes: 312_000_000,
    received: "1h ago",
    snippet: "Disk image · metadata-only (above 1 MB threshold for installers).",
    attachments: 0,
    stage: "relevance",
    proposals: null,
    proposedPath: null,
    reason:
      "Installer. Matches draft rule: ext=dmg size>1MB source=downloads → ignore (not yet confirmed).",
    suggestedRule: "ext=dmg size>1MB source=downloads → ignore",
  },
  {
    id: "i_51bb",
    hash: "7a8810…",
    source: "gmail",
    from: "research-digest@arxiv-weekly.net",
    subject: "Weekly digest — retrieval, agents, memory (wk 17)",
    filename: "digest.html",
    ext: "html",
    size: "48 KB",
    sizeBytes: 48_000,
    received: "6h ago",
    snippet:
      "This week: three papers on long-context retrieval, a survey on agent memory, and a thread about compounding…",
    attachments: 0,
    stage: "label",
    proposals: {
      type: [
        { value: "Newsletter / Digest", conf: 0.86 },
        { value: "Research", conf: 0.44 },
      ],
      from: [
        { value: "ArXiv Weekly", conf: 0.91 },
      ],
      context: [
        { value: "Research / Reading list", conf: 0.61 },
        { value: "Agents / Memory", conf: 0.58 },
        { value: "Personal / Reading", conf: 0.22 },
      ],
    },
    proposedPath: "/Cortex/Research/Reading list/2026-wk17-digest.html",
    confident: ["type", "from"],
  },
  {
    id: "i_9d07",
    hash: "ff3120…",
    source: "gmail",
    from: "maria.lang@pawplan.co",
    subject: "Re: launch notes — can you review Tues?",
    filename: "(email body)",
    ext: "eml",
    size: "12 KB",
    sizeBytes: 12_000,
    received: "yesterday",
    snippet:
      "Daniel — pulling the notes together for Tuesday's launch review. The framing you sent last week held up; I've…",
    attachments: 0,
    stage: "label",
    proposals: {
      type: [
        { value: "Correspondence", conf: 0.82 },
      ],
      from: [
        { value: "Maria Lang (PawPlan)", conf: 0.96 },
      ],
      context: [
        { value: "Agents / PawPlan", conf: 0.77 },
        { value: "Agents / Research", conf: 0.19 },
      ],
    },
    proposedPath: "/Cortex/Agents/PawPlan/correspondence/2026-04-23-launch-notes.eml",
    confident: ["type", "from", "context"], // fully auto-archived candidate
  },
];

const TAXONOMY = {
  types: [
    { name: "Financial / Invoice", count: 142, lastUsed: "2h ago" },
    { name: "Financial / Receipt", count: 309, lastUsed: "1d ago" },
    { name: "Correspondence", count: 891, lastUsed: "5m ago" },
    { name: "Research", count: 63, lastUsed: "6h ago" },
    { name: "Newsletter / Digest", count: 204, lastUsed: "6h ago" },
    { name: "Contract", count: 28, lastUsed: "3d ago" },
    { name: "Tax document", count: 41, lastUsed: "wk ago" },
    { name: "Screenshot", count: 512, lastUsed: "12m ago" },
  ],
  entities: [
    { name: "Acme Co.", count: 88, lastUsed: "2h ago" },
    { name: "PawPlan", count: 54, lastUsed: "yesterday" },
    { name: "FonnIT", count: 221, lastUsed: "2h ago" },
    { name: "Maria Lang (PawPlan)", count: 31, lastUsed: "yesterday" },
    { name: "ArXiv Weekly", count: 26, lastUsed: "6h ago" },
    { name: "IRS", count: 9, lastUsed: "2w ago" },
  ],
  contexts: [
    { name: "FonnIT / Clients / Acme", count: 71, lastUsed: "2h ago" },
    { name: "FonnIT / Billing", count: 118, lastUsed: "1d ago" },
    { name: "Agents / PawPlan", count: 44, lastUsed: "yesterday" },
    { name: "Agents / Research", count: 38, lastUsed: "3d ago" },
    { name: "Personal / Taxes", count: 22, lastUsed: "wk ago" },
    { name: "Research / Reading list", count: 57, lastUsed: "6h ago" },
  ],
};

const RULES = [
  {
    id: "r_01",
    text: "ext=dmg size>1MB source=downloads → ignore",
    fires: 41,
    lastFired: "1h ago",
    provenance: "derived from 6 ignores · wk 2",
    status: "active",
  },
  {
    id: "r_02",
    text: 'from=*@acme.com subject~"invoice" → keep, type=Financial/Invoice, context=FonnIT/Clients/Acme',
    fires: 12,
    lastFired: "2h ago",
    provenance: "derived from 4 keeps · wk 3",
    status: "active",
  },
  {
    id: "r_03",
    text: "source=downloads ext=png name~screenshot → uncertain",
    fires: 88,
    lastFired: "12m ago",
    provenance: "bootstrap rule · wk 1",
    status: "active",
  },
  {
    id: "r_04",
    text: "from=*@arxiv-weekly.net → keep, type=Newsletter/Digest",
    fires: 17,
    lastFired: "6h ago",
    provenance: "derived from 5 keeps · wk 2",
    status: "active",
  },
  {
    id: "r_05",
    text: "ext∈{iso,pkg} source=downloads → ignore",
    fires: 3,
    lastFired: "2w ago",
    provenance: "derived from 2 ignores · wk 1",
    status: "dormant",
  },
  {
    id: "r_06",
    text: "from=maria.lang@pawplan.co → keep, context=Agents/PawPlan",
    fires: 9,
    lastFired: "yesterday",
    provenance: "derived from 3 keeps · wk 3",
    status: "active",
  },
];

const MERGE_PROPOSALS = [
  {
    id: "m_01",
    kind: "entity",
    a: "Acme Co.",
    b: "Acme AP",
    evidence: "co-occur 38× · embedding sim 0.91 · domain acme.com",
    suggestedCanonical: "Acme Co.",
  },
  {
    id: "m_02",
    kind: "entity",
    a: "Maria Lang",
    b: "Maria Lang (PawPlan)",
    evidence: "same email · appears as both on 14 items",
    suggestedCanonical: "Maria Lang (PawPlan)",
  },
  {
    id: "m_03",
    kind: "rule",
    a: "ext=dmg size>1MB → ignore",
    b: "ext=dmg source=downloads → ignore",
    evidence: "overlap on 41 items · redundant in prefilter bucket",
    suggestedCanonical: "ext=dmg size>1MB source=downloads → ignore",
  },
];

const METRICS = {
  queues: { relevance: 3, label: 11 },
  weekly: {
    citedAnswers: 23,
    triageSessions: 6,
    medianDecisionSec: 2.8,
    ingested: 184,
  },
  auto: {
    relevanceAutoPct: 58,
    labelAutoPct: 64,
    rules: 47,
    medianRulesInCtx: 9,
    dormantRatio: 0.18,
  },
  // 8 weeks of queue-depth trend (sparkline)
  queueTrend: [84, 71, 62, 55, 41, 33, 26, 18],
};

const ASK_THREAD = {
  question: "What did we agree on with Acme re: late-fee language last quarter?",
  answer: [
    {
      text:
        "In the Q4 amendment you and Acme settled on a 1.5% monthly late fee, billed from the invoice due date, with a 5-day grace window.",
      cites: [1],
    },
    {
      text:
        "The grace window was added after Maria flagged the original draft as too aggressive; the final language lives in §4.2 of the executed PDF.",
      cites: [2, 3],
    },
    {
      text:
        "No further changes since — every Acme invoice this year has used that clause verbatim.",
      cites: [4],
    },
  ],
  sources: [
    {
      n: 1,
      title: "Acme — Services Agreement Amendment Q4.pdf",
      path: "/Cortex/FonnIT/Clients/Acme/Contracts/2025-q4-amendment.pdf",
      when: "Nov 18, 2025",
    },
    {
      n: 2,
      title: "Re: Acme amendment — late fee language",
      path: "gmail · thread 19f2c…",
      when: "Nov 14, 2025",
    },
    {
      n: 3,
      title: "Acme — Services Agreement Amendment Q4.pdf",
      path: "/Cortex/FonnIT/Clients/Acme/Contracts/2025-q4-amendment.pdf",
      when: "Nov 18, 2025",
    },
    {
      n: 4,
      title: "invoice-A-2041.pdf",
      path: "/Cortex/FonnIT/Clients/Acme/Invoices/2026/invoice-A-2041.pdf",
      when: "2h ago",
    },
  ],
  history: [
    "When did Acme's MSA renew?",
    "Pull all receipts from Delta that were over $400 in 2025",
    "Where did I save the PawPlan launch deck?",
    "What did Maria say about the pricing page last week?",
  ],
};

Object.assign(window, { SAMPLE_ITEMS, TAXONOMY, RULES, MERGE_PROPOSALS, METRICS, ASK_THREAD });
