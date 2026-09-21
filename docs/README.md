---
owner: docs / maintenance
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - documentation index
  - documentation ownership map
  - documentation metadata convention
---

# gitstarclub 文档索引

A browsable history of GitHub open-source activity. The site is fully static-read at runtime: JSON in Vercel Blob behind a publish pointer, no runtime database, no engine in the request path. Recurring data refresh is scheduled by Vercel cron; P1 orchestration no longer uses the Workflow SDK.

This page is the navigation index for `docs/`. For a project overview, start at [../README.md](../README.md). For what shipped when, see [CHANGELOG.md](./CHANGELOG.md). For what isn't built yet, see [ROADMAP.md](./ROADMAP.md).

## Analytics

Vercel Web Analytics is the only analytics integration and remains enabled through `<Analytics />` in `web/app/_shell/RootShell.tsx`. It uses same-origin `/_vercel/insights` endpoints, and the build asserts that CSP permits them. Google Analytics and other third-party tracking scripts are intentionally unsupported, matching the public privacy statement.

## Reading order (new engineer)

This section is the authoritative newcomer reading order. Update it when adding, removing, or reprioritizing core or satellite docs.

1. [REQUIREMENTS.md](./REQUIREMENTS.md) — what the product is and the constraints it operates under.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview: tech stack, data flow, data model, rendering model, hard constraints.
3. [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) — Blob layout, publish pointer, Workflow pipeline, live overlay, rollback, garbage collection.
4. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) — every canonical shard and view schema (the Zod source of truth).
5. [API.md](./API.md) — endpoint contracts: method, auth, params, response, cache, status codes, examples.
6. [PIPELINE.md](./PIPELINE.md) — bootstrap pipeline (one-off, archive-only).
7. [RANKING.md](./RANKING.md) — rank definitions: window × dim × metric, stock anchoring, derived rankings, tie-breaking.
8. [CODEBASE.md](./CODEBASE.md) — code map: layers, data access, workflow modules, and ownership boundaries.
9. [DEVELOPMENT.md](./DEVELOPMENT.md) — development playbooks: which code and docs to touch for common changes.
10. [WORKFLOW.md](./WORKFLOW.md) - document-driven issue, PR, merge, and visual-guardrail workflow.
11. [UIUX-ROUTE-INVENTORY.md](./UIUX-ROUTE-INVENTORY.md) — sole maintained route/source inventory.
12. [FRONTEND.md](./FRONTEND.md) — rendering strategy, component catalog, data-access layer, i18n.
13. [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) - locked visual baseline, tokens, typography, Chrome appearance, accessibility notes.
14. [SEO.md](./SEO.md) — per-page SEO templates, sitemap structure, robots policy.
15. [GEO.md](./GEO.md) — answer-engine citation strategy: answer capsules, schema, crawler hygiene, freshness, and measurement.
16. [OPS.md](./OPS.md) — runbooks: branch topology, staging, deploy, rollback, cron, workflow operations, Blob layout, env vars, alerting. Cloudflare R2 P0 adapter details live in [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md). P1 workflow/cron details live in [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). P2 ISR/Preview/observability details live in [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md). P3 Workers hosting details live in [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md).
17. [TESTING.md](./TESTING.md) — test pyramid, contract tests, parity gate, validation invariants. GitHub required CI is `static` + `production-build` only.

Supporting docs (read as needed): [PRODUCT.md](./PRODUCT.md) for product framing; [COCKPIT.md](./COCKPIT.md) for the unshipped Cockpit content contract and pre spike; [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md) for the UX navigation narrative; [CATEGORIES.md](./CATEGORIES.md) for category taxonomy, deterministic classification rules, and category-view rollout; [DATA-EXPORTS.md](./DATA-EXPORTS.md) for public export files; [I18N.md](./I18N.md) for the shipped locale URL architecture decision record.

Status and history: [CHANGELOG.md](./CHANGELOG.md). Open work and architectural decisions: [ROADMAP.md](./ROADMAP.md).

## Appendix documents

Nested Markdown files under `docs/` are appendix documents. They are useful evidence or operational runbooks, but they do not replace the owning core documents listed above.

### Reports and baselines

| Document | Status | Owner / topic | Update when | Truth role |
|---|---|---|---|---|
| [perf/CWV-25.md](./perf/CWV-25.md) | baseline | TESTING / performance | A newer Lighthouse or Core Web Vitals baseline is captured, or the old baseline needs an explicit closure note. | Supporting evidence for issue #25; [TESTING.md](./TESTING.md) owns current performance targets and gates. |

