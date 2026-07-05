---
owner: System architecture
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - System architecture, data flow, rendering model, hard constraints, and key decisions
related_docs:
  - ./REQUIREMENTS.md
  - ./DATA-CONTRACTS.md
  - ./VERCEL-DATA-OPERATIONS.md
  - ./FRONTEND.md
---

# Architecture

## Scope

This document describes how gitstarclub is built end to end: data flow, rendering model, hard constraints, and the reasons each significant decision points one way rather than the other. Read it before extending the system or proposing a structural change. Product framing is in [PRODUCT.md](./PRODUCT.md); per-layer detail lives in the layer docs ([DATA-CONTRACTS](./DATA-CONTRACTS.md), [PIPELINE](./PIPELINE.md), [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md), [FRONTEND](./FRONTEND.md), [SEO](./SEO.md), [DESIGN-SYSTEM](./DESIGN-SYSTEM.md), [OPS](./OPS.md), [TESTING](./TESTING.md)).

## Core insight

Every page on the site is a **deterministic aggregation of GitHub star events**: which user starred which repo on which day. Histories, monthly leaderboards, organization totals, weekly movers — all of them collapse to fixed reductions over the same fact table.

Because the aggregations are deterministic and the query set is finite, the entire site can be precomputed into static JSON and served from a CDN. There is no runtime database, no query engine in the request path, and no native modules in the build.

## Hard constraints

These are non-negotiable for the production system. New features must respect all of them; any proposal that breaks one is a flag for an architectural review.

1. **Zero runtime engine.** Build, cron, and request paths only read JSON. No DuckDB, ClickHouse, Postgres, or vector index in the runtime image.
2. **Zero runtime database.** Read-side state lives in versioned Blob views resolved through a publish pointer; there is no SQL connection to open.
3. **Vercel-first.** Deploy, cron, Blob, workflow, and Vercel Web Analytics stay on Vercel. Google Analytics 4 is optional and must stay env-gated through `NEXT_PUBLIC_GA_ID`.
4. **Static content pages.** Content surfaces (home, rankings, repo, organization, pulse) render server-side as static HTML. Chrome is server-rendered; the remaining client JavaScript is limited to explicit islands such as search, language/theme toggles, sharing, compare, service-worker registration, Vercel Web Analytics, and optional env-gated GA4.
5. **Recurring work on Vercel, not the laptop.** All recurring data refresh (whitelist diff, metadata, rename detection, canonical fold, full recompute, publish, garbage collection) runs as a Vercel Workflow. Local pipeline runs are reserved for one-off bootstrap.

The same data layer also operates AI-free: features that look like they would call an LLM (summaries, classifications, narratives) ship as deterministic templates instead. The rationale and tradeoff are recorded in the team feedback memory.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC, Turbopack) | Vercel-native |
| Language / toolchain | TypeScript 6, React 19, Zod 4, Node 24, bun | |
| Styling | Tailwind 4 + Material 3 Expressive tokens (graphite + amber), hand-authored in `web/app/globals.css` following the M3 system color role taxonomy | |
| Fonts | Plus Jakarta Sans (variable sans), Geist Mono (numerals, repo names) | |
| Read-side data | Versioned JSON views in Vercel Blob, served through a publish pointer | `views/<run_id>/**` + `views/latest.json` |
| Live-overlay data | Daily `current_month.json`, weekly `hot-snapshot.json`, written by cron | Append-only within a period |
| Recurring data refresh | Vercel Workflow (multi-step, Blob checkpoint) | |
| One-off bootstrap | BigQuery (GH Archive) + local DuckDB → Parquet, then Blob upload | Archived; not in the recurring path |
| Code validation | GitHub Actions + Bun checks | `.github/workflows/ci.yml` runs `bun run lint`, `bunx tsc --noEmit -p tsconfig.json`, and `bun run test` from `web/` on PRs and `main` pushes |
| Analytics | Vercel Web Analytics via `@vercel/analytics` remains enabled. Optional Google Analytics 4 uses Next.js `@next/third-parties/google` and renders only when `NEXT_PUBLIC_GA_ID` is a non-empty value starting with `G-`; unset or invalid values emit no GA script. | |

