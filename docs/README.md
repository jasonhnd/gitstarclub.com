# gitstarclub 文档索引

A browsable history of GitHub open-source activity. The site is fully static-read at runtime: JSON in Vercel Blob behind a publish pointer, no runtime database, no engine in the request path. Recurring data refresh runs on Vercel Workflow.

This page is the navigation index for `docs/`. For a project overview, start at [../README.md](../README.md). For what shipped when, see [CHANGELOG.md](./CHANGELOG.md). For what isn't built yet, see [ROADMAP.md](./ROADMAP.md).

## Reading order (new engineer)

1. [REQUIREMENTS.md](./REQUIREMENTS.md) — what the product is and the constraints it operates under.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview: tech stack, data flow, data model, rendering model, hard constraints.
3. [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) — Blob layout, publish pointer, Workflow pipeline, live overlay, rollback, garbage collection.
4. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) — every canonical shard and view schema (the Zod source of truth).
5. [PIPELINE.md](./PIPELINE.md) — bootstrap pipeline (one-off, archive-only).
6. [RANKING.md](./RANKING.md) — rank definitions: window × dim × metric, stock anchoring, derived rankings, tie-breaking.
7. [CODEBASE.md](./CODEBASE.md) — code map: routes, layers, data access, workflow modules, and ownership boundaries.
8. [DEVELOPMENT.md](./DEVELOPMENT.md) — development playbooks: which code and docs to touch for common changes.
9. [FRONTEND.md](./FRONTEND.md) — route catalog, rendering strategy, component catalog, data-access layer, i18n.
10. [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) — tokens, typography, components, motion, accessibility, zero-client-JS constraint.
11. [SEO.md](./SEO.md) — per-page SEO templates, sitemap structure, robots policy.
12. [OPS.md](./OPS.md) — runbooks: deploy, rollback, cron, workflow operations, Blob layout, env vars, alerting.
13. [TESTING.md](./TESTING.md) — test pyramid, contract tests, parity gate, validation invariants.

Satellite docs (read as needed): [PRODUCT.md](./PRODUCT.md) for product framing; [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md) for the UX navigation narrative; [CATEGORIES.md](./CATEGORIES.md) for category taxonomy, deterministic classification rules, and category-view rollout.

Status and history: [CHANGELOG.md](./CHANGELOG.md). Open work and architectural decisions: [ROADMAP.md](./ROADMAP.md).

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
| FRONTEND | Routes, rendering strategy, component catalog, data-access layer, i18n implementation |
| DESIGN-SYSTEM | Tokens, typography, components, motion, accessibility, zero-client-JS exceptions |
| SEO | Per-page SEO templates, sitemap structure, robots/noindex policy, internal linking |
| OPS | Deploy / rollback / cron / workflow runbooks, Blob layout, env vars, alerting, failure modes |
| TESTING | Test pyramid, contract tests, recompute parity, validation invariants, smoke tests |
| PRODUCT | Product framing: identity, page surfaces, tone, data-honesty posture, i18n posture |
| CATEGORIES | Category taxonomy, deterministic classification rules, category data artifacts, category route rollout |
| INFORMATION-ARCHITECTURE | UX navigation narrative (reader's map); the authoritative route table is in FRONTEND §1.1 |
| CHANGELOG | Versioned release history (what shipped and when) |
| ROADMAP | Open work, architectural decisions, backlog |

## Single source of truth ownership

A topic lives in exactly one document. Other documents reference it; they do not restate it. This keeps facts from drifting.

| Topic | Owning document |
|---|---|
| Repo / view counts | REQUIREMENTS |
| Per-artifact schema (field-level) | DATA-CONTRACTS |
| Blob layout | OPS (§Vercel Blob 布局) |
| Cron schedule | OPS (§Cron 调度) |
| Workflow step enumeration | VERCEL-DATA-OPERATIONS |
| Category taxonomy / classification rules | CATEGORIES |
| Rendering model (static base + client-side chrome i18n) | FRONTEND (§2.5) |
| Route catalog | FRONTEND (§1.1) |
| i18n posture | SEO (§10); implementation detail in FRONTEND (§7) |
| Color tokens / design vocabulary | DESIGN-SYSTEM |
| Ranking algorithms (seam, stock anchoring, derived rankings) | RANKING |
| Code module map / route ownership | CODEBASE |
| Development workflow / change playbooks | DEVELOPMENT |
| Release history | CHANGELOG |
| Open work / architectural decisions | ROADMAP |

## Maintaining the docs

- When a contract, route, or behavior changes, update the owning document in the same commit. Cross-references in other documents should not need to change, because they point to the owning document by name rather than copying the rule.
- When a user-visible change ships, add an entry to CHANGELOG.
- When a piece of open work moves into the backlog or its blocking decision changes, update ROADMAP.
- Each document opens with a `## Scope` section that states its responsibility and what is out of scope. Keep that current; it is the contract between the document and its readers.
