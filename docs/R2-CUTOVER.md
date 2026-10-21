---
owner: operations / storage
status: active
last_reviewed: 2026-10-19
source_of_truth_for:
  - R2 cutover runbook
  - current object-storage status
  - R2 stage plan and rollback
---

# R2 cutover

Host commands below preserve the accepted historical cutover. They are retired
and must not be executed for the current source host. Use [VINEXT-HOST.md](VINEXT-HOST.md)
for vinext/cf builds and separately authorized delivery. Storage acceptance dates
and resource identities below remain unchanged.

> **Current status:** Stage 4 (production cutover) was accepted on 2026-10-04 (Jason, 17:59 JST), as recorded in [PR #649](https://github.com/jasonhnd/gitstarclub.com/pull/649). That record names Worker version `c163a860` and deploy commit `c32b373`; these are historical acceptance identifiers, not the current deployment identity. The accepted operator path copied the Blob store into production R2 and switched the Worker to it. The original empty-bucket bootstrap stages 2/3 remain unaccepted. Stages 5 (production crons) and 6 (Blob retirement) remain unaccepted.
>
> Storage sentence used across the current docs: Cloudflare R2 (production cutover accepted 2026-10-04; see docs/R2-CUTOVER.md). Blob remains a retained rollback store and operating dependency until separately authorized retirement.

This file is the source of truth for where object storage is going and which stage is current. Historical P0 adapter notes live in [archive/R2-MIGRATION-P0.md](./archive/R2-MIGRATION-P0.md). The Blob publish and refresh design lives in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md). Both are superseded for storage status. Retained Blob rollback layout and the current environment inventory stay in [OPS.md](./OPS.md).

This document does not create buckets, change DNS, deploy a Worker, or write either store.

## Private raw archive and GCP retirement (2026-10-19)

Raw/backfill data lives only in private R2 `gitstarclub-raw`, separate from the public `gitstarclub-data-prod` and `gitstarclub-data-pre` buckets. Its original `star_daily_gross/data-0000000000{00..19}.parquet` set has 20 objects, 30,907,971 bytes, and 12,375,426 rows. The preserved whitelist (5,249 rows) and 2026-05-30 through 2026-09-30 gap table (90,797 rows) live under `bigquery-export/<table>/`. The archive has 22 objects in total. The gap export is retained evidence, not an approved data repair.

GSC_0071 deleted GCP project `gitstarclub` at 2026-10-19T11:12:41Z (observed `DELETE_REQUESTED`; final purge deferred). The calculated 30-day recovery deadline is 2026-11-18T11:12:41Z. GCS and BigQuery are retired; GH Archive extraction is retired in favor of GitHub's own star history (owner decision d1019-001344-1), without authorizing collection or publication. See [OPS raw-data inventory and read-only cf verification](./OPS.md#raw-backfill-data) and its [SHA-256 manifest](./raw-data.sha256). Verification uses `cf r2 objects list/get` and `shasum -a 256 -c`, never Wrangler. The raw archive does not change the production cutover stages or authorize writes.

## Read-only state check (2026-10-13)

GSC_0001 reconciliation was repeated on this documentation card, GSC_0002, with unauthenticated public GETs at 11:25 UTC (20:25 JST):

