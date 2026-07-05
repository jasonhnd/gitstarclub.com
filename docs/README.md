---
owner: docs / maintenance
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - documentation index
  - documentation ownership map
  - documentation metadata convention
---

# gitstarclub 文档索引

A browsable history of GitHub open-source activity. The site is fully static-read at runtime: JSON in Vercel Blob behind a publish pointer, no runtime database, no engine in the request path. Recurring data refresh runs on Vercel Workflow.

This page is the navigation index for `docs/`. For a project overview, start at [../README.md](../README.md). For what shipped when, see [CHANGELOG.md](./CHANGELOG.md). For what isn't built yet, see [ROADMAP.md](./ROADMAP.md).

## Analytics

Vercel Web Analytics remains enabled through `<Analytics />` in `web/app/_shell/RootShell.tsx`. Google Analytics 4 is optional and env-gated: set `NEXT_PUBLIC_GA_ID` to a non-empty measurement ID starting with `G-` to render the Next.js `GoogleAnalytics` component; when unset or invalid, no GA script is emitted.

## Reading order (new engineer)

This section is the authoritative newcomer reading order. Update it when adding, removing, or reprioritizing core or satellite docs.

1. [REQUIREMENTS.md](./REQUIREMENTS.md) — what the product is and the constraints it operates under.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview: tech stack, data flow, data model, rendering model, hard constraints.
3. [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) — Blob layout, publish pointer, Workflow pipeline, live overlay, rollback, garbage collection.
4. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) — every canonical shard and view schema (the Zod source of truth).
5. [API.md](./API.md) — endpoint contracts: method, auth, params, response, cache, status codes, examples.
6. [PIPELINE.md](./PIPELINE.md) — bootstrap pipeline (one-off, archive-only).
7. [RANKING.md](./RANKING.md) — rank definitions: window × dim × metric, stock anchoring, derived rankings, tie-breaking.
8. [CODEBASE.md](./CODEBASE.md) — code map: routes, layers, data access, workflow modules, and ownership boundaries.
9. [DEVELOPMENT.md](./DEVELOPMENT.md) — development playbooks: which code and docs to touch for common changes.
10. [WORKFLOW.md](./WORKFLOW.md) - document-driven issue, PR, merge, and visual-guardrail workflow.
11. [FRONTEND.md](./FRONTEND.md) — route catalog, rendering strategy, component catalog, data-access layer, i18n.
12. [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) - locked visual baseline, tokens, typography, Chrome appearance, accessibility notes.
13. [SEO.md](./SEO.md) — per-page SEO templates, sitemap structure, robots policy.
14. [GEO.md](./GEO.md) — answer-engine citation strategy: answer capsules, schema, crawler hygiene, freshness, and measurement.
15. [OPS.md](./OPS.md) — runbooks: branch topology, staging, deploy, rollback, cron, workflow operations, Blob layout, env vars, alerting.
16. [TESTING.md](./TESTING.md) — test pyramid, contract tests, parity gate, validation invariants.

Supporting docs (read as needed): [PRODUCT.md](./PRODUCT.md) for product framing; [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md) for the UX navigation narrative; [CATEGORIES.md](./CATEGORIES.md) for category taxonomy, deterministic classification rules, and category-view rollout; [DATA-EXPORTS.md](./DATA-EXPORTS.md) for public export files; [I18N.md](./I18N.md) for the shipped locale URL architecture decision record.

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

### Historical analyses

| Document | Status | Owner / topic | Update when | Truth role |
|---|---|---|---|---|
| [analysis/DATA-CORRECTNESS-21.md](./analysis/DATA-CORRECTNESS-21.md) | historical | Data correctness analysis for issue #21 / #36 follow-up planning | Only to add a closure note, link a follow-up issue, or correct an audit reference. Do not treat it as current product guidance. | Supporting evidence only; current ranking, contract, and test behavior belong to [RANKING.md](./RANKING.md), [DATA-CONTRACTS.md](./DATA-CONTRACTS.md), and [TESTING.md](./TESTING.md). |

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
| DATA-EXPORTS | Public data export files, regeneration commands, license, and attribution |
| I18N | Server-side per-locale rendering decision record and locale URL architecture |
| perf/CWV-25 | Baseline performance report for issue #25; supporting evidence, not current test policy |
| geo/queries | Active GEO target-query registry and citation-review worksheet |
| geo/ai-log-reporting | Active aggregate AI crawler / AI-referrer log reporting runbook |
| analysis/DATA-CORRECTNESS-21 | Historical data-correctness analysis for issue #21 / #36 follow-up planning |
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
| Branch topology / staging / promotion | [OPS.md](./OPS.md) (§Branch topology / staging) |
| Cron schedule | OPS (§Cron 调度) |
| Workflow step enumeration | VERCEL-DATA-OPERATIONS |
| Category taxonomy / classification rules | CATEGORIES |
| Rendering model (route locale + server-rendered localized HTML) | FRONTEND (§2.5) |
| Route catalog | FRONTEND (§1.1) |
| i18n posture | SEO (§10); implementation detail in FRONTEND (§7); shipped architecture decision in [I18N.md](./I18N.md) |
| Public data exports | [DATA-EXPORTS.md](./DATA-EXPORTS.md) |
| Answer-engine citation strategy / GEO | GEO |
| Color tokens / design vocabulary | DESIGN-SYSTEM |
| Ranking algorithms (seam, stock anchoring, derived rankings) | RANKING |
| Repo identity / rename → redirect posture | PRODUCT (§Repo 身份与改名) |
| Code module map / route ownership | CODEBASE |
| Issue workflow / PR gates / visual guardrails | WORKFLOW |
| Development change playbooks | DEVELOPMENT |
| GEO target-query registry and citation-review worksheet | GEO; appendix maintained in [geo/queries.md](./geo/queries.md) |
| GEO crawler / AI-referrer aggregate reporting | GEO and OPS; appendix maintained in [geo/ai-log-reporting.md](./geo/ai-log-reporting.md) |
| Core Web Vitals baseline evidence | TESTING owns current targets; appendix baseline in [perf/CWV-25.md](./perf/CWV-25.md) |
| Historical data-correctness analysis | Current behavior lives in RANKING, DATA-CONTRACTS, and TESTING; appendix evidence in [analysis/DATA-CORRECTNESS-21.md](./analysis/DATA-CORRECTNESS-21.md) |
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
