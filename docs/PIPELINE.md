---
owner: bootstrap pipeline
status: active
last_reviewed: 2026-07-17
source_of_truth_for:
  - one-off bootstrap pipeline
  - archived backfill algorithms
---

# gitstarclub data Pipeline

> How the artifacts defined by [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) are produced. This document focuses on the **one-off bootstrap pipeline**: seeding `canonical/v2/**` and `views/**` out of a blank system from zero. Day-to-day recurring refresh is carried by Vercel Workflow, and the local machine does not take part.
>
> Architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md), and operations/credentials are in [OPS.md](./OPS.md).

## Scope

This document describes the **bootstrap pipeline**: it runs once, executed from the developer's machine, in order to seed `canonical/v2/**` and `views/**` out of blank. Scripts under the `pipeline/` directory are an archived form——they have already been run once, are no longer triggered in day-to-day operations, and are executed again only in the following cases:

- The first cold start of a new environment
- Disaster rebuild (Blob lost in full)
- A new data source is introduced, and the historical baseline needs to be regenerated

**Day-to-day recurring data refresh (whitelist / metadata / canonical fold / full recompute / publish / rollback) all runs on Vercel Workflow**——see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md). The local environment and the BigQuery / DuckDB engines **do not take part** in the day-to-day path, and also **should not** be stuffed into a single Vercel Function (subject to the 800s / 4GB / 250MB limits).

Ordinary Vercel cron is responsible only for JSON incremental refresh; engine-class full recompute is carried by a multi-step Vercel Workflow.

## 0. Roles and environments

| Stage | Where it runs | What it uses | Trigger |
|---|---|---|---|
| One-off bootstrap (this document §1) | Local machine / full Node | BigQuery (once) + DuckDB + GraphQL → JSON | Run once manually |
| Daily cron (this document §2) | Vercel Function | GraphQL + JSON live tail (**does not touch DuckDB/Parquet**) | Vercel Cron `0 3 * * *` |
| Weekly cron (this document §3) | Vercel Function | GraphQL + JSON incremental overwrite of the current week/month/hot set | Vercel Cron `0 4 * * 0` |
| Production recompute (this document §4) | **Vercel Workflow** | Multi-step + Blob checkpoint + JSON shard (**no engine**) | Vercel Cron `0 6 * * 0` / manual |

Credentials: `GITHUB_TOKEN` (GraphQL/Search), GCP (**bootstrap only** BigQuery), `BLOB_READ_WRITE_TOKEN` (upload), `CRON_SECRET`. See OPS.

---

## 1. One-off bootstrap (`pipeline/backfill/`, run once manually)

> **Demotion notice**: this section is a one-off tool for the **first cold start / disaster rebuild**, and it is **not a day-to-day operations runbook**. After the JSON views + canonical it produces are uploaded to Blob, Vercel (§2/§3 live cron + §4 Workflow) takes over recurring refresh. **Day-to-day operations have 0 local dependencies.** These scripts are not deleted, but they are run manually only when a new data source is introduced / the baseline is rebuilt.

```text
01-whitelist → 02-extract(BigQuery) → 03-metadata(GraphQL)
            → 04-rollup(DuckDB) → 05-precompute(DuckDB)
            → 06-upload(immutable base phase)
            → 07-export-v2(immutable canonical phase → validate → one pointer commit)
```

**01 whitelist** — GitHub Search `stars:>=MIN_TRACKED_STARS` (default `web/lib/constants.ts` = 10,000; runtime `MIN_TRACKED_STARS` may override it, and preview wrangler `env.pre` = 1,000) only does membership discovery. First query the current highest star with an open upper bound, then **adaptively bucket** by star range against that dynamic upper bound to get around the Search 1000-result cap (if a range is >1000, bisect); there is no fixed 600k cap. When preview `WHITELIST_SEARCH_SHARDS=1`, the Search queue is digested hop by hop (default 10 min / hop), and progress is written to `ops/workflows/<run_id>/whitelist-search.json`, so that a single isolate does not hit the `gitstarclub-jobs-pre` 15 min Queue wall; unset / `0` is still a single hop. Output `data/whitelist.json`: `{id, node_id, full_name, owner, name, stars}`; the Search `stars` there is a discovery audit value, not the displayed total. The default ≥10k scale is about 5.3k, and it changes weekly.