Deliberately not in the production runtime stack: self-hosted ClickHouse, Tinybird, Neon/Postgres, Redis, Inngest, tRPC, any LLM SDK. The reasoning is the constraints above.

## Data flow

```
┌─ Bootstrap (one-off, archived) ─────────────────────────────┐
│  BigQuery   →   GH Archive WatchEvent (repo_id, day, gross) │
│  GraphQL    →   metadata + current_stars (authoritative)    │
│  DuckDB     →   star_daily.parquet, milestones, JSON views  │
│  Upload     →   Vercel Blob                                  │
└─────────────────────────────────────────────────────────────┘

┌─ Recurring recompute (Vercel Workflow) ─────────────────────┐
│  whitelist → rename → metadata (per bucket) → fold (month/  │
│  week) → recompute (rank, entity, heatmap, search index     │
│  written to views/<run_id>/**) → validate → publish (swap   │
│  views/latest.json) → garbage-collect old versions          │
│  Pure-JS throughout; large artifacts go via Blob direct URL │
└─────────────────────────────────────────────────────────────┘

┌─ Daily cron (live overlay, JSON-only, seconds) ─────────────┐
│  1. GraphQL: current_stars for tracked repos (~54 queries)  │
│  2. Net daily delta = today − yesterday                     │
│  3. Append to current_month.json                            │
│  4. Recompute hot-snapshot.json (home + current-period top) │
│  5. revalidatePath on hot surfaces                          │
└─────────────────────────────────────────────────────────────┘

┌─ Weekly cron (live overlay) ────────────────────────────────┐
│  1. GraphQL: current_stars                                  │
│  2. Overwrite current-week rank, current-month heatmap,     │
│     hot snapshot                                            │
│  3. Append to ops/sync-runs.json                            │
│  4. revalidatePath on current period + hot surfaces         │
└─────────────────────────────────────────────────────────────┘

┌─ Build (each deploy) ───────────────────────────────────────┐
│  Read precomputed JSON views, render static HTML and SSR    │
│  SVG. No aggregation, no engine, no native modules.         │
│  Output → Vercel Edge CDN                                   │
└─────────────────────────────────────────────────────────────┘
```

At runtime, content pages serve as static HTML from the edge. On-demand ISR pages render via a small function the first time a path is hit, then cache. There is no database connection on the request path.

## Key decisions

### Why daily increments do not pull GH Archive

Daily deltas only need `current_stars(today) − current_stars(yesterday)` per repo. GitHub's GraphQL API returns 100 repos per query, so the current tracked set (a few thousand repos; see [REQUIREMENTS.md](./REQUIREMENTS.md) §2 for the live count) costs a handful of queries — a few seconds, well under 1% of the hourly point budget. Pulling 1–3 GB of GH Archive daily is unnecessary, and net deltas (which can be negative when stars are revoked) are a more honest signal than GH Archive's gross adds.

### Why bootstrap uses BigQuery

Eleven years of star event history is only available in GH Archive. Free alternatives were evaluated and rejected:

- The public ClickHouse playground caps results at 1,000 rows per response and exposes `repo_name` but not `repo.id`, so 8M rows would need tens of thousands of paginated queries and renames break aggregation.
- Self-hosting ClickHouse or DuckDB would require downloading 4–12 TB of raw archive (the bucket cannot be filtered by event type) before any aggregation runs.
- GitHub's stargazers API caps at 40,000 stargazers per repo, so large repos cannot be fully reconstructed.

A single BigQuery scan costs about $10 (one-off), returns a stable `repo.id` (rename-safe), and is precise. The `githubarchive.*` columnar tables let `WHERE type='WatchEvent'` scan only the relevant columns.

