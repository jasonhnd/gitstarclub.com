---
owner: operations / storage
status: active
last_reviewed: 2026-10-01
source_of_truth_for:
  - R2 cutover runbook
  - current object-storage status
  - R2 stage plan and rollback
---

# R2 cutover

> **Current status:** Stage 1 (code) is done. Production still reads Vercel Blob until cutover. Stages 2 through 6 are not accepted.
>
> Storage sentence used across the current docs: Cloudflare R2 (production still reads Vercel Blob until cutover; see docs/R2-CUTOVER.md).

This file is the source of truth for where object storage is going and which stage is current. Historical P0 adapter notes live in [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md). The Blob publish and refresh design lives in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md). Both are superseded for storage status. Blob layout and the environment inventory, still required until cutover, stay in [OPS.md](./OPS.md).

This document does not create buckets, change DNS, deploy a Worker, or write either store.

## Target model

Two data buckets, one per deployment:

| Deployment | Bucket | `DEPLOY_ENV` | Public read origin | Worker write |
|---|---|---|---|---|
| Preview (`pre`) | `gitstarclub-data-pre` | `pre` | `https://data-pre.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` |
| Production (`main`) | `gitstarclub-data-prod` | `production` | `https://data.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` (stage 4) |

Preview already sets `STORAGE_READ_DRIVER=r2` and `R2_PUBLIC_BASE_URL` to the preview origin. That read uses public HTTP and does not use a storage key. Production top-level config still uses the blob read driver and does not bind `DATA`.

The assets binding `MEDIA` on `gitstarclub-assets` is not the JSON store. The JSON Worker does not use `MEDIA` for views, canonical objects, or pointers.

Issue #569 records that both data buckets already exist and that each has `_meta/bucket-identity.json` at the bucket root. This change did not call the Cloudflare or Vercel APIs. On 2026-09-30 the two public origins above did not resolve from the authoring host. Stage 2 acceptance includes those origins answering the identity object. A wrangler variable is not proof that DNS is live.

`R2_PREFIX` stays empty. Objects live at the bucket root (`views/latest.json`, `bootstrap/latest.json`, `_meta/bucket-identity.json`).

### Five protection layers

1. **Separate buckets.** Preview config cannot name `gitstarclub-data-prod` or `data.gitstarclub.com`. Production config cannot name `gitstarclub-data-pre` or `data-pre.gitstarclub.com`. There is no shared data prefix that lets one deployment write the other bucket.
2. **`DEPLOY_ENV`.** An R2 put or delete requires `DEPLOY_ENV` of `production` or `pre`. Unset refuses the write, including on Cloudflare where `VERCEL_ENV` is never set. `VERCEL_ENV=production` refuses the write unless `DEPLOY_ENV=production`. `WORKFLOW_COLD_START` and `PREFLIGHT_RELAX_EMPTY_SHARDS` arm only when `DEPLOY_ENV=pre`.
3. **Bucket identity.** Before an R2 put or delete, the guarded store reads `_meta/bucket-identity.json` at the bucket root. `bucket` must equal `R2_BUCKET` and `deploy_env` must equal `DEPLOY_ENV` (`pre` or `production`). Application code never puts or deletes a key under `_meta/`. An operator places the marker out of band. The positive check is cached per isolate.
4. **Key shape.** Guarded put and delete reject `.` and `..` segments, including one percent-encoding (`%2e`, `%2e%2e`), so `new URL()` cannot collapse `views/../_meta/x` into `_meta/`. `del` of an `r2://` URL or a public URL under `_meta/` is refused before the marker is read.
5. **CI gates.** `node scripts/assert-cf-ci-gates.mjs` refuses a production bucket or domain inside preview `env.pre`, a preview bucket or domain at the top level, `BLOB_*` on preview, a missing preview `DEPLOY_ENV`, and a non-empty `R2_PREFIX`. `cf:build` refuses a shell public read base that does not match the wrangler vars for `--site-target`. A loopback fixture (`127.0.0.1`, `localhost`, `::1`) stays allowed so CI can build.

The marker JSON is exactly one of:

```json
{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}
{"bucket":"gitstarclub-data-prod","deploy_env":"production"}
```

Bootstrap and the listed web ops scripts add a CLI target on top of those layers. `--store r2` requires `--target prod|pre`. `--target` without `--store r2` is refused. Named buckets come from `R2_BUCKET_PROD` / `R2_BUCKET_PRE`. A single `R2_BUCKET` must match the target suffix. R2 writes nothing unless `--execute`. The scripts never write `_meta/`.

## Stage plan

Do not skip ahead. Each stage names the acceptance commands and the rollback. Commands that pass `--execute` or deploy a Worker are operator steps for that stage. They are not part of the stage 1 code landing, and this docs change does not run them.

### Stage 0. Stop-bleed

Done before the stage 1 code. Shared-store incident #543: production `views/latest.json` was missing, so the production Worker serves `VIEWS_VERSION_FALLBACK` (`refresh-2026-09-13T06-00-16-398Z`) only after a confirmed 404 of that pointer. Preview schedules are paused (`env.pre` `triggers.crons` is `[]`). Preview does not set `BLOB_*` or the fallback. Production `triggers.crons` stays `[]`.

Acceptance (read-only, still required):

```bash
node scripts/assert-cf-ci-gates.mjs
```

Rollback: do not point preview cron at the production blob store. Remove `VIEWS_VERSION_FALLBACK` only after `views/latest.json` exists on the store production is reading, using the removal steps in [OPS.md](./OPS.md). The fallback is not a pointer write.

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

Unset drivers and `blob` still behave as the blob store. Preview `env.pre` sets `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `DEPLOY_ENV=pre`, `R2_BUCKET=gitstarclub-data-pre`, and `MIN_TRACKED_STARS=10000`. It does not set `BLOB_*`, `VIEWS_VERSION_FALLBACK`, `WORKFLOW_COLD_START`, or `PREFLIGHT_RELAX_EMPTY_SHARDS`.

Rollback of the code is a revert of those pull requests on `pre`. Do not roll production back by editing `main` from this stage. Production was not switched.

### Stage 2. Preview rehearsal

Not accepted. Load the preview bucket, then prove the preview site reads it. Dry run first. `--execute` is an operator action and needs the bucket-scoped key outside the repository.

Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`. These commands do not deploy that Worker and do not write bucket `gitstarclub-data-prod` or Worker `gitstarclub-web`.

From `pipeline/`, replace the generation id with the one the local build produced:

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --initial-commit
```

`--initial-commit` is allowed only when `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` are all absent. It stores `previous_generation: null`. That null is not a legacy-flat rollback. `--rollback legacy-flat` fails closed on this bucket. A retry of the same generation returns already-published.

A first publish has no prior generation. `previous_generation` stays null. `--rollback` of the generation just committed compares the target with the current generation, returns `already-rolled-back`, and leaves the pointer in place. That status is not an undo. `--rollback legacy-flat` also fails closed, because the flat layout was never uploaded to `gitstarclub-data-pre`. Do not run either command and record it as a rollback.

Later publishes (a commit without `--initial-commit`) set `previous_generation` to the generation that was current. Roll those back only to that field, after reading `https://data-pre.gitstarclub.com/bootstrap/latest.json`. Do not pass the current `generation`.

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# PREVIOUS is bootstrap/latest.json previous_generation, not the current generation.
node backfill/07-export-v2.mjs --store r2 --target pre --rollback "$PREVIOUS" --execute
```

Bad first publish: quarantine. Any write in this procedure needs a separate owner authorization. This document does not authorize it.

1. Read the pointer. `previous_generation` must be JSON null, and `generation` must be the bad id. If `previous_generation` is a generation id, this is not a first publish: use the later-publish command above and stop.

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
curl -fsS https://data-pre.gitstarclub.com/bootstrap/latest.json
```

