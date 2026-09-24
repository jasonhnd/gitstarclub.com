---
owner: operations
status: active
last_reviewed: 2026-09-24
source_of_truth_for:
  - branch topology
  - staging and promotion
  - deploy and rollback runbooks
  - cron and workflow operations
  - environment variables and alerting
---

# gitstarclub Operations Runbook

> Sole source of truth for operations and deployment. Architecture and data flow see [ARCHITECTURE.md](./ARCHITECTURE.md), product see [PRODUCT.md](./PRODUCT.md).
> Core principles from the architecture: **Cloudflare Workers hosting with Vercel Blob storage**, **a static runtime without an engine**, and **production data operations independent of local computation**. This runbook applies them to projects, environment variables, Cron, workflows, Blob, and alerts; see [API.md](./API.md) for endpoint method, authentication, cache, and status contracts.

## Scope

This document is **gitstarclub's operations runbook**—**deployment, cron / Workflow operations, Blob layout, environment-variable inventory, alerts, rollback**. When production has a problem that needs troubleshooting, or when standing up a new environment, reading this one document is enough.

Data operations layers:
- **Daily / weekly live cron**—see §Cron schedule.
- **History / metadata / canonical full refresh (Vercel cron + no-SDK orchestration)**—see §Vercel Workflow runbook (design see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md); P1 dual schedule see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md)).
- **One-time BigQuery + DuckDB bootstrap backfill**—see §One-time bootstrap Runbook (archived, non-routine path).

## Current hosting and branch topology

As checked on 2026-09-24, both `https://gitstarclub.com` and
`https://pre.gitstarclub.com` returned `server: cloudflare` and `x-opennext: 1`.
The current web host is Cloudflare Workers with OpenNext: `gitstarclub-web`
serves production (`main`), and `gitstarclub-web-pre` serves preview (`pre`).
The `www` hostname belongs to the production domain set, but this check did
not independently probe its response. Vercel Blob remains the JSON storage
service; the former Vercel web project and CLI deploy instructions below are
rollback history, not the current deployment procedure.

Feature PRs target `pre`; promotion is a separate merge from `pre` to `main`.
The CI gate forbids a live production Worker deploy from repository automation,
and its production `triggers.crons` contract remains `[]`.

### Deployment and scheduler evidence (2026-09-24)

| Surface | Observed or declared state |
|---|---|
| Production web | `gitstarclub.com`: `server: cloudflare`, `x-opennext: 1` |
| Preview web | `pre.gitstarclub.com`: `server: cloudflare`, `x-opennext: 1` |
| Production Worker schedule | Cloudflare schedules API observation in issue #528 at 03:30 UTC: `gitstarclub-web` = `[]`; repository gate requires `triggers.crons: []` |
| Preview Worker schedule | Same API observation: `gitstarclub-web-pre` = `0 3 * * *`, `0 4 * * 7`, `0 6 * * 7` |
| Production refresh trigger | Owner reports Cloudflare, but no production Worker Cron schedule was observed. An external caller, another Worker, or a changed schedule after the snapshot remains unverified. Do not infer the mechanism from route code or `web/vercel.json`. |

The Worker `scheduled` handler dispatches the three cron expressions to the
protected daily, weekly, and refresh routes. The preview platform schedules
prove preview triggers are configured; they do not establish a production
trigger. The production trigger requires an operator-provided schedule or
request log showing caller, target, and timestamp. The old `web/vercel.json`
cron declarations are retained as rollback reference and do not establish
active Vercel scheduling on the Cloudflare-hosted domain. Do not change the
production gate to reconcile the owner's statement without that evidence.

### Environment variable source

Production and preview Worker variables and bindings are declared in
[Worker configuration](../workers/gitstarclub-web/wrangler.jsonc); runtime secrets are injected on the
Cloudflare platform and are never stored in this repository. Local development
uses `web/.env.local`. Vercel Blob remains external storage and requires its
Blob URL and, for writes, a Blob token. The former Vercel project environment
configuration below applies only to its historical rollback deployment.

### History / rollback reference (retired Vercel web hosting; 2026-09-24)

The following topology, DNS values, authentication, and `vercel deploy` commands
record the pre-migration setup. They must not be used as the current operating
instructions.

## Deployment topology (single Vercel project)

Production and test environments are merged into the same Vercel project:

- Team: `zkscio`
- Project: `gitstarclub.com`
- Project ID: `prj_V9RVqspNWPXXiytX7Fj3wlMT9wNw`
- Root Directory: `web`
- Framework: Next.js
- Node.js: 24.x

| Project | Content | Domain | Description |
|---|---|---|---|
| **Production** | `web/` (Next.js, App Router + RSC) | **gitstarclub.com / www.gitstarclub.com** | Production branch is `main`; production is indexable only when `SITE_INDEXABLE=1` is set in Production |
| **Preview / staging** | the same project's Preview deployment | **pre.gitstarclub.com** | Fixed custom domain for the `pre` branch; Cloudflare DNS is `A pre.gitstarclub.com 76.76.21.21`, DNS-only |

## Branch topology / staging

GitHub and Vercel use a two-branch topology:

| Branch | Vercel target | Domain | Indexing | Purpose |
|---|---|---|---|---|
| `main` | Production Branch = `main` | `https://gitstarclub.com` / `https://www.gitstarclub.com` | Indexable only in Production; `SITE_INDEXABLE=1` is Production-only | Production |
| `pre` | Preview deployment for git branch `pre` | `https://pre.gitstarclub.com` | Always noindex in Preview | Staging |

`pre.gitstarclub.com` is a stable custom staging domain, not the auto
`*-git-pre-*.vercel.app` branch alias. It is bound in the Vercel project domain
configuration to the `pre` git branch (`gitBranch: pre`). Cloudflare DNS points
`pre.gitstarclub.com` to Vercel with `A -> 76.76.21.21`; the record is DNS-only
and must not be proxied.

Preview is intentionally noindex. The Cloudflare production build sets `SITE_INDEXABLE=1` and `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com`; the top-level Worker variables match. `bun run cf:dry-run` builds for preview with indexing disabled. Preview emits `<meta name="robots"
content="noindex,nofollow">` and `robots.txt` returns `User-Agent: *` with
`Disallow: /`. Preview still reads production Blob data because `BLOB_*`
variables are set for Preview.

Cloudflare owner commands (run from `web/`; build each target immediately before its matching deployment because both builds use the same output directory). GitHub Actions must not run the live deploy. `bun run cf:build --site-target=production` and `bun run cf:build --site-target=pre` are the explicit underlying forms. A bare `bun run cf:build` fails. `bun run cf:dry-run` builds pre and performs a Wrangler dry run of `env.pre` only. The build checks the generated home HTML and robots response for the selected indexing policy before deployment.

### Production build and deploy

`bun run cf:build:production` prerenders with `BLOB_BASE_URL`. Wrangler vars are not visible to that prerender. Export the public store base first (no trailing slash, no BOM). `SITE_INDEXABLE=1` and `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com` are set by the build script.

```sh
cd web
export BLOB_BASE_URL=https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
export NEXT_PUBLIC_BLOB_BASE_URL=https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
bun run cf:build:production
```

