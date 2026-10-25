---
owner: data
status: draft
last_reviewed: 2026-10-25
source_of_truth_for:
  - issue 774 production canonical gap and repair options
---

# Production canonical gap: issue 774

Read-only diagnosis for Jason, through PM. No bucket write, credential, `cf` call, `/start`, or deploy was made. Public GETs ran on 2026-10-25 from 19:12Z against `https://data.gitstarclub.com` and `https://data-pre.gitstarclub.com`. A second pass the same day, about 19:47Z, re-read the 32 production repo shards, the seven frozen entities named below, the frozen lookup, and week ranks `2026-W23`, `2026-W27`, and `2026-W35`. Those calls were credential-free GETs.

**Verified** means a public response or the current source. **Inferred** means a conclusion from those, not a second measurement. A prefix listing of `gitstarclub-data-prod` was not done. With `bootstrap/latest.json` absent, readers use the flat key ([bootstrap-publication.ts](../../web/lib/data/bootstrap-publication.ts#L161)), so a hidden generation would not satisfy preflight until a pointer names it.

The frozen generation `refresh-2026-09-13T06-00-16-398Z` is what production pages render through `VIEWS_VERSION_FALLBACK`. Its monthly numbers can be restored. The canonical repo shards now on the bucket cannot.

## 1. What is missing, and what the present shards actually contain

### Pointers and schema

| Object | Status | Body |
| --- | --- | --- |
| `_meta/bucket-identity.json` | 200 | `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}` |
| `canonical/v2/meta.json` | 200 | `seam_date` `2026-05-30`, `schema_ver` **1**, `folded_through` month `2026-08` / week `2026-W35`, `generated_at` `2026-09-13T06:25:07.096Z` |
| `canonical/v2/history-availability.json` | 404 | absent |
| `views/latest.json` | 404 | absent |
| `bootstrap/latest.json` | 404 | absent |
| `live/latest.json` | 200 | valid unpublished pointer: `schema_ver` 1 and every generation field `null` ([live.ts](../../web/lib/contracts/live.ts#L104)) |
| Root `meta.json`, `lookup/repos.json`, `lookup/orgs.json`, both all-time rank files | 404 | absent |
| `whitelist/latest.json`, `canonical/v2/whitelist/latest.json`, `canonical/v2/whitelist/refresh-2026-09-13T06-00-16-398Z.json` | 404 | absent |
| `canonical/star_daily.parquet`, `star_daily.parquet` | 404 | absent |

`schema_ver` 1 is the bootstrap writer ([07-export-v2.mjs](../../pipeline/backfill/07-export-v2.mjs#L83)). The reader accepts any non-negative integer ([canonical.ts](../../web/lib/contracts/canonical.ts#L23)). Nothing in the refresh path branches on the value; fold copies it through ([fold.ts](../../web/lib/workflows/steps/fold.ts#L131)).

Preview, the same evening, is a different lifecycle. Flat `canonical/v2/meta.json` and the sealed generation `bootstrap-aggregate-gap-20261022T001946Z` both say `schema_ver` **2**, `seam_date` `2026-10-21`, folded through `2026-09` / `2026-W40`. That 2 is what cold start writes ([cold-start.ts](../../web/lib/workflows/cold-start.ts#L57)). The preview history marker from #745 is not on the flat key. It is on the overlay:

`bootstrap/overlays/bootstrap-aggregate-gap-20261022T001946Z/canonical/v2/history-availability.json` = `{"seed_date":"2026-10-21","monthly":"unavailable","prior_year_heatmap":"unavailable","set_at":"2026-10-25T11:30:17Z"}`.

The sealed monthly shard `repo-monthly/0.json` is `{}` (2 bytes). Production `isPreDeployment` is false, so that marker is ignored and the family check stays strict ([history-availability.ts](../../web/lib/workflows/history-availability.ts#L15)). Copying the marker, the empty monthly shards, or `schema_ver` 2 onto production does not repair this gap.

### Bucketed families

Preflight requires four families, buckets 0 through 31 ([canonical-validation.ts](../../web/lib/workflows/canonical-validation.ts#L33)).

| Family | Public result |
| --- | --- |
| `canonical/v2/repos/0.json` … `31.json` | **32/32 HTTP 200**, 50,882,431 bytes |
| `canonical/v2/repo-monthly/0.json` … `31.json` | **32/32 HTTP 404** |
| `canonical/v2/repo-weekly/0.json` … `31.json` | **32/32 HTTP 404** |
| `canonical/v2/repo-recent-daily/0.json` … `31.json` | **32/32 HTTP 404** |
| Same three series under `views/refresh-2026-09-13T06-00-16-398Z/canonical/v2/` | `repo-monthly/0.json` 404. The views generation is not a second copy of the shards. |

The repo shards are the wrong universe. Verified by parsing all 32:

| Fact | Count |
| --- | --- |
| Records | 65,033. Keys match `id`, and every id sits in `id % 32`. |
| `tracked_since` | `2026-09-22` on every record |
| `d` | absent on every record |
| `active: false` | 0 |
| Stars | 1 repo at 999, 59,453 in 1,000–9,999, 5,579 at or above 10,000. Minimum 999, maximum 548,842. |
| Sample `fetched_at` | `2026-09-23T01:44:44.830Z` on `thoughtbot/shoulda` (id 9664) |

The frozen lookup has **5,552** repositories: 5,542 active and 10 historical, matching `views/.../meta.json` (`active_repo_count` 5542, `historical_repo_count` 10). Overlap with the canonical shards is **5,545**. Stars differ on 5,395 of those. Every one of the 10 historical rows was either deleted from canonical or rewritten `active: true`.

Seven published repositories are absent from canonical. Their frozen entities still exist:

| id | name | published state |
| --- | --- | --- |
| 99234994 | froala/design-blocks | historical, curve present |
| 149111813 | Tencent/MMKV | active, curve present |
| 206462776 | GrowingGit/GitHub-Chinese-Top-Charts | historical, curve present |
| 304766583 | imarvinle/awesome-cs-books | historical, curve present |
| 594330628 | Dr-TSNG/ZygiskNext | active, only `2026-08`, `tracked_since` `2026-08-02` |
| 824301644 | cheahjs/free-llm-api-resources | historical, 26 months |
| 1278830624 | Yu9191/wloc | historical, empty monthly curve |

**Inferred:** the rewrite is the failed refresh `refresh-2026-09-23T01-44-09-453Z`. `ops/workflows/active.json` names that run, status `failed`, fencing token 4, trigger `bearer-reuse-65033-20260923`, and `expires_at` equal to `acquired_at` (`2026-09-23T04:54:25.412Z`), so it is not a live lock. The star mix matches a 1,000-star search. The checked-in production floor is 10,000 or unset ([OPS.md](../OPS.md), `MIN_TRACKED_STARS`). The live Worker value on that day was not read.

Five historical rows are still in the shards and were flipped to `active: true`: 16630332 (`pagekit/vue-resource`), 21931810 (`petehunt/webpack-howto`), 36353527 (`typicode/hotel`), 65755556, 834082440.

Canonical-only rows: **59,488**, of which 59,450 are under 10,000 stars and **38** are at or above 10,000. Five sampled under-10k canonical-only entities (`thoughtbot/shoulda` and four others) are HTTP 404 in the frozen generation. **Inferred:** the other canonical-only ids, including the 38, have no frozen entity, because the generation's entity set is the lookup.

### Pending, site-daily, and the fold

`canonical/v2/pending/YYYY-MM.json` for every month from `2015-01` through `2026-10`: **142/142 HTTP 404**. `canonical/v2/site-daily/{2011..2026}.json`: **16/16 HTTP 404**.

With the watermark unchanged, today's date `2026-10-25`, and the week-date functions in [week-dates.ts](../../web/lib/workflows/steps/week-dates.ts#L36):

- `2026-W35` is Monday `2026-08-24` through Sunday `2026-08-30`.
- The next Monday is `2026-08-31`, which is `2026-W36`. That week ends Sunday `2026-09-06`.
- August's last day is `2026-08-31`. `weekRowsFromByDate` emits a week only when that week's Sunday is on or before the folded month's last day ([fold.ts](../../web/lib/workflows/steps/fold.ts#L724)). The next week is Monday `2026-08-31` through Sunday `2026-09-06`, so no week row is emitted.
- `runWeekPhase` skips the pending read only when the next Monday is strictly after that last day ([fold.ts](../../web/lib/workflows/steps/fold.ts#L438)). Here the two dates are equal, so the skip does not run. The phase reads `pending/2026-08.json` and throws `missing required frozen period(s) 2026-08` when the file is absent ([fold.ts](../../web/lib/workflows/steps/fold.ts#L460)).
- The month phase wants `pending/2026-09.json` because September is closed. A missing month pending is skipped (`pending_missing`) and does not throw ([fold.ts](../../web/lib/workflows/steps/fold.ts#L222)). October is the open month, so `pending/2026-10.json` is not required.

`ops/workflows/health/workflow-refresh.json` records that same pending error at `2026-09-23T04:54:25.578Z`, `last_success` null. Current graph order is preflight, then whitelist, rename, metadata, then fold ([graph.ts](../../web/lib/workflows/runtime/graph.ts#L79)). The week-phase throw happens before a weekly shard read. **Inferred:** that health row does not prove the three series families existed on 23 September. It does prove fold was reached and pending `2026-08` was already absent. Daily and weekly cron health the same week failed with `lookup unavailable`.

### Why the next managed refresh fails before fold

Fail-closed preflight treats a 404 shard as `canonical/v2/<family>/<bucket>.json: missing` ([canonical-validation.ts](../../web/lib/workflows/canonical-validation.ts#L268)). After all 32 buckets, a family with zero repository keys fails too ([canonical-validation.ts](../../web/lib/workflows/canonical-validation.ts#L184), called from [preflight.ts](../../web/lib/workflows/steps/preflight.ts#L110)). That second check is the one #743 hit on preview, where monthly files were empty objects. Production fails on the first check because the files are absent. The #745 marker cannot exempt production.

Empty-shard placeholder mode and cold start arm only when `DEPLOY_ENV=pre` ([runtime-config.ts](../../web/lib/runtime-config.ts#L148)).

Even after the three families exist, the equality at [validate-invariants.ts](../../web/lib/workflows/steps/validate-invariants.ts#L150) compares canonical ids with the lookup this refresh just built. **Verified** from that function and from [rest-fold.ts](../../web/lib/workflows/recompute/rest-fold.ts#L73): recompute inserts every canonical repository it is given into the new lookup, so this check is not a comparison with the frozen 5,552. **Inferred:** the 59,488 canonical-only ids meet that equality once recompute has copied them into the new lookup. No publish was run to observe it. The further constraint is previous membership ([validate-invariants.ts](../../web/lib/workflows/steps/validate-invariants.ts#L228)), using the published lookup loaded in [validate.ts](../../web/lib/workflows/steps/validate.ts#L130). An id the new lookup has and the previous lookup lacks is an unapproved addition unless the whitelist diff adds it. **Inferred:** with the checked-in 10,000-star floor those 59,488 ids are unapproved and the check fails. A 1,000-star floor can approve them and expand the published membership. The live Worker value is still unread, so which outcome a refresh would hit is unknown. Historical rows with `tracked_since` set and no `d` are treated as newcomers with `d = 0` ([model.ts](../../web/lib/workflows/recompute/model.ts#L83)). Recomputed pre-seam stock would then move. Restoring only the missing series, on top of these repo shards, does not preserve the published site.

## 2. Sources that can rebuild the families

### Frozen generation `refresh-2026-09-13T06-00-16-398Z`

Verified public reads:

- `views/.../meta.json` matches canonical meta on seam, fold watermark, and `generated_at`, and adds the 5,542 / 10 counts. `schema_ver` is 1.
- `views/.../lookup/repos.json` is 1,062,908 bytes and 5,552 ids.
- All **5,552** `entity/repo/<id>.json` files return HTTP 200.
- Month rank files `rank/month/2015-01` through `2026-08` ... `/repo/flow.json`: 140/140 HTTP 200. `2026-09` is 404. Each sampled file has 100 items. The contract cap is 100 ([DATA-CONTRACTS.md](../DATA-CONTRACTS.md)).
- Week rank files: every week of 2024 and 2025, plus `2026-W01` through `2026-W40`, except **404** for `2026-W27`, `2026-W36`, `2026-W37`, `2026-W38`, `2026-W39`, and `2026-W40`. `2026-W22` and `2026-W35` each have 100 items.
- Month heatmaps `heatmap/month/2015-01` through `2026-08`: **140/140 HTTP 200**. Year heatmaps `2015` through `2026`: 12/12 HTTP 200. `heatmap/month/2026-09` is 404.

Census of every entity curve, using the stock formula in [windows.ts](../../web/lib/workflows/recompute/windows.ts#L60) (`stock = round(cumgross × d)` through the seam month `2026-05`, then seam anchor plus net):

| Curve class | Repos | Stock check |
| --- | --- | --- |
| Has at least one month at or before `2026-05` | 5,249 | Recovered `d = May stock / cumflow` reproduces every published stock point. 0 mismatches. |
| Months only after `2026-05` | 273 | `d = 0` and cumulative net reproduce every published stock point. 0 mismatches. |
| `curve.monthly` empty | 30 | No monthly observations. `tracked_since` falls between `2026-08-30` and `2026-09-13`. |
| `recent_daily` date after `2026-05-29` | 0 | The daily tail never crosses the seam. |

5,249 + 273 + 30 = 5,552. The 5,249 figure is the same count as the preserved May whitelist ([OPS.md](../OPS.md) raw-archive table). **Inferred:** the 303 others were not in that whitelist; their curves simply have no pre-seam points. That is 273 post-seam curves plus 30 empty curves.

What each artifact can rebuild:

- **Monthly flows.** `curve.monthly` is `[period, adds, total_end]`. The canonical shard stores `[period, adds]` only ([canonical.ts](../../web/lib/contracts/canonical.ts#L90)). Copying `adds` keeps the published flow. The recovered `d`, plus `active` and `tracked_since` from the entity, keeps the recomputed stock on the current formula. Verified on all 5,522 non-empty curves.
- **Recent daily.** Only the pre-seam tail, and only where the entity has points. It does not contain June, July, or August.
- **Weekly full population.** Not in the entity. Week rank files are the top 100. They cannot fill a shard.
- **Site daily.** Month heatmap `cells` are `[date, total]`. They can fill `site-daily/<year>.json` for days that are present. Year heatmap cells are month totals, so they are not a daily source. Hole counts were measured for 2026 only: May 29 days summing to 287,718; June 28 days summing to 2,189,425; July 20 days summing to 2,545,194 (first cell `2026-07-12`); August 31 days summing to 2,445,113. Those totals match the earlier frozen-view note in [prod-rollout-and-data-repair.md](../../plans/prod-rollout-and-data-repair.md).
- **Pending.** Per-repo August and September days are not in `recent_daily`. The live pointer names no generation, so there is no `live/generations/<id>/current_month` to read. Site heatmaps have totals, not per-repo deltas.
- **Anchoring `d` on the current repo shards.** Gone. The curve inversion above is the public substitute. It matched published stocks; it was not compared with the original IEEE double from bootstrap.

`monthly_table` on the sampled entities repeats the last 24 month flows. The curve is the complete series.

### `node_id` is absent from the frozen curves

`ReposShardEntry.node_id` is mandatory ([canonical.ts](../../web/lib/contracts/canonical.ts#L50)). It is GitHub's GraphQL repository id, the value metadata sends to `nodes(ids:)`. **Verified** on the 19:47Z reads:

- All 65,033 current canonical repo records contain a non-empty string `node_id`. None of the seven frozen ids in the table above is a key in any shard, so those shards have no `node_id` for them.
- Each of the seven frozen entities has no `node_id` key. `RepoEntity` does not define one ([entity.ts](../../web/lib/contracts/entity.ts#L39)).
- All 5,552 frozen lookup entries have no `node_id` key. `RepoLookupEntry` does not define one ([lookup.ts](../../web/lib/contracts/lookup.ts#L7)).

**Verified:** copying `curve.monthly`, `active`, `tracked_since`, and the recovered `d` still leaves `node_id` unset, and `ReposShardEntry` requires it. The public curves are not a schema-valid repo shard.

**Verified** from those seven entity bodies: 99234994, 149111813, 206462776, 304766583, and 824301644 each have at least one month at or before `2026-05`. 594330628 has only `2026-08`. 1278830624 has an empty monthly curve and `tracked_since` `2026-09-06`. **Inferred** from the census that lines the 5,249 pre-seam curves up with the May whitelist: the five are inside that whitelist, and the other two are among the 303 published repos outside it.

These are the retained objects to inspect. Each credentialed read is a future prerequisite. This document does not authorize it and did not perform it.

1. The current public shards, for the 5,545 overlapping ids only. The field to copy is that record's `node_id`. `active`, `tracked_since`, and the missing `d` stay with the frozen entity and the curve inversion.
2. The May metadata named by the aggregate collector: `leader/gsc0045/whitelist.json` (recorded SHA-256 `07f5a3b79bb26fe2d248686c1b064b405d1ddd0124f76746dc7e5bd75f2cb4de`) and `leader/gsc0045/repos.json`. Step 01 stores `node_id` from GitHub Search, and step 03 copies it ([03-metadata.mjs](../../pipeline/backfill/03-metadata.mjs#L25)). **Inferred:** that pair can cover the May 5,249, including the five pre-seam ids above, only when the recovered bytes give each id a non-empty `node_id`. It does not cover 594330628 or 1278830624. The preserved BigQuery whitelist table was inspected as `repo_id` only ([prod-rollout-and-data-repair.md](../../plans/prod-rollout-and-data-repair.md#L171)), so that parquet is the wrong object for this field. Whether either JSON file is inside `backups/2026-10-20/raw-backfill.tar.gz` is unverified.
3. A pre-rewrite copy of production `canonical/v2/repos/*.json`, or the 2026-09-13 whitelist snapshot. That is the retained candidate that could hold `node_id` for all 5,552, including the two post-May ids. Public `whitelist/latest.json`, `canonical/v2/whitelist/latest.json`, and `canonical/v2/whitelist/refresh-2026-09-13T06-00-16-398Z.json` are 404, and the views generation is not a copy of the repo shards. Finding a surviving object takes a credentialed prefix list.
4. GSC_0080 `inventory.json` records GraphQL `node.id` when a node came back ([star-history.mjs](../../pipeline/scripts/star-history.mjs#L216)). The member builder in the same file also writes `base64("010:Repository" + id)` ([star-history.mjs](../../pipeline/scripts/star-history.mjs#L36)). That synthesized string is not a recovered identity. An empty string is not one either. Neither value may be written for any of the 5,552.

Options A and B publish only after all 5,552 restored rows, including the seven, have a `node_id` taken from one of the retained objects above. Any id still missing stops the publication. A later credentialed GitHub metadata read is a further prerequisite for ids those objects do not cover. It was not done here.

### Private raw bucket `gitstarclub-raw`

Not read. Credentials would be required. The committed manifest [raw-data.sha256](../raw-data.sha256) and [OPS.md](../OPS.md) name the objects an operator would checksum with `cf r2 objects get` (not Wrangler):

| Key | Recorded contents | Use for this repair |
| --- | --- | --- |
| `star_daily_gross/data-0000000000{00..19}.parquet` | 20 objects, 30,907,971 bytes, 12,375,426 rows, `repo_id`, `day`, `gross_adds`, days `2015-01-01` through `2026-05-29` | Pre-seam weekly and daily group-by after the local rename `day AS date`, `gross_adds AS delta` ([04-rollup.mjs](../../pipeline/backfill/04-rollup.mjs#L21)). Step 07's week query reads those renamed columns ([07-export-v2.mjs](../../pipeline/backfill/07-export-v2.mjs#L200)). Prior local comparison said those months match the frozen views through `2026-05-29`. That comparison was not repeated here. |
| `bigquery-export/whitelist/data-000000000000.parquet` | 5,249 rows | Id set for the gross archive. **Inferred:** the inspected table column is `repo_id` only, so this parquet is not a `node_id` source ([prod-rollout-and-data-repair.md](../../plans/prod-rollout-and-data-repair.md#L171)). |
| `bigquery-export/star_daily_gross_gap_260530_260930_20261019/data-000000000000.parquet` | 90,797 rows, `2026-05-30` through `2026-09-30` | GH Archive gross for the gap. A 40-repo sample captured about 3.7 percent of GitHub's history proxy. Retained evidence, not a repair input ([OPS.md](../OPS.md), [prod-rollout-and-data-repair.md](../../plans/prod-rollout-and-data-repair.md)). |

GCP is retired. Do not treat `gs://gitstarclub-backfill-746384388303/` as a live copy.

[production-rollout-current.md](../../plans/production-rollout-current.md) records a 2026-10-20 read-only listing of `backups/2026-10-20/` with `raw-backfill.tar.gz`, `star-history-agg.tar.gz`, SHA-256 manifests, and `README.txt`. This session did not list or download them. The same plan says the backup README excludes two aggregate manifests that contain local paths, and that the backup must not be assumed to be a self-contained publish bundle ([production-rollout-current.md](../../plans/production-rollout-current.md#L69)). A manifest is the file inventory and its checksums. The collector's inventory files are `manifest.json` and `inputs/manifest.json` ([STAR-HISTORY-AGGREGATE.md](STAR-HISTORY-AGGREGATE.md)). **Inferred:** those are the two excluded files; the README itself was not read here. The SHA-256 files beside the tarballs checksum the archives. They are a different artifact from the collector's `inputs/manifest.json`.

**Inferred:** the aggregate tarball contains the local output described in [STAR-HISTORY-AGGREGATE.md](STAR-HISTORY-AGGREGATE.md), `inputs/canonical/v2/repo-recent-daily/0..31.json` and `repo-weekly/0..31.json`, and no `repo-monthly`. That layout is the collector contract. It was not opened in this session. Shard files, if present, are not the verification evidence. The committed run summary says 5,243 of 5,249 repositories complete, 6 `not_found_or_inaccessible`, 650,132 of 650,876 repository-days, and `inputs/manifest.json` SHA-256 `b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49`. Those counts were not re-measured. **Verified** as arithmetic on those recorded figures: `5,243 × 124 = 650,132` observed days, and `6 × 124 = 744` missing days. The 744-day deficit is the six unavailable repositories, each missing its whole window. It is not a set of holes inside the 5,243 complete repositories. The metric is surviving stars at collection time, GitHub calendar labels, not net growth. The same doc forbids folding those days into monthly totals. Recovering the original manifest bytes, including `inputs/manifest.json` hashing to `b9015837…`, is an unresolved prerequisite. Option B stops when that evidence cannot be recovered.

The six unavailable ids in that write-up include 206462776, 304766583, and 824301644, which are three of the seven published repos missing from today's canonical shards. Their **published curves still exist** and remain the monthly source. Aggregate daily for those three stays unknown.

### Tools, and what each refuses to do here

`pipeline/backfill/07-export-v2.mjs` builds meta, all four families, and `site-daily` from `star_daily.parquet`, with `schema_ver` 1 and `folded_through` set to the last gross day. It then stages a bootstrap generation and commits `bootstrap/latest.json` ([07-export-v2.mjs](../../pipeline/backfill/07-export-v2.mjs#L328)). That call does not pass `recoveryGeneration`. On this bucket the commit does not fit:

- `--initial-commit` refuses while `canonical/v2/meta.json` exists ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L341)). Views and bootstrap pointers are absent, so those two checks would pass. Meta blocks it.
- A normal first commit, with no pointer and no recovery generation, calls `verifyLegacyFlatTarget` ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L402)). That requires root `meta.json`, both lookups, both all-time ranks, canonical meta, and all 128 shards ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L17)). Root views and the three series families are 404.
- Deleting meta to make `--initial-commit` legal drops `seam_date` and `folded_through` and is the cleanup [OPS.md](../OPS.md) forbids on a populated production bucket.

The aggregate importer from #729 (`web/scripts/lib/aggregate-history-import.ts`) is the tool that already publishes with a recovery generation. It refuses this bucket: identity must be `gitstarclub-data-pre` / `pre` ([aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L262)). It also throws when an entity has a monthly curve and the canonical monthly file is absent ([aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L168)). That is exactly production. When the monthly file is absent and the curve is empty, it writes `{}` and does not invent totals ([aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L187)). It must not be pointed at production, and it must not be the tool that creates monthly history.

The commit path it uses is the one that can publish onto a bucket that already has meta: stage a recovery generation, then `commitBootstrapGeneration({ recoveryGeneration })`, which skips the legacy-flat proof ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L395)). Staging is create-only under `bootstrap/generations/<id>/`. The single mutable switch is `bootstrap/latest.json`, under the `ops/workflows/active.json` lease. Rollback is a pointer swap to that recovery generation ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L469)). `--rollback legacy-flat` needs the flat files `verifyLegacyFlatTarget` already cannot see.

A refresh with no bootstrap pointer writes canonical to the flat keys ([bootstrap-publication.ts](../../web/lib/data/bootstrap-publication.ts#L154)). Those writes are guarded by the same workflow lease, and they have no generation pointer to swap back. Rollback would be restoring a byte backup of the 32 repo shards and meta, then deleting the new series.

## 3. Repair options

All three leave the #745 marker unset, keep `schema_ver` 1, and do not copy preview shards. None is authorized by this document. Before any of them, an operator confirms the live Worker `MIN_TRACKED_STARS` is unset or `10000`. A 1,000-star floor would repeat the 65,033-row rewrite on the next refresh.

Common publish shape when an option is separately authorized: both the recovery generation and the repaired generation contain a `base` phase and a `canonical` phase (`BOOTSTRAP_PHASES`, [bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L15)). **Verified:** [verifyBootstrapGeneration](../../pipeline/lib/bootstrap-publication.mjs#L307) checks both phase manifests and their objects. A generation that seals only today's canonical bytes fails that check.

The `base` phase is a snapshot of the frozen views now served as `views/refresh-2026-09-13T06-00-16-398Z/` (lookup, entities, ranks, heatmaps). The recovery generation's `canonical` phase is today's canonical bytes. The repaired generation's `canonical` phase is the repaired shards, and its `base` phase is that same frozen-view snapshot. Both snapshots are taken while the shared writer lease is held (`ops/workflows/active.json`). **Verified** from the importer, which refuses this bucket and still shows the required shape: the stage loop writes the recovery generation and the repaired generation ([aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L321)) inside the callback `withBootstrapPublicationLease` runs ([aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L333)). The publication comment records the same lease around both snapshots ([bootstrap-publication.mjs](../../pipeline/lib/bootstrap-publication.mjs#L399)). A snapshot taken before the lease, or a canonical-only seal, is not a recovery edge. `views/latest.json` is 404, so the frozen tree is the fallback generation directory, not a pointer target.

Commit with `recoveryGeneration` under that lease, then one managed refresh. Do not hand-write `views/latest.json`. The refresh is what creates it. Take the backup before the first write. Worker rollback does not undo a data commit. These steps remain prerequisites for a separately authorized production write. This document does not authorize one. Options A and B also wait on a recovered `node_id` for every one of the 5,552, as section 2 requires.

### Option A. Restore the published 5,552 from the frozen curves, and pre-seam weeks from the gross archive

**Writes.** Replace the 32 repo shards with the 5,552 lookup members. `active` and `tracked_since` come from the frozen entity. `d` is the value that reproduced published stock (curve inversion for the 5,249; `0` for the 273 post-seam curves and the 30 empty curves). `node_id` comes only from a retained object in section 2, for every id, including the seven that are absent from today's shards. Dimension fields the entity already has (`owner`, `owner_type`, `name`, `full_name`, and the rest of the published identity) come from the frozen entity. Publication stops while any of the 5,552 lacks a recovered `node_id`. No row is completed by synthesis. `repo-monthly` receives `[period, adds]` from `curve.monthly`. `repo-recent-daily` receives each entity's pre-seam `recent_daily` only. `site-daily` receives the 140 month-heatmap day cells, holes included, no invented days.

Pre-seam `repo-weekly` is a week group-by of the gross archive for those 5,249 ids. The raw columns are `day` and `gross_adds`. Step 07's week query reads `date` and `delta` ([07-export-v2.mjs](../../pipeline/backfill/07-export-v2.mjs#L200)). **Verified:** the local projection that renames them is `repo_id, day AS date, gross_adds AS delta` ([04-rollup.mjs](../../pipeline/backfill/04-rollup.mjs#L21)). That conversion happens locally, into the parquet the week query reads, before the query is suggested or replayed. The monthly writer in step 07 stays unused, and this conversion is not permission to run step 04 or step 07 against the production bucket. Post-seam weeks are left absent: the gross archive ends `2026-05-29` (`2026-W22`), and this option writes no later weekly row. `folded_through.week` is advanced from `2026-W35` to `2026-W36` so the week phase's next Monday is `2026-09-07`, which is after `2026-08-31`, and fold does not read `pending/2026-08`. September pending stays absent, so the month phase skips September. No `history-availability.json`.

**Monthly repository curves.** **Verified:** copying `adds` and the recovered `d` reproduces every published stock point on the current formula for all 5,522 non-empty curves. The 30 empty curves stay empty. That check is the repository curve. It does not measure monthly rank files or organization curves after a managed refresh. **Inferred**, and conditional on the metadata step leaving active membership and joined identity unchanged: those artifacts would then match the frozen generation. [metadata.ts](../../web/lib/workflows/steps/metadata.ts#L163) marks every previous row inactive and reactivates only the current Search snapshot, then refreshes identity from GraphQL. [windows.ts](../../web/lib/workflows/recompute/windows.ts#L185) omits `active: false` repositories when it builds active-only organization curves. Before any publication, compare the new monthly repo rank files, organization curves, and month heatmaps with `views/refresh-2026-09-13T06-00-16-398Z`. A is the monthly-recovery direction under those conditions. It is not a measured end-to-end preservation procedure.

**Unknown repos.** No published repository is missing a monthly curve that the generation had. The 30 empty curves have no monthly observations to restore. Post-seam weekly values are unknown for the whole 5,552 except the published top 100 in each existing week file; those 100 cannot fill a shard. The 303 repos outside the May whitelist have no pre-seam weekly rows in the gross archive; their curves have no pre-seam months either. The 38 canonical-only repos at or above 10,000 stars, and the 59,450 below 10,000, are dropped. Their history was not in the frozen generation.

**Watermark cost.** `2026-W36` (31 August through 6 September) will not be folded later. August's monthly total already includes 31 August. The frozen generation has no `2026-W36` rank file. This does not change a published monthly number.

**Publish and rollback.** Recovery-generation commit above. Rollback swaps the pointer to the sealed pre-repair bytes. Flat writes, if used instead, roll back only from that backup.

**Runtime.** **Inferred.** Building the JSON from the already-fetched curves is minutes. A DuckDB week group-by of 12.4 million gross rows is minutes on a laptop-class machine; it was not timed here. Staging is on the order of the documented shard sizes (monthly tens of MB, weekly up to the ~64 MB estimate in [VERCEL-DATA-OPERATIONS.md](../VERCEL-DATA-OPERATIONS.md)). The only measured production refresh in this evidence ran from `2026-09-23T01:44:09Z` to `04:54:25Z` (about 3 hours 10 minutes) on the 65,033-row universe and died in fold, before recompute. A 5,552-row refresh that finishes publish is a separate, shorter metadata job plus recompute. Treat several hours as the planning figure, and measure the first approved run.

**Weekly rank files this option drops.** **Verified** from source: [collectSeriesPeriods](../../web/lib/workflows/recompute/io.ts#L273) lists a period only when a shard row contains it, and [recompute-rank.ts](../../web/lib/workflows/steps/recompute-rank.ts#L196) writes a rank file only for those periods. Under A no repository has a weekly observation after `2026-W22`, so the new generation has no rank file for those later weeks. Recompute writes a file for a period only when the shards contain it, and the published `2026-W23` through `2026-W35` files (except the already absent `2026-W27`) drop out of the selected generation. **Verified** at 19:47Z: `rank/week/2026-W23/repo/flow.json` and `rank/week/2026-W35/repo/flow.json` each return 200 with 100 `items`, and `2026-W27` is 404. The earlier census in this document found the other weeks from `2026-W23` through `2026-W35`, except `2026-W27`, present under the frozen generation. `live/latest.json` is a valid pointer whose generation fields are null, so it names no fallback generation that keeps serving `refresh-2026-09-13T06-00-16-398Z` once `views/latest.json` points at the new run.

Publishing A requires an explicit acceptance of that loss: the frozen week ranks `2026-W23` through `2026-W26` and `2026-W28` through `2026-W35` disappear. The alternative is a separately reviewed publisher that copies those existing rank objects into the new generation and states how they sit beside weekly shards with no rows for those weeks. Recompute does not do that copy. Until the loss is accepted, or that separate review accepts a copy, A stays unpublished.

### Option B. Option A, plus the aggregate gap as daily and weekly rows that never enter monthly

**Writes.** Everything in A, plus the aggregate daily rows and the complete ISO weeks `2026-W23` through `2026-W39`, for the 5,243 complete whitelist repos. Insert a weekly key only when that week is absent. The partial weeks `2026-W22` (30–31 May) and `2026-W40` (28–30 September) stay out of the weekly shard: A's gross `2026-W22` stays the gross sum, and the three-day `2026-W40` sum is not stored as a week row. The collector's sidecar provenance is the export manifest. The runtime reads a different field. **Verified:** [windows.ts](../../web/lib/workflows/recompute/windows.ts#L118) loads `repos[id].aggregate_history.weeks`, and [windows.ts](../../web/lib/workflows/recompute/windows.ts#L69) uses that set so a survivor count does not advance `cumGross`, `cumNet`, or the seam anchor. The internal stock for that week is the unknown-stock sentinel `-1`. Stock rankings omit the row ([ranks.ts](../../web/lib/workflows/recompute/ranks.ts#L78)). The flow ranking is labeled aggregate only while that stock is negative ([flow-provenance.ts](../../web/lib/workflows/recompute/flow-provenance.ts#L14)). [aggregate-history-import.ts](../../web/scripts/lib/aggregate-history-import.ts#L89) writes both pieces the reader expects: `provenance` set to the strict surviving-star literal, and `weeks` set to the week keys actually inserted. B writes that same object on every repository that received an aggregate week. [metadata.ts](../../web/lib/workflows/steps/metadata.ts#L216) copies `aggregate_history` forward on a later refresh, so the object has to be on the shard before that refresh. A sidecar next to the shard leaves the field empty. **Verified** from the same stock path: recompute then treats the survivor sums as ordinary net growth, publishes a computed weekly stock, and the flow label is the ordinary-history label.

Monthly reconstruction stays the curve copy from A. It is a separate write. These daily and weekly rows are not its input. The importer is not used to derive the monthly shards, and it is not pointed at production.

**Monthly numbers.** Same repository-curve result as A. Aggregate days stay out of month fold and out of `04-rollup`, `05-precompute`, and `07-export-v2`. That separation is the collector contract ([STAR-HISTORY-AGGREGATE.md](STAR-HISTORY-AGGREGATE.md)). The pre-publication comparison A requires still applies.

**Unknown repos.** The six `not_found_or_inaccessible` whitelist repos have no aggregate days. **Verified** as arithmetic on the committed summary: the 744 missing repository-days are `6 × 124`, the whole window of those six. The 5,243 complete repositories account for the 650,132 observed days (`5,243 × 124`). Those 744 days stay absent. A zero is not a substitute. Three of the six still have published monthly curves, which the curve copy restores. The 303 repos outside the 5,249 whitelist have no aggregate rows. Weekly values are surviving-star sums. On weeks the frozen top 100 also covers, the survivor sum and the frozen net are different measurements. That gap was not re-measured in this session. B does write `2026-W23` through `2026-W39` shard rows, so recompute emits week rank files for the inserted weeks. Those files are survivor-sum ranks. The `aggregate_history.weeks` list is what marks them. **Inferred** from the collector metric, and not from a new rank comparison: those ranks are a different series from the frozen top 100.

**Publish, rollback, runtime.** Same protocol as A, including the `node_id` gate and the two phase snapshots under the writer lease. Before staging, a credentialed read has to recover the original `inputs/manifest.json` and show SHA-256 `b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49`. The backup directory listing, the tarball's sibling checksum, and shard files with no original manifest are short of that evidence. Option B stops when the exact manifest cannot be recovered. **Inferred** extra time is that download plus a local replay of the recovered manifest, not a new GitHub collection. If the recovered bundle lacks the input shards the collector doc describes, this option stops. Before publication, check that each inserted week is listed in that repository's `aggregate_history.weeks`, that `provenance` matches the strict literal, that the monthly shards are still the curve copy, and that a week-window evaluation of an imported week leaves the seam accumulators unmoved.

The week watermark advance in A still applies, so the next fold does not read the missing `pending/2026-08`. Week rows start strictly after `folded_through.week` ([fold.ts](../../web/lib/workflows/steps/fold.ts#L725)). With the watermark left at `2026-W35`, a later fold that has pending days appends `2026-W36` and later weeks. Those new weeks are further periods. They are not combined into the imported `2026-W23` through `2026-W39` values. **Verified:** when a plan does emit a week a repository already stores, [fold.ts](../../web/lib/workflows/steps/fold.ts#L664) removes that period and writes the pending flow in its place. Repositories the plan omits keep the previous tuple, so one week file can mix survivor-sum rows and pending-net rows. The two flows are not added. Month fold is a separate writer. Keeping aggregate days out of it, and keeping September pending absent, is what leaves the curve-copied monthly shards in place. The watermark does not tell recompute which weekly rows are survivor sums. `aggregate_history` does that.

### Option C. Replay `07-export-v2` on the gross archive alone

**Writes.** Step 07's full canonical set from the 20 gross parquet files: meta, repos, monthly, weekly, recent-daily, site-daily. The raw columns are `day` and `gross_adds`. **Verified:** step 07 reads `date` and `delta` ([07-export-v2.mjs](../../pipeline/backfill/07-export-v2.mjs#L199)), after the local projection `day AS date, gross_adds AS delta` ([04-rollup.mjs](../../pipeline/backfill/04-rollup.mjs#L21)). That conversion is a local prerequisite before any replay, and it is part of a separately authorized write. `repos.json` still has to supply a real `node_id` per row. The synthesized helper in section 2 is not that value. `folded_through` becomes the last gross day, month `2026-05` and week `2026-W22`. June through August disappear from the shards.

**Monthly numbers.** Pre-seam months can match the frozen flows only for the 5,249 ids in the archive, and only if the prior comparison still holds. It was not re-run. The 273 published post-seam curves and the 30 empty-curve newcomers are absent from that parquet. June, July, and August flows that are on the site today would be gone. This option does not keep the published monthly series.

**Unknown repos.** The 303 published repos outside the May whitelist have no rows in the gross archive. The 6 aggregate-unavailable repos are irrelevant here because this option does not read the aggregate. The expanded 65,033-row universe is replaced by whatever `repos.json` step 07 is given. That file is not in the public bucket. **Inferred:** it might be inside `raw-backfill.tar.gz`. If it is the May bootstrap file, its `current_stars` and `d` are the original seam values, which are a better `d` than curve inversion for those 5,249, and a worse membership than the September lookup.

**Publish.** The script's own `--initial-commit` and legacy-flat commit both refuse this bucket, as section 2 says. The same recovery-generation wrapper as A would be required, and it would publish the wrong months. **Do not use this option to repair production.**

**Rollback and runtime.** Same pointer rollback if a generation was committed. **Inferred** runtime is a local DuckDB export of the 12.4 million rows plus the upload, minutes to a few tens of minutes, then a refresh that would publish the shortened history.

## What an operator still has to read with credentials

These were not read:

- `cf r2 objects list` on `gitstarclub-data-prod` for `canonical/v2/repo-monthly/`, `repo-weekly/`, `repo-recent-daily/`, `pending/`, `site-daily/`, `bootstrap/generations/`, and any pre-rewrite `canonical/v2/repos/` or `canonical/v2/whitelist/` copy. Confirms the 404s are absent keys rather than a CDN miss, and shows whether an unreferenced generation still holds the September series and the seven missing `node_id` values.
- The same list and `cf r2 objects get` on `gitstarclub-raw` for the 22 manifest keys, checked with `shasum -a 256 -c docs/raw-data.sha256`, plus `backups/2026-10-20/`. For option B, recover the original collector `inputs/manifest.json` (SHA-256 `b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49`) and the other aggregate manifest the backup README excludes. The tarball listing is not that check.
- The May `whitelist.json` / `repos.json` named in section 2, wherever the retained copy actually is, read only to copy `node_id` for ids the public shards do not cover. GSC_0080 inventory records count only where they stored GraphQL `node.id`.
- The live Worker variable `MIN_TRACKED_STARS` on `gitstarclub-web` (the value of that one variable, not secrets).

## Recommendation

Option A is the monthly-recovery direction. **Verified:** the frozen monthly `adds` and the current stock formula reconstruct every non-empty repository curve. Publishing it waits on all of the following.

- A retained `node_id` for all 5,552 repositories, including the seven absent from today's shards. A synthesized id, including `base64("010:Repository" + id)`, stops the option.
- Acceptance that the published week rank files `2026-W23` through `2026-W26` and `2026-W28` through `2026-W35` disappear from the new generation. **Verified** this session: `2026-W23` and `2026-W35` each have 100 entries, and `2026-W27` is already 404. `live/latest.json` names no fallback generation. The other path is the separately reviewed copy described under A.
- A comparison, before publication, of monthly repo rank files, organization curves, and month heatmaps with the frozen generation. The curve check does not establish those artifacts. Metadata can change active membership, and active-only organization curves follow that membership.
- A frozen-view `base` phase on both the recovery generation and the repaired generation, with both snapshots taken under the shared writer lease.
- The local `day` / `gross_adds` to `date` / `delta` conversion before the pre-seam week query.

Option B is A plus the aggregate daily rows, the complete weeks `2026-W23` through `2026-W39`, and the per-repository `aggregate_history` object recompute reads (`provenance` and the imported week list). Monthly reconstruction stays the separate curve copy. B also stops unless the original `inputs/manifest.json` checksum `b9015837…` is recovered. The 744 missing repository-days belong to the six unavailable repositories and stay missing. Because those weeks are written, the new generation emits survivor-sum week ranks for them, and the week list is what labels them. **Inferred** from the collector metric: those ranks are a different series from the frozen top 100. The rank lists were not recomputed here.

Option C drops June through August. It is not the production repair.

The preview history marker and the preview empty monthly shards stay off this bucket. The 65,033-row repo shards are replaced as the membership baseline. Their `node_id` strings are the retained identity for the 5,545 overlapping ids, and for those ids only.