> **Newcomer baseline (the first v2 run)**: the Workflow whitelist step (`whitelist.ts:24-28`) uses the id set of `canonical/v2/whitelist/latest.json` as the newcomer diff baseline; **when that pointer does not yet exist on the first run, it falls back to the id set of bootstrap `lookup/repos.json`**——otherwise the first run would misjudge every existing repo as a "newcomer". After that, each run writes `latest.json` back as the next run's baseline.

**02 extract (BigQuery, ~$10)** — first `--dry_run` to confirm scan volume/cost, then run:
```sql
SELECT repo.id AS repo_id, DATE(created_at) AS day, COUNT(*) AS gross_adds
FROM `githubarchive.day.*`
WHERE _TABLE_SUFFIX BETWEEN '20150101' AND '<seam_date>'
  AND type = 'WatchEvent' AND repo.id IN UNNEST(@whitelist_ids)
GROUP BY repo_id, day;
```
Includes a stable `repo.id` (rename consolidation), and exports Parquet to the local machine.

**03 metadata (GraphQL)** — `nodes(ids:[node_id])` fetches in batches of 100/query `owner.login + owner.__typename + name + description + primaryLanguage + languages + repositoryTopics + createdAt + stargazerCount(=current_stars) + isArchived` → the `repos` dimension (DATA-CONTRACTS §1.2).

**04 rollup (DuckDB)** — read the Parquet from 02:
- Land `canonical/star_daily.parquet` (`repo_id, date, delta=gross_adds`).
- **Milestones**: for each repo, accumulate `delta` by `date`, and take the date when the cumulative total first reaches ≥10k/50k/100k → `repos.crossed_*`.
- **daily_totals**: `GROUP BY date SUM(delta)`, at site level.

**05 precompute views (DuckDB)** — following the ranking matrix and the entity rollup, produce every JSON view (rank/entity/heatmap/lookup, DATA-CONTRACTS §2). **stock anchoring** and the definitions are in [RANKING.md](./RANKING.md).

**06 upload (Blob, staging only)** — first validate `views/**` with the authoritative Zod contracts, then write `star_daily.parquet` + `lookup/*` + `rank/**` + `entity/**` + `heatmap/**` + `meta.json` create-only into `bootstrap/generations/<generation>/**`. Neither objects nor the phase manifest may be overwritten; a byte-identical rerun of the same generation validates the objects already present and resumes. This step **never modifies the production pointer**. Batched `put()` is **throttled <75/s** (the OPS Blob rate limit).