Deploy the top-level Worker `gitstarclub-web` with an explicit empty environment so `CLOUDFLARE_ENV` cannot select `pre`. Do not commit `CF_PREVIEW_COMMIT_SHA`. Pass the deployed SHA with `--var`. Do not use `--keep-vars` in place of the five plain-text vars in `wrangler.jsonc` (`BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, `CF_CRON_ORIGIN`, `WORKFLOW_RUNTIME`, `WORKFLOW_QUEUE_ENQUEUE_URL`). Secrets stay dashboard-injected. This command is a live deploy. Run it only when promoting production. A dry run of the same flags is safe and prints the binding list.

```sh
cd web
bunx wrangler deploy --dry-run --config ../workers/gitstarclub-web/wrangler.jsonc --env=""
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env="" \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

`--var` values are hidden in the dry-run binding table. The table must still list `HOSTING_TARGET`, `SITE_INDEXABLE`, `NEXT_PUBLIC_SITE_URL`, the five vars above, `ASSETS`, `WORKER_SELF_REFERENCE`, `JOBS` (`gitstarclub-jobs`), and `MEDIA` (`gitstarclub-assets`). Top-level `workers_dev` and `preview_urls` are `false`.

After the live deploy, check production and confirm the workers.dev subdomain stayed closed:

```sh
curl -fsS https://gitstarclub.com/robots.txt
curl -fsS https://gitstarclub.com/ | grep -o 'name="robots" content="[^"]*"'
curl -fsS -o /dev/null -w '%{http_code}\n' https://gitstarclub.com/rankings
curl -fsS https://gitstarclub.com/.well-known/deployment
curl -sS -o /dev/null -w '%{http_code}\n' https://gitstarclub-web.worldgo.workers.dev/
```

Expect `/robots.txt` to allow `/` for `User-Agent: *` and to list `Sitemap: https://gitstarclub.com/sitemap.xml`. Expect the home robots meta to be `index, follow` and not `noindex`. Expect `/rankings` to be `200` (a missing `BLOB_BASE_URL` returns 500). Expect `/.well-known/deployment` JSON `target` `cf` and `commitSha` equal to the `--var` SHA. Expect `https://gitstarclub-web.worldgo.workers.dev/` not to serve the site (`workers.dev` `enabled=false`, version preview URLs `previews_enabled=false`). Read-only settings check: Cloudflare API account `00f850e853e4c7f9627233d51a6e30a1`, Worker `gitstarclub-web`, resources `settings` and `subdomain`. Do not change schedules, DNS, or secrets from this procedure.

### Preview deploy

`env.pre` sets `workers_dev: true` and `preview_urls: true` so a preview deploy does not inherit the closed production flags. The probe host remains `https://gitstarclub-web-pre.worldgo.workers.dev`. Live `gitstarclub-web-pre` had workers.dev enabled and version preview URLs enabled on 2026-09-24; this file matches that. Turning preview URLs off for pre is a separate owner decision. `pre.gitstarclub.com/*` is not declared in `wrangler.jsonc`.

```sh
cd web
export BLOB_BASE_URL=https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
export NEXT_PUBLIC_BLOB_BASE_URL=https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com
bun run cf:build:pre
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env pre \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

Access: Preview is locked. Project-level Vercel Authentication
(`ssoProtection.deploymentType=preview`) was re-enabled 2026-08-28 so
`pre.gitstarclub.com`, PR `*.vercel.app` URLs, and leftover preview deployments
require a Vercel team login. Production domains (`gitstarclub.com` /
`www.gitstarclub.com`) stay public. CI uses the existing Protection Bypass for
Automation secret (`VERCEL_AUTOMATION_BYPASS_SECRET` / header
`x-vercel-protection-bypass`) to read identity when a Vercel Preview exists.
`preview-e2e` / `product-gates` soft-skip after Ignored Build (no Preview URL)
and are not GitHub required checks. Humans open staging while logged into
Vercel; Cloudflare preview acceptance is ops / manual on `pre.gitstarclub.com`.

Development flow: feature work targets `pre` through PRs into `pre`. Verify the
merged Preview deployment at `https://pre.gitstarclub.com`. Promotion to
production is a merge from `pre` to `main`.

### Cloudflare Workers (`main` → production, `pre` → preview)

These are **Cloudflare Worker names**, not the retired Vercel project also
historically called `gitstarclub-web`. Apex / www and `pre.gitstarclub.com`
were historically on Vercel before the Cloudflare cut.

| Git branch | Cloudflare Worker | wrangler env | Deploy rule |
|---|---|---|---|
| `main` | `gitstarclub-web` | top-level (default) | Production Worker only. GHA must never `wrangler deploy` this name except `--dry-run`. Production `gitstarclub-web.worldgo.workers.dev` is closed. |
| `pre` | `gitstarclub-web-pre` | `pre` | Preview Worker. Optional CI dry-run / probe only; do not live-deploy from GHA. |

`CF_PREVIEW_ORIGIN` (and `web/lib/runtime-config.ts` `DEFAULT_CF_PREVIEW_ORIGIN`)
defaults to `https://gitstarclub-web-pre.worldgo.workers.dev`.
`https://pre.gitstarclub.com` is an allowed equivalent override. Do not default
probe/dry-run at the closed production workers.dev host.

Optional `verify / cf-preview` and `verify / cf-workers-host` run only on `pre`
(or PRs targeting `pre`). **Do not** add those job names to `.delivery.yml` or
the GitHub required-check ruleset. `.delivery.yml` and `scripts/assert-cf-ci-gates.mjs`
use the same names: `main` → `gitstarclub-web` (production `triggers.crons` must
stay `[]`); `pre` → `gitstarclub-web-pre`. GHA and repo scripts must not
live-deploy `gitstarclub-web` or PUT production schedules.

**Domain naming conventions**:

- Production access uses only `gitstarclub.com` / `www.gitstarclub.com`.
- Test access uses only `pre.gitstarclub.com`.
- `pre.gitstarclub.com` is the fixed custom domain bound to the `pre` branch; it is not the auto `*-git-pre-*.vercel.app` branch alias.
- `gitstarclubcom.vercel.app` / `gitstarclubcom-zkscio.vercel.app` are production aliases auto-generated by Vercel, kept but not publicized externally.
- `gitstarclub-<hash>-zkscio.vercel.app` is the immutable deployment URL of each deploy, used only for inspect / promote / rollback, and is not an environment entry.
- Old `gitstarclub-web*.vercel.app` and old branch alias have been removed, to avoid confusion with the current single-project topology.

**Historical project handling**:

- `gitstarclub-web` is the old web staging project, kept only as a temporary rollback reference; do not use it for later deploys.
- The teaser static-page source in the repository root is still kept, but the production domain has already moved from teaser deployment promote to the Next.js deployment of `gitstarclub.com`.
- Deleting old Vercel projects is a destructive operation; manually delete the old projects only after confirming both `gitstarclub.com` Production and `pre.gitstarclub.com` are stable.

**Deploy commands**:

All Vercel CLI commands run from the repository root, because the project Root Directory is already set to `web`.

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com
vercel deploy . --yes --scope zkscio --project gitstarclub.com
```

When verification is required before cutting over to the production domain:

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com --skip-domain
vercel promote https://<deployment>.vercel.app --scope zkscio --yes
```

Staging is branch-bound through the Vercel project domain configuration
(`gitBranch: pre`). Do not replace it with a one-off deployment alias except for
an explicit recovery procedure.

## Environment variables and secrets

Current Worker configuration is in [Worker configuration](../workers/gitstarclub-web/wrangler.jsonc), with secrets stored on the Cloudflare platform. The former Vercel project configuration is rollback history. For local development, copy the repository root `.env.example` to `web/.env.local`; `web/scripts/lib/env.ts` loads only that file. **Never commit real secret values.** Follow least privilege for read and write paths: browsing or building does not require a write token.

<!-- env-inventory:start -->

| Variable | Purpose | Required / optional | Format | Who uses it (path:line) |
|---|---|---|---|---|
| `GITHUB_TOKEN` | GitHub GraphQL / Search PAT (batch lookup of `stargazerCount` + metadata + whitelist) | **Required** (cron / Workflow) | `ghp_…` PAT string | `web/lib/github.ts`; daily cron · weekly cron · Workflow whitelist/metadata step · one-time backfill. GraphQL and REST both send `User-Agent: gitstarclub` and `Accept: application/vnd.github+json` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read-write token | **Required** (write path) | `vercel_blob_rw_…` | `web/lib/data/write.ts` · `web/lib/storage/vercel-blob-store.ts` · `web/lib/storage/vercel-blob-fetch-client.ts` · `web/lib/workflows/recompute/io.ts` · `web/lib/workflows/steps/gc.ts`; cron writes the live tail · Workflow writes canonical/views · GC deletes old versions. CF Workers use runtime `fetch`, not `@vercel/blob`/undici |
| `BLOB_BASE_URL` | Vercel Blob public-read base URL (build / runtime direct-link fetch of views + resolving the publish pointer) | **Required** (read path) | `https://<store>.public.blob.vercel-storage.com` (**no trailing slash / no BOM**) | `web/lib/data/source.ts` · `web/lib/cron/sync-runs.ts`; Next.js build · ISR views read directly · live cron reads the publish pointer |
| `NEXT_PUBLIC_BLOB_BASE_URL` | `BLOB_BASE_URL` client fallback (only when the server-only value is unavailable) | Optional (fallback) | Same as `BLOB_BASE_URL` | `web/lib/data/source.ts` · `web/lib/cron/sync-runs.ts`; read from the client bundle |
| `STORAGE_READ_DRIVER` | Object-storage read driver | Optional (default `blob`) | `blob` \| `r2` \| `r2_then_blob` | `web/lib/runtime-config.ts` · `web/lib/storage/object-store.ts`; P0 still reads Vercel Blob by default, see [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md) |
| `READ_DRIVER` | `STORAGE_READ_DRIVER` alias | Optional | Same as `STORAGE_READ_DRIVER` | `web/lib/runtime-config.ts` |
| `STORAGE_WRITE_DRIVER` | Object-storage write driver | Optional (default `blob`) | `blob` \| `r2` | `web/lib/runtime-config.ts` · `web/lib/storage/object-store.ts`; `r2` allows only non-production `migrate-*` prefixes, and rejects `VERCEL_ENV=production` |
| `WRITE_DRIVER` | `STORAGE_WRITE_DRIVER` alias | Optional | Same as `STORAGE_WRITE_DRIVER` | `web/lib/runtime-config.ts` |
| `R2_ACCOUNT_ID` | Cloudflare account ID (composed into the S3 endpoint) | R2 driver only | 32-digit hex | `web/lib/runtime-config.ts`; prepared account `00f850e853e4c7f9627233d51a6e30a1` |
| `R2_S3_ENDPOINT` | R2 S3-compatible endpoint | R2 driver only | `https://<account>.r2.cloudflarestorage.com` | `web/lib/runtime-config.ts` |
| `AWS_ENDPOINT_URL` | `R2_S3_ENDPOINT` alias | R2 driver only | Same as `R2_S3_ENDPOINT` | `web/lib/runtime-config.ts` |
| `R2_ACCESS_KEY_ID` | R2 S3 access key | R2 driver only | Cloudflare R2 API token | `web/lib/runtime-config.ts` |
| `AWS_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` alias | R2 driver only | Same as `R2_ACCESS_KEY_ID` | `web/lib/runtime-config.ts` |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret | R2 driver only | secret | `web/lib/runtime-config.ts` |
| `AWS_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` alias | R2 driver only | Same as `R2_SECRET_ACCESS_KEY` | `web/lib/runtime-config.ts` |
| `R2_BUCKET` | R2 bucket name | R2 driver only | `gitstarclub-assets` | `web/lib/runtime-config.ts` |
| `AWS_S3_BUCKET` | `R2_BUCKET` alias | R2 driver only | Same as `R2_BUCKET` | `web/lib/runtime-config.ts` |
| `R2_REGION` | SigV4 region | Optional (default `auto`) | `auto` | `web/lib/runtime-config.ts` |
| `AWS_REGION` | `R2_REGION` alias | Optional | Same as `R2_REGION` | `web/lib/runtime-config.ts` |
| `R2_PREFIX` | Non-production object prefix | Optional (default `migrate-dev/`) | `migrate-dev/` / `migrate-test/` / `migrate-preview/` | `web/lib/runtime-config.ts`; an empty prefix and the production key space forbid writes |
| `R2_PUBLIC_BASE_URL` | R2 public-read base URL | only `r2` / `r2_then_blob` page read | no-trailing-slash https origin | `web/lib/runtime-config.ts` · `web/lib/data/source.ts` |
| `CRON_SECRET` | Cron auth random string (Vercel injects it as `Authorization: Bearer <secret>`, and the handler verifies it) | **Required** | Random string (≥32 characters, **no leading or trailing whitespace**) | `web/lib/cron/handlers.ts` · `web/lib/security.ts` · `web/lib/runtime-config.ts` · `web/app/api/workflows/refresh/start/route.ts` · `web/app/api/workflows/refresh/step/route.ts`; daily / weekly cron · refresh start / step |
| `WORKFLOW_RUNTIME` | Managed refresh orchestration backend | Optional (default `http`) | `http` \| `memory` \| `cf-queue` | `web/lib/runtime-config.ts` · `web/lib/workflows/runtime/resolve.ts`. Unset code default is `http`. Production wrangler top-level and preview `env.pre` both set `cf-queue`. |
| `WORKFLOW_QUEUE_ENQUEUE_URL` | Cloudflare Queue enqueue URL (Worker `/enqueue`) | Required only when `WORKFLOW_RUNTIME=cf-queue` | Absolute URL | `web/lib/runtime-config.ts` · `web/lib/workflows/runtime/cf-queue.ts`. Production top-level is `https://gitstarclub.com/enqueue`. Preview `env.pre` is `https://pre.gitstarclub.com/enqueue`. |
| `WORKFLOW_STEP_BASE_URL` | step route origin override | Optional | no-trailing-slash https origin | `web/lib/runtime-config.ts`; when unset, use the request origin or `VERCEL_URL` |
| `CACHE_INVALIDATION_DRIVER` | ISR invalidation port | Optional (default `vercel`) | `vercel` \| `memory` \| `cf-stub` | `web/lib/runtime-config.ts` · `web/lib/cache-invalidation/`; production defaults to Next `revalidatePath/Tag`, `cf-stub` is non-production only, see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) |
| `CF_CACHE_PURGE_URL` | CF stub dual-run POST URL (Worker `/preview/invalidate`) | Only when `CACHE_INVALIDATION_DRIVER=cf-stub` | Absolute URL | `web/lib/runtime-config.ts` · `web/lib/cache-invalidation/cf-stub.ts`; not Cloudflare Cache Purge |
| `PREVIEW_TARGET` | Preview resolution backend | Optional (default `vercel`) | `vercel` \| `cf` | `web/lib/runtime-config.ts` · `web/lib/preview/`; production gates still go through Vercel |
| `CF_PREVIEW_ORIGIN` | Non-production CF Preview origin | Optional (default `https://gitstarclub-web-pre.worldgo.workers.dev`) | no-trailing-slash https origin | `web/lib/runtime-config.ts`; default preview Worker `gitstarclub-web-pre`, do not point it at the already-closed production `gitstarclub-web.worldgo.workers.dev`; Access protects only this host, and is not bound to apex/www |
| `CF_CRON_ORIGIN` | CF Worker `scheduled` hits Next cron route HTTP origin | Required for Worker dispatch (wrangler var) | no-trailing-slash https origin; preview `https://pre.gitstarclub.com`, production `https://gitstarclub.com` | Worker `env.CF_CRON_ORIGIN`; do not hardcode the wrong environment, and do not use the already-closed production `workers.dev`; the value is not a secret, but it must be injected per Worker |
| `REFRESH_START_URL` | refresh cron / `/start` override URL | Optional (when unset, `{CF_CRON_ORIGIN}/api/workflows/refresh/start`) | Absolute URL | Worker `env.REFRESH_START_URL`; injected by the platform, not committed to the repo |
| `REFRESH_STEP_URL` | Queue consumer advances refresh step URL | Required when consuming a refresh step | Absolute URL | Worker `env.REFRESH_STEP_URL`; injected by the platform, not committed to the repo |
| `CF_ACCESS_CLIENT_ID` | CF Access Service Token id (CI) | Only `PREVIEW_TARGET=cf` / optional `cf-preview` job | Access Service Token Client ID | `web/lib/preview/access.ts`; the GitHub secret name is the same; token name `gitstarclub-cca-ci`, and the secret is not committed to the repo |
| `CF_ACCESS_CLIENT_SECRET` | CF Access Service Token secret (CI) | Only `PREVIEW_TARGET=cf` / optional `cf-preview` job | Access Service Token Client Secret | `web/lib/preview/access.ts`; header `CF-Access-Client-Secret` |
| `CF_PREVIEW_REQUIRE_SHA` | Require the CF Preview identity SHA to match | Optional (off by default) | String `1` enables the gate | `web/lib/runtime-config.ts` and `web/scripts/resolve-preview.ts`; check the built SHA or an explicit `CF_PREVIEW_COMMIT_SHA` before enabling this gate |
| `CF_PREVIEW_COMMIT_SHA` | Deployment SHA for CF Preview and the Workers host | Optional | Git SHA | `web/lib/deployment-identity.ts` and Worker `env.CF_PREVIEW_COMMIT_SHA`; when unset, identity uses the SHA baked by `cf:build` or `null` |
| `CF_BUILD_COMMIT_SHA` | Optional CI SHA override for `cf:build` | Optional | 40 to 64 hexadecimal characters | `web/scripts/cf-build-identity.ts`; Git HEAD is used when unset. Tracked changes append `-dirty`; untracked files do not. Missing Git yields `null`. |
| `MIN_TRACKED_STARS` | Whitelist / refresh discovery floor (star count) | Optional (default `10000`) | Positive-integer string; preview wrangler `env.pre` is `1000`, and production top-level must not be set to `1000` | `web/lib/runtime-config.ts` · `web/lib/github.ts` · `web/lib/constants.mjs`; GitHub Search `stars:>=N`; rollback = remove it or change it back to `10000` |
| `WHITELIST_SEARCH_SHARDS` | whitelist GitHub Search whether sharded by hop | Optional (default off = single hop) | The string `"1"` turns it on; preview wrangler `env.pre` is `1` | `web/lib/runtime-config.ts` · `web/lib/workflows/steps/whitelist.ts` · `web/lib/github.ts`; each hop writes `ops/workflows/<run_id>/whitelist-search.json`, and the snapshot is written only when complete. Rollback = remove it or set `0` to restore a single hop. Do not turn shards off to fix a metadata 502 |
| `PREFLIGHT_RELAX_EMPTY_SHARDS` | Whether preview preflight treats a missing/empty canonical shard as a `{}` placeholder | Optional (default off = missing shard fail closed) | The string `"1"` turns it on; preview wrangler `env.pre` only. `VERCEL_ENV=production` rejects it even if set by mistake | `web/lib/runtime-config.ts` · `web/lib/workflows/canonical-validation.ts` · `web/lib/workflows/steps/preflight.ts`; policy name `preview-empty-canonical-placeholder`. schema / `d` / identity / wrong bucket / non-404 still fail closed. Rollback = remove it or set `0`. Do not turn off sharded Search to fix a missing shard |
| `WORKFLOW_COLD_START` | Whether the first preview managed publish may bootstrap canonical / an empty lookup from zero | Optional (default off) | The string `"1"` turns it on; preview wrangler `env.pre` only, and it should be turned on together with `PREFLIGHT_RELAX_EMPTY_SHARDS=1`. `VERCEL_ENV=production` rejects it even if set by mistake | `web/lib/workflows/cold-start.ts` · `web/lib/runtime-config.ts` · refresh start / preflight / whitelist / metadata / recompute I/O. It takes effect only while `views/latest.json` is still 404; written meta uses a real UTC `generated_at` and the bootstrap-day `seam_date` (no GH Archive  gross history), and **forbids** fake `node_id` / fake GraphQL. On conflict with the #515 empty-bucket placeholder, #512 502 recovery, or SafeText, **cold start wins** (see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)). After the first successful publish it automatically returns to fail closed. Rollback = remove it or set `0` |
| `WHITELIST_SEARCH_HOP_BUDGET_MS` | Single-hop Search wall-clock budget | Optional (default `600000` = 10 min) | Integer milliseconds, `60000..840000` (must stay under the Queue 15 min wall) | `web/lib/runtime-config.ts` · `web/lib/github.ts` `searchWhitelistHop` |
| `HOSTING_TARGET` | Next hosting target | Optional (default `vercel`) | `vercel` \| `cf` | `web/lib/runtime-config.ts` · `web/lib/analytics-policy.ts`; `cf` is non-production Workers preview only, see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) |
| `NEXT_PUBLIC_HOSTING_TARGET` | `HOSTING_TARGET` public alias | Optional | Same as `HOSTING_TARGET` | `web/lib/runtime-config.ts`; do not set it to `cf` on Vercel Production |
| `CF_WORKERS_HOST_ORIGIN` | P3 Workers host smoke origin | Optional | no-trailing-slash http(s) origin | `web/lib/workers-host/smoke-origin.ts` · `web/scripts/cf-workers-host-smoke.ts` |
| `CF_WORKERS_HOST_LOCAL` | P3 smoke forces localhost | Optional | String `1` | `web/lib/workers-host/smoke-origin.ts` |
| `VERCEL_DEPLOY_HOOK_URL` | Deploy Hook URL (triggers one core rebuild, for a code / structure change or a manual full refresh) | Optional | `https://api.vercel.com/v1/integrations/deploy/<id>` | Manual / CI (data updates do not need it; the long tail uses ISR) |
| `ALERT_WEBHOOK_URL` | Failure-alert webhook (Slack / Discord incoming webhook or `https://webhook.site/...`, POST a JSON summary; **if unset, logs only**) | Optional | An `https://…` endpoint that can receive a JSON POST | `web/lib/observability/alert.ts:45`; Workflow `sendAlert` · daily / weekly cron failure delivery |
| `SITE_INDEXABLE` | Enables public indexing and sitemap discovery | Required for the production Cloudflare build and Worker; absent on preview | `"1"` enables indexing; other values disable it | `web/scripts/cf-opennext-build.ts`, [Worker configuration](../workers/gitstarclub-web/wrangler.jsonc), `web/app/robots.ts`, `web/app/_shell/RootShell.tsx` |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service-account key path | One-time backfill only | Local file path, for example `./gcp-key.json` | **Local backfill script** (one-time BigQuery backfill only) |
| `GCP_PROJECT_ID` | GCP project ID | One-time backfill only | GCP project ID string | **Local backfill script** (one-time BigQuery backfill only) |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap, metadata, and structured data | Required for the production Cloudflare build and Worker | `https://gitstarclub.com` without a trailing slash | `web/scripts/cf-opennext-build.ts`, [Worker configuration](../workers/gitstarclub-web/wrangler.jsonc), `web/app/robots.ts`, `web/app/_shell/RootShell.tsx` |
| `BING_SITE_VERIFICATION` | Bing `msvalidate.01` token | Optional (production) | Bing-provided token | `web/app/_shell/RootShell.tsx` outputs verification meta; no XML file is needed |
| `INDEXNOW_ENABLED` | IndexNow post-commit submission switch | Optional (default off) | The string `1` enables it | live cron calls IndexNow after the pointer is committed; dry-run / pre-commit do not call it |
| `SEO_LIVE_BASE` | Live-line origin fetched by integration tests (default `https://www.gitstarclub.com`; leave empty to skip the test) | Tests only | `https://www.gitstarclub.com` or an empty string | `web/lib/integration/seo.test.ts:23` |
| `SEO_EXPECT_INDEXABLE` | Live SEO acceptance environment policy (Preview `0`, Production `1`; when unset, inferred from the canonical host) | Tests only | `0` or `1` | `web/lib/integration/seo.test.ts` · `.github/workflows/ci.yml` |
| `SEO_CANON_ORIGIN` | canonical origin asserted by integration tests (default `https://gitstarclub.com`) | Tests only | Absolute origin (**no trailing slash**) | `web/lib/integration/seo.test.ts:25` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Preview Vercel Authentication CI bypass (`x-vercel-protection-bypass`) | needed only when preview-e2e / product-gates resolve a Vercel Preview; on Ignored Build / no Preview, skip | Vercel Protection Bypass for Automation token | `web/lib/vercel-protection-bypass.ts` · `web/scripts/resolve-vercel-preview.ts`; not sent to the browser, and not put on production pages |