2. Keep the objects. Do not hand-write `bootstrap/latest.json` or `views/latest.json`. Do not delete `_meta/bucket-identity.json`. Do not delete `bootstrap/generations/<bad-id>/`. `web/scripts/blob-del-prefix.ts` refuses the pointer, the broad prefix `bootstrap/`, and the current generation prefix. Do not run it against those paths. Do not treat `already-rolled-back` as success. Do not point Worker `gitstarclub-web` (top-level production, no `--env`) at bucket `gitstarclub-data-pre` or `gitstarclub-data-prod`.

3. Block preview readers. This step is blocked until the owner authorizes it on its own. Skipping stage 2 acceptance does not quarantine anything: Worker `gitstarclub-web-pre` on wrangler env `pre` still reads bucket `gitstarclub-data-pre`, so the bad pointer stays what the pages serve.

   No repository command performs the block. Env `pre` in the [Worker configuration](../workers/gitstarclub-web/wrangler.jsonc) sets `workers_dev: true` and `preview_urls: true`. Deploying that file turns those hosts back on. The route `pre.gitstarclub.com/*` is not in that file, so the deploy does not detach it. Cloudflare Access on `https://gitstarclub-web-pre.worldgo.workers.dev` does not cover `https://pre.gitstarclub.com`.

   The owner-authorized block is a live script setting on Worker `gitstarclub-web-pre`, wrangler env `pre`, Cloudflare account `00f850e853e4c7f9627233d51a6e30a1`. Do it in the Cloudflare dashboard or API. Do not deploy the committed wrangler file as this step. Do not write bucket `gitstarclub-data-pre`. Do not change DNS for `gitstarclub.com` or `www.gitstarclub.com`. Do not change Worker `gitstarclub-web`.

   - Turn off the workers.dev subdomain for script `gitstarclub-web-pre`.
   - Turn off preview URLs for that script.
   - Detach the custom route `pre.gitstarclub.com/*` from that Worker.

   Hosts that must stop serving the bad generation:

   - `https://pre.gitstarclub.com`
   - `https://gitstarclub-web-pre.worldgo.workers.dev`
   - every version preview URL for Worker `gitstarclub-web-pre` (the aliases `preview_urls: true` publishes)

```bash
# After the owner block. Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# Site curls are expected to fail closed. Do not use curl -f.
curl -sS -o /dev/null -w 'pre.gitstarclub.com %{http_code}\n' https://pre.gitstarclub.com/rankings
curl -sS -o /dev/null -w 'workers.dev %{http_code}\n' https://gitstarclub-web-pre.worldgo.workers.dev/rankings
curl -fsS https://data-pre.gitstarclub.com/bootstrap/latest.json
curl -fsS https://data-pre.gitstarclub.com/_meta/bucket-identity.json
curl -fsS -o /dev/null -w 'sealed stock %{http_code}\n' \
  "https://data-pre.gitstarclub.com/bootstrap/generations/${BAD}/views/rank/all-time/repo/stock.json"
```

   The two site responses must not be a rankings page. HTTP 200 whose body still has an `owner/name` row means that host is still serving the bad generation, and the quarantine has not happened. If a version preview URL was handed out, request its `/rankings` the same way and require the same failure. The pointer GET still names the bad `generation` with `previous_generation` null. The identity object is unchanged. The sealed stock object is still 200. The bad generation stays in the bucket.

   If the owner does not authorize this host block, step 3 stays blocked. Those hosts keep serving the bad generation. Do not record the incident as quarantined. Do not start stage 3. Do not restore hosts from this step. Recovery is step 5. A successful fetch of a detached host is not the condition for attaching that host.

4. Repair is a separate owner authorization, not the isolation. The only write that changes which generation a restored reader follows is a corrected generation, committed without `--initial-commit` (that flag is refused once `bootstrap/latest.json` exists). The owner names the new generation id before the command runs. The new pointer's `previous_generation` is the bad id. The bad generation stays sealed and becomes the one-hop rollback target. Do not delete it in this step. These commands publish objects in bucket `gitstarclub-data-pre` only. They do not rebuild pages and do not deploy Worker `gitstarclub-web-pre`. English rankings at `web/app/(en)/rankings/page.tsx` and localized rankings at `web/app/(localized)/[locale]/rankings/page.tsx` set `revalidate` to false, so a new pointer does not replace HTML that was already prerendered. Leave the hosts blocked.