### GEO operations

| Document | Status | Owner / topic | Update when | Truth role |
|---|---|---|---|---|
| [geo/queries.md](./geo/queries.md) | active | GEO measurement / citation review | Target queries, review cadence, page-type coverage, or miss classifications change. Re-run affected high-priority checks after schema, robots, sitemap, answer-capsule, ranking, category, methodology, or data-export changes. | Operational registry; [GEO.md](./GEO.md) remains the source of truth for strategy, metrics, and measurement intent. |
| [geo/ai-log-reporting.md](./geo/ai-log-reporting.md) | active | GEO crawler and AI-referrer reporting | `geo:report` inputs, output fields, taxonomy, privacy rules, or operator commands change. | Operational runbook; [GEO.md](./GEO.md) owns the reporting intent, and [OPS.md](./OPS.md) owns production log/operations practice. |
| [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md) | active | Cloudflare R2 P0 storage adapter | Driver names, env, write guards, or rollback steps change. | P0 Blob→R2 adapter only; [OPS.md](./OPS.md) still owns the production Blob layout and env inventory. |
| [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) | active | Cloudflare migrate P1 workflow runtime | Runtime kinds, CF Cron dispatch / Queue non-prod proof, Blob fetch write path, or dual-scheduler rollback change. | P1 orchestration only; production cron table stays in [OPS.md](./OPS.md) / `web/vercel.json`. Production Worker crons stay empty until an approved cutover. Full CF daily/refresh depends on the fetch Blob client. |
| [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) | active | Cloudflare migrate P2 ISR / Preview / observability | Cache-invalidation drivers, CF Preview + Access, optional `cf-preview` job, or P2 rollback change. | P2 only; production Preview/product-gates/`revalidatePath` stay Vercel. |
| [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) | active | Cloudflare migrate P3 Workers host | OpenNext adapter, workers.dev preview, optional `cf-workers-host` job, or P3 rollback change. | P3 only; production apex/www stay Vercel. Do not cut DNS. |

### Decision analyses

| Document | Status | Owner / topic | Update when | Truth role |
|---|---|---|---|---|
| [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md) | active | Track C analytical data-layer option analysis | When a constitution-level revision amends the hard constraints or this comparison. There is no dated auto-review. | Option comparison history and historical must-prove list only. The dated decision (product veto, lock-002; no POC; no auto-review) lives in [ROADMAP.md](./ROADMAP.md) Track C, which remains the iteration index. |

### Historical analyses

| Document | Status | Owner / topic | Update when | Truth role |
|---|---|---|---|---|
| [analysis/DATA-CORRECTNESS-21.md](./analysis/DATA-CORRECTNESS-21.md) | historical | Data correctness analysis for issue #21 / #36 follow-up planning | Only to add a closure note, link a follow-up issue, or correct an audit reference. Do not treat it as current product guidance. | Supporting evidence only; current ranking, contract, and test behavior belong to [RANKING.md](./RANKING.md), [DATA-CONTRACTS.md](./DATA-CONTRACTS.md), and [TESTING.md](./TESTING.md). |
| [analysis/RECONCILE-MAIN-PRE-2026-07-19.md](./analysis/RECONCILE-MAIN-PRE-2026-07-19.md) | historical | 2026-07-19 main/pre reconciliation inventory | Only to add a current-policy note or correct an audit reference. Do not treat the July 2026 required-check table as current. | Snapshot only; current GitHub required CI is `static` + `production-build` in [TESTING.md](./TESTING.md). |

## Responsibility per document