Platform and development-tool variables also belong to the maintained inventory; they must not be mistaken for application secrets:

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_RUNTIME` | Next.js injected | `nodejs` / `edge`; enables the shared Data Cache 404 sentinel for `bootstrap/latest.json` |
| `VERCEL_ENV` | Injected by Vercel | Distinguishes Production / Preview / Development behavior |
| `VERCEL_URL` | Injected by Vercel | `/.well-known/deployment` returns the current immutable deployment URL |
| `VERCEL_GIT_COMMIT_SHA` | Vercel injected | `/.well-known/deployment` returns the current deploy commit |
| `NODE_ENV` | runtime/tooling | Next.js and tests standard runtime mode |
| `CI` | CI | Enables CI-only timeouts, output, and security gates |
| `PORT` | Local tooling | Port the local fixture/dev server listens on |
| `BASE_URL` | Playwright/release | Browser-test origin; usually injected by the deployment resolver |
| `PLAYWRIGHT_BASE_URL` | Playwright | `BASE_URL` explicit Playwright override |
| `IDENTITY_ORIGIN` | release gate | Verifies the target deployment's canonical identity |
| `LIVE_SMOKE_SITE_URL` | live smoke | live smoke target origin |
| `RUN_LIVE_SMOKE` | live smoke | The string `1` enables the explicit network smoke |
| `BASELINE_SCREENSHOT_DIR` | visual tooling | baseline screenshot output directory |
| `BASELINE_SCREENSHOT_LOCALES` | visual tooling | baseline locale subset |
| `BASELINE_SCREENSHOT_ROUTE_IDS` | visual tooling | baseline route subset |
| `BASELINE_SCREENSHOT_YEAR` | visual tooling | baseline year parameter |
| `BASELINE_SCREENSHOT_MONTH` | visual tooling | baseline month parameter |
| `BASELINE_SCREENSHOT_WEEK` | visual tooling | baseline week parameter |
| `BASELINE_SCREENSHOT_REPO` | visual tooling | baseline repo parameter |
| `BASELINE_SCREENSHOT_ORG` | visual tooling | baseline org parameter |
| `BASELINE_SCREENSHOT_CATEGORY` | visual tooling | baseline category parameter |

<!-- env-inventory:end -->

**Conventions**:

- `NEXT_PUBLIC_*` goes into the client bundle; **put only non-sensitive values there**. Everything else is Server-only.
- Production and Preview page/build read paths require only `BLOB_BASE_URL`. Only cron /
  Workflow mutation environments configure `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
  `GITHUB_TOKEN`; they are **never written into the repository or the client**.