| Public surface | Result | Evidence limit |
| --- | --- | --- |
| [Production deployment identity](https://gitstarclub.com/.well-known/deployment) | HTTP 200; `commitSha=daee5fc2ee35a62963ec8eb02cc566f30ed83964`, `target=cf` | Public built identity; no provider version UUID or traffic split was inspected. |
| [Preview deployment identity](https://pre.gitstarclub.com/.well-known/deployment) | HTTP 200; `commitSha=5af183ac3f710981b4742651b53c93d377da2adf`, `target=cf` | This is the resumed integration baseline, not the production identity. |
| [Production bucket identity](https://data.gitstarclub.com/_meta/bucket-identity.json) | HTTP 200; `bucket=gitstarclub-data-prod`, `deploy_env=production` | Public marker only; live Worker bindings were not inspected. |
| [Production views pointer](https://data.gitstarclub.com/views/latest.json) and [bootstrap pointer](https://data.gitstarclub.com/bootstrap/latest.json) | Both HTTP 404 | Neither pointer is currently proof of a published bootstrap generation or completed production refresh. |
| [Frozen views metadata](https://data.gitstarclub.com/views/refresh-2026-09-13T06-00-16-398Z/meta.json) | HTTP 200; `generated_at=2026-09-13T06:25:07.096Z` | The copied frozen generation is available. This does not independently prove full copy parity, all page data, or a successful refresh. |

The checked-in production contract still sets `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`. Preserve it in the Worker and production build shell while the authoritative views pointer is absent. PR #649 records the retained fallback and Blob secret at cutover; current secret values/presence, provider UUID, bindings, schedules, outbound read logs, and retained rollback availability were not independently checked. Public GETs and this documentation synchronization do not constitute new operator acceptance or authorize a refresh/deploy.

## 2026-10-03 migration batch (steps 1–3)

Jason 2026-10-03 resume: Blob → R2 migration was split from formal traffic cutover. This accepted copy path is distinct from the unaccepted empty-bucket stages 2/3 below. Config [PR #648](https://github.com/jasonhnd/gitstarclub.com/pull/648) (`c32b373`) implements [issue #647](https://github.com/jasonhnd/gitstarclub.com/issues/647); #647 is the issue number, not the config PR.

| Step | Owner | Scope | Accepted when |
| --- | --- | --- | --- |
| **1 — Write-path audit (read-only)** | Backend engineer | List every in-repo Blob **writer**, trigger, and whether it is still schedulable; explain freeze-period growth (e.g. `ops/sync-runs.json`). No code or schedule changes. | Project store report `internal/r2-migration-20261003.md` (2026-10-03) |
| **2 — Inventory + R2 copy** | BOT / operator | Blob object inventory and copy into `gitstarclub-data-prod` at bucket root. **Do not** use repo Cloudflare API copy from this agent run. | Jason confirms byte/key parity vs Blob |
| **3 — Config + docs (no deploy)** | Backend engineer | PR on `pre`: top-level wrangler switches to stage-4 R2 vars (`STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, `DATA` → `gitstarclub-data-prod`, remove production `BLOB_*`; keep `VIEWS_VERSION_FALLBACK` until `views/latest.json` exists on the store production reads). Update this file (formal cutover checklist below). **Do not `wrangler deploy` production or merge to `main`.** | Jason 2026-10-04: R2 copy parity accepted; `node scripts/assert-cf-ci-gates.mjs` green; R2-vs-Blob page parity on `data.gitstarclub.com` |

**Not in steps 1–3 (explicitly deferred):**

- ~~Production Worker deploy that would make `gitstarclub.com` read R2 (stage 4 cutover acceptance).~~ **Done 2026-10-04** (see current status).
- Production `triggers.crons` enablement (stage 5).
- Blob store retirement (stage 6).
- Changing secret values, Bearer publish, or destructive Blob operations.

Formal cutover was stage 4 **live Worker deploy** + acceptance after step 2 passes (**completed 2026-10-04**). Merging step 3 into `pre` had updated the **checked-in** wrangler contract only; production traffic moved when the operator ran the authorized deploy in the checklist below.

### Accepted cutover checklist and separately authorized follow-up

Steps 1–3 record the copy/cutover path accepted on 2026-10-04. Any repetition requires accepted copy parity and config plus explicit Jason approval for each deploy. Item 4 remains separately authorized follow-up; this document does not authorize production actions.

1. **Pre-deploy read-only checks**
   - `https://data.gitstarclub.com/_meta/bucket-identity.json` → `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
   - Spot-check keys copied from Blob (Jason 2026-10-04: full inventory parity accepted).
   - `node scripts/assert-cf-ci-gates.mjs` on the commit you will deploy (top-level stage-4 contract, preview isolation unchanged).
   - Production shell build (no Blob vars): export `STORAGE_READ_DRIVER=r2`, `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, **`VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`** (required until `views/latest.json` is live on R2 for prerender), unset all `BLOB_*`, then `cd web && bun run cf:build:production` (see stage 4 acceptance below). **Without the fallback**, OpenNext prerender can resolve an empty views generation when R2 has no `views/latest.json`, producing blank homepage and `/rankings` HTML.

2. **Authorized production Worker deploy** (operator only; not CI)
   - Build and deploy top-level `gitstarclub-web` per [OPS.md](./OPS.md) with `--env=""` and `--var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"` matching the baked `cf:build` SHA.
   - Confirm Cloudflare bindings: `DATA` → `gitstarclub-data-prod`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, no Blob base variables. PR #649 records a retained `BLOB_READ_WRITE_TOKEN` secret; secret retirement is separate from the checked-in vars contract.

3. **Post-deploy traffic acceptance**
   - `https://gitstarclub.com/`, `/rankings`, a representative repo page at `/<owner>/<repo>` (not `/repo/...`), and **`/search-index`** (the site has no `/search` route) return **200** and match pre-cutover content (same views generation / rankings).
   - `https://data.gitstarclub.com/views/latest.json` (or the configured fallback generation) matches what pages render.
   - Workers Observability / logs: outbound reads hit `data.gitstarclub.com`, not `*.public.blob.vercel-storage.com` (Blob traffic should trend to zero for page reads).

4. **Remove frozen fallback and Blob secret** (separate authorized batch; **not done** as of 2026-10-04)
   - When `views/latest.json` returns **200** on `data.gitstarclub.com` and prerender no longer needs the shell fallback, remove top-level `VIEWS_VERSION_FALLBACK` and redeploy. Do not remove the fallback while the pointer is still missing.
   - Retire the production Worker secret `BLOB_READ_WRITE_TOKEN` only after stage 6 Blob retirement criteria are met. **2026-10-04 cutover:** both fallback var and `BLOB_READ_WRITE_TOKEN` remain on the live Worker.

**Historical rollback reference:** Worker version `14b84f73` (commit `b32939d`) is retained below with its full Blob/fallback configuration. Its present availability and suitability for the newer production revision require operator verification; do not assume it retains subsequent security fixes. Rollback requires separate authorization and never deletes either store.

## Target model

Two data buckets, one per deployment:

| Deployment | Bucket | `DEPLOY_ENV` | Public read origin | Worker write |
|---|---|---|---|---|
| Preview (`pre`) | `gitstarclub-data-pre` | `pre` | `https://data-pre.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` |
| Production (`main`) | `gitstarclub-data-prod` | `production` | `https://data.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` (stage 4) |

Preview already sets `STORAGE_READ_DRIVER=r2` and `R2_PUBLIC_BASE_URL` to the preview origin. That read uses public HTTP and does not use a storage key. The checked-in top-level wrangler uses the stage-4 R2 contract selected by PR #648. PR #649 records the live production cutover acceptance on 2026-10-04; the dated public identity and provider evidence limits are above.

The assets binding `MEDIA` on `gitstarclub-assets` is not the JSON store. The JSON Worker does not use `MEDIA` for views, canonical objects, or pointers.

Issue #569 records that both data buckets already exist and that each has `_meta/bucket-identity.json` at the bucket root. This change did not call the Cloudflare or Vercel APIs. On 2026-09-30 the two public origins did not resolve from the authoring host. That is historical, not a current outage claim. The October 13 production marker check is above. The original stage 2 acceptance additionally requires the preview marker, pointer, and page data; it remains unaccepted. A wrangler variable is not proof of live DNS or binding state.

`R2_PREFIX` stays empty. Objects live at the bucket root (`views/latest.json`, `bootstrap/latest.json`, `_meta/bucket-identity.json`).

### Five protection layers

1. **Separate buckets.** Preview config cannot name `gitstarclub-data-prod` or `data.gitstarclub.com`. Production config cannot name `gitstarclub-data-pre` or `data-pre.gitstarclub.com`. There is no shared data prefix that lets one deployment write the other bucket.
2. **`DEPLOY_ENV`.** An R2 put or delete requires `DEPLOY_ENV` of `production` or `pre`. Unset refuses the write, including on Cloudflare where `VERCEL_ENV` is never set. `VERCEL_ENV=production` refuses the write unless `DEPLOY_ENV=production`. `WORKFLOW_COLD_START` and `PREFLIGHT_RELAX_EMPTY_SHARDS` arm only when `DEPLOY_ENV=pre`.
3. **Bucket identity.** Before an R2 put or delete, the guarded store reads `_meta/bucket-identity.json` at the bucket root. `bucket` must equal `R2_BUCKET` and `deploy_env` must equal `DEPLOY_ENV` (`pre` or `production`). Application code never puts or deletes a key under `_meta/`. An operator places the marker out of band. The positive check is cached per isolate.
4. **Key shape.** Guarded put and delete reject `.` and `..` segments, including one percent-encoding (`%2e`, `%2e%2e`), so `new URL()` cannot collapse `views/../_meta/x` into `_meta/`. `del` of an `r2://` URL or a public URL under `_meta/` is refused before the marker is read.
5. **CI gates.** `node scripts/assert-cf-ci-gates.mjs` refuses a production bucket or domain inside preview `env.pre`, a preview bucket or domain at the top level, `BLOB_*` on preview, a missing preview `DEPLOY_ENV`, and a non-empty `R2_PREFIX`. Those host checks ignore case, so `DATA.gitstarclub.com` is still the production host. The legacy pre-cutover contract requires unset top-level `DEPLOY_ENV` and unset or `blob` drivers; current production instead selects the complete stage-4 contract below. `cf:build` refuses a shell public read base that does not match the wrangler vars for `--site-target`. A loopback fixture (`127.0.0.1`, `localhost`, and a URL whose hostname is `[::1]`) stays allowed so CI can build.

Issue #578 prepared the stage-4 target contract; PR #648 selected it in the checked-in config. Top-level `DEPLOY_ENV=production` selects that contract: both explicit drivers, the production bucket var and public base, and exactly one `DATA` binding must match stage 4. Checked-in `BLOB_*` variables must be absent. `scripts/cf-ci-gates.mjs` permits `VIEWS_VERSION_FALLBACK` to be absent or exactly `refresh-2026-09-13T06-00-16-398Z`; any other value fails. This permission is not a removal instruction: the current missing-pointer state requires the exact frozen fallback. `R2_PREFIX` must remain unset or empty. Driver aliases, if present, must agree with the explicit drivers. A partial switch fails. Bucket/domain isolation, indexing, and the paused schedules remain enforced in both contracts.

The marker JSON is exactly one of:

```json
{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}
{"bucket":"gitstarclub-data-prod","deploy_env":"production"}
```

Bootstrap and the listed web ops scripts add a CLI target on top of those layers. `--store r2` requires `--target prod|pre`. `--target` without `--store r2` is refused. Named buckets come from `R2_BUCKET_PROD` / `R2_BUCKET_PRE`. A single `R2_BUCKET` must match the target suffix. R2 writes nothing unless `--execute`. The scripts never write `_meta/`.

## Stage plan

The numbered plan records the original bootstrap route. Stages 2/3 are unaccepted historical recipes, superseded for the current production store by the accepted copy/cutover batch above. They must not be run against that copied store. Stages 5/6 require their own approval. Each stage names its acceptance and recovery. Commands that pass `--execute` or deploy a Worker are operator steps for that stage. They are not part of the stage 1 code landing, and this docs change does not run them.

### Stage 0. Stop-bleed

Done before the stage 1 code. The original shared-Blob incident #543 introduced the production-only frozen fallback after a confirmed 404 of `views/latest.json`. The accepted stage-4 contract now reads the copied production R2 store. At the dated October 13 check above, its views pointer still returned 404, so preserve `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` in the Worker and production build shell. Preview schedules are paused in source (`env.pre` `triggers.crons` is `[]`). Preview does not set `BLOB_*` or the fallback. Production `triggers.crons` stays `[]`.

Acceptance (read-only, still required):

```bash
node scripts/assert-cf-ci-gates.mjs
```

Recovery and later removal: do not point preview at either production store. Removing `VIEWS_VERSION_FALLBACK` requires separate owner authorization, HTTP 200 from the production R2 views pointer, proof that it is authoritative for page data, and a production build without the fallback that still prerenders real data. Change the Worker var and build shell together, following [OPS incident #543](./OPS.md#incident-543-read-only-views-version-fallback) and [stage 4](#stage-4-cutover-i-5b). Keep the existing gate, which already allows an absent or exact frozen fallback and rejects it on preview; do not delete its assertion. Blob-secret removal remains subject to stage 6. The fallback is not a pointer write.

### Stage 1. Code

Done on `pre`. Merged pull requests:

| PR | What landed |
|---|---|
| #558 | `DEPLOY_ENV` and the bucket-identity write guard (#557) |
| #560 | Hardening: no `_meta/` writes, `VERCEL_ENV=production` conflict, fixture refresh requires `DEPLOY_ENV` on Cloudflare (#559) |
| #562 | Worker `DATA` binding driver `r2_binding`; dot-segment refusal (#561) |
| #564 | Driver-aware reads and config checks (#563) |
| #566 | Pipeline R2 bootstrap, `--target prod\|pre`, dry run by default, `--initial-commit` (#565) |
| #568 | Preview Worker `env.pre` reads `gitstarclub-data-pre` at the preview public origin (#567) |

Acceptance for this stage is the required GitHub checks `static` and `production-build`, plus:

```bash
node scripts/assert-cf-ci-gates.mjs
bun run lint:docs
```

Unset drivers and `blob` still behave as the blob store. Preview `env.pre` sets `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `DEPLOY_ENV=pre`, `R2_BUCKET=gitstarclub-data-pre`, and `MIN_TRACKED_STARS=10000`. It also sets `WORKFLOW_COLD_START=1` and `PREFLIGHT_RELAX_EMPTY_SHARDS=1` (#662) so the empty bucket can take one real cold-start refresh; both arm only while `DEPLOY_ENV=pre` and `views/latest.json` is absent, and production must not set them. It does not set `BLOB_*`, `VIEWS_VERSION_FALLBACK`, or `WORKFLOW_FIXTURE`. The one-time first-run procedure is in [OPS.md](./OPS.md) (Preview cold-start first run); the resulting dataset is a rehearsal dataset with no GH Archive history.

Rollback of the code is a revert of those pull requests on `pre`. Do not roll production back by editing `main` from this stage. Production was not switched.

### Stage 2. Preview rehearsal

**Historical recipe; not accepted.** This describes a separately authorized empty-bucket preview rehearsal, not the accepted production copy/cutover. Load an eligible preview bucket, then prove the preview site reads it. Dry run first. `--execute` is an operator action and needs the bucket-scoped key outside the repository.

**Before the real-bucket rehearsal, run the offline local rehearsal first.**
Use the SHA-256-verified Node v24.20.0 and Bun 1.4.2 bootstrap in
[AGENTS.md](../AGENTS.md), with dependencies installed in both `web/` and
`pipeline/` using `bun --no-env-file install --frozen-lockfile`. From the
repository root:

```bash
cd web
bun --no-env-file scripts/r2-local-rehearsal.ts
```

Success prints `R2_LOCAL_REHEARSAL_OK` and exits 0. Any failed assertion or
timeout exits non-zero. Each run creates a private fixture project and HOME,
uses Miniflare's built-in local S3 and public R2 services with a persistent
workerd bucket, restarts that Worker to prove persistence, then removes its
own scratch directory. Miniflare is already installed by wrangler. The
entrypoint accepts no remote endpoint, bucket, or credential arguments.
Telemetry and remote bindings are disabled. Worker outbound reads are limited
to the local R2 service. Local S3 signing uses fabricated fixture values that
are valid only inside that Miniflare instance.

The rehearsal runs the actual `06-upload.mjs` and `07-export-v2.mjs` entrypoints
in a fixture mirror containing no environment files. It proves dry-run leaves
the bucket unchanged, upload and stage-only leave the pointer absent, and
initial commit publishes `previous_generation: null` and releases the shared
lease. A standalone Worker bundles the application read, storage, and lease
modules: with `STORAGE_READ_DRIVER=r2` and `STORAGE_WRITE_DRIVER=r2_binding`,
rankings resolve from the bootstrap generation while `views/latest.json` is
absent. The `DATA` write path claims, renews, and releases the workflow lease;
current pointer CAS succeeds and stale CAS is refused. Both pipeline and Worker
refuse a production identity and a different existing pointer. The Worker also
refuses mixed state and a marker introduced during initial-commit renewal.
Its bootstrap adapter reads staged parquet as bytes through `DATA`.

This local command is a prerequisite for the operator rehearsal. Stage 2 still
requires the real public origins and preview site acceptance below. The
standalone Worker exercises data paths; the full Next/OpenNext page server and
shared Next request cache are outside this command. CI workflows and required
checks are unchanged. See [TESTING.md](./TESTING.md#local-r2-stage-2-rehearsal).

Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`. These commands do not deploy that Worker and do not write bucket `gitstarclub-data-prod` or Worker `gitstarclub-web`.

From `pipeline/`, replace the generation id with the one the local build produced:

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --initial-commit
```

`--initial-commit` is allowed only when `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` are all absent. It stores `previous_generation: null`. That null is not a legacy-flat rollback. `--rollback legacy-flat` fails closed on this bucket. A retry of the same generation returns already-published. `web/scripts/ensure-bootstrap-pointer.ts --execute --initial-commit` uses the same publication lease as step 07 before that create-only write.

A first publish has no prior generation. `previous_generation` stays null. `--rollback` of the generation just committed compares the target with the current generation, returns `already-rolled-back`, and leaves the pointer in place. That status is not an undo. `--rollback legacy-flat` also fails closed, because the flat layout was never uploaded to `gitstarclub-data-pre`. Do not run either command and record it as a rollback.

Later publishes (a commit without `--initial-commit`) set `previous_generation` to the generation that was current. Roll those back only to that field, after reading `https://data-pre.gitstarclub.com/bootstrap/latest.json`. Do not pass the current `generation`.

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# PREVIOUS is bootstrap/latest.json previous_generation, not the current generation.
node backfill/07-export-v2.mjs --store r2 --target pre --rollback "$PREVIOUS" --execute
```

A bad first publish has no rollback. In this historical pre-cutover recipe, production `https://gitstarclub.com` would read Vercel Blob on Worker `gitstarclub-web` (top-level, no `--env`). Preview Worker `gitstarclub-web-pre` (wrangler env `pre`, bucket `gitstarclub-data-pre`) is a rehearsal and may show broken or empty data. Do not block preview hosts, do not publish through an isolated dashboard or API path, and do not prepare a Workers Static Assets cache.

Stop and record what went wrong. Read the pointer:

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
curl -fsS https://data-pre.gitstarclub.com/bootstrap/latest.json
```

`previous_generation` must be JSON null, and `generation` must be the bad id. If `previous_generation` is a generation id, this is not a first publish: use the later-publish command above.

Deleting objects uses the same owner authorization as a bucket write. Never delete `_meta/`, including `_meta/bucket-identity.json`. `web/scripts/blob-del-prefix.ts` refuses `_meta/`, `bootstrap/latest.json`, `canonical/`, the current generation prefix, and the broad prefix `bootstrap/generations/`. The owner removes the bad generation objects in bucket `gitstarclub-data-pre` under `bootstrap/generations/<bad-id>/`. Also remove `bootstrap/latest.json`, and remove `canonical/v2/meta.json` and `views/latest.json` when those objects exist. `--initial-commit` refuses while any of those three paths is present. Do not hand-write `bootstrap/latest.json` or `views/latest.json`. Do not point Worker `gitstarclub-web` at bucket `gitstarclub-data-pre` or `gitstarclub-data-prod`.

Rerun the stage 2 upload and `--initial-commit` commands in this section with a new generation id. Then redeploy preview the normal way and check the live rankings page. Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`:

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data-pre.gitstarclub.com
bun run cf:build:pre
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env pre \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

`https://pre.gitstarclub.com/rankings` must return 200, stay `noindex`, and show repository rows (an `owner/name` link and a star count) from the new generation. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. Repeat the stage 2 acceptance below after that live check. Real rollback starts at stage 4 and is the `wrangler rollback` command in that stage.

Acceptance. Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`. Do not require `views/latest.json`.

- `https://data-pre.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}`.
- `https://data-pre.gitstarclub.com/bootstrap/latest.json` returns 200. `generation` is the committed id. On the first publish, `previous_generation` is null.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/manifests/canonical.json` return 200. Each file's SHA-256 equals `base_manifest_sha256` or `canonical_manifest_sha256` on the pointer.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count. Views for this stage live under that generation prefix.
- `https://data-pre.gitstarclub.com/views/latest.json` is not required. A 404 is expected when no managed refresh has published. Do not hand-write that pointer. Preview does not set `VIEWS_VERSION_FALLBACK`, so a confirmed 404 lets pages read the bootstrap generation.
- `https://pre.gitstarclub.com/rankings` returns 200, is `noindex`, and shows repository rows (an `owner/name` link and a star count). The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. The rows must come from the committed bootstrap generation.
- Deployment identity must equal the commit that was actually deployed. `https://pre.gitstarclub.com/.well-known/deployment` `commitSha` equals the SHA baked by the preview `cf:build` for that deploy. A runtime `CF_PREVIEW_COMMIT_SHA` or `VERCEL_GIT_COMMIT_SHA` counts only when it names that same commit.
- `node scripts/assert-cf-ci-gates.mjs` still passes. Preview still has no `BLOB_*`.

If a later step needs `views/latest.json`, the only writer is the publish step of an owner-authorized managed refresh. Stage 2 acceptance does not run it. Do not PUT the object, and do not call `https://gitstarclub.com/api/cron/*`.

```bash
# Owner-authorized. Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# Do not call the production Worker gitstarclub-web.
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://pre.gitstarclub.com/api/workflows/refresh/start
```

That run's publish step writes `views/latest.json` in bucket `gitstarclub-data-pre`. Never hand-write the pointer.

Do not delete `_meta/`. Do not point Worker `gitstarclub-web` at this bucket. If the public origin still does not resolve, fix DNS in a separate authorized change before calling the rehearsal accepted. Do not use the production blob URL as a stand-in.

### Stage 3. Production rebuild

**Historical recipe; not accepted.** The original plan would repeat stage 2 with `--target prod` into an empty `gitstarclub-data-prod` after preview acceptance, while production remained on Blob with no `DATA` binding. The accepted operator copy/cutover superseded this rebuild path. Current production R2 is populated: do not apply the initial-commit, cleanup, or driver-reset steps below to that copied store. They are retained as recovery history for a separately authorized eligible empty target, not current operating instructions. Do not export the preview public origin for a production build.

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
node backfill/06-upload.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ
node backfill/06-upload.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute
node backfill/07-export-v2.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --initial-commit
```

The first publish on this bucket also stores `previous_generation: null`. There is no prior generation to roll back to. `--rollback` of that same generation returns `already-rolled-back` and leaves the pointer in place. `--rollback legacy-flat` fails closed on bucket `gitstarclub-data-prod`. In this original pre-cutover recipe, production `https://gitstarclub.com` would read Vercel Blob on Worker `gitstarclub-web` (top-level, no `--env`), so this publish does not change the live site. That recipe did not itself authorize cutover; the later accepted copy/cutover is recorded above.

Stop and record what went wrong. Deleting objects uses the same owner authorization as a bucket write. Never delete `_meta/`, including `_meta/bucket-identity.json`. `web/scripts/blob-del-prefix.ts` refuses `_meta/`, the pointer, and the current generation prefix. The owner removes `bootstrap/generations/<bad-id>/` and `bootstrap/latest.json` in bucket `gitstarclub-data-prod`, and removes `canonical/v2/meta.json` and `views/latest.json` when those objects exist, so `--initial-commit` can run again. Do not hand-write a pointer. Do not write bucket `gitstarclub-data-pre`. Do not deploy Worker `gitstarclub-web-pre`. Then rerun the stage 3 commands above.

A later publish rolls back to `previous_generation`:

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
# PREVIOUS is bootstrap/latest.json previous_generation on https://data.gitstarclub.com
node backfill/07-export-v2.mjs --store r2 --target prod --rollback "$PREVIOUS" --execute
```

Original recipe acceptance (not achieved by this copy/cutover). Worker `gitstarclub-web` would stay on the Blob read path. The new objects are in bucket `gitstarclub-data-prod`. Do not require `views/latest.json` on that bucket.

- `https://data.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
- `https://data.gitstarclub.com/bootstrap/latest.json` returns 200 and names the committed generation. On the first publish, `previous_generation` is null.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `https://data.gitstarclub.com/bootstrap/generations/<id>/manifests/canonical.json` return 200, and each SHA-256 matches the pointer.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count.
- `https://data.gitstarclub.com/views/latest.json` is not required. A 404 is expected. Do not hand-write it. A production refresh while Worker `gitstarclub-web` still writes Blob would write the blob store, not bucket `gitstarclub-data-prod`. After stage 4, the owner-authorized publish step below is the step that creates the managed pointer on this bucket. Do not call `https://gitstarclub.com/api/cron/*` to create it.
- In that recipe, production `https://gitstarclub.com/rankings` would return 200 from Blob with repository rows. While blob `views/latest.json` is missing, those rows are version `refresh-2026-09-13T06-00-16-398Z` via `VIEWS_VERSION_FALLBACK`. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. That pre-cutover Worker would have no `DATA` binding and would set blob base `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`. This is historical acceptance, not the current R2 Worker configuration.

```bash
# Owner-authorized, and only after stage 4. Worker gitstarclub-web, top-level
# production (no --env), bucket gitstarclub-data-prod
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://gitstarclub.com/api/workflows/refresh/start
```

That run's publish step writes `views/latest.json` in bucket `gitstarclub-data-prod`. Never hand-write the pointer.

In that historical recipe only, drivers stayed on `blob` (an unset `STORAGE_READ_DRIVER` is the same default). Do not reset the current production R2 drivers. Do not delete the identity marker or the blob objects. Do not roll the first publish back by naming the generation just committed.

### Stage 4. Cutover (I-5b)

**Accepted on production 2026-10-04** (Jason, 17:59 JST), recorded in PR #649 after the operator copy and config PR #648 (issue #647). The historical acceptance identifiers are Worker `c163a860`, commit `c32b373`; no rollback was recorded. The October 13 public identities are above and do not establish a current provider UUID.

The accepted store contains copied versioned views, including `views/refresh-2026-09-13T06-00-16-398Z/meta.json`; it is not the old bootstrap-only empty-bucket plan. While `views/latest.json` is confirmed absent, the exact frozen fallback selects that copied generation. Clearing it now cannot be justified by the unaccepted bootstrap recipe, and can leave `/` and `/rankings` without data. Do not hand-write either pointer.

Current checked-in contract and retained operating requirements:

- Worker `gitstarclub-web`, top-level production (no `--env pre`), has exactly one `DATA` binding to `gitstarclub-data-prod`; `MEDIA` remains the assets bucket.
- `DEPLOY_ENV=production`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_BUCKET=gitstarclub-data-prod`, and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`. Driver aliases, if set, must agree; `R2_PREFIX` stays unset or empty.
- Checked-in `BLOB_*` vars are absent. The gate permits an absent fallback or exactly `refresh-2026-09-13T06-00-16-398Z`. Preserve that exact value while the pointer is absent. Preview must have neither `BLOB_*` nor the fallback.
- Both checked-in cron arrays remain `[]`; stage 5 and Blob retirement/secret removal remain separately gated. The October 4 secret-retention record is not a new check of live secrets.

Recorded acceptance and requirements for any separately authorized repeat:

- Copy parity was owner-accepted before the switch; check the production identity marker and run `node scripts/assert-cf-ci-gates.mjs` on the intended deploy commit.
- `/`, `/rankings`, a representative `/<owner>/<repo>`, and `/search-index` must return 200 and match the expected generation. Rankings must contain repository rows and star counts, not only empty/waiting copy. HTTP 200 alone is insufficient.
- When present, the authoritative `views/latest.json` determines the rendered version. While it is absent, verify the configured frozen generation against pages; `bootstrap/latest.json` is not a required object for the accepted copied-store path.
- Verify outbound R2 reads with operator logs. No fresh log-level or full page-parity acceptance was performed on this documentation card.

Production OpenNext prerender inherits the shell, not Worker vars. For an authorized production build while the pointer is absent:

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
# Read-only build; no Blob variables or write credential.
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data.gitstarclub.com
export VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z
unset READ_DRIVER BLOB_BASE_URL NEXT_PUBLIC_BLOB_BASE_URL BLOB_READ_WRITE_TOKEN
bun run cf:build:production
```

Clear any other `BLOB_*` or `NEXT_PUBLIC_BLOB_*` shell vars. If `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` is set, it must match the production R2 origin. `cf:build` rejects missing/different read driver, missing public base, Blob shell vars, or a non-loopback read base that differs from the target's wrangler vars. No write driver or storage credential is needed. Offline fixture builds are separate from live cutover acceptance.

Remove the frozen fallback only in a separately authorized change after `views/latest.json` returns 200 from production R2, is authoritative for the rendered version, and a production build without the fallback still prerenders real data. Change both the Worker var and build shell together. The code gives a valid pointer priority; never use the frozen value to override it. Do not remove `BLOB_READ_WRITE_TOKEN` until the separate stage 6 criteria are accepted.

#### Historical stage-4 rollback reference

PR #649 retains pre-cutover Worker version `14b84f73-ef31-4e86-a70d-b71251756093` (commit `b32939d`). Its present availability and suitability are unverified; it predates security fixes now included in public production `daee5fc`. An operator must assess those fixes and explicitly authorize rollback before choosing this historical version. The command is retained for recovery history, not as automatic current incident guidance:

```bash
# Historical operator rollback only; production gitstarclub-web, no --env pre.
wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web
```

That recorded Blob configuration includes `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`, `BLOB_BASE_URL` and `NEXT_PUBLIC_BLOB_BASE_URL` at `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`, no production `DATA` binding, and Blob/default drivers. An authorized config-based rollback must restore the complete set, including the fallback while the Blob pointer is absent, and keep `triggers.crons=[]`. Restoring only the Blob base/driver is insufficient. Do not delete objects in either store or empty production R2.

After an authorized rollback, verify `https://gitstarclub.com/rankings` returns 200, remains indexable, and contains repository links plus star counts from the expected Blob generation; both boards showing waiting copy is a failure. Verify deployment identity too. Page status alone does not establish successful recovery or security suitability. OPS retains the same requirements.

### Stage 5. Production crons

Not accepted. After stage 4, and only with an explicit owner approval, set production `triggers.crons` to the three intended expressions (`0 3 * * *`, `0 4 * * SUN`, `0 6 * * SUN`). Cloudflare numbers Sunday as `1` or `SUN` and rejects `0`. Do not use `7` for Sunday (`7` is Saturday).

Acceptance: the production Worker schedule shows those three expressions, a completed run writes the production R2 bucket, and `node scripts/assert-cf-ci-gates.mjs` is updated in the same change that enables the crons so the empty-array contract is not left stale. Preview `triggers.crons` stays `[]` until the owner separately re-enables preview schedules.

Rollback: set production `triggers.crons` back to `[]` and redeploy that config. The `web/vercel.json` declarations stay as the scheduler rollback reference until stage 6. Do not call production cron as a substitute for the config rollback.

### Stage 6. Retire Blob

Not accepted. After production has been on R2 through at least one successful refresh, remove the remaining blob operating dependency.

The read-only tools are prepared for R2 (#578), as described below. A page returning 200 does not prove those tools are off Blob. Before Blob variables can be retired, both commands must complete against the production R2 public origin with those variables unset. This docs change does not edit those scripts.

- Production and preview do not require `BLOB_READ_WRITE_TOKEN` or `BLOB_BASE_URL`.
- Live release gates stop falling back to the public blob URL. They use `LIVE_PUBLIC_READ_BASE_URL` or the R2 public origin. That fallback is documented as temporary in [OPS.md](./OPS.md).
- Blob layout instructions in [OPS.md](./OPS.md) and the superseded Blob design doc move to history.
- `exports:generate` and `validate-live-views.ts` use `getPublicReadBases()` for the configured read driver. The validator checks the primary origin and reports `storage_read_driver` and `public_read_base`. Their offline CLI regression tests run with an R2 loopback base and no Blob vars; a missing R2 base fails even when a Blob base is available. This preparation does not retire the remaining Blob operating dependencies.

Acceptance: the top-level Worker config and preview `env.pre` contain no `BLOB_*` vars, and a read-only production page still returns 200 from `https://data.gitstarclub.com`. `exports:generate` and `validate-live-views` complete against the production R2 public origin with `BLOB_BASE_URL` and `NEXT_PUBLIC_BLOB_BASE_URL` unset. A page returning 200 alone does not verify those tools.

Rollback: use the stage 4 version rollback on Worker `gitstarclub-web` (top-level production, no `--env`): `wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web`. That restores `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` and the blob public base `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`. It does not write bucket `gitstarclub-data-prod`. Do not delete blob objects in order to roll back. Do not empty bucket `gitstarclub-data-prod`. Deleting the blob store is a separate owner decision after this stage has stayed healthy. It is not the rollback. The same rankings smoke as stage 4 must show repository rows, not the empty ranking copy.

## Retained Blob dependencies after stage 4

Production page reads and the checked-in Worker write contract use R2. Production cron enablement and a successful production R2 refresh remain unaccepted. PR #649 records the retained Blob secret at cutover; this card did not inspect live secrets. Production prerender still needs the exact frozen fallback while the R2 views pointer is absent.

Keep Blob rollback data and historical layout, dependencies, and the temporary live-gate Blob URL fallback until authorized stage 6 retirement. The prepared `exports:generate` and `validate-live-views.ts` tools are driver-aware, but their current live R2 success still needs independent evidence. Local development explicitly using the Blob driver needs `BLOB_BASE_URL`; Blob mutation additionally needs a Blob token. Current R2 reads use the target's public base; R2 writes require `DEPLOY_ENV`, a matching identity marker, and either `DATA` (`r2_binding`) or a separately supplied bucket-scoped S3 key. Never commit a key.

## Edge cache (Worker Cache API)

The Next branch uses `caches.default`, Cloudflare's per-data-center response cache,
after shell routing. It stores only GET responses with status 200 and a positive
`s-maxage` (shared-cache lifetime in seconds). HTML, RSC (Next's React component
payload), and JSON are all eligible. HEAD and other methods bypass the cache.
Paths starting with `/api`, paths containing `refresh`, `/start`, `/enqueue`,
`/preview/*`, and `/.well-known/*` are excluded. Requests carrying Authorization,
Cookie, or Range headers bypass it. Responses with `private`, `no-store`, or
`no-cache`, any Set-Cookie header, or `Vary: *` are never stored.

Every Next response carries `x-gsc-cache`: `HIT` means served from cache; `MISS`
means an eligible response was rendered and queued for storage; `BYPASS` means
the request or response was excluded, the Cache API was unavailable, or a cache
lookup failed. Cache writes run in `waitUntil` and failures only log a warning.
Shell responses keep their existing behavior. OpenNext's `disableIncrementalCache`
setting remains enabled.

Keys preserve the URL and query parameters, including `_rsc`, and append
`__gsc_cv`: a version composed of `EDGE_CACHE_VERSION` (default `v1`),
`VIEWS_VERSION_FALLBACK`, and the commit identifier baked by `cf:build`
(falling back to `VERCEL_GIT_COMMIT_SHA`, then `CF_PREVIEW_COMMIT_SHA`). These
identifiers are optional; no generated Next build ID is imported. `__gsc_variant` hashes the
full RSC, router state, prefetch, segment prefetch, Next URL, and Accept header
values so HTML and component payloads never share an entry.

After an authorized weekly data refresh, rotate `EDGE_CACHE_VERSION` in a
separately authorized deploy to move requests to new keys. Do not change
`VIEWS_VERSION_FALLBACK` to bust the cache: the production gate accepts only an
absent value or exactly `refresh-2026-09-13T06-00-16-398Z`, and the missing-pointer
state requires that exact value until the stage-4 removal prerequisites are met. Operators
can alternatively use Cloudflare's **Purge Everything**. Cache API entries live
in individual data centers; a URL purge must target the actual synthetic key,
including `__gsc_cv` and `__gsc_variant`, rather than just the public page URL.

The stored response lifetime is `min(s-maxage, 86400)` seconds (one day), enforced
by `EDGE_CACHE_MAX_TTL_SECONDS`. Rendered responses and cache hits keep the
original client-facing Cache-Control; only the stored copy carries the cap. The
homepage advertises a one-year `s-maxage`, so version rotation is required for
immediate refresh visibility. If rotation is forgotten, this cache can retain an
old response for at most one day after storage. This cap does not refresh stale
source data or existing downstream caches.