| Document | Scope |
|---|---|
| REQUIREMENTS | Product baseline, scope, constraints; single source for repo/view counts |
| ARCHITECTURE | System overview: tech stack, data flow, hard constraints, rendering model, key decisions |
| VERCEL-DATA-OPERATIONS | Production data lifecycle: Blob layout, publish pointer, Workflow steps, rollback, garbage collection |
| DATA-CONTRACTS | Per-shard / per-view Zod schemas (single source of truth for build-side types) |
| API | Endpoint contracts: route handlers, public JSON endpoints, metadata endpoints, auth, cache, statuses |
| PIPELINE | Bootstrap pipeline stages and algorithms (one-off, archived; recurring refresh lives in VERCEL-DATA-OPERATIONS) |
| RANKING | Rank definitions, stock anchoring, derived rankings, edge cases (single source of truth for ranking algorithms) |
| CODEBASE | Code map: module layers, data layers, contracts, workflow modules, category system, and ownership boundaries |
| DEVELOPMENT | Developer workflow: doc ownership, change playbooks, Vercel-first verification, and drift handling |
| WORKFLOW | Document-driven issue workflow, role boundaries, merge gates (`static` + `production-build` required; `preview-e2e` / `product-gates` optional), and visual guardrails |
| UIUX-ROUTE-INVENTORY | Sole maintained route/source inventory for pages, endpoints, metadata routes, and operational handlers |
| FRONTEND | Rendering strategy, component catalog, data-access layer, i18n implementation |
| DESIGN-SYSTEM | Locked visual baseline, tokens, typography, Chrome appearance, accessibility notes |
| SEO | Per-page SEO templates, sitemap structure, robots/noindex policy, internal linking |
| GEO | Answer-engine citation strategy, page-type answer capsules, GEO schema plan, AI crawler hygiene, freshness, and measurement |
| OPS | Branch topology / staging, deploy / rollback / cron / workflow runbooks, Blob layout, env vars, alerting, failure modes |
| R2-MIGRATION-P0 | Cloudflare migrate P0 Blob→R2 adapter: drivers, dual-read, non-production write guard, rollback |
| CF-MIGRATION-P1 | Cloudflare migrate P1 workflow runtime: HTTP/memory/CF Queue, non-prod Cron, Blob fetch write path, dual-scheduler rollback |
| CF-MIGRATION-P2 | Cloudflare migrate P2 ISR port, CF Preview/Access, optional CI dual-run, Workers Observability |
| CF-MIGRATION-P3 | Cloudflare migrate P3 Workers host: OpenNext preview, R2/Queue bindings, rollback, no DNS cut |
| TESTING | Test pyramid, contract tests, recompute parity, validation invariants, smoke tests; GitHub required CI is `static` + `production-build` |
| PRODUCT | Product framing: identity, page surfaces, tone, data-honesty posture, i18n posture |
| COCKPIT | Unshipped Cockpit content contract and pre-only `/cockpit` spike |
| CATEGORIES | Category taxonomy, deterministic classification rules, category data artifacts, category route rollout |
| INFORMATION-ARCHITECTURE | UX navigation narrative (reader's map); the authoritative route/source table is in UIUX-ROUTE-INVENTORY |
| DATA-EXPORTS | Public data export files, regeneration commands, license, and attribution |
| I18N | Server-side per-locale rendering decision record and locale URL architecture |
| perf/CWV-25 | Baseline performance report for issue #25; supporting evidence, not current test policy |
| geo/queries | Active GEO target-query registry and citation-review worksheet |
| geo/ai-log-reporting | Active aggregate AI crawler / AI-referrer log reporting runbook |
| analysis/DATA-CORRECTNESS-21 | Historical data-correctness analysis for issue #21 / #36 follow-up planning |
| analysis/RECONCILE-MAIN-PRE-2026-07-19 | Historical 2026-07-19 main/pre reconciliation inventory; not current required-check policy |
| analysis/DATA-LAYER-DECISION | Track C data-layer option comparison history and historical must-prove list; the dated lock-002 veto lives in ROADMAP Track C |
| CHANGELOG | Versioned release history (what shipped and when) |
| ROADMAP | Open work, architectural decisions, backlog |

## Single source of truth ownership

A topic lives in exactly one document. Other documents reference it; they do not restate it. This keeps facts from drifting.

| Topic | Owning document |
|---|---|
| Repo / view counts | REQUIREMENTS |
| Per-artifact schema (field-level) | DATA-CONTRACTS |
| Endpoint contracts (method / auth / params / response / cache / status codes) | [API.md](./API.md) |
| Blob layout | OPS (§Vercel Blob 布局) |
| Cloudflare R2 P0 adapter | [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md) |
| Cloudflare migrate P1 workflow runtime | [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| Cloudflare migrate P2 ISR / Preview / observability | [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) |
| Cloudflare migrate P3 Workers host | [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) |
| Branch topology / staging / promotion | [OPS.md](./OPS.md) (§Branch topology / staging) |
| Cron schedule | OPS (§Cron 调度) |
| Workflow step enumeration | VERCEL-DATA-OPERATIONS |
| Category taxonomy / classification rules | CATEGORIES |
| Rendering model (route locale + server-rendered localized HTML) | FRONTEND (§2.5) |
| Route and source inventory | [UIUX-ROUTE-INVENTORY.md](./UIUX-ROUTE-INVENTORY.md) |
| i18n posture | SEO (§10); implementation detail in FRONTEND (§7); shipped architecture decision in [I18N.md](./I18N.md) |
| Public data exports | [DATA-EXPORTS.md](./DATA-EXPORTS.md) |
| Answer-engine citation strategy / GEO | GEO |
| Color tokens / design vocabulary | DESIGN-SYSTEM |
| Ranking algorithms (seam, stock anchoring, derived rankings) | RANKING |
| Repo identity / rename → redirect posture | PRODUCT (§Repo 身份与改名) |
| Cockpit content / timeline / radar spike | [COCKPIT.md](./COCKPIT.md) |
| Code module map / module ownership | CODEBASE |
| Issue workflow / PR gates / visual guardrails | WORKFLOW (GitHub required CI: `static` + `production-build`; current automation table in TESTING) |
| Development change playbooks | DEVELOPMENT |
| GEO target-query registry and citation-review worksheet | GEO; appendix maintained in [geo/queries.md](./geo/queries.md) |
| GEO crawler / AI-referrer aggregate reporting | GEO and OPS; appendix maintained in [geo/ai-log-reporting.md](./geo/ai-log-reporting.md) |
| Core Web Vitals baseline evidence | TESTING owns current targets; appendix baseline in [perf/CWV-25.md](./perf/CWV-25.md) |
| Historical data-correctness analysis | Current behavior lives in RANKING, DATA-CONTRACTS, and TESTING; appendix evidence in [analysis/DATA-CORRECTNESS-21.md](./analysis/DATA-CORRECTNESS-21.md) |
| Historical 2026-07-19 main/pre reconciliation | Snapshot only in [analysis/RECONCILE-MAIN-PRE-2026-07-19.md](./analysis/RECONCILE-MAIN-PRE-2026-07-19.md); current required CI in TESTING |
| Track C data-layer decision | Dated record in [ROADMAP.md](./ROADMAP.md) Track C (product veto, lock-002; no POC; no auto-review); option compare history in [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md) |
| Release history | CHANGELOG |
| Open work / architectural decisions | ROADMAP |

## Metadata convention

Every Markdown document under `docs/` starts with YAML frontmatter. Required fields:

```yaml
---
owner: owning role or topic
status: active
last_reviewed: YYYY-MM-DD
source_of_truth_for:
  - topic this document owns
---
```

- `owner` is the role, topic, or maintenance area responsible for keeping the document accurate.
- `status` is one of `active`, `historical`, `baseline`, `draft`, or `superseded`. Appendix runbooks use `active`; one-time measurements use `baseline`; archived reports use `historical`.
- `last_reviewed` changes only when the document is checked against current code, product decisions, or operational practice.
- `source_of_truth_for` lists the facts the document owns. If a topic moves, update this field and the ownership tables above in the same commit.
- Optional `related_docs` entries can be added when a document needs explicit cross-links beyond inline references.

## Maintaining the docs

- When a contract, route, or behavior changes, update the owning document in the same commit. Cross-references in other documents should not need to change, because they point to the owning document by name rather than copying the rule.
- When a document is substantively reviewed, update its `last_reviewed` date. If its lifecycle changes, update `status` before changing the body.
- When a user-visible change ships, add an entry to CHANGELOG.
- When a piece of open work moves into the backlog or its blocking decision changes, update ROADMAP.
- Core owner docs that describe current behavior open with a `## Scope` section that states their responsibility and what is out of scope. Appendices, changelogs, and decision records must make their status clear in frontmatter and their first section.
- `bun run lint:docs` validates Markdown/frontmatter, backticked repository paths,
  environment-variable coverage, route ownership, API route coverage, pinned
  framework facts, and the CF CI gates in `scripts/assert-cf-ci-gates.mjs`
  (preview Worker `gitstarclub-web-pre`; no live GHA deploy of `gitstarclub-web`).
  Historical path references are exempt only through the reasoned allowlist in
  `scripts/check-docs.mjs`; current-state docs cannot opt out silently.