```bash
# Owner-authorized. Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# GOOD is a new generation id. Do not pass --initial-commit.
node backfill/06-upload.mjs --store r2 --target pre --generation "$GOOD" --execute
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GOOD" --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GOOD" --execute
```

If the owner does not approve that commit, the remaining path is written acceptance in step 5. Leave the hosts blocked until that path finishes. There is no supported command that deletes the first R2 pointer.

5. Recovery. The hosts from step 3 stay blocked through the object check and the isolated build. Do not fetch `https://pre.gitstarclub.com/rankings` to decide whether that host may be attached.

   Choose the generation this recovery will serve. Either step 4 has landed, or the owner has accepted the current generation in writing while the hosts are still blocked. If neither is true, leave the hosts blocked and stop. Written acceptance is that record. It is not a request to the detached site, and it is not stage 2 acceptance. Stage 2 acceptance includes the live rankings page, so it runs only after the controlled reopen below succeeds.

   a. With the hosts still blocked, verify the data origin. Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`. Repeat the site curls from step 3 and require the same closed result. `$SERVE` is the chosen generation.

```bash
# Hosts still blocked. Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
curl -fsS https://data-pre.gitstarclub.com/bootstrap/latest.json
curl -fsS https://data-pre.gitstarclub.com/_meta/bucket-identity.json
curl -fsS "https://data-pre.gitstarclub.com/bootstrap/generations/${SERVE}/manifests/base.json"
curl -fsS "https://data-pre.gitstarclub.com/bootstrap/generations/${SERVE}/manifests/canonical.json"
curl -fsS "https://data-pre.gitstarclub.com/bootstrap/generations/${SERVE}/views/rank/all-time/repo/stock.json"
```

   The pointer `generation` must be `$SERVE`. On the corrected path, `previous_generation` is the bad id. On the written-acceptance path, `previous_generation` is still JSON null. Identity stays `{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}`. Each manifest SHA-256 matches the pointer. The stock object contains at least one repository row with a star count. Do not delete the bad sealed generation, the pointer, or the identity object.

   b. Build a fresh preview while the hosts stay blocked. The build reads the public data origin. It does not attach a route.

```bash
# Worker gitstarclub-web-pre, wrangler env pre, bucket gitstarclub-data-pre
# Build only. Do not deploy.
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data-pre.gitstarclub.com
bun run cf:build:pre
```

   Do not export a Blob base URL. Read the prerendered English `/rankings` document and one localized `/rankings` document in the OpenNext asset output of that build. Each must show an `owner/name` link and a star count from `$SERVE`. The English sentence "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. This check is the build output. The corrected pointer alone does not establish it.

   c. Publish that output only under a separate owner authorization that leaves the block in place. Do not run `wrangler deploy --env pre` against the committed Worker configuration. That deploy sets `workers_dev` and `preview_urls` back to true. `pre.gitstarclub.com/*` stays detached, the workers.dev subdomain stays off, and preview URLs stay off. The owner publishes the built assets from the dashboard or API without changing those three settings. After the publish, repeat the step 3 site curls and require the same closed result. If that publish cannot be done without turning the hosts on, step 5 stays blocked. Do not call the incident recovered, and do not attach the route in order to finish the check.

   d. Controlled reopen is the next owner authorization, after (a), (b), and (c). It does not depend on a live response from the still-detached host. Turn the workers.dev subdomain on, turn preview URLs on, and attach `pre.gitstarclub.com/*` to Worker `gitstarclub-web-pre`.

   e. Immediately request the reopened rankings pages. Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`.

```bash
# Just after the controlled reopen. Re-block if either body fails.
curl -sS -D - -o /tmp/pre-rankings.html -w 'pre.gitstarclub.com %{http_code}\n' https://pre.gitstarclub.com/rankings
curl -sS -D - -o /tmp/workers-rankings.html -w 'workers.dev %{http_code}\n' https://gitstarclub-web-pre.worldgo.workers.dev/rankings
```

   Each response must be HTTP 200 and `noindex`, and the body must show an `owner/name` link and a star count from `$SERVE`. The empty English sentence on both ranking sections is a failure. If either check fails, detach `pre.gitstarclub.com/*`, turn the workers.dev subdomain off, and turn preview URLs off again before any other work. A version preview URL opened by that same authorization must pass the same body check or be turned off with the other hosts. Do not leave a failed page on those hosts. Do not start stage 3.

   f. Repeat stage 2 acceptance only after (e) passes. That acceptance may then request `https://pre.gitstarclub.com/rankings`. It is not the condition that allows (d).

Acceptance. Worker `gitstarclub-web-pre`, wrangler env `pre`, bucket `gitstarclub-data-pre`. Do not require `views/latest.json`.

- `https://data-pre.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}`.
- `https://data-pre.gitstarclub.com/bootstrap/latest.json` returns 200. `generation` is the committed id. On the first publish, `previous_generation` is null.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/manifests/canonical.json` return 200. Each file's SHA-256 equals `base_manifest_sha256` or `canonical_manifest_sha256` on the pointer.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count. Views for this stage live under that generation prefix.
- `https://data-pre.gitstarclub.com/views/latest.json` is not required. A 404 is expected when no managed refresh has published. Do not hand-write that pointer. Preview does not set `VIEWS_VERSION_FALLBACK`, so a confirmed 404 lets pages read the bootstrap generation.
- `https://pre.gitstarclub.com/rankings` returns 200, is `noindex`, and shows repository rows (an `owner/name` link and a star count). The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. The rows must come from the committed bootstrap generation.
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

Not accepted. Repeat the stage 2 upload and `--initial-commit` commands with `--target prod` into bucket `gitstarclub-data-prod` only after the preview rehearsal is accepted. Worker `gitstarclub-web` (top-level production, no `--env`) keeps reading Vercel Blob until cutover. Do not bind `DATA` on that Worker in this stage. Do not pass `--env pre`. Do not export the preview public origin for a production build. These commands do not deploy the Worker and do not write bucket `gitstarclub-data-pre`.

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
node backfill/06-upload.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ
node backfill/06-upload.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute
node backfill/07-export-v2.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target prod --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --initial-commit
```

The first publish on this bucket also stores `previous_generation: null`. `--rollback` of that same generation returns `already-rolled-back` and is not an undo. `--rollback legacy-flat` fails closed on `gitstarclub-data-prod`. Worker `gitstarclub-web` (top-level, no `--env`) is still on Blob, so `https://gitstarclub.com` is not reading this bucket. That is already true. It is not a host block you perform, and it does not hide `https://data.gitstarclub.com`. No repository command unpublishes that public origin while keeping the objects. Deleting the pointer or the sealed generation to hide the URL is blocked. Do not start stage 4 from a rejected generation. A corrective commit uses `--target prod`, omits `--initial-commit`, and does not run against Worker `gitstarclub-web-pre` or bucket `gitstarclub-data-pre`. Keep `_meta/bucket-identity.json` and `bootstrap/generations/<bad-id>/`.

A later publish rolls back to `previous_generation`:

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
# PREVIOUS is bootstrap/latest.json previous_generation on https://data.gitstarclub.com
node backfill/07-export-v2.mjs --store r2 --target prod --rollback "$PREVIOUS" --execute
```

Acceptance. Worker `gitstarclub-web` stays on the blob read path. The new objects are in bucket `gitstarclub-data-prod`. Do not require `views/latest.json` on that bucket.

- `https://data.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
- `https://data.gitstarclub.com/bootstrap/latest.json` returns 200 and names the committed generation. On the first publish, `previous_generation` is null.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `https://data.gitstarclub.com/bootstrap/generations/<id>/manifests/canonical.json` return 200, and each SHA-256 matches the pointer.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count.
- `https://data.gitstarclub.com/views/latest.json` is not required. A 404 is expected. Do not hand-write it. A production refresh while Worker `gitstarclub-web` still writes Blob would write the blob store, not bucket `gitstarclub-data-prod`. After stage 4, the owner-authorized publish step below is the step that creates the managed pointer on this bucket. Do not call `https://gitstarclub.com/api/cron/*` to create it.
- Production `https://gitstarclub.com/rankings` still returns 200 from the blob read path and still shows repository rows. While blob `views/latest.json` is missing, those rows are version `refresh-2026-09-13T06-00-16-398Z` via `VIEWS_VERSION_FALLBACK`. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. Top-level Worker `gitstarclub-web` still has no `DATA` binding and still sets blob base `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`. It must not be reading bucket `gitstarclub-data-prod` yet.

```bash
# Owner-authorized, and only after stage 4. Worker gitstarclub-web, top-level
# production (no --env), bucket gitstarclub-data-prod
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://gitstarclub.com/api/workflows/refresh/start
```

That run's publish step writes `views/latest.json` in bucket `gitstarclub-data-prod`. Never hand-write the pointer.

Leave production drivers on `blob` (an unset `STORAGE_READ_DRIVER` is the same default). Do not delete the identity marker or the blob objects. Do not roll the first publish back by naming the generation just committed.

### Stage 4. Cutover (I-5b)

Not accepted. This is the production read and write switch for Worker `gitstarclub-web`, top-level production (no `--env`; do not pass `--env pre`), bucket `gitstarclub-data-prod`, public origin `https://data.gitstarclub.com`. It lands as one pull request. This docs change does not edit the gate or the build script.

Order. Do not wait until `https://gitstarclub.com/rankings` renders the R2 bootstrap generation before clearing `VIEWS_VERSION_FALLBACK`. That wait cannot succeed on a bootstrap-only bucket. While the fallback is set, a 404 of `views/latest.json` selects `refresh-2026-09-13T06-00-16-398Z` (`web/lib/data/source.ts`). The read then requests `views/<that-version>/meta.json` on the public origin. Stage 3 stored views only under `bootstrap/generations/<id>/views/**`, so that meta is absent, the published time stays null, and the read does not choose the bootstrap generation. It requests `views/refresh-2026-09-13T06-00-16-398Z/**`, which is not in bucket `gitstarclub-data-prod`. Clearing the fallback is what makes a confirmed 404 use the bootstrap generation. Clear it in the same authorized build and deploy that switches the driver.

Before that deploy, Worker `gitstarclub-web` is still on the blob driver. Check objects on `https://data.gitstarclub.com` only. Do not use the live rankings page as proof of this bucket.

- `https://data.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
- `https://data.gitstarclub.com/bootstrap/latest.json` returns 200 and names the committed generation.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `.../manifests/canonical.json` return 200, and each SHA-256 matches the pointer.
- `https://data.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count.
- `https://data.gitstarclub.com/views/latest.json` is a 404. Do not hand-write it.

Worker config in that same pull request, deployed together with the shell below:

- Bind `DATA` to `gitstarclub-data-prod` on the top-level Worker. Keep `MEDIA` on `gitstarclub-assets`. Do not use `MEDIA` as the data bucket.
- Set `DEPLOY_ENV=production`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_BUCKET=gitstarclub-data-prod`, and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`.
- In that same deploy, remove `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, and `VIEWS_VERSION_FALLBACK`. Do not ship the R2 driver while the fallback is still set. Do not clear the fallback in an earlier deploy that still reads Blob. `views/latest.json` is not the object these checks use.
- Keep `triggers.crons` at `[]` until stage 5.

Same pull request, `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs`. The gate still requires top-level `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, and `VIEWS_VERSION_FALLBACK`, and the test locks those three. A cutover that only edits the Worker config fails `node scripts/assert-cf-ci-gates.mjs`. In this same pull request:

- Change the production target contract so top-level vars require `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `DEPLOY_ENV=production`, `R2_BUCKET=gitstarclub-data-prod`, and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, and require `DATA` bound to `gitstarclub-data-prod`.
- Stop requiring `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, and `VIEWS_VERSION_FALLBACK` on Worker `gitstarclub-web`. Preview env `pre` on Worker `gitstarclub-web-pre` still must not set `VIEWS_VERSION_FALLBACK` or `BLOB_*`. Bucket `gitstarclub-data-pre` stays the preview bucket.
- Update `scripts/cf-ci-gates.test.mjs` in that same pull request so the tests require the new contract, and so a missing R2 driver or a leftover blob base fails.

Same pull request, the production build shell in `web/scripts/cf-opennext-build.ts`. The production OpenNext spawn env adds `SITE_INDEXABLE=1` and `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com` and otherwise inherits the shell. Unset `STORAGE_READ_DRIVER` defaults to `blob` in `web/lib/runtime-config.ts`. In this same pull request that shell must:

- Export `STORAGE_READ_DRIVER=r2`.
- Export `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com` for bucket `gitstarclub-data-prod`. When `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` is set, set it to the same origin.
- Clear `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, and `VIEWS_VERSION_FALLBACK` in this same build, matching the Worker var removal in the same deploy. A parent shell must not bake blob store `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com` into the prerender, and must not leave the fallback set while `STORAGE_READ_DRIVER=r2`.
- Keep refusing a shell public read base that does not match the top-level wrangler vars for Worker `gitstarclub-web`. The loopback fixture at `127.0.0.1` stays allowed for CI.

Until that pull request, the production build shell in [OPS.md](./OPS.md) still exports the blob bases. Do not export `STORAGE_READ_DRIVER=r2` for a production build before the object checks above have passed and the gate and the wrangler vars change together.

Operator shell for that same cutover build. Run it only after the object checks. Worker `gitstarclub-web`, top-level production (no `--env`), bucket `gitstarclub-data-prod`:

```bash
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
# Do not export BLOB_BASE_URL or NEXT_PUBLIC_BLOB_BASE_URL.
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data.gitstarclub.com
unset BLOB_BASE_URL NEXT_PUBLIC_BLOB_BASE_URL VIEWS_VERSION_FALLBACK
bun run cf:build:production
```

Post-deploy acceptance. This is the first time `https://gitstarclub.com/rankings` is evidence of bucket `gitstarclub-data-prod`. If it fails, run the version rollback below. Do not leave the R2 driver in place with an empty board.

- `node scripts/assert-cf-ci-gates.mjs` passes, including the rule that preview config does not name bucket `gitstarclub-data-prod`, and including the new production R2 contract from this same pull request.
- `https://gitstarclub.com/rankings` returns 200 with indexing still on, and shows repository rows (an `owner/name` link and a star count) from the generation in `https://data.gitstarclub.com/bootstrap/latest.json`. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure.
- `https://data.gitstarclub.com/views/latest.json` may still 404. Do not hand-write it. If the owner has already run the authorized refresh publish on Worker `gitstarclub-web` (top-level, bucket `gitstarclub-data-prod`) and `views/latest.json` exists, the pages must match that `version`, and the file must be the one that publish wrote.
- The production shell build exported `STORAGE_READ_DRIVER=r2` and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, not preview origin `https://data-pre.gitstarclub.com` and not the blob host, and did not export `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, or `VIEWS_VERSION_FALLBACK`. `cf:build` fails the build if the shell base does not match the top-level wrangler vars for Worker `gitstarclub-web`.

If that post-deploy check fails, roll back. Rollback restores the full pre-cutover production Worker, including `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`. Production still depends on that value while blob `views/latest.json` is missing (#543). Restoring the blob base and the blob driver, and removing `DATA`, is not enough if the fallback stays unset: rankings then render with no rows.

The pre-cutover version is `14b84f73-ef31-4e86-a70d-b71251756093`. On 2026-10-01 a read-only check found that version deployed at 100% of Worker `gitstarclub-web`. Do not pass `--env pre`. This command does not write bucket `gitstarclub-data-prod` and does not write the blob store. The restored version reads blob base `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`.

```bash
# Worker gitstarclub-web, top-level production (no --env), blob store
# https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
# Does not target bucket gitstarclub-data-prod or wrangler env pre.
wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web
```

That version has `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`, `BLOB_BASE_URL` and `NEXT_PUBLIC_BLOB_BASE_URL` set to `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`, no top-level `DATA` binding, and no `STORAGE_READ_DRIVER` (the runtime default is `blob`). Do not follow the rollback with a deploy that drops `VIEWS_VERSION_FALLBACK`.

If the rollback is a wrangler config edit and a new deploy, instead of the version command above, set the same values: `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`, both blob base variables to that blob host, drivers back to `blob` or unset, remove the production `DATA` binding, and leave `triggers.crons` at `[]`. Worker `gitstarclub-web`, top-level production, no `--env`. Do not delete blob objects. Do not empty bucket `gitstarclub-data-prod`.

Smoke after that rollback checks that blob data renders again. HTTP 200 alone is not enough. Worker `gitstarclub-web`, top-level production, blob store `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`:

```bash
# Worker gitstarclub-web, top-level production (no --env), blob store
# https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
curl -fsS -o /dev/null -w '%{http_code}\n' https://gitstarclub.com/rankings
curl -fsS https://gitstarclub.com/rankings
```

Expect HTTP 200 and indexing still on (`index, follow`). The HTML must include a repository ranking row (`owner/name`) and a star count. It must not show "Ranking data is waiting for the next published recompute." as the body of both ranking sections. That empty copy means the fallback version was not served. Blob `views/latest.json` may still 404. The page data is version `refresh-2026-09-13T06-00-16-398Z`.

### Stage 5. Production crons

Not accepted. After stage 4, and only with an explicit owner approval, set production `triggers.crons` to the three intended expressions (`0 3 * * *`, `0 4 * * SUN`, `0 6 * * SUN`). Cloudflare numbers Sunday as `1` or `SUN` and rejects `0`. Do not use `7` for Sunday (`7` is Saturday).

Acceptance: the production Worker schedule shows those three expressions, a completed run writes the production R2 bucket, and `node scripts/assert-cf-ci-gates.mjs` is updated in the same change that enables the crons so the empty-array contract is not left stale. Preview `triggers.crons` stays `[]` until the owner separately re-enables preview schedules.

Rollback: set production `triggers.crons` back to `[]` and redeploy that config. The `web/vercel.json` declarations stay as the scheduler rollback reference until stage 6. Do not call production cron as a substitute for the config rollback.

### Stage 6. Retire Blob

Not accepted. After production has been on R2 through at least one successful refresh, remove the remaining blob operating dependency:

- Production and preview do not require `BLOB_READ_WRITE_TOKEN` or `BLOB_BASE_URL`.
- Live release gates stop falling back to the public blob URL. They use `LIVE_PUBLIC_READ_BASE_URL` or the R2 public origin. That fallback is documented as temporary in [OPS.md](./OPS.md).
- Blob layout instructions in [OPS.md](./OPS.md) and the superseded Blob design doc move to history.

Acceptance: the top-level Worker config and preview `env.pre` contain no `BLOB_*` vars, and a read-only production page still returns 200 from `https://data.gitstarclub.com`.

Rollback: use the stage 4 version rollback on Worker `gitstarclub-web` (top-level production, no `--env`): `wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web`. That restores `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` and the blob public base `https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com`. It does not write bucket `gitstarclub-data-prod`. Do not delete blob objects in order to roll back. Do not empty bucket `gitstarclub-data-prod`. Deleting the blob store is a separate owner decision after this stage has stayed healthy. It is not the rollback. The same rankings smoke as stage 4 must show repository rows, not the empty ranking copy.

## What is still blob, until cutover

Production page reads, production cron writes, and the production build prerender still use the blob driver. Keep those runbooks. They are labelled until cutover in [OPS.md](./OPS.md), [README.md](../README.md), and the other current docs. Do not delete them in stage 1.

Local read-only development against the blob driver still needs only `BLOB_BASE_URL` until cutover. Preview reads do not use a blob token. R2 writes need `DEPLOY_ENV`, the matching identity marker, and either the `DATA` binding (`r2_binding`) or the S3 key (`r2` / `r2_s3`). Never commit the key.
