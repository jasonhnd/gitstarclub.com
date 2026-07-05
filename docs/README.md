---
owner: docs-maintainers
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - documentation navigation
  - newcomer reading order
  - document metadata convention
---

# gitstarclub 文档索引

A browsable history of GitHub open-source activity. The site is fully static-read at runtime: JSON in Vercel Blob behind a publish pointer, no runtime database, no engine in the request path. Recurring data refresh runs on Vercel Workflow.

This page is the authoritative navigation index and newcomer reading order for `docs/`. The root [README](../README.md) intentionally points here instead of duplicating this sequence. For contributing expectations, start at [../CONTRIBUTING.md](../CONTRIBUTING.md). For what shipped when, see [CHANGELOG.md](./CHANGELOG.md). For what is not built yet, see [ROADMAP.md](./ROADMAP.md).

## Analytics

Vercel Web Analytics remains enabled through `<Analytics />` in `web/app/_shell/RootShell.tsx`. Google Analytics 4 is optional and env-gated: set `NEXT_PUBLIC_GA_ID` to a non-empty measurement ID starting with `G-` to render the Next.js `GoogleAnalytics` component; when unset or invalid, no GA script is emitted.

## Reading order (new engineer)

1. [REQUIREMENTS.md](./REQUIREMENTS.md) — what the product is and the constraints it operates under.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview: tech stack, data flow, data model, rendering model, hard constraints.
3. [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) — Blob layout, publish pointer, Workflow pipeline, live overlay, rollback, garbage collection.
4. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) — every canonical shard and view schema (the Zod source of truth).
5. [PIPELINE.md](./PIPELINE.md) — bootstrap pipeline (one-off, archive-only).
6. [RANKING.md](./RANKING.md) — rank definitions: window × dim × metric, stock anchoring, derived rankings, tie-breaking.
7. [CODEBASE.md](./CODEBASE.md) — code map: routes, layers, data access, workflow modules, and ownership boundaries.
8. [DEVELOPMENT.md](./DEVELOPMENT.md) — development playbooks: which code and docs to touch for common changes.
9. [WORKFLOW.md](./WORKFLOW.md) - document-driven issue, PR, merge, and visual-guardrail workflow.
10. [FRONTEND.md](./FRONTEND.md) — route catalog, rendering strategy, component catalog, data-access layer, i18n.
11. [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) - locked visual baseline, tokens, typography, Chrome appearance, accessibility notes.
12. [SEO.md](./SEO.md) — per-page SEO templates, sitemap structure, robots policy.
13. [GEO.md](./GEO.md) — answer-engine citation strategy: answer capsules, schema, crawler hygiene, freshness, and measurement.
14. [OPS.md](./OPS.md) — runbooks: branch topology, staging, deploy, rollback, cron, workflow operations, Blob layout, env vars, alerting.
15. [TESTING.md](./TESTING.md) — test pyramid, contract tests, parity gate, validation invariants.

## Satellite onboarding placement

Read these when the adjacent core document raises the topic:

| Placement | Docs | When to read |
|---|---|---|
| Product framing, after REQUIREMENTS | [PRODUCT.md](./PRODUCT.md) | Page purpose, product tone, current scope boundaries, data-honesty language |
| UX navigation, after FRONTEND | [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md) | Reader journey and navigation narrative; route facts remain in FRONTEND |
| Categories, after RANKING and FRONTEND | [CATEGORIES.md](./CATEGORIES.md) | Category taxonomy, deterministic assignment rules, category route rollout |
| Locale architecture, after SEO and FRONTEND | [I18N.md](./I18N.md) | Locale URL decision record and server-rendering rollout notes |
| Public exports, after DATA-CONTRACTS and GEO | [DATA-EXPORTS.md](./DATA-EXPORTS.md) | Bounded public data export set, attribution, and regeneration |
| Status and backlog | [CHANGELOG.md](./CHANGELOG.md), [ROADMAP.md](./ROADMAP.md) | Shipped changes, open architectural decisions, and deferred work |

## Appendices, reports, and operational satellites

| Document | Status | Owner / topic | Source-of-truth posture | Update when | Onboarding placement |
|---|---|---|---|---|---|
| [geo/queries.md](./geo/queries.md) | active | GEO | Operational runbook for target AI query tracking and citation review cadence | GEO target queries, reviewed engines, or citation-review cadence changes | After [GEO.md](./GEO.md) §Measurement |
| [geo/ai-log-reporting.md](./geo/ai-log-reporting.md) | active | GEO | Operational runbook for aggregate AI crawler/referrer reporting | The report script input format, taxonomy, or output schema changes | After [GEO.md](./GEO.md) §Measurement |
| [perf/CWV-25.md](./perf/CWV-25.md) | baseline | performance | Supporting evidence baseline, not a live performance SLO | A new reviewed Lighthouse/Core Web Vitals baseline supersedes it | After [TESTING.md](./TESTING.md) §Performance |
| [analysis/DATA-CORRECTNESS-21.md](./analysis/DATA-CORRECTNESS-21.md) | historical | data correctness | Historical issue analysis and supporting evidence, not current product policy | Only to append a supersession note; current rules belong in RANKING, DATA-CONTRACTS, or TESTING | Read only when investigating the linked issue lineage |

## Responsibility per document