**07 export-v2 (DuckDB → canonical/v2 JSON shards → atomic commit)** — **fold + bucket** the 8M-row daily table of §1.1 into `canonical/v2/{meta,repos,repo-monthly,repo-weekly,repo-recent-daily,site-daily}/...` JSON shards (`<bucket>=repo_id % N`), so that Vercel Workflow can recompute with no engine. Freeze `repos.d` (the stock anchoring factor, IEEE double at full precision, `>= 0` and it may be `> 1`) + the milestone `crossed_*`; the fold watermark is written to `folded_through` of `canonical/v2/meta.json`. This step create-only stages the canonical phase, re-validates the local views + all 128 required canonical shards, checks the remote SHA-256 object by object, and acquires the shared Workflow CAS lease; at the end it **overwrites only one `bootstrap/latest.json`**. Any upload / validation / lease failure does not cut over production. See [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6 and [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §1.4.

```bash
cd pipeline
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
GEN=bootstrap-20260717T120000Z

# Preflight only; do not upload
node backfill/06-upload.mjs --generation "$GEN" --dry-run

# create-only stage / resume the same generation from a breakpoint
node backfill/06-upload.mjs --generation "$GEN"

# Export + stage canonical; when you need to stop and inspect before commit, add --stage-only
node backfill/07-export-v2.mjs --generation "$GEN" --stage-only

# Re-running the same command rechecks and resumes, and cuts the pointer once after every check passes
node backfill/07-export-v2.mjs --generation "$GEN"

# When previous_generation is a generation, specify that generation explicitly
node backfill/07-export-v2.mjs --rollback bootstrap-20260710T120000Z --execute

# The first publish's previous_generation:null is explicitly defined as legacy-flat
node backfill/07-export-v2.mjs --rollback legacy-flat --execute
```

---

## 2. Daily cron (`web/app/api/cron/daily`, JSON-only, idempotent)

```text
1. Validate Authorization: Bearer CRON_SECRET (otherwise 401)
2. From `lookup/repos.json` select only `active:true`, and GraphQL batch-queries current_stars (100 repos per batch)
3. net daily add = today's current_stars − yesterday's value in current_month.json
4. upsert current_month.json: write daily_totals + per_repo + current_stars by UTC day (append-only, idempotent)
5. Pick the mover set (deltas are already in hand, free): today's top ~50 by gain ∪ (today ≥ 5× its 90d daily average and the same-day net add ≥200) ∪ milestone crossed
6. Recompute hot-snapshot.json + `/pulse` data (including spike/revival) → Blob
7. revalidatePath: the core hot set (home/current year/current month/rankings/pulse) + **the mover set's repo/org pages**
   (entities that did not move + all history are not touched at all)
```

- The whole path is fetch + JSON, and it **does not touch Parquet/DuckDB**; it takes seconds.
- Idempotent: running again on the same day = overwrite that same day with the same batch of GraphQL results, without accumulating twice (OPS: cron has no retry, and may fire twice).
- First-day boundary: when `current_month.json` does not exist or the month has rolled over, initialize a new month.

---

## 3. Weekly cron (Vercel Function, `web/app/api/cron/weekly`)

```text
1. Validate Authorization: Bearer CRON_SECRET
2. Use GraphQL to batch-refresh current_stars only for `active:true` repos
3. upsert current_month.json
4. Overwrite-write the current month's repo flow/stock, the current week's repo flow, the current month's heatmap, and hot-snapshot
5. revalidatePath the core pages and the current week/month pages
6. Write an ops/sync-runs.json record
```

- Dropping out of ≥10k, a newcomer backfilling multiple years of history, and all-time/entity history recompute: these are not synchronous steps of ordinary cron, and are handed to §4 Workflow.
- Renames: the live refresh of Vercel cron still follows the existing lookup; a full metadata refresh updates lookup only after it enters Workflow shards, and the old URL is 308'd by the web layer.

---

## 4. Vercel Workflow production pipeline

> The full design is in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md). What follows is the **correspondence** with the §1 bootstrap: that §1 local chain has already been moved onto Vercel Workflow, and it **does not depend on local compute**.

| §1 bootstrap step (local) | → | §4 Workflow step (Vercel) |
|---|---|---|
| 01-whitelist (Search) | → | step `refresh whitelist` (Search adaptive bucketing + diff) |
| 03-metadata（GraphQL） | → | step `metadata shards` → `canonical/v2/repos/<bucket>.json` |
| — (added) | → | step `rename detection` + `newcomer tracking` (`tracked_since`) |
| 04-rollup (DuckDB → Parquet + milestones) | → | step `canonical shard update` (the live tail is folded into month/week JSON shards; milestones are frozen after bootstrap computes them) |
| 05-precompute (DuckDB → every JSON view) | → | steps `rank / entity / heatmap recompute` (read JSON shards, pure JS aggregation → `views/<run_id>/**`); the entity/org step (`recompute-entity.ts`) derives `search/index.json` and it joins the validate gate |
| — (added) | → | step `build aliases` (`aliases.ts`): the union of the `renames.json` increments of every retained run → `views/<run_id>/lookup/aliases.json`, for 308 redirects of old renamed URLs |
| 06-upload (Blob put throttling) | → | steps `validate → publish (cut the views/latest pointer) → gc (version reclamation) → revalidate` |

**Key differences**:
- **No engine**: a Workflow step reads `canonical/v2/*` JSON shards and, in pure JS, does prefix sums / grouping / sorting, and **does not load DuckDB / Parquet** (see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5).
- **Shards + checkpoint**: each step is short and idempotent, and progress is written to `ops/workflows/<run_id>/steps/<step>.json`; a failure affects only that version's prefix `views/<run_id>/`, and does not cut the live pointer.
- **Publish = cut the pointer**: write `views/<run_id>/**` (version=run_id) → validate → cut `views/latest.json` → revalidate; rollback can happen in seconds.
- **Do not do a 16k full build**: publish only revalidates the core hot set, and the long tail is on-demand ISR.

The §3 weekly live cron and the §4 Workflow are prefix-isolated and each does its own job (live overlay vs base publish layer), so week-level refresh does not gap.

---

## 5. Key algorithms

- **Milestones**: the first day `repo cumsum(delta)` crosses a threshold (computed once at backfill, then frozen).
- **stock historical anchoring**: gross accumulation × anchoring factor `d` aligned to `current_stars` —— the formula and the precision boundary are in [RANKING.md](./RANKING.md).
- **Period boundaries**: week = ISO week (UTC); month/year = UTC calendar boundaries. A week does not divide a month evenly, so canonical must be **day** grain (see the ARCHITECTURE decision).
- **Fold aging**: when the current month closes → days aggregate into monthly (entity `curve.monthly`). An **ISO week** is folded into `repo-weekly` after every day it belongs to has fallen inside an already-frozen month (at the same time as the month fold, in the same `fold` step, watermark `folded_through.week`; a week that crosses months takes its daily aggregate from the two months' pending). ⚠️ **`repo-recent-daily` does not age at present**: it is seeded once by bootstrap (`07-export-v2`), and the recurring `fold` (`fold.ts`) folds only the month/week rollup + site-daily, and **does not read, write, or trim** recent-daily (`web/lib/` has no writer, only the reader `io.ts:53`); the rolling aging of "keep daily points for the recent ~90 days, and roll anything older into monthly" is **not yet implemented** (xref issue #3).

## 6. Idempotency / errors / reruns

- Every step can be rerun: for the same generation, bootstrap rechecks byte count + SHA-256 object by object and creates only the missing objects; once a phase manifest is written it is sealed, and inconsistent content fails closed. A Workflow step is idempotent by `(run_id, shard)` ([VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §8).
- **bootstrap atomicity**: `06` does not publish; `07` cuts the single file `bootstrap/latest.json` only after both remote phases are complete, both local validators pass, and the `ops/workflows/active.json` CAS lease has been acquired. The first commit also verifies, inside the lease, the legacy flat base/canonical recovery artifacts that bootstrap did not rewrite; `previous_generation:null` means an executable `legacy-flat` rollback target. The generation body is never overwritten; recurring canonical writes are bound to that generation's copy-on-write overlay, and the old generation + overlay can roll back directly.
- **Versioned artifacts**: Workflow publish writes `views/<run_id>/` (version=run_id) → cuts the `views/latest.json` pointer (keeping `prev_version`), and bad data only has to be pointed back at the previous version (OPS rollback).
- **Validation gate**: after the JSON is produced, run the Zod schema + sanity invariants (TESTING §1.2/§1.3); if they do not pass, do not publish and do not cut the pointer.
- **Failure rests on verifiable state** (Vercel Function logs + an optional webhook + `sync-runs` + `ops/workflows/**`); the repository currently has no Sentry integration. A Workflow step retries on its own, and across quota it waits with `sleep` instead of spinning.