- When writing Vercel variables, leading/trailing whitespace and a BOM must be stripped; whitespace on `CRON_SECRET` makes the Cron header illegal, and a BOM on `BLOB_BASE_URL` makes the Next.js build report `ERR_INVALID_URL` at the sitemap stage.
- **The two GCP items are for local one-time backfill only**: query GH Archive with BigQuery (about $10, including a stable repo.id). After one backfill these two variables can be retired—**routine operations are 0 GCP and 0 external bills**. (Why not the free ClickHouse public instance / self-hosted: see ARCHITECTURE "Why backfill uses BigQuery".)
- At startup, verify that required secrets exist; if any are missing, fail-fast (do not swallow them silently).
- Cloudflare R2 P0 adaptation (dual-read switch, non-production write guard, rollback) see [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md). Reads/writes still default to Vercel Blob; **do not cut DNS**.
- Cloudflare migrate P1 orchestration (remove the Workflow SDK, non-production CF Cron/Queue, dual-schedule rollback) see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). **The production weekly refresh is still Vercel cron**, until Jason approves the cutover.
- Cloudflare migrate P2 (ISR invalidation port, pluggable Preview, Access protects only `gitstarclub-web-pre.worldgo.workers.dev`, optional `cf-preview` job) see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md). **Production Preview / product-gates / `revalidatePath` are still Vercel**. Do not cut DNS, and do not bind Access to apex/www.
- Cloudflare migrate P3 (OpenNext mounts Next onto the `gitstarclub-web` preview, optional `cf-workers-host` dry-run) see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md). **Production apex/www is still Vercel**. Do not cut DNS, and do not treat the Worker as the only entry.

## Vercel Blob layout

