# Codebase Map

## Scope

This document maps the current code to the product and data architecture. Use it
when starting a code change, reviewing a bug report, or deciding which owning doc
must be updated with a behavior change.

This is not a replacement for the owning docs:

- Data shapes live in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md).
- Production data operations live in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) and [OPS.md](./OPS.md).
- Routes and rendering details live in [FRONTEND.md](./FRONTEND.md).
- Category rules live in [CATEGORIES.md](./CATEGORIES.md).

## Runtime Shape

GitStarClub is a static-read Next.js app backed by JSON views in Vercel Blob.
The request path never queries a database. Pages read validated JSON through
`web/lib/data/*`; recurring refresh work writes new versioned views through
Vercel Workflow and flips `views/latest.json`.

```text
GitHub APIs
  -> Vercel Workflow refresh
  -> canonical/v2/* shards
  -> views/<run_id>/*
  -> views/latest.json
  -> web/lib/data/*
  -> app routes and server-rendered components
```

## Top-Level Layout

| Path | Responsibility |
|---|---|
| `web/app/` | Next.js App Router pages, route handlers, metadata, OG images, sitemap, robots |
| `web/app/_explore/` | Shared server-rendered UI components used by product pages |
| `web/lib/data/` | Read-side accessors for Blob views; all page data should go through this layer |
| `web/lib/contracts/` | Zod schemas for every persisted view and public read contract |
| `web/lib/workflows/` | Vercel Workflow orchestration and refresh steps |
| `web/lib/workflows/recompute/` | Pure recompute core: ranks, entities, heatmaps, categories, windows |
| `web/lib/categories/` | Deterministic category taxonomy and classification rules |
| `web/lib/cron/` | Shared daily/weekly live-overlay route handlers and refresh logic |
| `web/lib/i18n/` | Server/client dictionaries and locale helpers |
| `web/lib/compare/` | Compare-page normalization and curve logic |
| `web/lib/search/` | Search index/query core |
| `web/lib/observability/` | Health and alert helpers for cron/workflow failure alerting |
| `web/lib/integration/` | Cross-module integration and smoke tests, including the offline recompute parity gate |
| `docs/` | Product, architecture, data, operations, frontend, SEO, testing, and development docs |

Shared root-level utilities live directly under `web/lib/`: `github.ts` (GitHub
GraphQL client), `format.ts` (number/time formatting), `periods.ts` (period/window
helpers), `narrative.ts` (deterministic monthly narrative), `og-card.tsx` (OG image
renderer), and the SEO helpers listed under [SEO And Discovery](#seo-and-discovery).

## Route Map

| Route | Source | Primary data |
|---|---|---|
| `/` | `web/app/page.tsx` | `hot-snapshot`, rank, heatmap, narratives |
| `/pulse` | `web/app/pulse/page.tsx`, `PulseView.tsx` | live month/week views |
| `/rankings` | `web/app/rankings/page.tsx` | all-time rank |
| `/rankings/[year]` | `web/app/rankings/[year]/page.tsx` | yearly rank |
| `/rankings/[year]/[period]` | `web/app/rankings/[year]/[period]/page.tsx` | month/week rank |
| `/:owner/:name` | `web/app/[owner]/[name]/page.tsx` | repo entity, lookup, JSON-LD |
| `/o/:login` | `web/app/o/[login]/page.tsx` | org entity |
| `/compare` | `web/app/compare/page.tsx`, `CompareClient.tsx` | repo curves via route handler |
| `/categories` | `web/app/categories/page.tsx` | category registry |
| `/categories/[dimension]` | `web/app/categories/[dimension]/page.tsx` | category registry |
| `/categories/[dimension]/[slug]` | `web/app/categories/[dimension]/[slug]/page.tsx` | category rank + repo lookup |
| `/about` | `web/app/about/page.tsx` | static page: data sources & methodology |
| `/api/cron/daily` | `web/app/api/cron/daily/route.ts` → `web/lib/cron/handlers.ts` | live-overlay refresh |
| `/api/cron/weekly` | `web/app/api/cron/weekly/route.ts` → `web/lib/cron/handlers.ts` | live-overlay refresh |
| `/api/workflows/refresh/start` | `web/app/api/workflows/refresh/start/route.ts` | managed refresh enqueue |
| `/api/lang` | `web/app/api/lang/route.ts` | sets language cookie, then redirects |
| `/repo-curve` | `web/app/repo-curve/route.ts` | compare curve endpoint |
| `/search-index` | `web/app/search-index/route.ts` | search payload |

## Read Side

All production pages should use `web/lib/data/*` rather than fetching Blob URLs
directly.

Important files:

- `source.ts`: resolves `views/latest.json` with a 60-second TTL and validates
  versioned reads. Do not change pointer caching without reading
  [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md).
- `rank.ts`, `entity.ts`, `lookup.ts`, `heatmap.ts`, `categories.ts`,
  `compare.ts`, `search.ts`: typed read helpers for page code. `lookup.ts` also
  exposes `getAliasMap` for `aliases` (`lookup/aliases.json`, old full_name ->
  current id for rename redirects).
- `write.ts`: write helper for workflow, cron, and ops paths. Page code should
  not write.

Rule: if a page needs a new view, add or extend the Zod schema in
`web/lib/contracts/`, then add the read helper in `web/lib/data/`.

## Data Contracts

`web/lib/contracts/*` is the code-level source of truth for persisted JSON
shape. `docs/DATA-CONTRACTS.md` is the reader-facing source of truth and must be
updated in the same commit when schemas change.

Common contract groups:

- `canonical.ts`: canonical/v2 shard inputs.
- `entity.ts`: repo/org entity views.
- `categories.ts`: category registry, assignments, and category ranks.
- `workflow.ts`: publish pointer, manifests, validation, rename map.
- `rank`, `lookup`, `search`, `live`, `compare`: read-side view contracts.

## Workflow Side

The managed refresh entry point is `web/lib/workflows/refresh.ts`.

Current step order:

```text
whitelist
  -> rename
  -> metadata buckets
  -> fold
  -> recompute rank/category views
  -> recompute repo entities
  -> recompute org entities/search/lookups
  -> recompute heatmap
  -> build aliases (lookup/aliases.json)
  -> validate
  -> publish
  -> gc
```

Step files live in `web/lib/workflows/steps/`. Pure compute lives in
`web/lib/workflows/recompute/`.

Rules:

- Keep workflow steps idempotent.
- Do not write `views/latest.json` before validation passes.
- New persisted artifacts need a contract, recompute/write code, validation
  coverage when they affect published views, and docs.
- Avoid full GitHub metadata refreshes for all repos; see metadata backfill
  notes in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md).

