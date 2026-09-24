---
owner: data contracts
status: active
last_reviewed: 2026-09-22
source_of_truth_for:
  - canonical JSON shard schemas
  - JSON view schemas
  - build-side data types
---

# gitstarclub Data Contracts (canonical JSON shard + JSON views)

## Scope

This document is the **interface contract between the data layer and the build**, giving each canonical shard and JSON view an **exact schema**——fields, types, definitions, and reference relationships, and it is the source of truth for the Zod definitions in `web/lib/contracts/`. It must be read before adding an artifact / changing a field / adjusting a definition.
Physical form, tradeoffs, and the generation pipeline are in [ARCHITECTURE.md](./ARCHITECTURE.md) "data model" and [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md); how the frontend consumes them is in [FRONTEND.md](./FRONTEND.md); ranking-definition details are in [RANKING.md](./RANKING.md); this document does not cover deployment, operations, or cron scheduling (see [OPS.md](./OPS.md)).

> ⚠️ **canonical form**: §1's `star_daily.parquet` is the **bootstrap archive** form. **production canonical = §1.4's JSON shard** (Vercel can recompute it, with no engine). The Workflow / checkpoint / publish pointer contracts are in §2.11–2.13.

## Requirement Traceability

[REQUIREMENTS.md §0](./REQUIREMENTS.md#0-requirement-ids--priority--traceability-matrix) owns priority and acceptance language. This table identifies which JSON contracts provide evidence for each requirement.

| Requirement ID | Contract artifacts | Contract responsibility |
|---|---|---|
| `REQ-CHRONICLE-001` | `rank/**`, `entity/repo/{id}.json`, `entity/org/{login}.json`, `heatmap/{year|month}/{period}.json`, `lookup/**` | Historical and entity pages can join stable ids/logins to versioned ranking, curve, heatmap, and lookup views. |
| `REQ-PULSE-001` | `live/latest.json`, `live/generations/{run_id}/**`, `ops/sync-runs.json` | Daily movers and pulse pages consume one complete, freshness-labelled live generation independent of full recompute. |
| `REQ-RANKING-001` | `rank/{window}/{period}/{dim}/{metric}.json`, `rank/all-time/{dim}/stock.json`, derived `growth` / `new` rank files | Rank item shape, metric semantics, id-vs-login exclusivity, ordering, continuity, and top-N rules are schema-visible. |
| `REQ-I18N-001` | All data views; no translated repo/org data fields | Data contracts remain language-neutral so frontend locale routes can localize chrome/meta without mutating source facts. |
| `REQ-DATAOPS-001` | `bootstrap/latest.json`, bootstrap phase manifests, `views/latest.json`, `ops/workflows/{run_id}/manifest.json`, `ops/workflows/{run_id}/validation.json`, `ops/workflows/latest-success.json` | Bootstrap and recurring published versions, validation gates, checkpoints, and rollback pointers are explicit artifacts. |
| `REQ-PERF-001` | Budgeted JSON service views, lookup-only rank joins, `/repo-curve` projection | Frontend reads small, precomputed views instead of loading engines or full canonical shards on request paths. |
| `REQ-SEARCH-001` | `search/index.json` | Search has a versioned, compact client index with one document per tracked repo. |
| `REQ-COMPARE-001` | `/repo-curve?id=<id>` projection from `entity/repo/{id}.json` | Compare reuses entity curves and returns only the slim curve payload needed by the client. |
| `REQ-CATEGORY-001` | `categories/registry.json`, `categories/assignments.json`, `categories/assignments/shards/*.json`, `lookup/categories.json`, `rank/category/**` | Category pages are driven by public registry and assignment artifacts, with paged all-time rank views. New generations shard assignments so each Data Cache entry stays under 1.50 MiB. |

## Global conventions

- **Dates**: always UTC, `YYYY-MM-DD`.
- **Period identifier `period`**: week = `WeekPeriod` ISO week `YYYY-Www` (e.g. `2024-W42`); month = `MonthPeriod` `YYYY-MM`; year = `YearPeriod` `YYYY`; all-time `all`.
- **Primary key**: repo = the GitHub numeric `repo_id` (immutable, stable across renames); org = the `owner` login string.
- **Numbers**: integers. `delta` / flow is net after the seam, and **may be negative** (unstar); stock (cumulative) is non-negative.
- **Contract hard line**: `current_stars` / `current_stars_sum` / `stars` / count-like fields are non-negative; `RankItem.value` may still be negative (net flow). A `RankItem` must carry exactly one of `id` (repo) or `login` (org).
- **Text and time**: `DateStr` date fields use UTC `YYYY-MM-DD`; `TimestampStr` (`generated_at` / `published_at` / checkpoint and others) uses a timezone-qualified ISO timestamp. Free-text fields are escaped by the React render layer, and the contract also rejects high-risk active HTML fragments (script/iframe/style and others) and a real `javascript:` URL scheme (not `JavaScript:` inside an English title).
- **Reference vs embedding**: ranking JSON stores only the entity **id/login + numbers**, and does not embed names/descriptions; the build uses `lookup/*` to join out display fields → ranking files stay small, and a rename only needs to update lookup.
- Every JSON carries `meta` (at least `generated_at`; a view also includes `period/window/dim/metric`) to help caching and debugging.

---

## 1. Canonical (touched only by the data layer: §1.1–1.3 bootstrap Parquet form; §1.4 production JSON shard)

### 1.1 Fact table `canonical/star_daily.parquet` (🗄️ bootstrap archive form)

The sole bootstrap source of truth; in the production phase it is folded into §1.4's month/week JSON shards, and the daily table itself retires to an archive and is not on the production read / recompute path.

| Column | Type | Description |
|---|---|---|
| `repo_id` | INT64 | GitHub numeric id (immutable primary key) |
| `date` | DATE | UTC day |
| `delta` | INT32 | That day's star delta; gross before the seam (≥0, GH Archive WatchEvent count), net after the seam (GraphQL day difference, may be negative) |

- Logical PK `(repo_id, date)`; sorted/partitioned by `repo_id`, which helps aggregation by repo.
- ~8 million rows / columnar storage ≈ tens of MB. **Does not include the in-progress current month**——the current month is in the `current_month.json` live tail (§2.8), and the build/cron merges it.

### 1.2 `repos` dimension (→ also exported as `lookup/repos.json`)

| Field | Type | Description |
|---|---|---|
| `id` | int | GitHub numeric id (primary key) |
| `node_id` | string | GraphQL global id (for batched `nodes()`) |
| `owner` | string | Owner login |
| `owner_type` | `"User"\|"Organization"` | Decides org-ranking classification |
| `name` | string | repo name |
| `full_name` | string | Current `owner/name` (updated on rename; URLs use it, and old URLs 308) |
| `description` | string\|null | |
| `language` | string\|null | Primary language |
| `topics` | string[] | |
| `created_at` | DateStr\|TimestampStr | repo creation date; a canonical shard may keep the GitHub `createdAt` timestamp, and the entity view is trimmed to `YYYY-MM-DD` |
| `current_stars` | int | GraphQL authoritative current total (**the only number that must be exact**) |
| `active` | bool | Whether it belongs to this GitHub Search discovery set. `false` = kept for history only, and it does not participate in current polling, the current total, or all-time/category rankings |
| `is_archived` | bool | |
| `crossed_10k/50k/100k` | DateStr\|null | Exact date the milestone was first crossed (for "on this day in history") |
| `tracked_since` | DateStr\|null | Date of first entering the whitelist / when tracking started. A bootstrap baseline repo is `null` (it has full history); a newcomer repo = the first discovery day; re-entry after a drop keeps the original date (the page labels from this, see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §10) |
| `fetched_at` | TimestampStr | Metadata fetch time |

#### Repository tracking contract (authoritative)

1. GitHub Search is responsible only for **membership discovery**. Discovery first runs an open-upper-bound `stars:>=MIN_TRACKED_STARS` (default 10,000; `getMinTrackedStars()` reads `MIN_TRACKED_STARS`, preview = 1,000), reads the current maximum in descending star order, then adaptively buckets by that dynamic upper bound; there is no 600,000 or other product-level maximum-star cutoff. When preview `WHITELIST_SEARCH_SHARDS=1`, Search resumes the queue by hop (`ops/workflows/<run_id>/whitelist-search.json`) and does not write a snapshot before completion. A failed run's unpublished snapshot is reused by the next run via `ops/workflows/latest-unpublished-whitelist.json` (no re-search); the published pointer remains the baseline. Opening a page does not compute on the fly; membership changes go only through refresh → precomputed views.
2. GraphQL `Repository.stargazerCount` is the sole authoritative source of `current_stars`, the current total, and current/all-time ranking. The `stargazers_count` returned by Search is kept only in the immutable whitelist snapshot for discovery audit, and is not written to canonical `current_stars`.
3. `WhitelistSnapshot.count === entries.length` is this run's authoritative active tracked count. The publish gate requires that set to match canonical `active:true`, `lookup/repos.json active:true`, and `meta.active_repo_count` exactly.
4. A drop does not delete: canonical, lookup, search, and the repo entity are kept, and `active:false` is written; daily/weekly cron, current org/category aggregation, and the all-time ranking use only active rows.
5. Re-entry is reactivated by the next whitelist `diff.added`, GraphQL fetches the authoritative total again, and the first `tracked_since` is kept. Only a first-time newcomer writes the immutable whitelist snapshot's UTC date into `tracked_since`.

### 1.3 `meta`（→ `meta.json`）

```json
{ "seam_date": "2026-05-30", "backfilled_at": "...", "schema_ver": 1,
  "active_repo_count": 5302, "historical_repo_count": 17, "generated_at": "..." }
```

`seam_date` = the gross→net boundary (backfill cutoff date): `date < seam_date` is gross, and after that is net. A versioned writer also writes `active_repo_count` / `historical_repo_count`; the publish gate cross-checks them against the whitelist / lookup. The `Meta` contract accepts both **flat bootstrap meta** (includes `backfilled_at`) and **versioned meta** (includes `folded_through`, with no `backfilled_at`); count fields are optional during legacy reads, but a new publish must have them and they must match. `schema_ver` is that view's schema version. Ownership of these four lifecycle fields:

| Field | Type | Produced by | Official on |
|---|---|---|---|
| `active` | bool | metadata / recompute | `ReposShardEntry`, `RepoLookupEntry`, `SearchDoc`, `RepoEntity`（legacy optional） |
| `tracked_since` | DateStr\|null | metadata | same |
| `active_repo_count` | int | recompute `views/meta.json` | `Meta` only |
| `historical_repo_count` | int | recompute `views/meta.json` | `Meta` only |

They **do not belong to** `canonical/v2/meta.json` (`CanonicalMeta` stays `.strict()`, and does not include count fields). Readers do not use `.passthrough()`.

### 1.4 Production canonical JSON shard

> **Fold + bucket** §1.1's 8M-row daily table into a set of small JSON, so Vercel Workflow can recompute with no engine. The design and bucketing strategy are in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5/§5.2. `<bucket>` = `repo_id % N`.

**`canonical/v2/meta.json`** —— global metadata (drives stock-anchor segmentation + the close-out watermark):

```json
{ "seam_date": "2026-05-30", "schema_ver": 1,
  "folded_through": { "month": "2026-05", "week": "2026-W22" },
  "generated_at": "2026-06-02T14:32:57.214Z" }
```

- `seam_date`: the gross→net boundary; stock anchoring segments by it ([VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.3).
- `folded_through`: the last week/month period already folded into base; the read path uses it to decide whether a period belongs to live or base (prevents duplication, [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.2).
- `generated_at`: a UTC timestamp that both the bootstrap writer and the recurring fold writer must write. During migration, a reader still accepts a legacy generation that lacks this field; the managed refresh route checks `meta` + every `repos` shard before the lease, and the workflow's first step validates all 128 required shards again before any canonical mutation (CF / HTTP orchestration splits invocations by 4-bucket windows, and the semantics remain a full gate). When preview `PREFLIGHT_RELAX_EMPTY_SHARDS=1`, a missing/empty shard is treated as an empty `{}` placeholder via `preview-empty-canonical-placeholder`, and the whole run is not voided; production stays fail closed. schema / identity / `d` / a wrong bucket are still rejected.

**`canonical/v2/repos/{bucket}.json`** —— repo-dimension buckets (fields same as §1.2, including `tracked_since` and `fetched_at` (metadata fetch time); plus `d` = the frozen anchor factor (`>= 0`, and it may be `> 1` when GitHub Archive undercounts), computed by bootstrap and **stored as a full-precision IEEE double**——rounding would make the JS-recomputed `stock_est` differ from DuckDB by ±1):

```json
{ "1296269": { "id": 1296269, "node_id": "...", "owner": "vuejs", "owner_type": "Organization",
               "name": "vue", "full_name": "vuejs/vue", "language": "TypeScript",
               "current_stars": 207000, "active": true, "crossed_10k": "2016-10-04", "tracked_since": null,
               "d": 0.9123 } }
```

**`canonical/v2/repo-monthly/{bucket}.json`** —— per-repo month flow series (period = `MonthPeriod`, drives the month ranking + the entity month curve):

```json
{ "1296269": [ ["2015-01", 1200], ["2015-02", 1500] ] }   // { "<id>": [[period, flow], ...]; gross before the seam / net after }
```

**`canonical/v2/repo-weekly/{bucket}.json`** —— per-repo ISO week flow series (period = `WeekPeriod`, drives the historical week ranking): `{ "<id>": [["2024-W42", 320], ...] }`.

**`canonical/v2/repo-recent-daily/{bucket}.json`** —— per-repo daily points for the recent ~90 days (curve tail + week boundary, net may be negative): `{ "<id>": [["2026-03-01", 30], ["2026-03-02", -5]] }`. ⚠️ **bootstrap(`07-export-v2`) one-time seed**; the recurring `fold` step(`fold.ts`)**does not read, write, or trim** recent-daily(`web/lib/` has no writer, only the reader `io.ts:53`)——"daily points that roll out of 90 days are merged into `repo-monthly`" aging is **not yet implemented** (xref issue #3 / [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.2).

**`canonical/v2/site-daily/{yyyy}.json`** —— site-level daily totals (`year` = `YearPeriod`, drives the heatmap): `{ "year": "2024", "cells": [["2024-01-01", 82000]] }`.

**`canonical/v2/pending/{period}.json`** —— a frozen snapshot of a month-period live tail that is already closed out and pending fold (period = `MonthPeriod`; written before the cron cross-period reset and read by the fold step, [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.2): the same shape as `current_month.json`'s `per_repo` + `daily_totals`.

> **stock anchoring**(definition same as [RANKING.md](./RANKING.md) §3,**must be split before and after the seam**): the anchor factor `d = current_stars@seam / cumgross@seam_date`(**the denominator includes only pre-seam gross**),bootstrap computes it and then writes it frozen into the `repos` shard; `d >= 0`, and it may be `> 1` when Archive undercounts. Before the seam, `stock_est = cumgross × d`; **after the seam, net is not multiplied by `d` and is summed directly**: `stock = stock@seam + Σ(net after the seam)`. Details are in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.3. Milestones are likewise computed by bootstrap, then frozen and written into the `repos` shard.

---

## 2. Service views (JSON, read by the build, stored in Vercel Blob)

### 2.0 View schema index (the physical Blob tree is in [OPS.md](./OPS.md) §Blob layout)

> The following is an index of **view names that have a §2.x schema → section**; the full physical layout (including `canonical/v2/*` shards) is not relisted here, see OPS §Blob layout.

```text
lookup/repos.json                              # build join table (§2.1)
lookup/orgs.json
lookup/aliases.json                            # renamed old full_name → current repo id (§2.2b)
search/index.json                              # client site-wide search index (derived by recompute)
rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json
rank/all-time/{repo|org}/stock.json
live/latest.json                              # live generation pointer + fenced lease (§2.9a)
live/generations/{run_id}/manifest.json       # generation integrity manifest
live/generations/{run_id}/rank/{week|month}/{period}/repo/{flow|stock}.json
live/generations/{run_id}/heatmap/month/{period}.json
live/generations/{run_id}/current_month.json  # live tail (written by cron, §2.8)
live/generations/{run_id}/hot-snapshot.json   # hot set (written by cron, read by ISR, §2.9)
entity/repo/{id}.json
entity/org/{login}.json
heatmap/{year|month}/{period}.json
current_month.json                             # migration-period flat fallback (new cron no longer overwrites it)
hot-snapshot.json                              # migration-period flat fallback (new cron no longer overwrites it)
ops/sync-runs.json                             # cron run records (written by cron, read by operations)
meta.json
canonical/v2/whitelist/latest.json             # { run_id, ids[] }: compatibility pointer of the published baseline (written by publish / rollback; the whitelist step does not advance it)
# ── Vercel-only publish layer (see §2.11–2.13)──
bootstrap/latest.json                          # cold start generation's atomic commit / rollback pointer
bootstrap/generations/{generation}/**          # sealed base + canonical payload and phase manifests
bootstrap/overlays/{generation}/canonical/**   # recurring canonical copy-on-write state
views/latest.json                              # publish pointer (the read side resolves the version prefix from it; version = run_id)
views/{run_id}/…                               # one run's complete view version (version=run_id, with no separate staging/published)
ops/workflows/{run_id}/manifest.json           # Workflow run metadata
ops/workflows/{run_id}/steps/{step}.json       # each step's checkpoint
ops/workflows/{run_id}/metadata-<bucket>.json  # metadata GraphQL batch progress (continue the run after a 502)
ops/workflows/latest-unpublished-whitelist.json # unpublished whitelist snapshot pointer
ops/workflows/latest-success.json              # run_id of the most recent successful publish (recovery point)
```

> **The internal structure of publish-layer artifacts (`views/<version>/*`) = the views in §2.1–2.7** (`rank/** entity/** heatmap/** lookup/** meta.json`), placed under the `views/<run_id>/` prefix (version = run_id, with no staging→published copy). The read side first reads the `views/latest.json` pointer to resolve `<version>`, then reads the views under that prefix (when there is no pointer it falls back to the flat layout; see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.1).

Phase 1 category views also live under `views/<run_id>/`:

- `categories/registry.json` - public category registry and counts.
- `categories/assignments.json` - v2 index (`schema_version: 2`, `shard_count: 32`) or, for already-published generations, the v1 monolith `{ rules_version, generated_at, repositories }`.
- `categories/assignments/shards/<bucket>.json` - v2 repo-id buckets (`bucket = repo_id % 32`). Readers assemble these into the original `CategoryAssignments` shape. ISR pages must not `no-store` this path.
- `lookup/categories.json` - small client/build lookup for public categories;
  category entries may carry `sitemap` eligibility so route discovery can omit
  explicitly hidden categories.
- `rank/category/<dimension>/<slug>/all-time/repo/stock.json` - phase-1 all-time category rank page 1.
- `rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json` - phase-1 all-time category rank pages 2+.

Windowed category rank views are reserved for later category page phases; do not
emit `rank/category/**/{week|month|year}/**` until the write-budget impact is
explicitly accepted.

### 2.1 `lookup/repos.json`

The build's join table——holds only the minimum fields needed to render rankings/cards (full metadata is in `entity/repo`).

```json
{
  "1296269": { "owner": "vuejs", "name": "vue", "full_name": "vuejs/vue",
               "owner_type": "Organization", "language": "TypeScript", "current_stars": 207000,
               "active": true, "tracked_since": null }
}
```

lookup keeps both active and historical repos, so old URLs / historical entities can still resolve; callers must not infer current membership from "the row exists".

### 2.2 `lookup/orgs.json`

```json
{
  "vuejs": { "login": "vuejs", "owner_type": "Organization",
             "repo_count": 14, "current_stars_sum": 312000 }
}
```

### 2.2b `lookup/aliases.json`

Rename map: an old (deprecated) `full_name` (lowercased) → the current `repo id`. When the repo page `/[owner]/[name]` cannot find the slug, it uses this to **308 permanently redirect** to that id's current `full_name` (`repo_id` is stable across renames, and the redirect target is resolved at request time from `lookup/repos.json`). Produced by the `buildAliases` workflow step: the union of every retained `ops/workflows/<run>/renames.json` increment (gc does not delete `ops/`, so it can cover renames from earlier runs), dropping ids that are no longer tracked, self-references, and entries that collide with a live repo's current name.

```json
{ "facebook/react": 10270250, "facebook/react-native": 29028775 }
```

### 2.3 `rank/{window}/{period}/{dim}/{metric}.json`

Rankings. `window∈{week,month,year}`, `period` is in Global conventions, `dim∈{repo,org}`, `metric∈{flow,stock}`.
**Derived repo rankings (month/year only, dim=repo)**: `metric=growth` (growth rate; the item includes `rate`=growth-rate % and `base`=period-start stock; **entering the ranking requires period-start stock ≥ 20,000 and current-period flow > 0**——`flow<=0` is dropped as well, see `ranks.ts:131`), `metric=new` (newcomer; the item includes `date`=the date 10k was crossed). The definition is in [RANKING §4](./RANKING.md); `RankItem` therefore carries the three optional fields `rate`/`base`/`date`.

```json
{
  "meta": { "window": "month", "period": "2024-10", "dim": "repo",
            "metric": "flow", "generated_at": "..." },
  "items": [
    { "rank": 1, "id": 1296269, "value": 12345, "prev_rank": 2 },
    { "rank": 2, "id": 28457823, "value": 11900, "prev_rank": 1 }
  ]
}
```

- `dim="repo"` → use `id`; `dim="org"` → use `login` (the other field is omitted).
- `value`: `flow` = ∑delta over the period; `stock` = the cumulative total at period end (historical = anchor estimate, after the seam = exact).
- `prev_rank`: the rank in the previous period of the same kind (for "↑↓ / enter-leave TOP50"), or `null` if there is none.
- top-N: repo defaults to 100, and org defaults to 100 (pages truncate as needed).

### 2.4 `rank/all-time/{dim}/stock.json`

`items` has the same shape; all-time is `stock` only (`active:true` only; repo is sorted by GraphQL `current_stars`, and org is sorted by the `current_stars_sum` of active members).

### 2.4a `rank/category/<dimension>/<slug>/all-time/repo/stock*.json`

Phase-1 category rank views are all-time repo stock lists only. They reuse
`RankItem` rows but add category metadata to the rank meta object. Page 1 keeps
the compatibility path `rank/category/<dimension>/<slug>/all-time/repo/stock.json`;
page 2+ lives at
`rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json`.

```json
{
  "meta": {
    "window": "all",
    "period": "all",
    "dim": "repo",
    "metric": "stock",
    "generated_at": "...",
    "category": { "id": "language/python", "dimension": "language", "slug": "python" }
  },
  "items": [
    { "rank": 1, "id": 1296269, "value": 12345, "prev_rank": null }
  ]
}
```

Rules:

- `dim` is always `repo`.
- `metric` is `stock` for the Phase-1 all-time view.
- Each category rank file is capped to `CATEGORY_DETAIL_PAGE_SIZE` rows; ranks
  continue across page files (`101`, `102`, ... on page 2).
- Every `item.id` must be assigned to `meta.category.id` in the assembled `categories/assignments` map (v2 shards or v1 monolith).
- Windowed `flow`/`stock` category ranks are future work; avoid emitting them until the category route phase has accepted the extra view count.

### 2.4b `categories/assignments.json`（index + repo-id shards）

Production assignments exceeded the Next.js Data Cache 2 MiB entry limit (2,113,986 bytes). New generations write a small index plus 32 repo-id shards. ISR pages keep `force-cache` / daily revalidate — they must not flip to `no-store`. The publish gate checks **UTF-8 JSON byte length** of the index and every shard; each file must be **< 1.50 MiB**.

**v2 index** (`categories/assignments.json`, KB-scale):

```json
{
  "schema_version": 2,
  "rules_version": "2026-06-07.2",
  "generated_at": "2026-06-04T00:00:00.000Z",
  "shard_count": 32
}
```

**v2 shard** (`categories/assignments/shards/<bucket>.json`, `bucket = repo_id % 32`):

```json
{
  "schema_version": 2, "bucket": 1,
  "rules_version": "2026-06-07.2",
  "generated_at": "2026-06-04T00:00:00.000Z",
  "repositories": {
    "123456": {
      "language": ["language/python"],
      "language_family": ["language_family/python"],
      "domain": ["domain/ai-ml"],
      "project_type": ["project_type/library"],
      "ecosystem": ["ecosystem/python"],
      "owner_kind": ["owner_kind/organization"],
      "maturity": ["maturity/star-10k"]
    }
  }
}
```

**v1 monolith** (already-published generations remain readable): the previous `{ rules_version, generated_at, repositories }` document at `categories/assignments.json`. Readers accept either shape and assemble shards before callers see `CategoryAssignments`. Index-mode assemble batches shard reads (≤6 concurrent, ≤4 on CF Workers) because a single `Promise.all` of 32 shards plus other `/rankings` Blob GETs exceeds the Workers subrequest cap.

### 2.5 `entity/repo/{id}.json`

```json
{
  "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "owner_type": "Organization",
  "name": "vue", "description": "...", "language": "TypeScript",
  "languages": [
    { "name": "TypeScript", "size": 120000, "color": "#3178c6" },
    { "name": "JavaScript", "size": 30000, "color": "#f1e05a" }
  ],
  "topics": ["vue","framework"],
  "homepage_url": "https://vuejs.org/", "license": "MIT",
  "latest_release": { "name": "v3.5.0", "tag_name": "v3.5.0", "published_at": "2024-09-01", "url": "https://github.com/vuejs/core/releases/tag/v3.5.0" },
  "created_at": "2013-07-29", "current_stars": 207000,
  "active": true, "tracked_since": "2026-07-17", "is_archived": true,
  "milestones": { "crossed_10k": "2016-10-04", "crossed_50k": "2017-12-09", "crossed_100k": "2018-10-26" },
  "curve": {
    "monthly": [ ["2015-01", 1200, 18000], ["2015-02", 1500, 19500] ],
    "recent_daily": [ ["2026-03-01", 30], ["2026-03-02", -5] ]
  },
  "monthly_table": [ { "month": "2024-10", "adds": 1234, "rank": 42 } ],
  "rank_history": { "month": [ ["2024-10", 42], ["2024-11", 38] ] },
  "inflections": [ { "period": "2018-10", "flow": 12000, "kind": "peak" } ]
}
```

- `curve.monthly`: `[period, adds, total_end]`——history uses monthly points (11 years≈132 points). `total_end` is `stock_est` and **must be ≥ 0** (`MonthlyPoint` uses `NonNegativeInt`). Flow (`adds`) may be negative. Writers clamp `stock_est = max(0, formula)` in `computeRepoWindow` so `d=0` newcomers / first-period unstars cannot publish a negative star count; running `cumGross`/`cumNet`/`anchor` stay unclamped so later periods can recover toward `current_stars`. Recompute Zod-parses every `RepoEntity` / `OrgEntity` before Blob write; the publish gate re-parses every entity from lookup, not only the top repo.
- `active` / `tracked_since`: explicitly show the current tracking status and newcomer provenance; a historical entity is not deleted, and the repo page shows "kept for history" plus the available first-tracked date.
- `languages`: optional GitHub language breakdown from GraphQL
  `Repository.languages`, sorted by byte size descending. Older published shards
  may omit it; pages fall back to the primary `language` field.
- `homepage_url` / `license` / `latest_release`: optional GitHub metadata fields. Pages only read JSON views; these fields are filled in by the offline metadata pipeline / cron, and GitHub is not fetched live on the request path. `homepage_url` can also serve as a repo JSON-LD `sameAs` deterministic first-party identity source.
- `curve.recent_daily`: `[date, net_adds]`——daily points for the recent ~90 days (the curve tail), and may be negative.
- `monthly_table`: adds for the recent N months + the current month's flow rank.
- `rank_history`: optional, rank history (drives "rank trend").
- `inflections`: optional, inflection markers `[{period, flow, kind}]`, derived by recompute——a "burst" month whose month flow is ≥ K× the rolling median and passes an absolute floor; the highest month is `kind:"peak"`, the rest are `"surge"`, at most 3; `StarCurve` draws markers + a tooltip from them. Old data lacks this field (optional).

### 2.6 `entity/org/{login}.json`

```json
{
  "login": "vuejs", "owner_type": "Organization", "current_stars_sum": 312000, "repo_count": 14,
  "members": [ 1296269, 11730342 ],
  "curve": { "monthly": [ ["2015-01", 2100, 30000] ], "recent_daily": [ ["2026-03-01", 55] ] },
  "rank_history": { "month": [ ["2024-10", 7] ] }
}
```

- `members`: that org's whitelist (≥10k) repo id list.
- `curve` = member aggregate (∑ member delta; stock = ∑ member cumulative). Org `stock_est` is also ≥ 0 because it sums clamped member stocks.

### 2.7 `heatmap/{year|month}/{period}.json`

Site-level totals ("burst day/month").

```json
{ "meta": { "scope": "month", "period": "2024-10", "generated_at": "..." },
  "cells": [ ["2024-10-01", 82000], ["2024-10-02", 91000] ] }
```

- `heatmap/month/2024-10.json` → each day's total for that month (calendar heatmap).
- `heatmap/year/2024.json` → that year's 12 month totals (month cells on the year page); `cells` uses `["2024-10", total]`.
- Daily totals for the in-progress current month come from `current_month.json`, and the build merges them.

### 2.8 `live/generations/{run_id}/current_month.json` (live tail——written by the Vercel cron)

The `month` field is a `MonthPeriod`; the `updated` / `daily_totals` / `per_repo` date fields are `DateStr`.

Production `current_month` exceeds the Next.js Data Cache 2MB entry limit by month end (after `JSON.stringify` escaping; measured on 2026-08-23, the monolith was about 1.90MB raw / 2.13MB cache entry). A new generation is written as **an index + 32 repo shards**, and pages/cron assemble them and then use them as the original `CurrentMonth`. A reader also accepts the old monolith file.

**v2 index** (`current_month.json`, KB-scale):

```json
{
  "schema_version": 2,
  "month": "2026-08", "updated": "2026-08-23",
  "daily_totals": [ ["2026-08-01", 80000], ["2026-08-23", 76000] ],
  "shard_count": 32
}
```

**v2 shard**（`current_month/shards/<bucket>.json`，`bucket = repo_id % 32`）：

```json
{
  "schema_version": 2, "bucket": 1,
  "per_repo": { "1296269": [ ["2026-08-01", 30], ["2026-08-23", -5] ] },
  "current_stars": { "1296269": 207000 }
}
```

**v1 monolith** (already-published generations remain readable):

```json
{
  "month": "2026-05", "updated": "2026-05-29",
  "daily_totals": [ ["2026-05-01", 80000], ["2026-05-02", 76000] ],
  "per_repo": { "1296269": [ ["2026-05-01", 30], ["2026-05-02", -5] ] },
  "current_stars": { "1296269": 207000 }
}
```

- Within the current month, **append-only + upsert by UTC day** (idempotent, see [OPS.md](./OPS.md)).
- When the same UTC day is rerun, the start-of-day baseline is rebuilt from `current_stars - recorded today delta`, then the full that-day delta is computed from the latest GraphQL number; the same input produces the same day state, and later growth or pullback still keeps the full difference relative to the start of the day.
- GitHub may return partial data for a deleted/renamed repo. Cron explicitly supports this kind of partial publication: it updates only repos that returned successfully, and a missing repo's `per_repo` today value and `current_stars` are kept as-is; if a non-reuse path gets no repo back at all, it fails closed and does not overwrite live state.
- `current_stars`: each day's latest authoritative GraphQL value (also used for anchoring).
- The `current_stars` map contains only active repos; an already-dropped repo's existing `per_repo` daily series is kept for the month-end fold, but no further GraphQL request is sent for it, and it does not enter the current rank.
- The daily/weekly Vercel cron writes the live tail, the current week/month rank, and the current-month heatmap inside the same immutable generation; it switches `live/latest.json` only after every object and `manifest.json` are written and pass schema. Base `rank/*` / `heatmap/*` are not overwritten by cron, to avoid merging the live tail twice. **Folding into `canonical/v2` month/week shards at period close-out** (not Parquet) is carried by Vercel Workflow shards (the month+week fold is `fold.ts`, see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6/§7.2); handoff relies on `canonical/v2/pending/<period>.json` + the in-generation `rollover/<period>.json` recovery copy + the `folded_through` watermark to prevent duplication or lost data.

### 2.9 `live/generations/{run_id}/hot-snapshot.json` (written by cron, read by hot-set ISR)

KB-scale; a hot-set ISR page **reads only it**, and never loads a large file.

```json
{
  "generated_at": "2026-05-30T03:00:00.000Z",
  "freshness": {
    "current_month": "2026-07-17T03:00:00.000Z",
    "current_year": "2026-05-30T03:00:00.000Z",
    "year_spine": "2026-05-30T03:00:00.000Z",
    "on_this_day": null,
    "all_time": "2026-07-17T03:00:00.000Z"
  },
  "home": {
    "year_spine": [ ["2015", 1200000], ["2016", 1800000] ],
    "current_month_top": { "flow": [ {"rank":1,"id":1296269,"value":1234} ], "stock": [ ... ] },
    "on_this_day": [ { "id": 1296269, "crossed": "10k", "date": "2016-05-29" } ]
  },
  "current_year": { "...": "same rank items subset" },
  "current_month": { "...": "" },
  "all_time": { "repo": [ ... ], "org": [ ... ] }
}
```

`freshness` is each section's source-as-of, and `null` means the writer cannot prove that
the section is currently valid; a legacy flat snapshot may temporarily lack this field. `generated_at` is, among known
sections, the most conservative time, and must not pass off a carry-forward old `year_spine` /
`current_year` as this refresh. When cron has a year rank/heatmap base it uses
base + the current month to recompute; `on_this_day` that cannot be recomputed keeps only entries matching this UTC month-day,
otherwise it publishes an empty array and `freshness.on_this_day=null`.

### 2.9a `live/latest.json` + generation manifest (atomic live publish)

`live/latest.json` is the only mutable live control object, and it stores both the current complete generation and
a 15-minute lease. Both lease acquisition and the final publish use Blob ETag CAS; acquiring the lease only changes
`lease`, and does not change `generation`, so a reader always sees either the old complete version or the new complete version.

```json
{
  "schema_ver": 1,
  "generation": "daily-2026-07-17T03-00-00-000Z",
  "run_id": "daily-2026-07-17T03-00-00-000Z",
  "idempotency_key": "daily:2026-07-17",
  "job": "daily",
  "day": "2026-07-17",
  "month": "2026-07",
  "week": "2026-W29",
  "published_at": "2026-07-17T03:02:00.000Z",
  "previous_generation": "daily-2026-07-16T03-00-00-000Z",
  "lease": null
}
```

While running, `lease={run_id,idempotency_key,job,acquired_at,expires_at}`; before the first publish,
`generation` and the publish metadata may be `null`. The manifest repeats the run/period metadata above and
lists every relative `files[]` inside the generation. The default idempotency key is `<job>:<UTC-day>`;
the same key running→attached, committed→returns what is already published, and a different key while active→409.
An object write or validation failure leaves only an unreferenced orphan generation, and the pointer is unchanged; revalidate
and IndexNow must run only after the pointer CAS succeeds.

A generation is a complete snapshot of "this publish's file set", and it does not copy period files that have not yet been folded.
So, after a periodic rank / heatmap reader confirms 404 for the current object, it follows each manifest's
`previous_generation` and walks back at most 64 generations; every generation is checked for schema, generation id,
`files[]`, acyclicity, and depth. If an object the manifest has listed is 404, or there is a manifest/transport/schema
error or a cycle, it still fails closed. When the requested week/month is **newer than** the current hop's
`manifest.week` / `manifest.month`, walking stops immediately (an older generation cannot have that period), and it may use
the legacy flat migration edge. When the scan hits the 64-generation cap and has not yet reached
`previous_generation:null`, it **truncates to missing** (returns null, does not 500, and does not guess
legacy). Only when a valid chain reaches `null` may it look up migration-period flat `live/*`. `current_month` and
`hot-snapshot` do not use the history chain, so an older generation's snapshot is not passed off as the current state. When the public CDN, under high-concurrency
SSG, keeps returning 403, a page read tries the same historical object at most 2 times, and after a 60-second circuit break by Blob/key
stops the live chain and falls back to base / `notFound` (it does not select an older generation); the circuit break recovers automatically, and the required
product gate still judges that transport failure as a failure.

### 2.10 `ops/sync-runs.json` (cron run records)

A lightweight operations log; overwritten by the Vercel cron, keeping the most recent 100 runs.

```json
{
  "generated_at": "2026-06-02T00:00:00.000Z",
  "runs": [
    {
      "id": "daily-2026-06-02T03-00-00-000Z",
      "job": "daily",
      "status": "ok",
      "dry": false,
      "started_at": "2026-06-02T03:00:00.000Z",
      "finished_at": "2026-06-02T03:02:11.000Z",
      "duration_ms": 131000,
      "result": {
        "day": "2026-06-02",
        "month": "2026-06",
        "week": "2026-W23",
        "polled": 5249,
        "generation": "daily-2026-06-02T03-00-00-000Z",
        "previous_generation": "daily-2026-06-01T03-00-00-000Z",
        "writes": [
          "live/generations/daily-2026-06-02T03-00-00-000Z/current_month.json",
          "live/generations/daily-2026-06-02T03-00-00-000Z/hot-snapshot.json",
          "live/latest.json"
        ]
      }
    }
  ]
}
```

### 2.11 `views/latest.json` — publish pointer

The read side resolves the currently effective view-version prefix from this; switching the pointer = atomic publish / rollback (see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7).

```json
{
  "version": "2026-06-02T04-00-00Z",
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "published_at": "2026-06-02T04:03:11.000Z",
  "prev_version": "2026-05-26T04-00-00Z",
  "schema_ver": 1
}
```

- The read-side pointer fetch carries the `published-views-pointer` cache tag; it resolves `version` → and reads the immutable `views/<version>/**` (it falls back to the flat layout when there is no pointer). publish / rollback actively invalidate the tag + the root layout, and memos on other warm instances are also bounded by the 60s SLA.
- Rollback must go through the fenced rollback API / `rollbackVersion()`, and must not be only a hand edit of Blob; it syncs recovery, the published whitelist pointer, and cache invalidation.
- Before publish, first write the immutable `ops/workflows/<run_id>/publish-intent.json`; it pins the `prev_version` observed the first time, so a retry after a partial success does not create a self-referential rollback.

### 2.11a `bootstrap/latest.json` — cold start generation pointer

The one-shot `pipeline/backfill` does not directly overwrite any live views / canonical objects. `06-upload` and `07-export-v2` first create-only write `bootstrap/generations/<generation>/**`; the two phase manifests each record, for that phase, every object's logical path, byte count, and SHA-256. This pointer is overwritten as a single file only after the remote per-object recheck, the local Zod validation, and the shared Workflow lease all pass.

```json
{
  "schema_ver": 1,
  "generation": "bootstrap-20260717T120000Z",
  "prefix": "bootstrap/generations/bootstrap-20260717T120000Z",
  "previous_generation": "bootstrap-20260710T120000Z",
  "published_at": "2026-07-17T12:10:00.000Z",
  "base_manifest_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "canonical_manifest_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

- `generation` must match `^bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$`; `prefix` must be strictly equal to `bootstrap/generations/<generation>`.
- Both manifest digests are 64-character lowercase hex; the pointer uses a strict Zod object, and unknown fields are rejected.
- `previous_generation:null` is the explicit `legacy-flat` recovery edge. The first commit must, inside the shared lease, validate legacy `meta` / lookup / all-time rank and all `4 × 32` canonical shard families; `--rollback legacy-flat --execute` rechecks these mutable artifacts inside the same lease and then atomically deletes the pointer. A retry of the same command after a successful delete whose response was lost is a no-op success.
- A base read reads the bootstrap pointer only after the managed pointer successfully returns a version, and uses the newer complete generation by `published_at`; therefore a new bootstrap commit / rollback can switch base + canonical at once, and a later updated managed publish takes base back over. If the managed pointer times out, fails with a non-404, or has an unusable shape, it fails safe, keeps legacy flat, and does not query bootstrap, to avoid jumping to an old generation by mistake; bootstrap is queried only when the managed pointer is an explicit 404, and if bootstrap is also an explicit 404 it keeps using legacy flat.
- A canonical read checks `bootstrap/overlays/<generation>/canonical/**` first, and falls back to the sealed generation when the object does not exist; a canonical writer writes only the overlay and does not overwrite the generation. `previous_generation` therefore restores both the old seed and its overlay.
- A resume of the same generation must be byte-identical; if validation / upload / the active lease fails, the pointer is unchanged. A generation rollback rechecks the sealed target before the lease, then rereads the pointer inside the lease; a legacy rollback's target validation must finish inside the lease.

### 2.12 `ops/workflows/{run_id}/manifest.json` + `steps/{step}.json` — Workflow checkpoint

A business-readable run-progress ledger (the orchestration runtime advances it with a Queue / HTTP chain; it no longer depends on Workflow SDK persistence).

```json
// manifest.json
{
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "started_at": "2026-06-02T04:00:00.000Z",
  "status": "running",                          // running | published | failed
  "steps": ["preflight","whitelist","rename","metadata","fold","recompute","buildAliases","validate","publish","gc"],  // manifest grouping (fine-grained steps are in VERCEL-DATA-OPERATIONS §4)
  "published_version": null
}
```

> `steps[]` is the **manifest grouping** (10 items, corresponding to the progress ledger, including the read-only `preflight` and the real `buildAliases` phase); the **fine-grained 13 steps** (preflight/whitelist/rename/metadata/fold/rank/repo-entities/org-entities/heatmap/aliases/validate/publish/gc) are in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4. The orchestration runtime also writes `ops/workflows/<run_id>/steps/<step>.json`; metadata also writes a mutable `metadata-<bucket>.json` (GraphQL batch progress; a 502 continues the same hop); `validate` also writes `canonical-manifest.json` (the path, bucket, record count, SHA-256, and integrity conclusion of every required canonical shard) and `validation.json`, and the other run-level ledgers include manifest / error / latest-success / `latest-unpublished-whitelist.json`.

`ops/workflows/active.json` is the mutual-exclusion lease for refresh / rollback. Both the start route and the executor update it with a Blob ETag conditional write; takeover increments `fencing_token`. The lease expires after 30 minutes, and a long write heartbeats every ≤5 minutes; before writing canonical, a checkpoint, or the publish pointer, both `run_id` and the token must be checked.

```json
{
  "run_id": "refresh-2026-06-07T06-00-00-000Z",
  "status": "running",
  "acquired_at": "2026-06-07T06:00:00.000Z",
  "expires_at": "2026-06-07T06:30:00.000Z",
  "fencing_token": 12,
  "idempotency_key": "workflow-refresh:2026-W23",
  "trigger": "manual-or-cron"
}
```

#### 2.12.1 `ops/workflows/health/{pipeline}.json` — independent health status

`pipeline` is fixed to `workflow-refresh`, `cron-daily`, or `cron-weekly`. Each pipeline uses its own object and ETag compare-and-set, so concurrent runs do not overwrite each other. The only operator signal at Sunday 06:00 is `ops/workflows/health/workflow-refresh.json`. The retired flat `ops/workflows/health.json` **must not be read** (a Jul 2026 success record may still be hanging after a later stall).

```json
{
  "schema_version": 2,
  "pipeline": "cron-daily",
  "status": "ok",
  "at": "2026-07-17T03:02:11.000Z",
  "correlation_id": "daily-2026-07-17T03-00-00-000Z",
  "run_id": "daily-2026-07-17T03-00-00-000Z",
  "idempotency_key": null,
  "error": null,
  "last_success": { "at": "2026-07-17T03:02:11.000Z", "correlation_id": "daily-2026-07-17T03-00-00-000Z", "run_id": "daily-2026-07-17T03-00-00-000Z", "idempotency_key": null, "error": null },
  "last_failure": null,
  "freshness": { "last_success_at": "2026-07-17T03:02:11.000Z", "expected_within_seconds": 129600, "stale_after": "2026-07-18T15:02:11.000Z" }
}
```

- `status` is the latest time signal (`ok | failed | attached | rejected`). An older late write must not roll latest backward.
- `last_success` and `last_failure` are kept independently; a successful recovery does not erase the previous failure's diagnosis.
- `freshness.stale_after` is an absolute time computed from the pipeline frequency, so a reader does not need to trust the static age value from write time.

```json
// steps/recompute.json
{
  "step": "recompute", "status": "ok",          // ok | running | error
  "started_at": "...", "finished_at": "...",
  "shards_done": 32, "files_written": 4120,
  "error": null
}
```

`ops/workflows/latest-success.json` = `{ "run_id": "...", "version": "...", "published_at": "..." }` (recovery point).

`ops/workflows/<run_id>/publish-intent.json` is immutable retry state:

```json
{
  "operation": "publish",
  "run_id": "refresh-2026-06-07T06-00-00-000Z",
  "version": "refresh-2026-06-07T06-00-00-000Z",
  "prev_version": "refresh-2026-05-31T06-00-00-000Z",
  "published_at": "2026-06-07T06:18:00.000Z",
  "fencing_token": 12
}
```

A retry of the same operation must replay that object; it must not reread the pointer and then overwrite `prev_version`. `operation` may also be `rollback`.

### 2.13 `ops/workflows/{run_id}/validation.json` — validation report

Step `validate` runs Zod + sanity on `views/<run_id>/**`, and runs schema / ID / anchoring integrity on every required canonical bucket; it also checks repo key/id/bucket, that time series are non-empty, and that there is no orphan repo ID; if `ok=false` it does not switch the pointer.
**`checked` = the sample-read count of key derived views + the count of every required canonical shard**. Derived views are still spot-checked for `meta` / `rank/all-time` / lookup / search / categories / the top-repo entity / last year's heatmap; canonical `repos`, `repo-monthly`, `repo-weekly`, and `repo-recent-daily` are read in full, bucket by bucket, and `canonical-manifest.json` is written as well.

```json
{
  "run_id": "...", "ok": true,
  "checked": 6, "schema_failures": 0,
  "invariants": { "ranks_sorted": true, "org_eq_members": true, "drift_pct": 0.3 },
  "failures": []
}
```

### 2.14 `search/index.json` — client site-wide search

A compact search index that recompute derives from the `repos` dimension (one entry per repo; the head of the description is truncated to 200 characters to control size). It is written with the entity/org step to `views/<run_id>/search/index.json` and included in `validate` (which asserts the entry count ≥ a threshold). The client `SearchBox`, on first focus, lazy-loads it and builds a MiniSearch index (typo tolerance + prefix + weighted by stars), with **zero runtime backend**; the read side resolves the publish pointer on the server through the `/search-index` route and reads the versioned artifact. The endpoint method, cache, fallback, and status contract are in [API.md](./API.md). The schema is `SearchIndex`/`SearchDoc` (`web/lib/contracts/search.ts`).

```json
{
  "generated_at": "2026-06-02T00:00:00.000Z",
  "count": 5302,
  "repos": [
    { "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "language": "JavaScript",
      "current_stars": 207000, "description": "...", "active": true, "tracked_since": null }
  ]
}
```

> **The monthly narrative has no independent artifact**: ranking-page narrative is a **deterministic template**, assembled **at render time** from that month's rank data (top/growth rate/newcomer) (`web/lib/narrative.ts`), **not written to Blob and not using AI**. So there is no `narrative/*` contract here.

### 2.15 `/repo-curve?id=<id>` — multi-repo compare slim route (no independent artifact)

Multi-repo compare (`/compare`) needs the browser to fetch several repos' curves **on demand**. **No new Blob artifact is created**: `app/repo-curve/route.ts` reads the versioned `entity/repo/<id>.json` (§2.5) on the server through the publish pointer, **projects** the slim payload compare needs, and returns it. The endpoint method, query, cache, and error status contract are in [API.md](./API.md). The schema is `CompareCurve` (`web/lib/contracts/compare.ts`):

```json
{ "id": 10270250, "full_name": "facebook/react", "current_stars": 232000, "crossed_10k": "2014-09-15", "points": [["2014-01", 9800], ["2014-02", 10400]] }
```

`points = [period, total_end][]` (takes the cumulative column of the entity `curve.monthly`); `crossed_10k` comes from `entity.milestones.crossed_10k`, for "align to 10k" x-axis remapping. **So there is no `compare/*` or `curve/*` Blob contract here**——it is a read-only projection of the entity, and the offline parity set is unchanged.

---

## 3. Version / cache / atomicity

- **Atomic switch**: cold start writes the sealed `bootstrap/generations/<generation>/**` → validate → updates `bootstrap/latest.json` (§2.11a); a recurring base publish writes `views/<run_id>/...` → validate → updates `views/latest.json` (§2.11); a live publish writes `live/generations/<run_id>/...` → manifest → a fenced CAS updates `live/latest.json` (§2.9a). All three paths have only one logical commit point, and the read side consumes only the immutable complete version the pointer points at.
- `meta.schema_ver`: a breaking schema change bumps it, the build checks version match at startup, and it fails fast on a mismatch.
- The live pointer's 60s short cache may read the previous complete generation, but it will not read a mixed generation; on a non-404 pointer error the read side uses the cached old generation or fails closed, and only a real 404 allows the migration-period flat fallback.

## 4. Type source (single source of truth)

Every artifact is defined with a Zod schema in `web/lib/contracts/` (schemas for canonical shards / workflow checkpoints / the publish pointer also live here):

- After bootstrap / Workflow produces each JSON, it **validates** it with the corresponding schema (dirty data is not published and does not switch the pointer, see TESTING §1.2/§1.3).
- When the build / runtime reads, `schema.parse(json)` → yields a typed object; the type is inferred from Zod, and **no separate interface is written**.
- Changing the schema = changing Zod = changing the contract, the validation, and the types at the same time——the three cannot drift.
