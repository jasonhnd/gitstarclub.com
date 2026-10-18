# Production rollout and data repair plan

Status: draft for owner decision. References #543 (P0, open). Closes nothing.
Order: SB-20261018-09, step 1.3. Evidence date: 2026-10-18 about 14:30 UTC.

This plan stops before any production deploy, secret change, cron change, or R2 or Blob write. It is built from the accepted diagnosis on GSC_0017, `docs/OPS.md`, `docs/R2-CUTOVER.md`, `docs/PIPELINE.md`, the repository code, and unauthenticated public GETs. `wrangler` is not authenticated on the authoring machine. Anything that needs live Cloudflare state is marked **to verify by operator**.

## 0. Starting state

| Item | State | Evidence |
|---|---|---|
| Production code | `daee5fc` (deployed 2026-10-04) | `GET https://gitstarclub.com/.well-known/deployment` |
| Preview code | `5af183a` | same endpoint on `pre.` |
| Latest code | `main` = `99cb00e`, tree-identical to `pre` `eb24ac8` | `git diff origin/pre origin/main` is empty |
| Code delta `daee5fc..main` | 6 runtime files: Worker edge cache (`web/lib/workers-host/edge-cache.ts`, `workers/gitstarclub-web/src/{index,env}.ts`), tests, `web/package.json` pin of `source-map-js` 1.2.2 (#655), plus docs and pipeline tests | `git diff --stat daee5fc origin/main` |
| Schedules | none: top-level `triggers.crons: []`, `env.pre` `[]` | `workers/gitstarclub-web/wrangler.jsonc` |
| Production views pointer | `views/latest.json` and `bootstrap/latest.json` 404; pages live on `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` | `https://data.gitstarclub.com/...` |
| Production canonical | `canonical/v2/meta.json` 200 (`folded_through` month 2026-08, week 2026-W35, `seam_date` 2026-05-30); `repos/0..31` 200; `repo-monthly`, `repo-weekly`, `repo-recent-daily` 0/32; `pending/2026-08.json` 404; `site-daily/{2024,2025,2026}.json` 404; `whitelist/latest.json` 404; `star_daily.parquet` 404 | public GETs, GSC_0017 E4 and this card |
| Last refresh run | `refresh-2026-09-13T06-00-16-398Z` is the last good publish. The 2026-09-23 run failed with `canonical/v2/pending: missing required frozen period(s) 2026-08` | `ops/workflows/active.json`, `health/workflow-refresh.json` |
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

### B1. Copy missing kinds and `pending/2026-08` from the old Vercel Blob store: not available

* Public probe (read-only): all 13 keys tried return 404 `Store not found`, including `views/refresh-2026-09-13T06-00-16-398Z/meta.json`, which R2 holds. The store is deleted or disabled. The public base URL is recorded in `docs/R2-CUTOVER.md` and `docs/OPS.md`.
* What could still be true: the Vercel dashboard or Vercel support may be able to restore a deleted store; the owner may hold local exports. **To verify by operator.** If a copy surfaces, `web/scripts/sync-blob-to-r2.ts --prefix canonical/v2/ --execute` (dry-run by default; needs `DEPLOY_ENV=production`, the Blob token, an R2 S3 key) is the existing copy tool.
* Closes P2 and P3: only if a snapshot dated at or after the 2026-08 freeze exists. Today: no. Cost 0 and zero spend risk, but currently no source.

### B2. Rebuild with the pipeline from GH Archive: possible, but cannot land on the populated bucket as-is

Steps (`docs/PIPELINE.md` section 1, `docs/OPS.md` one-time bootstrap):

1. `01-whitelist.mjs`: GitHub Search with `stars:>=10000`, adaptive buckets (needs `GITHUB_TOKEN`; about 5.3k repositories).
2. `02-extract.mjs`: render the BigQuery SQL with a **new** dated table and a cutoff suffix; dry-run with `--maximum_bytes_billed=400000000000`; then run. Requires a GCP project and credentials (`GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT_ID`). Docs measured about 303 GB scanned and budgeted about $10 for the 2015 to 2026-05-31 extract. A cutoff near today scans slightly more; confirm with the dry run. Export Parquet locally.
3. `03-metadata.mjs` (GraphQL, `GITHUB_TOKEN`), `04-rollup.mjs` and `05-precompute.mjs` (DuckDB, local; precompute uses `--max-old-space-size=4096`).
4. `06-upload.mjs` and `07-export-v2.mjs --stage-only` create-only into `bootstrap/generations/<id>/...` of the chosen bucket. Needs a bucket-scoped R2 S3 key (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PRE|PROD`), kept outside the repository. Runtime: one local machine, unmeasured, plausibly several hours.
5. Commit (`07 --initial-commit` or a normal commit). **Blocker:** `--initial-commit` refuses when `canonical/v2/meta.json` already exists (`bootstrap-publication.mjs` `INITIAL_COMMIT_ABSENT_PATHS`), and the normal commit path runs `verifyLegacyFlatTarget`, which requires all 128 flat canonical objects plus `meta.json`, `lookup/*` and `rank/all-time/*` at the bucket root. Production has none of the three missing kinds, so both fail closed. Landing it needs either (a) a reviewed code change to the commit gate, or (b) removing `canonical/v2/meta.json` first, which `docs/OPS.md` explicitly says not to do on the populated copy, and which destroys the only copy of the live `repos` shards. Either needs its own authorization and a full backup of `gitstarclub-data-prod` first.

Data semantics to decide before running:
* **Cutoff.** If the cutoff is the last closed month end (2026-09-30), the rebuilt `folded_through` is month 2026-09, and the fold needs no pending until the following month closes. This closes P3 by construction (inference from `fold.ts`; **verify with a local fixture fold before trusting**). A cutoff of 2026-05-31, the original, would leave June to September for pending data that no longer exists.
* **Gross versus net.** Bootstrap history is GH Archive gross `WatchEvent` counts; the live cron appends GraphQL net deltas after `seam_date`. `docs/OPS.md` (W27 recovery) records that 2026 `WatchEvent` volume is far below 2024 samples (about 80x lower in a spot check). A rebuild through mid-2026 may undercount recent months. Published rank values would change relative to the frozen 2026-09-13 views. This needs an owner decision and a comparison against the frozen views before any production commit.
* All four kinds, `repos`, `site-daily` and the whitelist pointer are regenerated together; do not mix new kinds with old `repos` shards (anchor factor `d` and `tracked_since` would disagree).
* Whitelist drift since May is normal weekly churn at the same 10k floor.

Recommended execution order for B2: rehearse the whole chain into `gitstarclub-data-pre` (empty, supports `--initial-commit`, matches the documented stage 2), then reuse the same local artifacts for production. Preview then also gets real data.
Closes: P2 yes (all 128 shards and `site-daily`); P3 yes if cutoff is the last closed month end; P4 only after the first managed refresh. Spend: BigQuery plus local compute; GitHub API quota. Risk: high (changes published numbers; production commit path blocked; R2 write to the data bucket).

### B3. Other paths

* **B3a. Targeted `pending/2026-08` (and `2026-09`) from GH Archive.** Small BigQuery extract of two months of daily `WatchEvent` per whitelisted repo (scan likely well under the full extract; dry-run to confirm). No existing tool writes `pending/*` from archive data (`web/scripts/backfill-live-week.ts` writes live rank only), so it needs a new reviewed script. Closes P3 only. Does **not** close P2, which still needs the three kinds. Gross-versus-net caveat applies. Not sufficient on its own.
* **B3b. Reconstruct `repo-monthly`, `repo-weekly`, `repo-recent-daily` from the frozen views** (`views/refresh-2026-09-13.../entity/repo/<id>.json` curves and period tables, which are deterministic functions of canonical). Existing offline harness `web/scripts/parity-recompute.ts` could check a reconstruction by recomputing and diffing views. Lossy risk: weekly and 90-day daily series may not be recoverable exactly. Needs an analysis card before any decision; unverified. No new data source, so no coverage change.
* **B3c. Searching for another copy.** The preview bucket is empty (only `_meta/bucket-identity.json`), so it is no source. Owner-side: local machines, a Parquet or `data/` directory (none found in the repository checkout), cloud storage used for the original bootstrap (`gs://` export bucket from `02-extract.sql`), Vercel dashboard. **To verify by operator.** A found `star_daily.parquet` or exported `v2/canonical/v2` directory would make B2 much cheaper (steps 04, 05, 07 only, no BigQuery spend).
* **B3d. Not allowed:** fabricating empty frozen pending on production (cold-start is physically gated to `DEPLOY_ENV=pre`); hand-writing `views/latest.json` or `bootstrap/latest.json`; relaxing validation.

### B4. Comparison

| Option | Closes P2 | Closes P3 | Changes coverage (lock-002) | Spend | Main risk |
|---|---|---|---|---|---|
| B1 Blob copy | yes, if a copy existed | yes, if recent | no | none | source is gone |
| B2 BigQuery rebuild | yes | yes with last-month-end cutoff | no, same 10k universe and metrics; backfilling the same coverage is not expansion | BigQuery about $10 per docs, GitHub quota, local compute | blocked commit path, changed numbers, destructive-cleanup temptation |
| B3a pending only | no | yes | no | small BigQuery | partial, gross vs net |
| B3b reconstruct from views | maybe | no | no | none | lossy, unproven |
| B3c find local copy | yes | depends on its date | no | none | may not exist |

Recommendation: (1) operator read-only checks (section D0), including B3c and the Vercel dashboard; (2) if no copy exists, B2 rehearsed on preview first with a cutoff of the last closed month end, preceded by a decision card for the production commit mechanism and a full R2 backup. Do not start any R2 write before the owner approves.

## C. Re-enabling the production schedule and fallback removal

### C1. Prerequisites (all must be true)

1. Section B complete: production canonical passes the 128-shard preflight (`GET .../api/workflows/refresh/start` returns a `run_id`, not 500).
2. Secrets present on `gitstarclub-web` by name (**to verify by operator**: `wrangler secret list --name gitstarclub-web`; values are never read): `CRON_SECRET` (at least 32 characters, no leading or trailing whitespace) and `GITHUB_TOKEN`. Missing ones are set with `wrangler secret put <NAME> --name gitstarclub-web` [owner authorization needed: secret]. Optional `ALERT_WEBHOOK_URL`. `BLOB_READ_WRITE_TOKEN` stays until stage 6.
3. Queue `gitstarclub-jobs` consumer healthy (**to verify by operator**).
4. `WORKFLOW_FIXTURE` is not set on production (it is not in `wrangler.jsonc`; confirm no dashboard var). On preview it is `"1"`, which turns scheduled refreshes into no-ops.

### C2. Config and gate changes (one reviewed PR into `pre`, then promotion)

* `workers/gitstarclub-web/wrangler.jsonc`: top-level `triggers.crons`. Use `SUN`, never `7` (Saturday) or `0`. Suggested sequence: first `["0 6 * * SUN"]` only (managed refresh), after one clean publish add `"0 3 * * *"` and `"0 4 * * SUN"` (daily and weekly live cron depend on `live/latest.json`; the daily skips until a publish). Stage 5 text in `docs/R2-CUTOVER.md` lists all three.
* `scripts/cf-ci-gates.mjs`: remove or invert `productionCronsAreEmpty` and its issue message (about lines 306 to 308 and 391 to 394), set the returned `productionCrons` and the final console message (about lines 816 and 827) from the real list, add an exact-match check against the intended production list (mirror `previewCronIssues`), keep the ambiguous-weekday check. Update `scripts/cf-ci-gates.test.mjs`.
* `.delivery.yml`: line 19 comment and the assertion that production `triggers.crons` is `[]` (`scripts/cf-ci-gates.mjs` about line 723 greps for it). `.github/workflows/ci.yml` also mentions the contract. Editing these files is outside executor scope unless the owner explicitly asks.
* Docs in the same PR: `docs/OPS.md` (several "stay `[]`" sentences), `docs/R2-CUTOVER.md` stage 5, `docs/PIPELINE.md`, `docs/API.md`, `docs/TESTING.md`, `docs/CODEBASE.md`, `docs/README.md`, `README.md`, and the comment block in `wrangler.jsonc`.
* Then deploy per section A [owner authorization needed: cron, deploy]. The deploy is what applies the cron triggers. Rollback: set crons back to `[]` and redeploy; the Worker scheduled handler rejects unknown cron strings.

### C3. First refresh

Prefer one manual authenticated run before relying on the schedule [owner authorization needed: R2 write, spend (GitHub quota)]:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://gitstarclub.com/api/workflows/refresh/start
```

Watch `ops/workflows/<run_id>/steps/*.json`, `health/workflow-refresh.json` and Workers Observability. There is no dry run for managed refresh. Do not call `/api/cron/*` as a substitute. A successful publish writes `views/latest.json` (never hand-write it), then run the data-exports regeneration from `docs/DATA-EXPORTS.md`.

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
   0.4 [no auth] Vercel dashboard: is the Blob store `cdv7ejjwmzbbdj8w` deleted, paused or recoverable; any export or backup. Ask whether any local `star_daily` Parquet or `v2/canonical/v2` export exists.
   0.5 [no auth] Check the Workers request log for any external caller of `/api/workflows/refresh/start` since 2026-09-13.
1. [no auth] Pre-deploy checks A2 on the exact `main` head; record results.
2. [no auth] Capture A5 rollback record and A2.7 baseline.
3. [no auth] Build production shell A3.
4. [owner authorization needed: deploy] Deploy `main` (A4).
5. [no auth] Post-deploy smoke A6; on failure [owner authorization needed: deploy] rollback A5.
6. [no auth] Decision card for the data repair: choose B1/B2/B3 after step 0.3 and 0.4; decide cutoff and gross-versus-net handling; decide the production commit mechanism for B2; request a full backup plan.
7. [owner authorization needed: R2 write] Full backup copy of `gitstarclub-data-prod` before any repair write.
8. [owner authorization needed: spend] GCP project use and BigQuery run (dry-run first with the byte cap), plus GitHub token use for whitelist and metadata.
9. [owner authorization needed: R2 write] Rehearse the whole chain into `gitstarclub-data-pre` (bucket-scoped key kept outside the repo); verify preview rankings.
10. [no auth] Local fixture fold test proving the rebuilt canonical advances without `pending` (B2 cutoff inference).
11. [owner authorization needed: R2 write] Stage and commit the rebuilt generation to `gitstarclub-data-prod` with the approved commit mechanism (B2 step 5). Never delete `_meta/`, never hand-write a pointer.
12. [owner authorization needed: secret] Set `CRON_SECRET` and `GITHUB_TOKEN` on `gitstarclub-web` if step 0.2 shows them missing.
13. [no auth] Land the C2 PR (wrangler crons, `cf-ci-gates.mjs` and its tests, docs) into `pre` with the local full gate; `.delivery.yml` edit only with explicit owner request.
14. [owner authorization needed: cron] Approve the production schedule change (start with `0 6 * * SUN`).
15. [owner authorization needed: deploy] Promote to `main` and deploy with the crons (section A procedure).
16. [owner authorization needed: R2 write, spend] First managed refresh run (C3); confirm `views/latest.json` 200.
17. [owner authorization needed: deploy] Optionally add daily and weekly crons after one clean publish; rotate `EDGE_CACHE_VERSION`.
18. [owner authorization needed: deploy] Remove `VIEWS_VERSION_FALLBACK` (C4) after its conditions hold. Stage 6 Blob retirement is a separate decision.
19. [no auth] Docs PR correcting the stale Blob rollback references in `docs/OPS.md` and `docs/R2-CUTOVER.md`.

## Open questions for the owner

1. Is a rebuild with changed published numbers acceptable, or must the frozen 2026-09-13 numbers be preserved (which favors B3b or B1 over B2)?
2. Which production commit mechanism is acceptable for B2: a reviewed code change to the commit gate, or a backed-up manual cleanup?
3. May the roll-out of `main` (section A) happen ahead of the data repair?