### Why build reads JSON and ships no engine

Every page is a deterministic aggregation with a fixed query set. There is no need to keep a query engine in the runtime image. Aggregations are precomputed into JSON views; the build, the cron, and the request path only read those views. The cost is that adding a new slice requires updating the recompute logic, not writing a query at request time. For the current view catalog that tradeoff is straightforward.

### Why store events at daily grain (not monthly)

Weekly rankings cross calendar months. Daily is the smallest grain that exactly reconstructs week / month / year / all-time × repo / org × flow / stock, and it matches what GH Archive supplies. Daily volume (~8M rows) fits comfortably in Parquet during bootstrap (tens of MB). After bootstrap, days fold into stable monthly and weekly shards and the daily series exits the production read path.

### Organization dimension adds no new data

"Organization rank" = per-repo flow grouped by `owner`. Owners include both organizations (`Organization`) and individuals (`User`); both participate, distinguished by `owner_type`. It is a different `GROUP BY`, not a new pipeline.

### Honest data caveats (documented on the About page)

- Historical curves are gross adds (GH Archive WatchEvents); live deltas are net (GraphQL). The seam introduces a small inconsistency. Current totals always reflect GitHub's authoritative count.
- Survivorship bias: only repos that currently have ≥10,000 stars are backfilled. Projects that were once popular but dropped below the threshold are absent.
- Cumulative gross does not necessarily equal current total (stars get revoked); the current total is the authoritative anchor.
- Repo renames keep their identity via `repo.id`; URLs use the current `full_name` with 308 redirects from the old.

### Why the data starts at 2015

GitHub's "watch" semantics changed in late 2012. By 2015 the WatchEvent stream is consistent enough for long-term comparison.

### Whitelist

The tracked set is repos with current stars ≥ 10,000 (a few thousand entries; the live count drifts slowly and lives in [REQUIREMENTS.md](./REQUIREMENTS.md) §2). New entrants are picked up by the workflow's whitelist diff and metadata seeding without manual intervention.

## Data model

There is no database. The logical model is a fact table over star events; the physical model is JSON shards.

### Logical model

- **Fact: `star_daily(repo_id, date, delta)`** — per-repo, per-day star delta. Gross before the seam, net after. ~8M rows. In the bootstrap form this is a Parquet file; in the production form it is folded into monthly and weekly JSON shards.
- **Dimension: `repos`** — owner, owner type, language, milestones, topics, etc. Primary key is the immutable integer `id` (rename-safe). `current_stars` is the authoritative GraphQL value.
- **`meta`** — global metadata: `seam_date` (gross→net boundary), `schema_ver`, `folded_through` watermark, etc.

Field-level schemas are in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md).

### Derivations

For each (window, dimension, metric) triple, the recompute produces a JSON view:

- **Window**: week / month / year / all-time
- **Dimension**: repo (by `repo_id`), org (by `owner`)
- **Metric**: `flow` (sum of `delta` in the window — "who is rising"), `stock` (cumulative through the window end, anchored to `current_stars` — "who is largest")

The recompute applies prefix sums and group-by reductions over the JSON shards. Equivalent SQL on the bootstrap Parquet form is included below for reference; production never executes it because there is no engine to execute it in.

```sql
-- Monthly repo "flow" leaderboard
SELECT repo_id, SUM(delta) AS adds FROM star_daily
WHERE date BETWEEN '2024-10-01' AND '2024-10-31'
GROUP BY repo_id ORDER BY adds DESC LIMIT 100;

-- Weekly org "flow"
SELECT r.owner, SUM(s.delta) AS adds
FROM star_daily s JOIN repos r ON s.repo_id = r.id
WHERE s.date BETWEEN :wk_start AND :wk_end
GROUP BY r.owner ORDER BY adds DESC LIMIT 100;

-- All-time stock leaderboard
SELECT id, current_stars FROM repos ORDER BY current_stars DESC LIMIT 100;
```