Use **one PUBLIC store**: the large set of JSON views is read by the build / runtime via **direct-link URL**; public reads are the simplest and hit the CDN. The first bootstrap's views + canonical are sealed first in an immutable generation and committed once by `bootstrap/latest.json`; later canonical changes enter that generation's copy-on-write overlay. The full definition of the new layout see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4 and [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.11–2.13.

```text
blob://
├── bootstrap/
│   ├── latest.json                                  # atomic bootstrap pointer (previous=null means legacy-flat)
│   ├── generations/<bootstrap-generation>/          # create-only; never overwritten after the manifest is sealed
│   │   ├── manifests/{base,canonical}.json           # object path/bytes/SHA-256 integrity receipt
│   │   ├── views/**                                  # first base views; after views/latest exists, managed views take priority
│   │   └── canonical/
│   │       ├── star_daily.parquet                    # bootstrap archive
│   │       └── v2/**                                 # immutable canonical seed
│   └── overlays/<bootstrap-generation>/canonical/v2/** # recurring canonical copy-on-write state
├── canonical/                                       # legacy flat layout: read and write only when the bootstrap pointer does not exist
│   ├── star_daily.parquet                          # bootstrap archive (read/write only for one-time / disaster rebuild, not a production path)
│   └── v2/                                          # production canonical JSON shard (see VERCEL-DATA-OPERATIONS §4)
│       ├── meta.json                                #   seam_date · schema_ver · folded_through (week/month watermark)
│       ├── whitelist/                               #   Workflow step 1: ≥10k whitelist (web/lib/workflows/steps/whitelist.ts)
│       │   ├── <run_id>.json                        #     single-run snapshot (entries + diff.added/dropped)
│       │   └── latest.json                          #     pointer: { run_id, ids } — used by the next run to compute the diff
│       ├── repos/{bucket}.json                      #   repo dimension + active/history + tracked_since + frozen anchor factor d
│       ├── repo-monthly/{bucket}.json · repo-weekly/{bucket}.json · repo-recent-daily/{bucket}.json
│       ├── site-daily/{yyyy}.json
│       └── pending/{period}.json                    #   frozen snapshot of a closed period's live tail waiting to be folded (guards against duplicates / data loss)
├── lookup/
│   ├── repos.json                                   # repo metadata (build join)
│   └── orgs.json
├── rank/                                            # precomputed ranking views (read by the build, flat old layout; the new layout uses views/<run_id>/rank/**)
│   ├── {week|month|year}/{period}/{repo|org}/{flow|stock}.json
│   └── all-time/{repo|org}/stock.json
├── entity/                                          # flat old layout
│   ├── repo/{id}.json                               # curve + milestones + period table + rank history
│   └── org/{login}.json
├── heatmap/{year|month}/{period}.json
├── live/                                            # atomic live tail of the current period (written by daily / weekly cron)
│   ├── latest.json                                  #   the only mutable control object: full generation pointer + ETag/CAS lease
│   └── generations/<run_id>/                        #   immutable; switching latest is allowed only after the manifest is written
│       ├── manifest.json                            #     full file manifest + idempotency key + previous generation
│       ├── current_month.json · hot-snapshot.json
│       ├── rank/{week|month}/{current}/repo/{flow|stock}.json
│       ├── heatmap/month/{current}.json
│       └── rollover/{period}.json                   #     in-generation recovery copy of cross-month pending (only when crossing a month)
├── views/                                           # publish layer: latest.json pointer + <run_id>/ (version=run_id)
│   ├── latest.json                                  #   pointer: { version, run_id, published_at, prev_version, schema_ver }
│   └── <run_id>/                                    #   versioned output (writeVersion → views/<run_id>/<rel>)
│       ├── meta.json                                #     version meta (seam_date · schema_ver · folded_through · generated_at)
│       ├── lookup/                                  #     entity step derived (lookup/repos.json + lookup/orgs.json)
│       │   ├── repos.json
│       │   ├── orgs.json
│       │   ├── aliases.json                         #     buildAliases step derived: old_full_name → current id (repo route 308 redirect, validate checks)
│       │   └── categories.json                      #     category step derived: public category catalog (validate checks that it is non-empty)
│       ├── categories/                              #     category step derived (registry + per-repo assignment, validate checks)
│       │   ├── registry.json                        #       category registry (dimensions × categories, including the public flag)
│       │   ├── assignments.json                     #       v2 index (or a v1 monolith readable during migration)
│       │   └── assignments/shards/{0..31}.json      #       repo_id % 32 shards (single file < 1.50 MiB)
│       ├── search/
│       │   └── index.json                           #     client search index (derived by the entity step; the validate gate checks the entry count)
│       ├── rank/                                    #     rank matrix (window × dimension × metric)
│       │   ├── {week|month|year}/{period}/{repo|org}/{flow|stock|growth|new}.json
│       │   ├── all-time/{repo|org}/stock.json
│       │   └── category/{dimension}/{slug}/all-time/{repo|org}/stock.json  # category rankings (validate spot-checks)
│       ├── entity/                                  #     repo / org curve + milestones + period table + rank history
│       │   ├── repo/{id}.json
│       │   └── org/{login}.json
│       └── heatmap/                                 #     site-level day / month rollup
│           ├── month/{yyyy-mm}.json
│           └── year/{yyyy}.json
├── ops/
│   ├── sync-runs.json                               # live cron run records (keep the most recent 100)
│   └── workflows/
│       ├── latest-success.json                      #   recovery point of the most recent successful run: { run_id, version, published_at }
│       ├── active.json                              #   current refresh/rollback lease (ETag CAS; idempotency_key + fencing_token + expiry)
│       ├── health/                                  #   per-pipeline CAS health state (no flat health.json)
│       │   ├── workflow-refresh.json                #     Sunday 06:00 the only operator signal
│       │   ├── cron-daily.json                      #     updated on every non-dry success/failure
│       │   └── cron-weekly.json                     #     updated on every non-dry success/failure
│       └── <run_id>/                                #   Workflow single-run checkpoint
│           ├── manifest.json                        #     step list + status (running / published / failed)
│           ├── canonical-manifest.json              #     record count, SHA-256, and integrity receipt of the required canonical shard
│           ├── validation.json                      #     publish gate result (ok · checked · invariants · failures)
│           ├── renames.json                         #     rename step output (old_full_name → new_full_name, web-layer 308)
│           └── error.json                           #     written on failure (run_id · error · at)
├── current_month.json                               # migration-period legacy fallback; the new cron no longer overwrites it
└── hot-snapshot.json                                # migration-period legacy fallback; the new cron no longer overwrites it
```

**Blob operation constraints (must be followed when writing a pipeline)**:

| Dimension | Value | Countermeasure |
|---|---|---|
| API | `put` / `head` / `list` / `del` / `copy`; callable from build script, cron route, and server component | — |
| Per-file limit | 5TB | Far beyond need (the data is only tens of MB) |
| Pro capacity | ~5GB storage + 100GB transfer/month | The data is tens of MB, with ample room |
| **Write rate** | **4,500 times/minute (75/s)** | **Batched `put()` must be throttled** (limit concurrency + spacing), especially when a bootstrap upload / Workflow recompute writes tens of thousands of entity JSON files |
| Same-path overwrite | Requires `allowOverwrite: true` | Only a pointer / lease / operations state may be overwritten; live generation objects must use `allowOverwrite:false` |
| **Cache propagation** | A same-path overwrite takes up to **60s** to take effect network-wide | The page process still memo `live/latest.json` 60s. Pointer writes use `max-age=0`. **publish uses the Blob API `head()` etag (the origin etag recorded at claim time) as fence**, and no longer uses a public GET to decide whether the lease is still held. A public store cannot private get; the CDN caches by path, and `?v=` has no effect. The Sunday weekly fast path is 1–2s, otherwise it reads `lease: null`. generation paths are immutable |

> Why a PUBLIC store was chosen: JSON views are public data meant to be `fetch`ed directly by the build / runtime, so a public read skips signatures and naturally goes through the CDN. canonical (JSON shard + bootstrap Parquet) is in the same store, but only a Workflow / bootstrap that holds the token writes it, and it is not on the build / runtime read path.

**Safe delete (preview only by default)**:

```bash
cd web

# Enumerate the full prefix, and print the exact object count + bytes; it does not delete
bun scripts/blob-del-prefix.ts views/verify-123/

# A delete happens only when --execute and a character-for-character identical --confirm are both present
bun scripts/blob-del-prefix.ts views/verify-123/ \
  --execute --confirm views/verify-123/
```

preview inventory does not hold a write lock, and does not delete. Execute mode first acquires the `ops/workflows/active.json` fenced lease shared with managed/bootstrap publish and rollback; before each delete chunk it runs `renew → re-read live protection state → re-check fencing → del`, and releases the lease only at the end. Therefore a current / rollback target cannot be switched in between the protection check and the destructive call. `canonical/**`, `ops/**`, `live/**`, `current_month`, `hot-snapshot`, the two latest pointer, the view prefix of the current / rollback-target / active Workflow, and the current / rollback bootstrap generation + overlay are all hard-blocked; wide prefixes such as `views/`, `bootstrap/generations/`, and `bootstrap/overlays/` also cannot be executed. Automatic GC reuses the same guard before the owning refresh lease is released.

> **Public JSON endpoint**: the method/cache/status contract for `/search-index`, `/repo-curve`, and the static data export aliases see [API.md](./API.md); Blob reads and the physical layout still follow this section.

### Live-rank recovery: `2026-W27`

During the `GITHUB_TOKEN` outage (**2026-06-30 → ~2026-07-12**, issue #280) daily/weekly live refresh failed, so no `live/rank/week/2026-W27/**` was written by cron, and `current_month` / pending never recorded **2026-06-29 … 2026-07-05** (ISO week W27).

**Backfill (landed):** `web/scripts/backfill-live-week.ts` rebuilt `live/rank/week/2026-W27/repo/flow.json` from [GH Archive](https://www.gharchive.org/) hourly `WatchEvent` rows for the tracked ≥10k set (Mon–Sun UTC).

| Caveat | Detail |
|---|---|
| Metric | **Gross** star additions (WatchEvent count), not GraphQL **net** deltas used by normal live cron |
| Completeness | GH Archive `WatchEvent` volume in mid-2026 is **far lower** than 2024 samples for the same hour-of-day (~80× fewer in a spot check). Treat W27 ranks as **ordering best-effort / lower-bound**, not comparable in magnitude to W26/W28 live shards |
| Scope | Top-20 flow only (same shape as live cron) |
| Base ranks | Still absent under `views/<version>/rank/week/2026-W27/**` until July is frozen and fold advances `folded_through.week` past W27 (needs July pending) |

Re-run:

```bash
cd web
# one day at a time (resumable state under $TMPDIR/gitstarclub-backfill-<week>/)
bun run scripts/backfill-live-week.ts --week 2026-W27 --date 2026-06-29
# …
bun run scripts/backfill-live-week.ts --week 2026-W27 --finalize
```

`KNOWN_MISSING_LIVE_WEEKS` is empty after this backfill. Product gates expect `live/rank/week/2026-W27/repo/flow.json` **200**.

## Cron route and schedule reference

The following Vercel schedule declaration is historical. The current preview Worker schedule and production evidence gap are recorded above.

`web/vercel.json` declares `crons[]`; the Pro plan allows **100 job / project**, minimum once / minute. Three job:

Endpoint method, auth, query, response, cache, and status contract see [API.md](./API.md); this section maintains only the schedule, idempotency, and the operations runbook.

| Job | Schedule (UTC) | Action | Triggers a deploy? |
|---|---|---|---|
| **Daily** | `0 3 * * *` (~03:00) | **Vercel Function / JSON-only**: GraphQL looks up current_stars → generate and validate a complete immutable live generation → atomically switch `live/latest.json` → `revalidatePath` the hot-set pages | **No** (does not touch Parquet / the engine / deploy) |
| **Weekly** | `0 4 * * 0` (Sunday ~04:00) | **Vercel Function / incremental refresh**: reuse the same generation/pointer publish protocol, and write `ops/sync-runs.json` | **No** (long tail is on-demand ISR; no full build) |
| **Weekly refresh workflow** | `0 6 * * 0` (Sunday 06:00) | **Vercel cron + no-SDK orchestration / full refresh**: after `/api/workflows/refresh/start` authenticates, it acquires a lease and `startRefresh`—whitelist → rename → metadata → fold → rank / entity / heatmap recompute → validate → publish (switch the pointer) → version GC. The default is an HTTP self-chain to `/api/workflows/refresh/step`; the production schedule is still this table, not CF Cron | **No** (publish only switches the pointer; the schedule is independent of daily / weekly) |

```jsonc
// web/vercel.json — all scheduled entrypoints run on Vercel Production
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 3 * * *" },
    { "path": "/api/cron/weekly", "schedule": "0 4 * * 0" },
    { "path": "/api/workflows/refresh/start", "schedule": "0 6 * * 0" }
  ]
}
```

### CF Cron dispatch draft (in-repo code; the platform is not enabled)

The Worker `scheduled` handler dispatches by `event.cron` to the three paths in the table above (see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md)). weekly / refresh also accept Sunday `0` and `7` (and the documented `SUN`); daily stays `0 3 * * *`. Production `wrangler.jsonc` `triggers.crons` **must stay `[]`**. Preview `env.pre` may carry a draft of the three expressions, which **does not mean** schedules are already turned on in Cloudflare. This repo does not enable platform schedules, and does not claim that production cron is already on.

Note: `CRON_SECRET` / `REFRESH_*_URL`, and `PUT .../schedules` (first `gitstarclub-web-pre`), are **a separately opened operations execution ticket**. This repo does not write secret values, and does not claim that production cron is already enabled. Stopping Vercel Cron comes only after CF preview is green and Jason approves the cutover.

**A full daily / refresh on CF depends on the Blob write-path fix**: under `HOSTING_TARGET=cf`, lease/write must use `web/lib/storage/vercel-blob-fetch-client.ts` (runtime `fetch` → `https://vercel.com/api/blob`), and must not use `@vercel/blob` undici/Node TLS, which triggers `options.ALPNProtocols option is not implemented`. `?dry=1` writes no objects and can return 200 before that fix. Re-test steps see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Production `triggers.crons` must still be `[]`.

> **Vercel-only cron implementation**: daily job = `web/app/api/cron/daily/route.ts`, weekly job = `web/app/api/cron/weekly/route.ts`, and both delegate to `web/lib/cron/handlers.ts` and support `?dry=1`. CRON_SECRET auth → with the idempotency key `<job>:<UTC-day>`, acquire a 15-minute ETag/CAS lease on `live/latest.json` → GraphQL pulls current_stars → `live-refresh.ts` idempotently rebuilds that day's state → validate all JSON → write `live/generations/<run_id>/**` (`current_month.json` v2 index + `current_month/shards/<0-31>.json`) and the manifest → the same control object does a fenced CAS generation switch → only **after that** come `revalidatePath` / IndexNow / `ops/sync-runs.json`. On UTC Sunday, daily returns `skipped: weekly-owns-sunday` before acquiring the lease, so it does not contend with the 04:00 weekly for live/health. Different keys in parallel return 409; the same key still running returns 202 attached, and one already committed returns 200 already-published. A manual same-day refresh must supply a new `idempotency_key`. Publish / release fence with the Blob API `head()` etag captured at acquire — not a public GET of the pointer body (#402). Health CAS is at most 5 tries, with exponential backoff + jitter; do not resolve a sustained conflict by raising the count.

**Failed weekly / leftover lease:** A false-fence (or any failure after acquire) used to leave `lease` on `live/latest.json` until `expires_at` (~15 min) because release also read the CDN-stale `lease: null` body and skipped the clear. Release now CAS-clears when `claimedEtag` still matches origin `head()`. If an old deploy left a lease stuck, wait until `expires_at` before the next acquire; do not skip that wait by writing `main` or calling production cron unless the user said push main. Sunday **workflow-refresh** failures are the next section, not this path.

### Sunday 06:00 UTC workflow-refresh failure

Schedule: `0 6 * * 0` UTC → `GET /api/workflows/refresh/start` (managed refresh, no Workflow SDK). This is **not** the Sunday 04:00 weekly live cron above. A leftover `live/latest.json` lease is that other path (#402). The production scheduler is unverified; see the dated evidence above.

Paging already exists — do not invent new alerts. `markFailed` in `web/lib/workflows/checkpoint.ts` calls `recordHealth("workflow-refresh", "failed", …)` and `sendAlert`. Start-route lease/enqueue failures in `web/lib/workflows/start.ts` also `sendAlert`. `sendAlert` always writes a structured `[ALERT] workflow-refresh failed` function log; it POSTs a webhook only when `ALERT_WEBHOOK_URL` is set.

1. Read **`ops/workflows/health/workflow-refresh.json`** (`status`, `last_failure`, `freshness.stale_after`). **Do not read** retired `ops/workflows/health.json`.
2. Grep Vercel function logs for `[ALERT] workflow-refresh`.
3. Check `ops/workflows/active.json` (`run_id`, `expires_at`, `fencing_token`, `idempotency_key`). Default Sunday key is week-scoped (`workflow-refresh:YYYY-Www`). Same-key retries attach; a different active trigger is 409.
4. Check `ops/workflows/<run_id>/manifest.json`, `error.json`, and `validation.json`. Validate is fail-closed; do not relax invariants.
5. Check `views/latest.json`. If the failure was before publish, the pointer must be unchanged. Do not hand-edit the pointer.
6. Enqueue with a **new** Idempotency-Key only after leftover lease `expires_at`, and only if same-week attach is not the right move. How: authenticated `GET /api/workflows/refresh/start` with a new `Idempotency-Key`. There is **no** dry-run for managed refresh.
7. Hard stops: no validate-invariant relaxation; no inventing `bootstrap/latest.json`; do not push `main` or call production cron unless the user said push main; wait leftover lease; product-gates stay fail-closed.
8. After a successful publish, static exports still need the [DATA-EXPORTS.md](./DATA-EXPORTS.md) regenerate path (#375). Do not duplicate that runbook here.

**Optional — retire the stale flat object (do not run unless the user authorized a production Blob write).** Writers no longer touch `ops/workflows/health.json`. `blob-del-prefix.ts` hard-blocks `ops/**`. If the Jul-2026 object is still confusing operators, overwrite or delete that **single** pathname from the Vercel Blob dashboard after confirming `healthPath` still has no flat-file writer. Do not prefix-delete `ops/`. Do not call production cron to “refresh” it.

**Auth mode (CRON_SECRET)**:

- The trigger is an **HTTP GET** against the production URL; once `CRON_SECRET` is configured, Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`.
- The handler's first step verifies that header and blocks external direct calls to `/api/cron/*` and the Workflow trigger; the exact status / response contract see [API.md](./API.md) (robots already disallows `/api/`, but auth is the real line of defense).

**Idempotency (critical constraint)**:

> Vercel Cron **does not retry automatically**, and **one firing may trigger twice**. Both handler **must be idempotent**:
> - Daily / weekly: the default key is `<job>:<UTC-day>`; the same key publishes at most once. The lease, the current generation, and the fencing token coexist on `live/latest.json`, so an old process that has lost the lease cannot arrive late and overwrite the new pointer.
> - Generation files are immutable; if an object write fails at any step, the `generation` field still points at the previous complete version. After a partial failure, releasing or letting the lease expire is enough to retry with the same key, and an existing same-byte immutable object can be reused safely.
> - Inside `current_month`, upsert is still by UTC day, so a same-day additional refresh with an explicit new key does not accumulate twice.
> - Failures are covered by **alerts** (see below), not by retries.

**Duration**: the cron route is a Function, default 300s / **max 800s**. Daily / weekly Vercel cron only read and write JSON, but a full GraphQL poll needs per-batch pacing; a local full simulation is about 131s, and a real Vercel run must reserve several minutes and stay inside 800s. A historical full recompute with DuckDB / Parquet must not be placed in a single Function; when it has to stay Vercel-only, split it into Workflow shards that read and write Blob checkpoint step by step.

**Daily cron live-run runbook**:

1. First call `GET /api/cron/daily?dry=1` on the Vercel production-target URL, with `Authorization: Bearer <CRON_SECRET>`; if the logs show a GitHub GraphQL `403`, `Retry-After`, or rate-limit remaining near 0, stop the live run and first keep lowering the batch size / adding waits.
2. Before the live run, record `live/latest.json` (especially `generation` / `previous_generation` / `lease`). immutable generation files do not need to be backed up one by one.
3. Actually trigger `GET /api/cron/daily`, again with `Authorization: Bearer <CRON_SECRET>`. The client connection may close before the function finishes; Blob writes and Vercel logs are authoritative.
4. After the write, from the repository root run `bun web/scripts/validate-live-views.ts --bust <UTC day>`; the script first resolves `live/latest.json`, then validates `current_month` / `hot-snapshot` and freshness for the same generation. Then check `/` and `/pulse`.
5. If it fails, confirm the pointer's `generation` did not change; a partial generation that was written but is not referenced does not affect production and can be left for a later GC. If committed content is wrong, point `generation` back at `previous_generation` (also use an ETag conditional write; do not overwrite an active lease).

## Vercel Workflow runbook

> Long tasks that carry the history / metadata / canonical full refresh. This section gives only the **operations steps**; **for Workflow design and the step list see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §3**.
>
> Critical constraint: Search only discovers membership; metadata calls GraphQL `nodes()` bucket by bucket, across 32 buckets, for every active repo, and writes the sole authoritative `current_stars` from `stargazerCount`. A single bucket is at most about two batches of requests and keeps inter-batch throttling; if any active repo is missing a GraphQL result, publishing stops, and it must not fall back to Search stars.
>
> Wired to cron: `/api/workflows/refresh/start` is in the `crons` of `web/vercel.json`, schedule `0 6 * * 0` (Sunday 06:00 UTC, independent of daily / weekly).

**Why steps instead of a single Function**: a single Function is capped at 800s / 4GB / bundle 250MB / response body 4.5MB ([Functions Limits](https://vercel.com/docs/functions/limitations)), which cannot hold a full DuckDB recompute. P1 no longer depends on the Vercel Workflow SDK; each step is ordinary async plus explicit retry, advanced by an HTTP self-chain or a non-production CF Queue. The production schedule is still Vercel cron; do not turn Fluid off just to try the new orchestration.

**Deploy prerequisites**:
- Fluid Compute may stay on (P1 **forbids** turning it off in order to bet on the new orchestration).
- env: configure `CRON_SECRET`, `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, and `BLOB_BASE_URL` on both Production and Preview. `WORKFLOW_RUNTIME` defaults to `http`.
- Deploy: `vercel deploy . --yes --scope zkscio --project gitstarclub.com` (preview, from the repository root; Root Directory=web).

**Manual trigger runbook**:

1. `GET <deployment>/api/workflows/refresh/start`, with `Authorization: Bearer <CRON_SECRET>` → the route first read-only validates `canonical/v2/meta.json` and all 32 `repos` shard (including `active` / `tracked_since` / `d`, key/id/bucket), and only after that passes does it acquire the lease and `startRefresh`, then immediately return `run_id` (non-blocking). A preflight failure does not enqueue or acquire a lease; step `preflight` validates all 128 required shard again before any canonical mutation. CF / HTTP orchestration splits this recheck into 4-bucket windows (16 shard per window, `ops/workflows/<run_id>/steps/preflight-0.json` … `preflight-28.json`), so Workers do not read all 128 objects at once and trigger 1102. When preview has `PREFLIGHT_RELAX_EMPTY_SHARDS=1`, a confirmed 404 / empty bucket is treated as a `{}` placeholder and a `preview-empty-canonical-placeholder` log is recorded, without voiding the whole run; production stays fail closed.
2. Read `ops/workflows/active.json` and `ops/workflows/<run_id>/steps/<step>.json`. **Do not** treat Vercel Dashboard → Observability → Workflows / `workflow inspect` as the operating surface (P1 has removed the Workflow SDK). For production, compare the self-built run log and the health JSON; for a CF dual-run, also look at Workers Observability (see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md)).
3. Read `(run_id, fencing_token, expires_at)` on `ops/workflows/active.json`, `ops/workflows/<run_id>/manifest.json` (status running / published / failed), plus artifacts `canonical/v2/whitelist/<run_id>.json`, `canonical/v2/repos/<bucket>.json`, `renames.json`, `views/<run_id>/lookup/aliases.json`, `publish-intent.json`, and `latest-success.json`.
4. Check the whitelist count, that repos shard buckets are complete, and that diff / rename look reasonable.
5. cron is already wired in (`/api/workflows/refresh/start`, `0 6 * * 0`, on a schedule independent of daily / weekly). This managed Workflow **has no dry-run mode**; any `dry` query returns `400` before a lease is acquired or state is written. A no-write probe can only use `/api/cron/daily?dry=1` or `/api/cron/weekly?dry=1`; a manually triggered managed refresh must be watched through a complete real run, following the steps above.

> Full-chain steps: `preflight` (validate every canonical shard again) → `fold` (month + week; each time `fold-decision.json` is written first. When there is closed pending, also write compact `fold-month-plan.json` / `fold-week-plan.json`, split by 1-bucket windows into `fold-month-*` / `fold-week-*`, and still write `fold.json` at the end. If already folded through the current month and no weeks remain, then `reason=no_closed_month`; missing a month plan is not a stall) → `recomputeRank` (on CF: month-pack + 8-period month/monthOrg, then year derived from month buckets followed by 8-period year/yearOrg, then week-pack + 8-period week/weekOrg, and finally rest by repos bucket; after fold, write `recompute-enqueued.json`, and each hop first writes `recomputeRank-<phase>-start.json`. The #497 whole-window week OOM has been split by bucket; month/year/rest likewise no longer load a whole window, see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md)) → `buildAliases` (→ `lookup/aliases.json`) → `validate` publish gate → `publish` switches the `views/latest.json` pointer / rollback → `gc` version reclamation (design see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7). CF preview Blob filenames are runtime steps: after fold, `recompute-enqueued.json`, `recomputeRank-month-pack.json` / `recomputeRank-month-*.json` should appear through the terminal `recomputeRank-month.json`, plus year-pack / week-pack / `recomputeRank-rest-*.json` and the terminal `recomputeRank.json` (not the manifest alias `recompute.json`). When `WORKFLOW_RUNTIME=cf-queue`, the Queue consumer reads the step JSON (or `x-gitstarclub-queue-successor`) and then `JOBS.send`s the next step; writing only `fold-decision`+`fold.json` and then a silent queue, a fetch source of `Worker exceeded memory limit`, no `error.json`, and an expired lease is a stall that is still not closed after #486 (the root cause is that the month hop still loads an object window, not that fold-decision failed to enqueue; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md)). `/` `/rankings` returning 500 while `/preview/health` returns 200 is the same isolate OOM (OpenNext vs shell), not a published pointer written corrupt. The pass/fail table for a preview Bearer full refresh see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix). An OOM or a silent Queue counts as failure, not "still running".

**Auth / credentials**: `CRON_SECRET` (trigger), `GITHUB_TOKEN` (Search / GraphQL), `BLOB_READ_WRITE_TOKEN` (read and write canonical / staging / published). **refresh is 0 GCP end to end** (GCP is bootstrap only).

### Dual-scheduler rollback (P1)

The production Sunday refresh trigger is not independently established. A non-production
CF Cron on `gitstarclub-web` may also call start or enqueue a shrink fixture.
If that CF path is enabled and must be abandoned:

1. Stop the Worker cron (`triggers.crons` empty; do not keep `env.pre` crons).
2. Set `WORKFLOW_RUNTIME=http` (or unset it) on the Next deployment.
3. Leave `web/vercel.json` exactly as committed — daily / weekly / start stay Vercel.
4. Do not cut DNS. Do not delete production Blob.

Full write-up: [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md).

### Dual-run rollback (P2 ISR / Preview)

The earlier Vercel Preview gates and ISR invalidation are rollback references. A non-production
CF Preview host (`gitstarclub-web-pre.worldgo.workers.dev`, Worker
`gitstarclub-web-pre`) plus optional `verify / cf-preview` may dual-run Access
+ a cache-invalidation stub.

If that CF path is enabled and must be abandoned:

1. Unset GitHub variable `CF_PREVIEW_ENABLED` so `verify / cf-preview` is skipped.
   Do not add or keep that job in `.delivery.yml` / required checks.
2. Set `PREVIEW_TARGET=vercel` and `CACHE_INVALIDATION_DRIVER=vercel` (or unset both).
3. Leave Vercel Authentication, `VERCEL_AUTOMATION_BYPASS_SECRET`, and
   `web/vercel.json` exactly as committed.
4. Do not cut DNS. Do not attach Access to apex/www. Do not delete production Blob.

Full write-up: [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md).

### Workers host rollback (P3 OpenNext preview)

Production apex/www now use Cloudflare Workers. A non-production OpenNext host on
`gitstarclub-web-pre.worldgo.workers.dev` (or `wrangler preview` with
`--env pre`) may serve the Next app behind the existing Worker shell.

If that CF host misbehaves:

1. Unset GitHub variable `CF_WORKERS_HOST_ENABLED` so `verify / cf-workers-host`
   is skipped. Do not add that job to `.delivery.yml` / required checks.
2. `wrangler rollback` the `gitstarclub-web-pre` Worker if a bad preview version
   was promoted. Do not change Vercel production. Do not roll back production
   `gitstarclub-web` from a preview incident.
3. Set `HOSTING_TARGET=vercel` (or unset) on any Next deployment.
4. Leave `web/vercel.json`, Vercel Authentication, and production DNS exactly
   as committed.
5. Do not cut DNS. Do not orange-cloud apex/www. Do not delete production Blob.

Full write-up: [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md).

**Alerts**: a Workflow failure writes a structured Vercel Function log, an optional webhook, a run checkpoint, and an independent health state; the repository currently has no Sentry SDK or Marketplace integration. A failure that happens before publish does not switch the live pointer.

### Post-publish checklist: static data exports

Workflow publish only cuts the Blob pointer. Committed static exports under
`web/public/data/exports/v1/` do **not** update automatically. Product-gates
`export-manifest-age` requires the deployed manifest `data_as_of` within
**14 days** (`EXPORT_MAX_AGE_MS`). Full copy-paste runbook:
[DATA-EXPORTS.md](./DATA-EXPORTS.md) §After a successful weekly publish.

After a successful `views/latest.json` publish (cron or manual):

1. Confirm `views/latest.json` has the intended `version` / `published_at`.
2. On a branch from `pre`: `cd web && bun run exports:generate`
   (needs `BLOB_BASE_URL` / `NEXT_PUBLIC_BLOB_BASE_URL`).
3. PR the new dated directory `web/public/data/exports/v1/YYYY-MM-DD/` **into
   `pre`**. Do not commit a `latest/` tree; do not push straight to `main`.
4. Verify Preview
   `https://pre.gitstarclub.com/data/exports/v1/latest/manifest.json`.
5. Promote `pre` → `main` through the normal PR path only — no silent
   production overwrite and no runtime export regenerate endpoint.

## Deploy Hook usage (optional)

- Create one under the web app project **Settings → Git → Deploy Hooks** (the project must be Git-connected), and store the resulting URL in `VERCEL_DEPLOY_HOOK_URL`; it triggers `POST .../deploy/<prj>/<id>` (no auth / payload); the limit is **5 hook / project**.
- **Limited use**: under the ISR model, **a data update does not need a deploy** (cron calls `revalidatePath` directly). Deploy happens only for a **code / structure change** (a Git push usually auto-deploys; this hook is for manual / CI to trigger one core rebuild).
- **Neither the daily nor the weekly cron triggers a full deploy**: daily revalidate the hot set, weekly revalidate changed pages; long-tail pages are on-demand ISR.

> Vercel **rebuilds every build-time SSG page on each deploy**, and `.next/cache` does not keep prerendered HTML across deploys—so history / long-tail pages **are not built at deploy** (on-demand ISR). A deploy builds only the small core and never approaches the 45min cap (see ARCHITECTURE "Page layering").

## Monitoring and alerts

| Watch | Tool | Trigger |
|---|---|---|
| Runtime / build failures | Vercel build / function logs | Uncaught exceptions, route errors, build failures; there is currently no Sentry integration. **Do not** rely on the Vercel Workflows UI |
| pipeline run records | **`ops/sync-runs.json` log** (each daily / weekly job appends one entry: start / end time, query count, paths written, status) | For reconciliation and traceback; together with `ops/workflows/<run_id>/steps/*.json` they form the self-built run log |
| CF Preview dual-run | Workers Observability (`gitstarclub-web-pre`) + Worker JSON `event` lines | Preview only; Access protects only `gitstarclub-web-pre.worldgo.workers.dev`, see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) |
| CF Workers host preview | Same as above + OpenNext `/` `/rankings` | Non-production only; production is still Vercel, see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) |
| **Data drift** | Compare the GraphQL authoritative total against the summed adds total | **Alert when drift > a threshold (for example 2%)**, and re-anchor with GraphQL as the anchor (see ARCHITECTURE "Data validation / reconciliation") |
| **Cron failure** | `[ALERT]` function log + optional `ALERT_WEBHOOK_URL` + `sync-runs` + pipeline health | webhook delivery is best-effort; when it fails or is unset, logs and health are authoritative, and run a manual catch-up if needed |
| Single-day spike | pipeline sanity check | An extreme single-day addition spike is logged as an alert (net is allowed to be negative) |

For aggregate-only GEO crawler and AI-referrer reporting from Vercel-side logs, use [geo/ai-log-reporting.md](./geo/ai-log-reporting.md). That appendix owns the operator command and taxonomy; this runbook owns the production log and alerting context.

**Alert channel**: Vercel Function logs always exist; `ALERT_WEBHOOK_URL` can point at an endpoint that receives a JSON POST, such as Slack / Discord. Watch especially for cron not running / a failed run, and for data drift past the bound. Webhook is not a reliable queue and must not be the only source of state.

> `sync_runs` does not need a database: the current implementation overwrite-writes `ops/sync-runs.json` on Blob and keeps the most recent 100 runs. When reliable delivery or paging is needed, attach a separate alerting service with durable retries; the current code does not declare that capability.

### Alert webhook (`ALERT_WEBHOOK_URL`, optional)

When the data pipeline (Vercel Workflow full refresh + daily / weekly cron) fails, it calls `sendAlert` (`web/lib/observability/alert.ts`). `sendAlert` has two delivery surfaces, both **best-effort and never throwing** (an alert failure must not take down the pipeline):

1. **Always** write one grep-able structured log line `[ALERT] <pipeline> failed` (including `run_id` / `step` / `error`) to **Vercel function logs**—visible even when no webhook is configured.
2. **If and only if** the environment variable `ALERT_WEBHOOK_URL` is set, also `POST` a JSON failure summary to that URL (`{ text, pipeline, run_id, step, error, at }`, 5s timeout per attempt). Only HTTP 2xx counts as success; 408 / 425 / 429 / 5xx, timeouts, and network errors are tried at most 3 times (100ms / 250ms backoff), and other 4xx are marked delivery-failed immediately. The final result includes `delivered` / `failed` / `disabled`, the attempt count, and a safe diagnosis, and is written to the structured log; webhook errors are not thrown back into the pipeline.

**One-line setup**: in the Vercel project Settings → Environment Variables, add `ALERT_WEBHOOK_URL`, with the value pointing at an endpoint that can receive a JSON POST—a Slack / Discord incoming webhook, or `https://webhook.site/...` for debugging. It takes effect as soon as it is set, with no code change; leave it empty to stay in logs-only mode.

> `recordHealth` writes `ops/workflows/health/{workflow-refresh|cron-daily|cron-weekly}.json` separately. The only operator signal for Sunday 06:00 is `ops/workflows/health/workflow-refresh.json`. The flat `ops/workflows/health.json` is retired; do not read it. Each record is updated with an ETag compare-and-set, keeps `last_success`, `last_failure`, and `correlation_id` / `run_id` / `idempotency_key`, and provides `freshness.stale_after`. Every non-dry success and failure of the daily and weekly cron updates its record; `attached` / `rejected` only change that pipeline's latest signal and do not delete historical successes or failures. Concurrent runs of different pipelines cannot overwrite each other.

## One-time bootstrap Runbook (archived / non-routine path)

> **Demotion statement**: this is a tool run manually once for **the first cold start / a disaster rebuild / introducing a new data source**, and **not a recurring operations path**. After the artifacts are uploaded to Blob, Vercel (live cron + Workflow) takes over, and routine operations are **0 local dependencies · 0 GCP**.

11 years of event-level history are backfilled only once, via **BigQuery** (GCP credentials required, about $10, including a stable repo.id). Free alternatives (the ClickHouse public instance, self-hosted ingestion) were all judged infeasible after evaluation; see ARCHITECTURE "Why backfill uses BigQuery".

**Prerequisites**: GCP credentials (`GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID`) · GitHub PAT (`GITHUB_TOKEN`) · Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). Run it on a local machine / a full Node environment, not on Vercel.

```text
1. Query GH Archive WatchEvents (BigQuery)
   Aggregate WatchEvent by repo + UTC day (from 2015-01; if the volume is large, chunk by year / by batch) → export
2. Local DuckDB
   Land a per-repo×day fact table → star_daily.parquet
   + compute milestones (exact dates of crossing 10k / 50k / 100k)
3. GraphQL (GITHUB_TOKEN)
   Search discovers members (dynamically open upper bound); GraphQL fetches metadata + owner(+type) + current_stars (sole authority) → repos.json
4. DuckDB precomputes every JSON view
   {week / month / year / all-time}×{repo / org}×{flow / stock} + entity curves + heatmap
5. Generate a unique id, for example `bootstrap-20260717T120000Z`; first run
   `06-upload.mjs --generation <id> --dry-run`, then with the same id stage / resume base phase
6. Run `07-export-v2.mjs --generation <id> --stage-only` to check the canonical phase; after confirmation, rerun
   without `--stage-only`. The script rechecks the manifest + remote bytes/SHA-256, acquires the Workflow CAS lease,
   and finally switches only `bootstrap/latest.json`. Batched create are throttled to < 75/s
```

- **Cost**: ~$10 (one-time); after the backfill, never touch GCP again.
- Metric-definition caveats (gross vs net, survivor bias, start point 2015) see ARCHITECTURE, and are noted on the About page.
- After the backfill the two GCP variables can be retired, and routine operations return to 0 GCP.

## One-time canonical lifecycle provenance migration (Issue #326)

> This is a **one-time controlled migration** that fills in lifecycle provenance for legacy canonical rows, not
> a bootstrap rerun, and not a recurring Workflow. The implementation PR delivers only the tool, tests, and dry-run
> evidence; without explicit production execution authorization, `--execute` is forbidden.

The read-only inventory on 2026-07-28 shows that all 5,393 canonical repo row lack an explicit
`active`; the currently published whitelist has 5,389 ids, so the planned result is 5,389
`active:true` and 4 retained historical `active:false`. Another 79 row are both
`tracked_since:null` and have no `d`. They are not bootstrap historical rows: legacy
`lookup/repos.json` does not contain these ids, while 19 immutable whitelist snapshot can fully recover the first
appearance date (12 on `2026-06-02`, 18 on `2026-06-28`, 49 on `2026-07-12`). Therefore the migration only fills in
`tracked_since`, and **never guesses `d=1`, nor recomputes the anchor from mutable current stars**.

### Dry-run (default, zero production writes)

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts
```

Dry-run loads only `BLOB_BASE_URL`, does not need `BLOB_READ_WRITE_TOKEN`, and does not call Blob
create / put / delete. Review checks at least:

- `production_writes=0`;
- source layout / `views/latest.run_id` / 19 snapshot hash match the review evidence;
- `canonical_repositories=5393`, `active_true=5389`, `active_false=4`;
- `tracked_since_recovered=79`, `anchors_invented=0`, `changed_buckets=32`;
- the emitted `plan_sha256` is unchanged across repeated dry-run.

To save the full changed-id / per-bucket checksum plan, use
`--plan-out <new-local-file>`; the tool only creates a new file, and refuses to overwrite an existing file whose content differs.
If `bootstrap/latest.json`, the published whitelist pointer, any snapshot, or a repo shard drifts,
that produces a new plan or fail closed directly, and it must be reviewed again.

### Execute (must be authorized separately)

Only after the full plan has been manually reviewed, it is confirmed there is currently no planned `pre → main` promotion, and explicit production
execution authorization has been obtained, may it be run:

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts \
  --execute \
  --confirm <exact-reviewed-plan-sha256>
```

The executor first acquires the shared fenced lease on `ops/workflows/active.json`, then create-only seals the plan and the 32 before
shard and the 32 after shard create-only sealed into
`ops/migrations/canonical-lifecycle/<plan-sha256>/`. The plan receipt is created last; after that, each
canonical write accepts only two states: a checksum equal to reviewed before (pending write) or reviewed after
(already completed on retry). Any third kind of bytes, pointer drift, lease loss, or full canonical
validation failure aborts. Public Blob overwrite may keep exposing the old bytes on the CDN for up to 60 seconds,
so the post-write exact-after checksum check uses a bounded backoff that covers that window; during it, only reviewed
before may be seen, and going past the window or seeing a third kind of bytes still fails and releases the lease. Every write, via `putOwnedView`, before the write
renews the lease; after success, full 128-shard canonical validation must be `complete=true`.

After an interruption, retry with **the same execute command and the same digest**; the executor reads the immutable receipt and skips buckets that have already
reached the after checksum bucket. Do not generate a new confirmation digest based on partial state.

### Rollback

Rollback accepts only the original plan receipt, and the current shard must still equal that plan's before or after
checksum; a third state already rewritten by a later Workflow is hard-blocked:

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts \
  --rollback <exact-reviewed-plan-sha256> \
  --execute \
  --confirm <exact-reviewed-plan-sha256>
```

Rollback restores the immutable before shards, and therefore restores again the #320 preflight blocked legacy
state; it is for recovering from a migration incident, and does not mean canonical readiness has passed. Normal acceptance after a successful migration is:
dry-run again and get `changed_repositories=0`, then run full canonical preflight / product
gates, and only then re-evaluate `pre → main`.

## Build constraints

> **The Vercel build has a 45-minute hard cap (all plans) — the primary constraint.** Never build every page in a single deploy.

- Long-tail pages (historical repo / org detail) use **on-demand ISR** and are not built at deploy time (see ARCHITECTURE "Page layering").
- The long tail (history / repo / org / week pages) **is not built at deploy**; on-demand ISR generates it lazily and stores it in the persistent ISR store. Data changes rely on cron `revalidatePath`, with no full build.
- OG images **are not fully generated on every build**: the four `next/og` route are drawn at request/ISR time,
  and after `revalidate=86400` are cached by Vercel ISR/CDN; there is no pipeline-side OG generation or Blob
  `og/*` artifacts.
- The build only reads precomputed JSON views and renders them directly—**no aggregation, no engine, no native modules**.

**Function resources (ISR / cron) check**:

| Resource | Default | Limit |
|---|---|---|
| Duration | 300s | **800s** |
| Memory / CPU | 2GB / 1 vCPU | 4GB / 2 vCPU |
| `/tmp` | 500MB | — |
| Response body | 4.5MB | A direct Blob read bypasses this limit |

> Daily cron and hot-set ISR only read and write KB-level JSON, far from any limit above. Large files are always read via Blob (bypassing the 4.5MB response-body limit). **A full recompute exceeds a single Function's limit and must go through Vercel Workflow shards** (see §Vercel Workflow runbook).

## Vercel Firewall bot rules (pre-app)

`robots.txt` is not a security boundary and still incurs Edge/middleware cost
if the request reaches the deployment. Apply these **Vercel Firewall** rules
on project `gitstarclub.com` (`prj_V9RVqspNWPXXiytX7Fj3wlMT9wNw`, scope
`zkscio`) so blocked crawlers never enter Fluid/ISR/Blob:

| Rule | Condition | Action |
|---|---|---|
| Block Meta external agent | User-Agent contains `meta-externalagent` OR `facebookexternalhit` | Deny |
| Block GoogleOther | User-Agent contains `GoogleOther` | Deny |
| Block GPTBot training | User-Agent contains `GPTBot` and does **not** contain `OAI-SearchBot` or `ChatGPT-User` | Deny |
| Block SEO scrapers | User-Agent contains `AhrefsBot` OR `Amazonbot` OR `PetalBot` OR `Bytespider` OR `SemrushBot` OR `DotBot` OR `CCBot` | Deny |
| Rate-limit remaining unknown bots | `bot_category` is `unclassified` or `tool`, path matches `/:locale(ja\|zh\|zh-TW\|ko\|es\|fr)?/:owner/:name` | Challenge or 30 req/min/IP |

Do not implement these blocks as application middleware 403s; that still
bills Edge invocations. Keep `Googlebot` and `Bingbot` unblocked.

The table above is the optional recipe. **Do not apply it unless an operator
explicitly asks.** On 2026-08-20 the four Deny rules were published, then
**removed the same day** after the operator chose to allow those crawlers
(including Meta link-preview). Production currently has **zero custom
Firewall rules**. The unclassified/tool rate-limit was never published
(Security Plus 401). Re-apply only with a new dated decision; then
`vercel firewall publish`.

Operator command for the missing bootstrap pointer (dry-run first):

```text
cd web && bun scripts/ensure-bootstrap-pointer.ts
cd web && bun scripts/ensure-bootstrap-pointer.ts --execute
```

`--execute` only writes when a sealed `bootstrap/generations/<id>` already
exists. If none exists, the plan is `leave-legacy-flat` and no pointer is
invented. Creating a pointer is not the root-cost fix: a missing pointer is a
normal long-lived legacy state and must stay negatively cached with coalesced
reads even if the object disappears again.

## Rollback

- **Pointer rollback (Workflow publish)**: do not overwrite Blob directly. Call the protected rollback API with a stable idempotency key; it acquires a fenced lease, pins the rollback intent, syncs the recovery / whitelist pointers, and invalidates pages and the pointer cache. Example: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Idempotency-Key: rollback-<incident>" -H "Content-Type: application/json" --data '{"target_version":"<views/latest.prev_version>"}' https://www.gitstarclub.com/api/workflows/refresh/rollback`. After a successful return, check the pages and `views/latest.json` within the **≤60s** visibility SLA. Design see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.
- **bootstrap generation / legacy rollback**: first read `bootstrap/latest.previous_generation`. When the value is a generation, run `cd pipeline && node backfill/07-export-v2.mjs --rollback <bootstrap-generation> --execute`; the first publish's value is `null`, and its explicit meaning is to run `--rollback legacy-flat --execute`. A generation target rechecks sealed manifests and every object before the lease; a mutable legacy target, after acquiring the same Workflow CAS lease, verifies the key flat base artifacts and all `4 × 32` canonical shards. The command then rereads the pointer inside the lease and overwrites the pointer only once; a legacy target atomically deletes `bootstrap/latest.json`. If the pointer write/delete succeeded but the response was lost, retrying the same target returns `already-rolled-back`. Do not hand-edit the pointer, and do not delete the current / previous generation or overlay.
- **Deploy rollback**: Vercel keeps historical deployments, and **Promote the previous healthy deployment** rolls back in seconds. The old `gitstarclub-web` is kept temporarily as an extra rollback reference, but a normal rollback should be finished inside the `gitstarclub.com` project. Cost-control changes (robots, pointer cache, long-tail ISR, proxy matcher) rollback the same way: promote the previous Ready production deployment, then revert any Firewall deny rules that were added in the same change window.
- **Daily live tail**: `live/generations/<run_id>/**` is immutable, and `live/latest.json` is the only publish switch. A failure before commit needs no data rollback (the pointer still points at the old generation); if bad data is found after commit, point the pointer's `generation` back at `previous_generation`. Rollback must also first confirm there is no active `lease` and use an ETag conditional write, so it does not overwrite a cron that is publishing.
- **Order**: roll data back first (Blob points back at the previous view version) → then redeploy the previous healthy deployment → check that `sync_runs` and drift are back to normal.

## Verify a manual CF preview deployment

1. From a clean checkout of the intended commit, run `cd web && bun run cf:build:pre` and record the SHA printed as the CF build identity. Keep the resulting `.open-next` output with that commit. A bare `bun run cf:build` fails because the build requires `--site-target=pre`.
2. An operator deploys that output to `gitstarclub-web-pre` using the approved manual process. This repository does not automate a live deploy.
3. Request `https://pre.gitstarclub.com/.well-known/deployment` and compare `commitSha` with the recorded SHA. A `-dirty` suffix means the build included tracked uncommitted changes. Untracked files do not add that suffix. If `VERCEL_GIT_COMMIT_SHA` or `CF_PREVIEW_COMMIT_SHA` is set on the Worker, its value takes priority.
