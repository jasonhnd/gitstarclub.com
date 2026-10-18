# Production rollout and data repair plan

Status: draft for owner decision. References #543 (P0, open). Closes nothing.
Order: SB-20261018-09. Section B revised by GSC_0030 on 2026-10-18. GSC_0029 review findings are applied in this revision.

This plan stops before any production deploy, secret change, cron change, or R2 or Blob write. It is built from the accepted diagnosis on GSC_0017, `docs/OPS.md`, `docs/R2-CUTOVER.md`, `docs/PIPELINE.md`, the repository code, and unauthenticated public GETs. `wrangler` is not authenticated on the authoring machine. Anything that needs live Cloudflare state is marked **to verify by operator**.

Section B was revised by GSC_0030 on 2026-10-18 after a read-only look at `gs://gitstarclub-backfill-746384388303/star_daily_gross/` (20 Parquet files, the 2026-05-30 BigQuery export). History through 2026-05-29 comes from that backup. Only 2026-05-30 onward is a new extract. Costs below are estimates from `bq query --dry_run` (bytes billed 0).

## 0. Starting state

| Item | State | Evidence |
|---|---|---|
| Production code | `daee5fc` (deployed 2026-10-04) | `GET https://gitstarclub.com/.well-known/deployment` |
| Preview code | `5af183a` | same endpoint on `pre.` |
| Latest code | `origin/main` is `99cb00e`. On 2026-10-18 that tree matched `origin/pre` `eb24ac8`. Checked again for this revision: `origin/pre` is `ba45fc0`, two commits ahead (`210f704` #658, `ba45fc0` #662 / #665). Section A still deploys `main`. Confirm the SHA in A2.1. | `git rev-parse origin/main origin/pre`; `git log --oneline origin/main..origin/pre` |
| Code delta `daee5fc..main` | 55 files. Worker behaviour: `web/lib/workers-host/edge-cache.ts`, the Worker src index.ts and env.ts, the `source-map-js` pin in `web/package.json` and `web/bun.lock`, plus two edge-cache tests (`web/lib/workers-host/edge-cache.test.ts` and `web/lib/workers-host/worker-entry.test.ts`). The same range also changes `pipeline/backfill/05-precompute.mjs` and `pipeline/backfill/07-export-v2.mjs`, and adds `pipeline/lib/backfill-data.mjs`. A Worker deploy does not ship those pipeline files. A B2 rebuild from this commit does. The rest of the 55 are docs and pipeline tests. | `git diff --stat daee5fc origin/main` |
| Schedules | none: top-level `triggers.crons: []`, `env.pre` `[]` | the Worker `wrangler.jsonc` under `workers/` |
| Production views pointer | `views/latest.json` and `bootstrap/latest.json` 404; pages live on `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` | `https://data.gitstarclub.com/...` |
| Production canonical | `canonical/v2/meta.json` 200 (`folded_through` month 2026-08, week 2026-W35, `seam_date` 2026-05-30); `repos/0..31` 200; `repo-monthly`, `repo-weekly`, `repo-recent-daily` 0/32; `pending/2026-08.json` 404; `site-daily/{2024,2025,2026}.json` 404; `whitelist/latest.json` 404; `star_daily.parquet` 404 | public GETs, GSC_0017 E4 and this card |
| Last refresh run | The 2026-09-13 generation is `views/refresh-2026-09-13T06-00-16-398Z/meta.json` (200). `ops/workflows/health/workflow-refresh.json` is 200, `last_success` is null, and the error is `canonical/v2/pending: missing required frozen period(s) 2026-08`. | public GETs |
| Old Vercel Blob store | **gone**: every key on `cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com` returns 404 with body `Store not found` (HTTP server: Vercel), including keys that still exist in R2 | this card |

Note on `site-daily`: the 404 probe used the documented key `canonical/v2/site-daily/<yyyy>.json` for 2024, 2025 and 2026. If confirmed by an operator R2 listing, `site-daily` and `whitelist/latest.json` are also missing, which widens P2. **To verify by operator.**

Problems from GSC_0017 used below: P1 no scheduler; P2 canonical shards missing; P3 fold gap (`pending/2026-08`); P4 no views pointer; P5 unverified secrets and bindings.

### Fold requirement, restated

`web/lib/workflows/steps/fold.ts`: the month phase reads `pending/<next month>`; a missing pending is non-fatal there (`pending_missing`). The week phase starts at the Monday after `folded_through.week` (2026-08-31, ISO week W36), so it needs `pending/2026-08` and throws when it is absent. Cold-start relaxation (empty frozen pending) arms only when `DEPLOY_ENV=pre`, so production can never fabricate it. Once September closed (2026-10-01), `pending/2026-09` is also wanted by the month phase, but its absence only skips the month.

## A. Code rollout: main to production Worker `gitstarclub-web`

Code rollout is independent of the data repair: it does not read or write R2 differently from `daee5fc` except for the new edge cache, and pages keep rendering the frozen fallback generation.

### A1. Decision and risk

* Benefit: picks up the `source-map-js` security pin (#655) and the Cache API edge cache (#652, live on preview since 2026-10-11).
* New behavior on production: `handleEdgeCachedNext` caches 200 GET responses with `s-maxage` for at most one day (`EDGE_CACHE_MAX_TTL_SECONDS`), keyed with `EDGE_CACHE_VERSION` (default `v1`), `VIEWS_VERSION_FALLBACK`, and the baked commit. `/api`, `/.well-known`, `/preview`, `/start`, `/enqueue` and authenticated requests bypass it. After any later data refresh, rotate `EDGE_CACHE_VERSION` in an authorized deploy or purge, otherwise stale pages can live for up to a day.
* Do not change `VIEWS_VERSION_FALLBACK` to bust the cache (gate allows only absent or the exact frozen value).

### A2. Pre-deploy checks [no auth]

1. Fresh detached checkout of the exact commit (`main` head at deploy time, today `99cb00e`): `git worktree add --detach ../gsc-verify <sha>`.
2. AGENTS.md bootstrap block, then the full static block (installs, audits, `lint:docs`, lint, three typechecks, `validate:views`, `test:cov`, fixture `bun run build`, fixture `cf:dry-run`). GitHub Actions is off by owner decision, so this local result is the gate. Record every result.
3. `node scripts/assert-runtime-versions.mjs` and `node scripts/assert-cf-ci-gates.mjs` on that commit.
4. Production data identity: `curl -fsS https://data.gitstarclub.com/_meta/bucket-identity.json` must be exactly `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
5. Pointer state: `views/latest.json` still 404 and `views/refresh-2026-09-13T06-00-16-398Z/meta.json` still 200. If a pointer now exists, stop and re-plan: the fallback and the build shell must be reconsidered per OPS.
6. Record rollback target (section A5) **before** deploying.
7. Capture a baseline of the current site for comparison: `/`, `/rankings`, one period page, `/react/react`, `/search-index`, `/robots.txt`, `/sitemap.xml` (status, size, a hash of the rendered ranking rows).

### A3. Production build shell [no auth for the build; deploy needs owner authorization]

Exactly per `docs/OPS.md`, from the clean checkout, no Blob variables:

```sh
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data.gitstarclub.com
export VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z
unset READ_DRIVER BLOB_BASE_URL NEXT_PUBLIC_BLOB_BASE_URL BLOB_READ_WRITE_TOKEN
# any NEXT_PUBLIC_R2_PUBLIC_BASE_URL must equal the production origin or be unset
bun run cf:build:production
```

Read the printed CF build identity SHA and confirm it equals `git rev-parse HEAD`. `.open-next` is shared with the preview build, so build immediately before deploying and never reuse an output from `cf:build:pre`.

### A4. Deploy [owner authorization needed: deploy]

Operator only, from `web/`, same checkout:

```sh
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env="" \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

Before running, **to verify by operator**: the live Worker's vars. A deploy without `--keep-vars` replaces dashboard-only variables with the file contents. Compare `wrangler versions view <current-version-id> --name gitstarclub-web` with `wrangler.jsonc` and carry over anything legitimate. Do not use `--keep-vars` to retain obsolete Blob vars. Secrets are not touched by `wrangler deploy`.
Required live inventory afterwards: one `DATA` binding to `gitstarclub-data-prod`, `MEDIA`, `ASSETS`, `WORKER_SELF_REFERENCE`, `JOBS` (`gitstarclub-jobs`), `DEPLOY_ENV=production`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_PUBLIC_BASE_URL`, the exact fallback, `workers_dev` and preview URLs off, no `BLOB_*` vars, and `triggers.crons=[]`.

### A5. Rollback target (read-only discovery) and procedure

Discover the version id that serves `daee5fc` **before** the deploy [no auth beyond operator Cloudflare login, read-only]:

```sh
wrangler deployments list --name gitstarclub-web          # newest deployment, version ids and traffic split
wrangler deployments status --name gitstarclub-web        # the version serving 100% now
wrangler versions list --name gitstarclub-web             # id, created time, message/tag
wrangler versions view <version-id> --name gitstarclub-web  # check vars: CF_PREVIEW_COMMIT_SHA must be daee5fc2ee35a62963ec8eb02cc566f30ed83964
```

The public deployment endpoint cannot give a version UUID. Match the id by its baked `CF_PREVIEW_COMMIT_SHA` var and by creation time (2026-10-04 about 10:56 UTC). Write the id into the deploy record.

Rollback command [owner authorization needed: deploy]:

```sh
wrangler rollback <daee5fc-version-id> --name gitstarclub-web --message "rollback to daee5fc"
```

It does not touch R2, Blob, secrets or `triggers`. After rollback, repeat the A6 smoke and expect `commitSha=daee5fc...`.

Older versions are **not** acceptable rollback targets:
* `14b84f73` (`b32939d`, 2026-09-27) predates the security fixes, and its configuration points at the Blob store which now answers `Store not found`. Rolling back to it would break every data read. `docs/OPS.md` and `docs/R2-CUTOVER.md` still list it as the historical rollback; that text is stale and should be corrected by a docs PR.
* `c163a860` (`c32b373`, 2026-10-04 cutover) predates `daee5fc` (#651 disables the incremental cache that caused read-only errors).

### A6. Post-deploy smoke [no auth]

| Check | Pass condition |
|---|---|
| `GET /.well-known/deployment` | 200, `commitSha` equals the deployed SHA, `target=cf`, `host=gitstarclub.com` |
| `GET /robots.txt` | production policy: indexable, does not contain `Disallow: /` for `*`, sitemap link present; page `<meta name="robots">` is not `noindex` |
| `GET /` | 200, contains repository rows and star counts; same top rows as baseline |
| `GET /rankings` and one period page found from `/sitemap.xml` (monthly 2026-08 or weekly 2026-W35) | 200, `owner/name` links with star counts; the English empty copy "Ranking data is waiting for the next published recompute." must be absent on both boards |
| `GET /react/react` and `GET /facebook/react` | 200 with star history; `facebook/react` answers 308 to `/react/react` |
| `GET /search-index`, `/sitemap.xml` | 200 |
| `x-gsc-cache` header | first request `MISS`, repeat `HIT`; `/.well-known/deployment` stays `BYPASS` |
| Observability on `gitstarclub-web` | no `[ALERT]`, outbound reads hit `data.gitstarclub.com`, none to `*.public.blob.vercel-storage.com` (**to verify by operator**) |
| HTTP 200 alone is not enough | compare rendered ranking rows with the A2.7 baseline: generation must still be the frozen 2026-09-13 one |

Any failure: roll back (A5), then diagnose.

## B. Data repair options for production canonical

Goal: make a full managed refresh runnable on production (canonical complete, fold able to proceed) so that the first publish creates `views/latest.json`. Coverage rule (lock-002): the tracked universe stays GitHub repositories with at least 10,000 stars (`MIN_TRACKED_STARS=10000`), same metrics and periods. Rebuilding or backfilling the same coverage is not an expansion. Lowering the floor, adding sources, periods or repositories beyond the weekly whitelist drift would be, and is excluded.

Revision (GSC_0030): do not rebuild 2015 through 2026-05-29. That gross history is already in the GCS backup and already matches the frozen views. Rebuild only the gap from 2026-05-30 through the last closed month end, 2026-09-30.

### B0. The GCS backup (read-only, 2026-10-18)

Bucket `gs://gitstarclub-backfill-746384388303/` is in GCP project `gitstarclub`, location US, created 2026-05-30T01:50:50Z. The only prefix is `star_daily_gross/`. `gcloud storage ls -l gs://gitstarclub-backfill-746384388303/**` shows 20 objects, 30,907,971 bytes (29.48 MiB), each created 2026-05-30T01:50:56Z. No write, delete, or ACL change was made. The logged-in account is a project owner on `gitstarclub` (stronger than this check needed). The account name is in the GSC_0030 handoff, not here. The active gcloud config project was left unchanged.

DuckDB on the 20 files (local copy only):

| Check | Result |
|---|---|
| Columns | `repo_id` BIGINT, `day` DATE, `gross_adds` BIGINT |
| Rows | 12,375,426 |
| Distinct `repo_id` | 5,249 |
| Min / max `day` | 2015-01-01 / 2026-05-29 |
| Rows on or after 2026-05-30 | 0 |
| Nulls, non-positive `gross_adds`, duplicate `(repo_id, day)` | 0 |
| Sum of `gross_adds` | 120,374,597 |

This is gross, not net. `pipeline/backfill/02-extract.sql` lines 1-2 and 28-37 count GH Archive `WatchEvent` rows (no unstar event) as `gross_adds` per `repo.id` and UTC `day`. There is no net column. The minimum `gross_adds` in the file is 1.

`pipeline/backfill/04-rollup.mjs` lines 19-22 reads exactly those three names and writes `repo_id`, `day AS date`, `gross_adds AS delta`. The file is the input step 04 expects. DuckDB's BIGINT is the usual read of BigQuery INT64. No cast is required.

BigQuery metadata (no table contents were queried): dataset `gitstarclub.gitstarclub` in US holds `whitelist` (5,249 rows, `repo_id` INTEGER, created 2026-05-30T01:39:24Z) and unsuffixed `star_daily_gross` (12,375,426 rows, columns `repo_id` INTEGER, `day` DATE, `gross_adds` INTEGER, created 2026-05-30T01:49:05Z). The row count matches the Parquet. `pipeline/lib/extract-sql.mjs` lines 14-17 refuses to render a query that writes that unsuffixed table. Leave both tables in place. A gap extract needs a new dated table such as `gitstarclub.star_daily_gross_260930`.

`seam_date` on production canonical and on the frozen views is 2026-05-30 (`pipeline/backfill/07-export-v2.mjs` lines 184-186 sets it to the day after max(`date`)). The backup ending on 2026-05-29 is the matching gross side of that seam. It does not include 2026-05-30.

### B1. Copy missing kinds from the old Vercel Blob store: not available

Unchanged from GSC_0027. The store at `cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com` answers 404 `Store not found`. It is not a source for `repo-monthly`, `repo-weekly`, `repo-recent-daily`, or `pending/2026-08`. Cost 0. Whether Vercel can restore it is still **to verify by operator**, and it is no longer on the critical path.

### B2. Gap rebuild: backup through 2026-05-29, BigQuery only from 2026-05-30 (recommended)

Cutoff: 2026-09-30, the last closed month end (today in this note is 2026-10-18, so October is open). Do not extend the extract through 2026-10-04 just to finish ISO week W40. Step 07 sets `folded_through.month` to the month of the max day (`07-export-v2.mjs` lines 212-213). A max day in October would mark October folded while most of October is missing, and the next month fold would skip the rest.

Steps, and whether each one runs:

1. `01-whitelist.mjs`: not for this repair. The BigQuery whitelist already has 5,249 rows, the same count as distinct `repo_id` in the Parquet. Row counts match; the id sets were not compared, because that would be a query. A fresh search would return today's `stars>=10000` set. The frozen views meta says `active_repo_count` 5542, which is 293 higher than 5249 as a count, not a measured set difference. Lock-002: do not expand coverage. Joining the gap to the existing whitelist keeps the May universe. At least two repositories in the frozen all-time top 100 are absent from the backup (section B4) and have no gross history there. What to do with repositories tracked only after the seam is a separate decision, not part of this extract.
2. `02-extract`: yes, narrowed window only. Same SELECT as `02-extract.sql` lines 28-37, with `_TABLE_SUFFIX BETWEEN '260530' AND '260930'`, still `type = 'WatchEvent'`, still joining `gitstarclub.whitelist`. Destination must be a new suffixed table. Export Parquet and place it next to the 20 backup files. Dates do not overlap (backup max 2026-05-29, window min 2026-05-30), so `04-rollup.mjs`'s `star_daily_gross/*.parquet` glob will not double-count.
3. `03-metadata.mjs`: yes. The Parquet and the BigQuery whitelist have `repo_id` only. Step 03 needs `node_id` plus current GraphQL stars to build `repos.json`. That is GitHub API quota, not a BigQuery charge. Without `repos.json`, steps 04 and 05 cannot write names, all-time ranks, or the anchor discount.
4. `04-rollup.mjs`: yes, local DuckDB, no cloud spend. Input is the union of the backup and the gap files.
5. `05-precompute.mjs`: yes, local, after 03 and 04.
6. `06-upload.mjs`: not required. The v2 path is step 07.
7. `07-export-v2.mjs`: yes, stage into the chosen bucket. The production commit is still blocked (section B5).

Estimated BigQuery bytes, from `bq query --project_id=gitstarclub --location=US --use_legacy_sql=false --dry_run` on 2026-10-18. Each job was a SELECT (no `CREATE`), `dryRun=true`, `totalBytesBilled=0`, accuracy `PRECISE`. These are estimates of a later real run, not an invoice. List price uses the stated rate of 6.25 USD per TiB, with TiB = 2^40 bytes. The first 1 TiB of on-demand scan per month is free. Month-to-date usage of project `gitstarclub` was not measured, so the "if the free tebibyte is still unused" column assumes this job is the month's only scan.

| Window | Bytes (dry run) | Decimal GB | TiB | List price before free tier | If the 1 TiB free tier is still unused |
|---|---:|---:|---:|---:|---:|
| Gap 2026-05-30 .. 2026-09-30 (recommended) | 10,580,215,529 | 10.580 | 0.009623 | 0.06 USD | 0 USD |
| Same gap through 2026-10-04 (do not use; see cutoff note) | 10,801,283,272 | 10.801 | 0.009824 | 0.06 USD | 0 USD |
| 2015-01-01 .. 2026-05-31, the window in `02-extract.sql` line 15 ("about 303 GB") | 303,236,025,668 | 303.236 | 0.275792 | 1.72 USD | 0 USD |
| 2015-01-01 .. 2026-09-30, ignoring the backup | 313,606,985,036 | 313.607 | 0.285224 | 1.78 USD | 0 USD |

The 303.236 GB dry run matches the comment in `02-extract.sql` line 15. Both the gap and a full rescan sit inside one free tebibyte, so the dollar difference is small if the free tier is intact. The reason to use the backup is that it already matches the published history, and that the unsuffixed May table must not be overwritten. It is not a large bill avoidance.

GitHub quota for step 03 and local DuckDB time are extra and were not measured. No figure above is a GitHub or Cloudflare charge.

### B3. What the cutoff does to the fold

`07-export-v2.mjs` lines 188 and 212-215 set `folded_through.week` to the ISO week of the max day and `folded_through.month` to that day's `YYYY-MM`. For a max day of 2026-09-30 (Wednesday, week 2026-W40):

* Month watermark 2026-09. September is complete in the file. The next month fold wants October, which is not closed yet (`fold.ts` lines 193-207), so it does not need `pending/2026-09`.
* Week watermark 2026-W40. `fold.ts` lines 436-452: the next Monday after Sunday of W40 is 2026-10-05, which is after the end of September, so the week phase returns without reading pending. That is how a generation built this way avoids today's failure (`missing required frozen period(s) 2026-08`, `fold.ts` lines 457-460).
* Side effect, accepted unless a later reviewed change says otherwise: the W40 weekly shard contains only 2026-09-28, 2026-09-29 and 2026-09-30. October 1 through 4 never join that week, because the watermark has already passed it. Stamping W39 instead would make the first refresh demand `pending/2026-09` and fail closed again. Do not do that without a real pending file.

This is still an inference from `fold.ts` and step 07. Prove it with a local fixture fold before the preview rehearsal. Production cannot use the cold-start empty-pending relaxation (`DEPLOY_ENV=pre` only).

### B4. Number impact versus frozen views `refresh-2026-09-13T06-00-16-398Z`

Compared locally with DuckDB, no BigQuery scan and no pipeline write. The node scripts `04-rollup.mjs` and `05-precompute.mjs` were not executed: they write the gitignored pipeline data directory, and step 05 needs `repos.json` from GitHub. The comparisons below use the same aggregation as step 04 (`sum(gross_adds)` by period) and public GETs of the frozen generation. All-time in step 05 is ordered by GraphQL `current_stars`, which this backup does not contain.

View meta and canonical meta both say `seam_date` 2026-05-30, `folded_through` month 2026-08 and week 2026-W35, `generated_at` 2026-09-13T06:25:07.096Z. `active_repo_count` is 5542 and `historical_repo_count` is 10.

Periods entirely inside the backup match the frozen generation on star totals:

* `heatmap/year/{2024,2025}.json` and 2026-01 through 2026-05: every month total equals the backup. Delta 0.
* `heatmap/month/2024-06.json`, `2026-04.json` and `2026-05.json`: every day matches. 2026-05 has 29 days on both sides. 2026-05-30 and 2026-05-31 are absent from the published May heatmap as well as from the backup.
* Flow top 100, values: exact match (sum of the published top 100 equals the backup for those same ids, and no id has a different value) for month 2024-06, 2025-12, 2026-01, 2026-04 and 2026-05; week 2026-W20, 2026-W21 and 2026-W22; year 2024 and 2025.
* Flow top 100, order: identical where there is no tie. Where the order differs, the values are equal. The largest place shift is 2, on a three-way tie in week 2026-W22 (several repos with flow 51). That is not a star-count difference.
* Entity month curves for `freeCodeCamp/freeCodeCamp` (id 28457823) and `react/react` (id 10270250): all 137 months through 2026-05 match.

So using the backup for history before 2026-05-30 does not move published flow totals through 2026-05-29. Two edge periods will move once the gap is appended, because those two days are missing on both sides today:

* Month 2026-05 gains 2026-05-30 and 2026-05-31.
* Week 2026-W22 gains Saturday 2026-05-30 and Sunday 2026-05-31 (the backup's W22 is only Monday 2026-05-25 through Friday 2026-05-29, and the published top-100 values match that partial week).

Late-May days in the backup are about 5,000 to 14,000 gross stars per day. Two days is a small add on May's 287,718. That size is an extrapolation, not a measured extract.

All-time is a different metric. The frozen `rank/all-time/repo/stock.json` is `current_stars` as of the 2026-09-13 generation, not the gross sum. Top-100 overlap with a gross-cumsum top 100 is 72 of 100. Among those 72 the largest rank shift is 69 places. Only 2 of the published all-time top 100 are absent from the backup: rank 22, id 1333065091, value 221823; rank 71, id 1266797999, value 136777. The published top-100 `current_stars` sum is 19,261,680. The backup's gross top-100 sum is 16,510,555. A later step 03 will refresh `current_stars` again, so all-time will move even for repositories that are in the backup. That movement is expected and is not a gross-versus-net bug.

June through August are not in the backup. The frozen heatmaps (net, and with holes) are:

| Period | Published site total | Days present | What is missing |
|---|---:|---:|---|
| 2026-06 | 2,189,425 | 28 of 30 | 2026-06-29, 2026-06-30 |
| 2026-07 | 2,545,194 | 20 of 31 | 2026-07-01 through 2026-07-11. 2026-07-12 alone is 1,109,427 (catch-up after the token outage) |
| 2026-08 | 2,445,113 | 31 of 31 | none |
| Sum | 7,179,732 | | |

`rank/week/2026-W27/repo/flow.json` on that generation returns HTTP 404. `docs/OPS.md` lines 416-421 already say the W27 base ranks are absent until the fold passes W27, and that a 2026 `WatchEvent` spot check was about 80 times lower than a 2024 sample for the same hour of day.

The backup's own 2026 daily gross, through 2026-05-29, is 20,700.5 stars per day, against 45,085.1 per day in 2024 (about 2.2 times lower, not 80 times). A 30-day month at the 2026 rate is about 621,000 stars. Each published net month above is about 2.2 to 2.5 million, roughly 3.9 times that gross rate. If the gap extract stays near the January-May rate, June through August totals fall from about 7.18 million to something near 1.9 million, and the 2026-07-12 spike disappears (a gross series has no GraphQL catch-up day). If the OPS 80-times warning applies to the gap, the drop is much larger. The dry run does not return row counts, so the gap total was not measured. Owner decision: published June through September numbers will change. The pre-seam months will not, apart from the two May days above.

Sample entity net adds after the seam, for scale, not as a site total: freeCodeCamp June/July/August flows 4657 / 2593 / 1510; react 814 / 628 / 1539. Those are one repository each.

### B5. Production commit path (unchanged blocker, leader decision kept)

`--initial-commit` refuses when any of `bootstrap/latest.json`, `views/latest.json`, or `canonical/v2/meta.json` already exists (`pipeline/lib/bootstrap-publication.mjs`, `INITIAL_COMMIT_ABSENT_PATHS` lines 9-13, `assertInitialCommitTarget` lines 304-308). Production `canonical/v2/meta.json` is 200, and both pointers are absent, so `--initial-commit` refuses today.

`--initial-commit` does not call `verifyLegacyFlatTarget`. Lines 350-357 call that function only when `initialCommit` is false and no bootstrap pointer exists. Missing `repo-monthly`, `repo-weekly`, and `repo-recent-daily` shards therefore do not fail `--initial-commit`. They fail the normal commit.

`verifyLegacyFlatTarget` requires every path in `LEGACY_FLAT_REQUIRED_PATHS` (lines 17-29): root `meta.json`, `lookup/repos.json`, `lookup/orgs.json`, `rank/all-time/repo/stock.json`, `rank/all-time/org/stock.json`, `canonical/v2/meta.json`, and the 128 `canonical/v2/<kind>/<bucket>.json` shards. Those shards are not at the bucket root. The kinds are `repos`, `repo-monthly`, `repo-weekly`, and `repo-recent-daily`, buckets 0 through 31. Public GETs on 2026-10-18: `canonical/v2/repos/0` through `31` are 200; the other three kinds, buckets 0 through 31, are 404; `canonical/v2/meta.json` is 200 with `folded_through` month 2026-08 and week 2026-W35.

Deleting `canonical/v2/meta.json` does not delete `canonical/v2/repos/*`. With both pointers still absent, removing that meta object drops `seam_date` and `folded_through`, leaves the live repos shards in place, and is what makes `--initial-commit` legal. `docs/OPS.md` line 633 forbids initial-commit and bad-first-publish cleanup on the populated production copy. Do not do it.

`pipeline/backfill/07-export-v2.mjs` stages under `bootstrap/generations` and the commit writes `bootstrap/latest.json` (around lines 306-345).

Leader decision, kept: the production commit goes through a reviewed code change to that gate. Not a destructive cleanup. Rehearse the whole chain into empty `gitstarclub-data-pre` first (`--initial-commit` is allowed there). Take a full backup of `gitstarclub-data-prod` before any production write.

### B6. Other paths

* **B6a. Pending only (former B3a).** A small extract cannot close P2. The shards are still missing. Not sufficient.
* **B6b. Reconstruct from the frozen views (former B3b).** Still the only no-spend way to keep June through August net totals and the repositories that are not in the May whitelist. Lossy for weekly and 90-day series. Not proven. Use it only if the owner rejects changed June through September numbers.
* **B6c. Full BigQuery rescan, ignoring the backup.** Dry-run estimate 313.607 GB, list price about 1.78 USD, likely 0 USD inside the free tebibyte. It would redo history that already matches the frozen views, and it risks overwriting `gitstarclub.star_daily_gross` if someone renders the unsuffixed name. Do not.
* **B6d. Not allowed.** Fabricating empty frozen pending on production. Hand-writing `views/latest.json` or `bootstrap/latest.json`. Relaxing validation in place. Deleting canonical objects to make `--initial-commit` succeed.

### B7. Comparison

Estimates are marked. "Free tier" means the estimate if project `gitstarclub` still has the full 1 TiB monthly on-demand allowance. That usage was not measured.

| Option | Closes P2 | Closes P3 | Coverage (lock-002) | Estimated scan | Estimated list price | If free tier unused | Main risk |
|---|---|---|---|---|---:|---:|---|
| B1 Blob copy | no | no | no change | none | 0 | 0 | source is gone |
| B2-gap, backup plus 2026-05-30 .. 2026-09-30 (recommended) | yes, after 03, 04, 05, 07 | yes, with the W40 partial-week caveat in B3 | no expansion if the join stays on the existing 5,249-row whitelist; frozen `active_repo_count` is 5542, and at least two all-time top-100 repos are absent from the backup | 10,580,215,529 bytes | 0.06 USD | 0 USD | June-September numbers change; commit still needs a reviewed code change |
| B2-full, rescan 2015 .. 2026-09-30 | yes | yes, same caveat | same | 313,606,985,036 bytes | 1.78 USD | 0 USD | redoes matching history; must not overwrite the May table |
| B6a pending only | no | yes | no expansion | a subset of the gap, under 10.58 GB | under 0.06 USD | 0 USD | does not restore shards |
| B6b reconstruct from views | maybe | no | no expansion | none | 0 | 0 | lossy, unproven; the path that preserves net totals |
| B1 plus a found `star_daily.parquet` | n/a | n/a | | | | | the rolled-up canonical Parquet was not in this bucket; the gross export was |

Recommendation: B2-gap. Keep the May tables and the 20 Parquet files as the source through 2026-05-29. Dry-run the gap again immediately before the real job (the byte cap in `02-extract.sql` line 17 is 400,000,000,000, far above this estimate). Rehearse on the preview bucket. Land on production only through the reviewed commit-gate change, after a backup of `gitstarclub-data-prod`. Do not start any R2 write before the owner approves the changed June through September numbers.

## C. Re-enabling the production schedule and fallback removal

### C1. Prerequisites (all must be true)

1. Section B complete: production canonical passes the 128-shard preflight (`GET .../api/workflows/refresh/start` returns a `run_id`, not 500).
2. Secrets present on `gitstarclub-web` by name (**to verify by operator**: `wrangler secret list --name gitstarclub-web`; values are never read): `CRON_SECRET` (at least 32 characters, no leading or trailing whitespace) and `GITHUB_TOKEN`. Missing ones are set with `wrangler secret put <NAME> --name gitstarclub-web` [owner authorization needed: secret]. Optional `ALERT_WEBHOOK_URL`. `BLOB_READ_WRITE_TOKEN` stays until stage 6.
3. Queue `gitstarclub-jobs` consumer healthy (**to verify by operator**).
4. `WORKFLOW_FIXTURE` is not set on production (it is not in `wrangler.jsonc`; confirm no dashboard var). On preview it is `"1"`, which turns scheduled refreshes into no-ops.

### C2. Config and gate changes (one reviewed PR into `pre`, then promotion)

* the Worker `wrangler.jsonc` under `workers/`: top-level `triggers.crons`. Use `SUN`, never `7` (Saturday) or `0`. Suggested sequence: first `["0 6 * * SUN"]` only (managed refresh), after one clean publish add `"0 3 * * *"` and `"0 4 * * SUN"` (daily and weekly live cron depend on `live/latest.json`; the daily skips until a publish). Stage 5 text in `docs/R2-CUTOVER.md` lists all three.
* `scripts/cf-ci-gates.mjs`: remove or invert `productionCronsAreEmpty` and its issue message (about lines 306 to 308 and 391 to 394), set the returned `productionCrons` and the final console message (about lines 816 and 827) from the real list, add an exact-match check against the intended production list (mirror `previewCronIssues`), keep the ambiguous-weekday check. Update `scripts/cf-ci-gates.test.mjs`.
* `.delivery.yml`: line 19 comment and the assertion that production `triggers.crons` is `[]` (`scripts/cf-ci-gates.mjs` about line 723 greps for it). `.github/workflows/ci.yml` also mentions the contract. Editing these files is outside executor scope unless the owner explicitly asks.
* Docs in the same PR: `docs/OPS.md` (several "stay `[]`" sentences), `docs/R2-CUTOVER.md` stage 5, `docs/PIPELINE.md`, `docs/API.md`, `docs/TESTING.md`, `docs/CODEBASE.md`, `docs/README.md`, `README.md`, and the comment block in `wrangler.jsonc`.
* Then deploy per section A [owner authorization needed: cron, deploy]. The deploy is what applies the cron triggers. Rollback: set crons back to `[]` and redeploy; the Worker scheduled handler rejects unknown cron strings.

### C3. First refresh

Prefer one manual authenticated run before relying on the schedule [owner authorization needed: R2 write, spend (GitHub quota)]:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://gitstarclub.com/api/workflows/refresh/start
```

Watch `ops/workflows/<run_id>/steps/*.json`, `ops/workflows/health/workflow-refresh.json` and Workers Observability. There is no dry run for managed refresh. Do not call `/api/cron/*` as a substitute. A successful publish writes `views/latest.json` (never hand-write it), then run the data-exports regeneration from `docs/DATA-EXPORTS.md`.

### C4. Fallback removal conditions (per `docs/OPS.md`, separately authorized)

1. `https://data.gitstarclub.com/views/latest.json` returns 200 and is authoritative for the version production pages render.
2. A production build without `VIEWS_VERSION_FALLBACK` still prerenders real data (rankings with repository rows and star counts).
3. Remove the Worker var and the build-shell export together in one authorized build and deploy. Keep the existing gate (it already allows absent or the exact value). Rotate `EDGE_CACHE_VERSION` in the same deploy.
4. `BLOB_READ_WRITE_TOKEN` removal waits for the stage 6 criteria. Do not remove the fallback merely because #543 closes.

## D. Ordered checklist

Legend: [no auth] needs no owner authorization (read-only; operator login only where noted). Others name what must be authorized.

0. **Operator read-only verification** (one short pass, closes every "to verify by operator")
   0.1 [no auth] `wrangler whoami`, then `wrangler deployments list|status` and `versions list|view` for `gitstarclub-web` and `gitstarclub-web-pre`: live vars, bindings, triggers, current version ids; record the `daee5fc` version id.
   0.2 [no auth] `wrangler secret list` for both Workers (names only): `CRON_SECRET`, `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `ALERT_WEBHOOK_URL`.
   0.3 [no auth] `wrangler r2 object list`/public listing of `gitstarclub-data-prod`: confirm 0/32 for the three kinds, `site-daily`, `pending/*`, `whitelist/*`, and whether `live/generations/*` or `ops/*` still hold anything useful.
   0.4 [no auth] Vercel dashboard: is the Blob store `cdv7ejjwmzbbdj8w` deleted, paused or recoverable. The GCS gross export is already found (section B0); a local `star_daily.parquet` or `v2/canonical/v2` tree is still not in the checkout. **To verify by operator** only for the Vercel dashboard.
   0.5 [no auth] Check the Workers request log for any external caller of `/api/workflows/refresh/start` since 2026-09-13.
1. [no auth] Pre-deploy checks A2 on the exact `main` head; record results.
2. [no auth] Capture A5 rollback record and A2.7 baseline.
3. [no auth] Build production shell A3.
4. [owner authorization needed: deploy] Deploy `main` (A4).
5. [no auth] Post-deploy smoke A6; on failure [owner authorization needed: deploy] rollback A5.
6. [no auth] Decision card for the data repair. GSC_0030 recommends B2-gap (sections B2 and B7): history through 2026-05-29 from the GCS parquet, BigQuery only for 2026-05-30 through 2026-09-30. The production commit stays a reviewed code change, not a destructive cleanup (section B5, leader decision, kept). Request a full backup of `gitstarclub-data-prod` before any repair write.
7. [owner authorization needed: R2 write] Full backup copy of `gitstarclub-data-prod` before any repair write.
8. [owner authorization needed: spend] Run the gap extract only after a fresh dry run still shows about 10.58 GB (section B2). Do not re-scan 2015 through May. GitHub token use is for step 03 metadata, not for a new whitelist search.
9. [owner authorization needed: R2 write] Rehearse the whole chain into `gitstarclub-data-pre` (bucket-scoped key kept outside the repo); verify preview rankings.
10. [no auth] Local fixture fold test proving the rebuilt canonical advances without `pending` (B2 cutoff inference).
11. [owner authorization needed: R2 write] Stage and commit the rebuilt generation to `gitstarclub-data-prod` with the reviewed commit-gate change (section B5). Never delete `_meta/`, never hand-write a pointer.
12. [owner authorization needed: secret] Set `CRON_SECRET` and `GITHUB_TOKEN` on `gitstarclub-web` if step 0.2 shows them missing.
13. [no auth] Land the C2 PR (wrangler crons, `cf-ci-gates.mjs` and its tests, docs) into `pre` with the local full gate; `.delivery.yml` edit only with explicit owner request.
14. [owner authorization needed: cron] Approve the production schedule change (start with `0 6 * * SUN`).
15. [owner authorization needed: deploy] Promote to `main` and deploy with the crons (section A procedure).
16. [owner authorization needed: R2 write, spend] First managed refresh run (C3); confirm `views/latest.json` 200.
17. [owner authorization needed: deploy] Optionally add daily and weekly crons after one clean publish; rotate `EDGE_CACHE_VERSION`.
18. [owner authorization needed: deploy] Remove `VIEWS_VERSION_FALLBACK` (C4) after its conditions hold. Stage 6 Blob retirement is a separate decision.
19. [no auth] Docs PR correcting the stale Blob rollback references in `docs/OPS.md` and `docs/R2-CUTOVER.md`.

## Open questions for the owner

1. Are changed numbers for 2026-05-30 onward acceptable? Periods through 2026-05-29 already match the frozen views (section B4). June through August cannot keep both the frozen net totals and a GH Archive gross fill.
2. The production commit mechanism is already decided: a reviewed code change to the commit gate, not a destructive cleanup. The remaining authorization is that code change itself, after a preview rehearsal.
3. May the roll-out of `main` (section A) happen ahead of the data repair?