| Document | Scope |
|---|---|
| REQUIREMENTS | Product baseline, scope, constraints; single source for repo/view counts |
| ARCHITECTURE | System overview: tech stack, data flow, hard constraints, rendering model, key decisions |
| VERCEL-DATA-OPERATIONS | Production data lifecycle: Blob layout, publish pointer, Workflow steps, rollback, garbage collection |
| DATA-CONTRACTS | Per-shard / per-view Zod schemas (single source of truth for build-side types) |
| PIPELINE | Bootstrap pipeline stages and algorithms (one-off, archived; recurring refresh lives in VERCEL-DATA-OPERATIONS) |
| RANKING | Rank definitions, stock anchoring, derived rankings, edge cases (single source of truth for ranking algorithms) |
| CODEBASE | Code map: route files, data layers, contracts, workflow modules, category system, and ownership boundaries |
| DEVELOPMENT | Developer workflow: doc ownership, change playbooks, Vercel-first verification, and drift handling |
| WORKFLOW | Document-driven issue workflow, role boundaries, merge gates, and visual guardrails |
| FRONTEND | Routes, rendering strategy, component catalog, data-access layer, i18n implementation |
| DESIGN-SYSTEM | Locked visual baseline, tokens, typography, Chrome appearance, accessibility notes |
| SEO | Per-page SEO templates, sitemap structure, robots/noindex policy, internal linking |
| GEO | Answer-engine citation strategy, page-type answer capsules, GEO schema plan, AI crawler hygiene, freshness, and measurement |
| OPS | Branch topology / staging, deploy / rollback / cron / workflow runbooks, Blob layout, env vars, alerting, failure modes |
| TESTING | Test pyramid, contract tests, recompute parity, validation invariants, smoke tests |
| PRODUCT | Product framing: identity, page surfaces, tone, data-honesty posture, i18n posture |
| CATEGORIES | Category taxonomy, deterministic classification rules, category data artifacts, category route rollout |
| INFORMATION-ARCHITECTURE | UX navigation narrative (reader's map); the authoritative route table is in FRONTEND §1.1 |
| I18N | Locale URL decision record, server-rendered locale architecture, rollout plan |
| DATA-EXPORTS | Public data export set, attribution, source views, and regeneration |
| CHANGELOG | Versioned release history (what shipped and when) |
| ROADMAP | Open work, architectural decisions, backlog |

## Single source of truth ownership

A topic lives in exactly one document. Other documents reference it; they do not restate it. This keeps facts from drifting.

| Topic | Owning document |
|---|---|
| Repo / view counts | REQUIREMENTS |
| Per-artifact schema (field-level) | DATA-CONTRACTS |
| Blob layout | OPS (§Vercel Blob 布局) |
| Branch topology / staging / promotion | [OPS.md](./OPS.md) (§Branch topology / staging) |
| Cron schedule | OPS (§Cron 调度) |
| Workflow step enumeration | VERCEL-DATA-OPERATIONS |
| Category taxonomy / classification rules | CATEGORIES |
| Rendering model (static base + client-side chrome i18n) | FRONTEND (§2.5) |
| Route catalog | FRONTEND (§1.1) |
| i18n posture | SEO (§10); implementation detail in FRONTEND (§7) |
| Answer-engine citation strategy / GEO | GEO |
| Color tokens / design vocabulary | DESIGN-SYSTEM |
| Ranking algorithms (seam, stock anchoring, derived rankings) | RANKING |
| Repo identity / rename → redirect posture | PRODUCT (§Repo 身份与改名) |
| Code module map / route ownership | CODEBASE |
| Issue workflow / PR gates / visual guardrails | WORKFLOW |
| Development change playbooks | DEVELOPMENT |
| Release history | CHANGELOG |
| Open work / architectural decisions | ROADMAP |

## Document metadata convention

Every Markdown document under `docs/` opens with YAML frontmatter:

```yaml
---
owner: docs-maintainers
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - documentation navigation
---
```

Required fields:

| Field | Meaning |
|---|---|
| `owner` | Owning role, topic, or maintainer function responsible for review |
| `status` | One of `active`, `baseline`, `draft`, `historical`, or `superseded` |
| `last_reviewed` | Date the document was materially reviewed, in `YYYY-MM-DD` |
| `source_of_truth_for` | Short list of topics for which this document is authoritative |

Status expectations:

| Status | Meaning |
|---|---|
| `active` | Current guidance or runbook; update with owning behavior changes |
| `baseline` | Point-in-time evidence, benchmark, or report; supersede with a newer baseline rather than editing old results |
| `historical` | Investigation record or issue-specific analysis; current policy should live in the owning core doc |
| `draft` | Proposed guidance not yet accepted as source of truth |
| `superseded` | Kept for history; must link to the replacement |

Markdown code fences must include language tags. Use `text` for directory trees and ASCII diagrams, `bash` or `powershell` for shell commands, `json`/`jsonc` for JSON, and `ts` for TypeScript. Run the local guard from `web/`:

```bash
bun run docs:check
```

## Maintaining the docs

- When a contract, route, or behavior changes, update the owning document in the same commit. Cross-references in other documents should not need to change, because they point to the owning document by name rather than copying the rule.
- When a user-visible change ships, add an entry to CHANGELOG.
- When a piece of open work moves into the backlog or its blocking decision changes, update ROADMAP.
- Each document opens with a `## Scope` section that states its responsibility and what is out of scope. Keep that current; it is the contract between the document and its readers.
- Keep frontmatter metadata current when a document is materially reviewed, changes status, or moves from supporting evidence to source-of-truth guidance.