## Frontend Components

Shared UI is in `web/app/_explore/`. These are mostly server components and
should stay near-zero-client-JS unless a workflow requires client interactivity.
The explicit global client islands are `RegisterSW`, Vercel Web Analytics, and
optional env-gated Google Analytics 4 from `web/app/_shell/RootShell.tsx`.

Common components:

- `Chrome`: site shell/navigation.
- `RankingList`: rank rows used by rankings and categories.
- `StarCurve`: server-rendered SVG star trend. Repo pages pass frozen exact
  `10k` / `50k` / `100k` milestones from `entity/repo.milestones`; higher
  thresholds are not curve-derived.
- `Heatmap`: activity heatmap.
- `CompareCurve`: compare chart.
- `SearchBox`, `ShareButton`, `Breadcrumbs`, `JsonLd`, `Narrative`.

The repo route `/[owner]/[name]` 308-redirects a renamed repo's stale slug to its
current `full_name` via `lookup/aliases.json` (`getAliasMap`) before falling back
to `notFound()`.

When changing layout, check [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) and
[FRONTEND.md](./FRONTEND.md) before editing CSS classes.

## Category System

Category rules are deterministic and live in `web/lib/categories/rules.ts`.
Published artifacts are generated by `web/lib/workflows/recompute/categories.ts`.

Current language rule:

- Repos always belong to the GitHub primary language when present.
- Secondary languages count only when they are a significant share of the GitHub
  language breakdown.
- Tiny support-file languages such as small `Justfile`, `Dockerfile`,
  `Makefile`, or config snippets must not create language category membership.

Update [CATEGORIES.md](./CATEGORIES.md) whenever taxonomy, thresholds, public
visibility, or assignment behavior changes.

## SEO And Discovery

SEO helpers live in:

- `web/lib/seo.ts`
- `web/lib/jsonld.ts`
- `web/lib/sitemap.ts`
- `web/app/sitemap.xml/route.ts`
- `web/app/sitemap-*.xml/route.ts`
- `web/app/robots.ts`
- route-level `opengraph-image.tsx`

Changes to routes, canonical URLs, indexability, JSON-LD, OG images, or sitemap
membership must update [SEO.md](./SEO.md).

## Test Locations

Most tests are colocated with the code they cover:

- `web/lib/contracts/contracts.test.ts`
- `web/lib/workflows/recompute/*.test.ts`
- `web/lib/workflows/steps/*.test.ts`
- `web/lib/integration/*.test.ts`
- `web/lib/categories/rules.test.ts`
- `web/lib/data/*.test.ts`
- `web/lib/search/core.test.ts`
- `web/lib/compare/core.test.ts`

Workflow validation is also a production gate in
`web/lib/workflows/steps/validate.ts`.

## When Code And Docs Disagree

Prefer the following order:

1. Zod contracts and production validation for persisted data shape.
2. Current code behavior.
3. Owning docs listed in `docs/README.md`.
4. Historical notes, changelog, or old comments.

When you resolve drift, update the owning doc in the same commit as the code
change.