### Physical: JSON view artifacts

Each (period × dim × metric) reduction produces a JSON view: rank tables, entity timelines (per repo, per org), heatmaps, lookup tables for build-time joins, and the client-side search index. Live-overlay paths produce `current_month.json` and `hot-snapshot.json`. The complete Blob layout is in [OPS.md](./OPS.md); per-view schemas are in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md).

Builds ingest these JSONs directly and bake them into static HTML. Adding a new view means adding a recompute step that produces JSON; the read path needs no engine.

## Rendering and distribution

### Page set

| Page type | Base canonical path count |
|---|---|
| Home | 1 |
| Year | ~11 |
| Month | ~132 |
| Week | ~570 |
| All-time rankings | small |
| Repo | ~the current whitelist size (see [REQUIREMENTS.md](./REQUIREMENTS.md) §2) |
| Organization | several thousand |
| Compare | 1 (static shell, URL-driven state) |
| Search index endpoint | 1 |
| OG cards (per surface) | one per page |

English keeps the base canonical paths unprefixed; non-default locales add URL prefixes and participate in canonical / `hreflang` / sitemap output. The table above counts base canonical paths, while crawlable locale URLs are roughly that set multiplied by the seven supported locales. Long-tail surfaces (year / month / week / repo / org) still render through on-demand ISR rather than being fully cross-producted at deploy time.

### Build budget

Eleven thousand-plus pages cannot be built at deploy time within Vercel's 45-minute budget, and `.next/cache` does not carry pre-rendered HTML across deploys. The build only produces the small core (home, current year, current month, all-time rankings, pulse, compare). Everything else renders on first request and is then cached as ISR.

### Page tiering and refresh cadence

| Tier | Surfaces | Refresh mechanism |
|---|---|---|
| **Core** (built at deploy) | home, current year, current month, all-time rankings, `/pulse`, `/compare` | Built at deploy; daily cron writes `hot-snapshot.json` and calls `revalidatePath` on these surfaces |
| **Movers** (event-driven, daily) | Repos and orgs flagged as moving today (top-50 daily flow ∪ ≥ 5× their 90-day median with absolute floor ∪ milestone crossings) | Daily cron picks the set and calls `revalidatePath` on those entities + the pulse surface |
| **Long-tail** (on-demand ISR) | Historical years / months / weeks; repos and orgs not currently moving | `dynamicParams=true`, not enumerated in `generateStaticParams`; first request renders, then cached. `revalidate=false` (changes propagate via targeted `revalidatePath`) |
| **Frozen** | Completed weekly / monthly / yearly pages | Rendered once and stamped "as of <date>"; only re-rendered when the recompute publishes a new pointer version |

Cadence:

- **Deploys** (code or structural change): build the small core only; ISR resets and re-warms on first request. Long-tail surfaces are not enumerated at deploy.
- **Daily cron**: update `current_month.json`, write `hot-snapshot.json`, recompute mover set, `revalidatePath` on hot surfaces. Untouched entities and historical surfaces are not touched.
- **Weekly cron**: refresh the current week and month rank, current-month heatmap, hot snapshot, and `ops/sync-runs.json`.
- **Workflow runs** (recompute → validate → publish): re-derive every `views/**` artifact, validate, and atomically swap the pointer. Old versions are reaped by the GC step.

Configuration constraints: `next.config.ts` does not set `cacheComponents` (Next 16 default — leaving it off is mandatory because enabling it would disable `dynamicParams` and break the on-demand ISR model); long-tail pages export `revalidate=false`; ISR rendering reads only KB-sized hot-snapshot JSON.

### GraphQL budget

The hourly point budget is 5,000. Querying `stargazerCount` is ~1 point per query; ~54 queries per cron run (~1%) sit comfortably under the limit. Metadata backfill (topics, license, etc.) costs more per query but still remains well below the budget.

### Performance posture (designed for ~10M page views per day)

