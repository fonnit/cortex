# Milestones — Cortex

## v1.0 — Initial Build (2026-04-24)

Full vertical: ingest → classify → triage → taxonomy → rules → retrieval, end-to-end.

- 4 phases, 20 plans
- Foundation, Triage & Web App, Taxonomy/Rules/Admin, Retrieval

## v1.1 — Ingest Pipeline Rearchitecture (2026-04-25, code-complete; operator acceptance pending)

Brownfield rewire of the ingest backbone. Daemon stops touching Neon, classification moves to queue-driven consumers, `claude -p` switches from argv content to file paths.

- 4 phases (5–8), 8 plans
- Queue & API Surface, Daemon Thin Client, Stage 1 & 2 Consumers, Operational Acceptance
- Audit: `.planning/v1.1-MILESTONE-AUDIT.md`
- Archive: `.planning/milestones/v1.1-ROADMAP.md`
- Status: tech_debt — 32/32 requirements satisfied, no blockers; 5 ACC live operator runs pending Daniel

---
*Created 2026-04-25 during v1.1 close.*