| Strategy | Purpose |
|---|---|
| Static HTML for content pages | Function invocations stay at zero |
| HTML under ~20 KB | Reduces bandwidth at scale |
| Near-zero client JS on content pages | SVG charts and chrome render server-side; only explicit interaction and global islands hydrate, including RegisterSW, Vercel Web Analytics, and optional env-gated GA4 |
| `Cache-Control: s-maxage=86400, stale-while-revalidate` | Historical surfaces cached aggressively |
| Subset fonts as woff2 | Plus Jakarta Sans subset ~30 KB |
| Pre-rendered OG cards in Blob | No function cost on share embeds |

### Bandwidth defense (cost-stepping)

At ~10M views per day, bandwidth (~15 TB/month) dominates cost. The expected steps are:

1. **Up to ~1M/day**: Vercel Pro, ~$40–100/month.
2. **1M–5M/day**: aggressive compression (Brotli 11, HTML minification).
3. **5M+/day**: Cloudflare in front of Vercel to absorb egress (~80–90% cut).

## Operations, data quality, and compliance

### Time and timezone

- **Storage**: UTC throughout. Daily aggregation is on UTC day boundaries (matches GH Archive).
- **Display**: timestamps render as UTC + JST side by side. The `ja` locale leads with JST; other locales lead with UTC.
- Day-grain data (daily star deltas) has no timezone conversion; it presents as a UTC day.

### Data reconciliation

Two sources drift: GH Archive (gross) and GraphQL (authoritative net total).

- The daily cron compares the GraphQL `current_stars` against the historical roll-up.
- When drift exceeds threshold (~2%), the GraphQL value anchors `current_stars`; historical `total_end` is re-anchored proportionally; `sync_runs.total_drift_pct` records the event.
- Current totals are always precise; the historical curve shape stays gross-based and only re-anchors at the seam.
- Pipeline sanity checks flag extreme single-day spikes; net deltas can be negative (revoked stars) and that is allowed.

### Compliance and attribution

- **GH Archive**: historical WatchEvent data is credited to GH Archive (gharchive.org), licensed under CC BY 4.0, and disclosed as derived/transformed into GitStarClub ranking and curve views.
- **GitHub**: repository metadata and current star totals are fetched through official GraphQL/Search APIs under ToS; only public data for public repos.
- The About page and footer document the data caveats (gross vs net, survivorship bias, 2015 start), attribution, and source links.

### Accessibility

- SVG charts (star curves, heatmaps) carry `<title>` and `aria-label` summaries and provide a visually hidden data table for assistive tech.
- Semantic HTML: `<main>`, `<nav>`, `<article>`; breadcrumbs use `<nav aria-label>`.
- The M3 token system meets WCAG AA contrast in both light and dark themes; `on-*` color pairs are guaranteed by the M3 tone mapping.
- Keyboard reachability: all internal links are tab-focusable with a visible focus state.

## Future expansion (what would change this picture)

The current scope is comfortably static. Several requested capabilities would force introducing an analytical data layer:

- Drill-down beyond the ≥10k whitelist (~460k repos at the ≥100 threshold).
- Arbitrary-repo compare (not limited to the indexed set).
- Topic / language / cohort clustering.
- Semantic / embedding-based search.

These cannot fit a fixed view set or a client-side index. They share an open architectural decision recorded in [ROADMAP.md](./ROADMAP.md): which analytical layer to introduce (managed ClickHouse, Vercel-native relational, etc.) and how to reconcile that with the Vercel-first / runtime-zero-engine posture above. No work on those features starts before that decision lands.

## Cost estimate

| Scale | Monthly cost |
|---|---|
| MVP (<100k page views / day) | ~$20 (Vercel Pro) + one-off bootstrap ~$10 (BigQuery) |
| 1M / day | ~$40–100 |
| 10M / day (Vercel-only) | ~$2,100 (bandwidth-dominated) |
| 10M / day (with Cloudflare in front) | ~$200–400 |
