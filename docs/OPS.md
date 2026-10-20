---
owner: operations
status: active
last_reviewed: 2026-10-19
source_of_truth_for:
  - branch topology
  - staging and promotion
  - deploy and rollback runbooks
  - cron and workflow operations
  - environment variables and alerting
---

# gitstarclub Operations Runbook

> Sole source of truth for operations and deployment. Architecture and data flow see [ARCHITECTURE.md](./ARCHITECTURE.md), product see [PRODUCT.md](./PRODUCT.md).
> Core principles from the architecture: **Cloudflare Workers hosting with Cloudflare R2 storage (production cutover accepted 2026-10-04; see [R2-CUTOVER.md](./R2-CUTOVER.md))**, **a static runtime without an engine**, and **production data operations independent of local computation**. This runbook applies them to projects, environment variables, Cron, workflows, retained Blob rollback history, and alerts; see [API.md](./API.md) for endpoint method, authentication, cache, and status contracts.

## Scope

This document is **gitstarclub's operations runbook**—**deployment, cron / Workflow operations, Blob layout, environment-variable inventory, alerts, rollback**. When production has a problem that needs troubleshooting, or when standing up a new environment, reading this one document is enough.

Data operations layers:
- **Daily / weekly live cron**—see §Cron schedule.
- **History / metadata / canonical full refresh (managed refresh)**—see §Managed refresh runbook (step names see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)).
- **Historical BigQuery + DuckDB bootstrap backfill**—extraction retired 2026-10-19; see the archived One-time bootstrap Runbook and [Raw backfill data](#raw-backfill-data).
- **Raw backfill archive**—private R2 `gitstarclub-raw` only; see [Raw backfill data](#raw-backfill-data) for inventory, checksums, and the GCP retirement record.

## Current hosting and branch topology

The source host is vinext on Cloudflare Workers. See [VINEXT-HOST.md](VINEXT-HOST.md)
for typed configuration, pinned dependencies, build validation, caching and the
authorization boundary. This source migration does not assert a live deployment.
The [previous host procedures](archive/HOST-BEFORE-VINEXT.md) are historical.
Storage cutover evidence remains in [R2-CUTOVER.md](R2-CUTOVER.md).

## Branch topology

| Branch | Worker | Mode | Policy |
| --- | --- | --- | --- |
| main | gitstarclub-web | production | Production URLs closed; separate owner authorization required |
| pre | gitstarclub-web-pre | pre | Public preview, noindex; manual owner-run delivery only |

### Production build and deploy

Run `bun run build:production` and `bun run validate:host -- --mode production`
from `web/`. Use the offline fixture for local evidence. There is no automatic
production deployment; an owner must separately approve and review the cf path.
Preserve the frozen fallback until the storage runbook authorizes removal.

### Preview deploy

Run `bun run build:pre` and `bun run validate:host -- --mode pre`.
`deploy:pre` is available for a separately authorized operator, using the pinned
adapter and cf. Do not deploy a loopback fixture build. No schedules are enabled.
Both modes preserve DATA/MEDIA/JOBS and same-mode self-reference. Production
and preview have separate cache namespaces. GitHub Actions remains OFF;
`static` and `production-build` remain the required job names if automation is
separately re-enabled. Optional jobs remain optional and never deploy.

## Environment variables and secrets

Current Worker configuration is in [Worker configuration](../web/cloudflare.config.ts), with secrets stored on the Cloudflare platform. For local development, copy the repository root `.env.example` to `web/.env.local`; `web/scripts/lib/env.ts` loads only that file. **Never commit real secret values.** Follow least privilege for read and write paths: browsing or building does not require a write token.

<!-- env-inventory:start -->

| Variable | Purpose | Required / optional | Format | Who uses it (path:line) |
|---|---|---|---|---|
| `GITHUB_TOKEN` | GitHub GraphQL / Search PAT (batch lookup of `stargazerCount` + metadata + whitelist) | **Required** (cron / Workflow) | `ghp_…` PAT string | `web/lib/github.ts`; daily cron · weekly cron · Workflow whitelist/metadata step · one-time backfill. GraphQL and REST both send `User-Agent: gitstarclub` and `Accept: application/vnd.github+json` |
| `BLOB_READ_WRITE_TOKEN` | Retained Blob write token; not used by the current R2 write contract | **Required** for the `blob` write driver | `vercel_blob_rw_…` | `web/lib/data/write.ts` · `web/lib/storage/vercel-blob-store.ts` · `web/lib/storage/vercel-blob-fetch-client.ts` · `web/lib/workflows/recompute/io.ts` · `web/lib/workflows/steps/gc.ts`; cron writes the live tail · refresh writes canonical/views · GC deletes old versions. CF Workers use runtime `fetch`, not `@vercel/blob`/undici. Preview `r2_binding` does not use this token |
| `BLOB_BASE_URL` | Retained Blob rollback/local-driver public base URL (build / runtime direct-link fetch of views + resolving the publish pointer) | **Required** for the `blob` read driver | `https://<store>.public.blob.vercel-storage.com` (**no trailing slash / no BOM**) | `web/lib/runtime-config.ts` · `web/lib/data/source.ts` · `web/lib/cron/sync-runs.ts`; page reads use `getPublicReadBases()`. R2 drivers use `R2_PUBLIC_BASE_URL` instead |
| `VIEWS_VERSION_FALLBACK` | Read-only version served when `views/latest.json` is a confirmed 404 (#543 stopgap, #553) | Optional. Production Worker top-level only; required while the current pointer is absent. Preview must not set it | `refresh-YYYY-MM-DDTHH-MM-SS-mmmZ`. Production is `refresh-2026-09-13T06-00-16-398Z`. Any other non-empty value is ignored and logged once | `web/lib/runtime-config.ts` · `web/lib/data/source.ts`. See the incident note below this inventory |
| `NEXT_PUBLIC_BLOB_BASE_URL` | `BLOB_BASE_URL` client fallback (only when the server-only value is unavailable) | Optional (fallback) | Same as `BLOB_BASE_URL` | `web/lib/runtime-config.ts` · `web/lib/data/source.ts`; used only when `BLOB_BASE_URL` is unset |
| `STORAGE_READ_DRIVER` | Object-storage read driver | Optional in code (default `blob`). Both Worker contracts explicitly set `r2` | `blob` \| `r2_binding` \| `r2_s3` \| `r2` \| `r2_then_blob` | `web/lib/runtime-config.ts` · `web/lib/storage/object-store.ts`; `r2` reads `R2_PUBLIC_BASE_URL`. Production uses R2 after the accepted 2026-10-04 cutover (stage 4, I-5b). See [R2-CUTOVER.md](./R2-CUTOVER.md) |
| `READ_DRIVER` | `STORAGE_READ_DRIVER` alias | Optional | Same as `STORAGE_READ_DRIVER` | `web/lib/runtime-config.ts` |
| `DEPLOY_ENV` | Which deployment this process is (`production`, `pre`, or `local`) | Preview Worker `env.pre` sets `pre`; production top-level sets `production`. Cloudflare Workers must set it; they do not receive `VERCEL_ENV` | `production` \| `pre` \| `local` | `web/lib/runtime-config.ts`. Read through `resolveRuntimeEnv()` so a Worker var is visible. Unset on `HOSTING_TARGET=cf` refuses R2 writes and does not arm `WORKFLOW_COLD_START` or `PREFLIGHT_RELAX_EMPTY_SHARDS` |
| `STORAGE_WRITE_DRIVER` | Object-storage write driver | Optional in code (default `blob`). Both Worker contracts explicitly set `r2_binding` | `blob` \| `r2_binding` \| `r2_s3` \| `r2` | `web/lib/runtime-config.ts` · `web/lib/storage/object-store.ts`; `blob` still requires `BLOB_BASE_URL` and `BLOB_READ_WRITE_TOKEN`. R2 write drivers require `DEPLOY_ENV`. `put` / `del` still require a matching bucket-identity marker. `r2_binding` uses the DATA binding and does not need a Blob token |
| `WRITE_DRIVER` | `STORAGE_WRITE_DRIVER` alias | Optional | Same as `STORAGE_WRITE_DRIVER` | `web/lib/runtime-config.ts` |
| `R2_ACCOUNT_ID` | Cloudflare account ID (composed into the S3 endpoint) | R2 driver only | 32-digit hex | `web/lib/runtime-config.ts`; prepared account `00f850e853e4c7f9627233d51a6e30a1` |
| `R2_S3_ENDPOINT` | R2 S3-compatible endpoint | R2 driver only | `https://<account>.r2.cloudflarestorage.com` | `web/lib/runtime-config.ts` |
| `AWS_ENDPOINT_URL` | `R2_S3_ENDPOINT` alias | R2 driver only | Same as `R2_S3_ENDPOINT` | `web/lib/runtime-config.ts` |
| `R2_ACCESS_KEY_ID` | R2 S3 access key | R2 driver only | Cloudflare R2 API token | `web/lib/runtime-config.ts` |
| `AWS_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` alias | R2 driver only | Same as `R2_ACCESS_KEY_ID` | `web/lib/runtime-config.ts` |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret | R2 driver only | secret | `web/lib/runtime-config.ts` |
| `AWS_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` alias | R2 driver only | Same as `R2_SECRET_ACCESS_KEY` | `web/lib/runtime-config.ts` |
| `R2_BUCKET` | R2 bucket name | R2 driver only | Preview Worker `env.pre` is `gitstarclub-data-pre`. Production top-level DATA is wired to `gitstarclub-data-prod`. `MEDIA` stays `gitstarclub-assets` | `web/lib/runtime-config.ts` |
| `R2_BUCKET_PROD` | Production bucket for bootstrap and ops CLIs (`--target prod`) | R2 CLI only | `gitstarclub-data-prod` | `pipeline/lib/bootstrap-cli.mjs` · `web/lib/storage/ops-target.ts`. When set, it wins. A different `R2_BUCKET` is refused |
| `R2_BUCKET_PRE` | Preview bucket for bootstrap and ops CLIs (`--target pre`) | R2 CLI only | `gitstarclub-data-pre` | `pipeline/lib/bootstrap-cli.mjs` · `web/lib/storage/ops-target.ts`. When set, it wins. A different `R2_BUCKET` is refused |
| `AWS_S3_BUCKET` | `R2_BUCKET` alias | R2 driver only | Same as `R2_BUCKET` | `web/lib/runtime-config.ts` |
| `R2_REGION` | SigV4 region | Optional (default `auto`) | `auto` | `web/lib/runtime-config.ts` |
| `AWS_REGION` | `R2_REGION` alias | Optional | Same as `R2_REGION` | `web/lib/runtime-config.ts` |
| `R2_PREFIX` | Optional R2 object key prefix | Optional (default empty, the bucket root) | A relative prefix such as `archive/`, or empty | `web/lib/runtime-config.ts`. The write guard is the bucket identity marker, not this prefix |
| `R2_PUBLIC_BASE_URL` | R2 public-read base URL | `r2_binding`, `r2_s3`, `r2`, and `r2_then_blob` public reads. Preview Worker `env.pre` sets `https://data-pre.gitstarclub.com` | no-trailing-slash https origin | `web/lib/runtime-config.ts` · `web/lib/data/source.ts`. Ops CLIs use this only when the named prod or pre URL below is unset |
| `R2_PUBLIC_BASE_URL_PROD` | Public read base for ops CLIs with `--target prod` | R2 CLI only | no-trailing-slash https origin | `web/lib/storage/ops-target.ts`. When set, it wins over `R2_PUBLIC_BASE_URL`. The script reads `_meta/bucket-identity.json` from this base and requires the prod bucket. A passing check copies this base onto `R2_PUBLIC_BASE_URL` so later library reads use it |
| `R2_PUBLIC_BASE_URL_PRE` | Public read base for ops CLIs with `--target pre` | R2 CLI only | no-trailing-slash https origin | `web/lib/storage/ops-target.ts`. When set, it wins over `R2_PUBLIC_BASE_URL`. The script reads `_meta/bucket-identity.json` from this base and requires the pre bucket. A passing check copies this base onto `R2_PUBLIC_BASE_URL` so later library reads use it |
| `LIVE_PUBLIC_READ_BASE_URL` | Explicit public read base for live release gates | Optional | no-trailing-slash https origin | `web/lib/runtime-config.ts` · `web/lib/integration/release-gates-live.ts`. When unset, gates still fall back to `RELEASE_GATE_BLOB_BASE`, then `BLOB_BASE_URL`, then the current public Blob URL. That Blob URL fallback is temporary and is removed in stage 6 |
| `CRON_SECRET` | Bearer secret the cron and refresh handlers require. The caller sends `Authorization: Bearer <secret>`. It is a Worker secret, not a committed value | **Required** | Random string (≥32 characters, **no leading or trailing whitespace**) | `web/lib/cron/handlers.ts` · `web/lib/security.ts` · `web/lib/runtime-config.ts` · `web/app/api/workflows/refresh/start/route.ts` · `web/app/api/workflows/refresh/step/route.ts`; daily / weekly cron · refresh start / step |
| `WORKFLOW_RUNTIME` | Managed refresh orchestration backend | Optional (default `http`) | `http` \| `memory` \| `cf-queue` | `web/lib/runtime-config.ts` · `web/lib/workflows/runtime/resolve.ts`. Unset code default is `http`. Both typed modes set `cf-queue`. |
| `WORKFLOW_QUEUE_ENQUEUE_URL` | Cloudflare Queue enqueue URL (Worker `/enqueue`) | Required only when `WORKFLOW_RUNTIME=cf-queue` | Absolute URL | `web/lib/runtime-config.ts` · `web/lib/workflows/runtime/cf-queue.ts`. Production top-level is `https://gitstarclub.com/enqueue`. Mode `pre` uses `https://pre.gitstarclub.com/enqueue`. |
| `WORKFLOW_STEP_BASE_URL` | step route origin override | Optional | no-trailing-slash https origin | `web/lib/runtime-config.ts`; when unset, use the request origin or `VERCEL_URL` |
| `CACHE_INVALIDATION_DRIVER` | ISR invalidation port | Optional (code default `vercel`) | `vercel` \| `memory` \| `cf-stub` | `web/lib/runtime-config.ts` · `web/lib/cache-invalidation/`; Worker bindings select native page/data cache invalidation before this fallback selector; elsewhere unset uses Next `revalidatePath` / `revalidateTag`. `cf-stub` is non-production only |
| `CF_CACHE_PURGE_URL` | CF stub dual-run POST URL (Worker `/preview/invalidate`) | Only when `CACHE_INVALIDATION_DRIVER=cf-stub` | Absolute URL | `web/lib/runtime-config.ts` · `web/lib/cache-invalidation/cf-stub.ts`; not Cloudflare Cache Purge |
| `PREVIEW_TARGET` | Optional preview-target resolver | Optional (code default `vercel`) | `vercel` \| `cf` | `web/lib/runtime-config.ts` · `web/lib/preview/`. `https://pre.gitstarclub.com` is public either way. This variable is not a login lock |
| `CF_PREVIEW_ORIGIN` | Preview Worker origin used by probes and deployment identity when `VERCEL_URL` is unset | Optional (default `https://gitstarclub-web-pre.worldgo.workers.dev`) | no-trailing-slash https origin | `web/lib/runtime-config.ts`; default preview Worker `gitstarclub-web-pre`. Do not point it at the closed production `gitstarclub-web.worldgo.workers.dev`. `https://pre.gitstarclub.com` is an allowed public equivalent. This host is not behind a login wall |
| `CF_CRON_ORIGIN` | CF Worker `scheduled` hits Next cron route HTTP origin. On `HOSTING_TARGET=cf` it is also the origin of the publish / rollback cache-invalidation callback (`POST {CF_CRON_ORIGIN}/api/workflows/refresh/revalidate`) | Required for Worker dispatch and for publish / rollback on Cloudflare (typed configuration var) | no-trailing-slash https origin; preview `https://pre.gitstarclub.com`, production `https://gitstarclub.com` | Worker `env.CF_CRON_ORIGIN` · `web/lib/workflows/publication-invalidation-request.ts`; do not hardcode the wrong environment, and do not use the already-closed production `workers.dev`. The callback never falls back to production. Publish / rollback resolve it before the pointer switch, so a missing or invalid value fails them with nothing published. `DEPLOY_ENV=pre` refuses `gitstarclub.com` / `www.gitstarclub.com`. The production top-level vars set `DEPLOY_ENV=production`, so a Worker that sets it must use one of them and the callback also refuses a non-production host there. `scripts/cf-ci-gates.mjs` still pins the typed configuration value. The value is not a secret, but it must be injected per Worker |
| `REFRESH_START_URL` | refresh cron / `/start` override URL | Optional (when unset, `{CF_CRON_ORIGIN}/api/workflows/refresh/start`) | Absolute URL | Worker `env.REFRESH_START_URL`; injected by the platform, not committed to the repo |
| `REFRESH_STEP_URL` | Queue consumer advances refresh step URL | Required when consuming a refresh step | Absolute URL | Worker `env.REFRESH_STEP_URL`; injected by the platform, not committed to the repo |
| `CF_ACCESS_CLIENT_ID` | CF Access Service Token id (CI) | Only `PREVIEW_TARGET=cf` / optional `cf-preview` job | Access Service Token Client ID | `web/lib/preview/access.ts`; the GitHub secret name is the same; token name `gitstarclub-cca-ci`, and the secret is not committed to the repo |
| `CF_ACCESS_CLIENT_SECRET` | CF Access Service Token secret (CI) | Only `PREVIEW_TARGET=cf` / optional `cf-preview` job | Access Service Token Client Secret | `web/lib/preview/access.ts`; header `CF-Access-Client-Secret` |
| `CF_PREVIEW_REQUIRE_SHA` | Require the CF Preview identity SHA to match | Optional (off by default) | String `1` enables the gate | `web/lib/runtime-config.ts` and `web/scripts/resolve-preview.ts`; check the built SHA or an explicit `CF_PREVIEW_COMMIT_SHA` before enabling this gate |
| `CF_PREVIEW_COMMIT_SHA` | Optional runtime copy of the deployed SHA | Optional | Git SHA | `web/lib/deployment-commit.ts` and Worker `env.CF_PREVIEW_COMMIT_SHA`. When `Vite build` baked a SHA, that SHA is the reported identity. This var counts only when it equals the baked SHA. When no SHA was baked, it is the fallback after `VERCEL_GIT_COMMIT_SHA`. A stale value cannot mask the built commit. |
| `CF_BUILD_COMMIT_SHA` | Optional CI SHA override for `Vite build` | Optional | 40 to 64 hexadecimal characters | `web/scripts/cf-build-identity.ts`; Git HEAD is used when unset. Tracked changes append `-dirty`; untracked files do not. Missing Git yields `null`. |
| `MIN_TRACKED_STARS` | Whitelist / refresh discovery floor (star count) | Optional (default `10000`). Preview typed configuration `env.pre` is `10000`, the same floor as production | Positive-integer string. Production top-level must stay unset or `10000`. The 1k experiment is paused; restoring it is an owner decision | `web/lib/runtime-config.ts` · `web/lib/github.ts` · `web/lib/constants.mjs`; GitHub Search `stars:>=N` |
| `WHITELIST_SEARCH_SHARDS` | whitelist GitHub Search whether sharded by hop | Optional (default off = single hop) | The string `"1"` turns it on; preview typed configuration `env.pre` is `1` | `web/lib/runtime-config.ts` · `web/lib/workflows/steps/whitelist.ts` · `web/lib/github.ts`; each hop writes `ops/workflows/<run_id>/whitelist-search.json`, and the snapshot is written only when complete. Rollback = remove it or set `0` to restore a single hop. Do not turn shards off to fix a metadata 502 |
| `PREFLIGHT_RELAX_EMPTY_SHARDS` | Whether preview preflight treats a missing/empty canonical shard as a `{}` placeholder | Optional (default off = missing shard fail closed). typed configuration `env.pre` sets `"1"` (#662); production top-level must not set it (`scripts/cf-ci-gates.mjs`) | The string `"1"` turns it on only when `DEPLOY_ENV=pre`. Unset `DEPLOY_ENV` (including `HOSTING_TARGET=cf`) and `DEPLOY_ENV=production` / `VERCEL_ENV=production` stay fail-closed. Removing it is an owner decision | `web/lib/runtime-config.ts` · `web/lib/workflows/canonical-validation.ts` · `web/lib/workflows/steps/preflight.ts`; policy name `preview-empty-canonical-placeholder`. schema / `d` / identity / wrong bucket / non-404 still fail closed. Rollback = remove it or set `0`. Do not turn off sharded Search to fix a missing shard |
| `WORKFLOW_COLD_START` | Whether the first preview managed publish may bootstrap canonical / an empty lookup from zero | Optional (default off). typed configuration `env.pre` sets `"1"` (#662); production top-level must not set it (`scripts/cf-ci-gates.mjs`) | The string `"1"` turns it on only when `DEPLOY_ENV=pre`, together with `PREFLIGHT_RELAX_EMPTY_SHARDS=1`. Unset `DEPLOY_ENV` (including `HOSTING_TARGET=cf`) and production stay off. The paused 1k-star experiment stays paused (`MIN_TRACKED_STARS=10000`); lowering the floor is an owner decision | `web/lib/workflows/cold-start.ts` · `web/lib/runtime-config.ts` · refresh start / preflight / whitelist / metadata / recompute I/O. It takes effect only while `views/latest.json` is still 404; written meta uses a real UTC `generated_at` and the bootstrap-day `seam_date` (no GH Archive  gross history), and **forbids** fake `node_id` / fake GraphQL. On conflict with the #515 empty-bucket placeholder, #512 502 recovery, or SafeText, **cold start wins** (see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)). After the first successful publish it automatically returns to fail closed. Rollback = remove it or set `0` |
| `WHITELIST_SEARCH_HOP_BUDGET_MS` | Single-hop Search wall-clock budget | Optional (default `600000` = 10 min) | Integer milliseconds, `60000..840000` (must stay under the Queue 15 min wall) | `web/lib/runtime-config.ts` · `web/lib/github.ts` `searchWhitelistHop` |
| `HOSTING_TARGET` | Next hosting target | Optional in code (default `vercel`). Both Workers set `cf` | `vercel` \| `cf` | `web/lib/runtime-config.ts`. Production Worker `gitstarclub-web` and preview Worker `gitstarclub-web-pre` both set `cf` |
| `NEXT_PUBLIC_HOSTING_TARGET` | `HOSTING_TARGET` public alias | Optional | Same as `HOSTING_TARGET` | `web/lib/runtime-config.ts`. The Workers set `HOSTING_TARGET=cf` |
| `CF_WORKERS_HOST_ORIGIN` | P3 Workers host smoke origin | Optional | no-trailing-slash http(s) origin | `web/lib/workers-host/smoke-origin.ts` · `web/scripts/cf-workers-host-smoke.ts` |
| `CF_WORKERS_HOST_LOCAL` | P3 smoke forces localhost | Optional | String `1` | `web/lib/workers-host/smoke-origin.ts` |
| `VERCEL_DEPLOY_HOOK_URL` | Not used by the current Cloudflare deploy path | Optional | URL string | Not read by application code. Deploy with the typed configuration commands in this runbook |
| `ALERT_WEBHOOK_URL` | Failure-alert webhook (Slack / Discord incoming webhook or `https://webhook.site/...`, POST a JSON summary; **if unset, logs only**) | Optional | An `https://…` endpoint that can receive a JSON POST | `web/lib/observability/alert.ts:45`; Workflow `sendAlert` · daily / weekly cron failure delivery |
| `SITE_INDEXABLE` | Enables public indexing and sitemap discovery | Required for the production Cloudflare build and Worker; absent on preview | `"1"` enables indexing; other values disable it | `web/vite.config.ts`, [Worker configuration](../web/cloudflare.config.ts), `web/app/robots.ts`, `web/app/_shell/RootShell.tsx` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Historical GCP service-account key path | Retired 2026-10-19; do not provision | Local file path, for example `./gcp-key.json` | Archived BigQuery extraction only; see [Raw backfill data](#raw-backfill-data) |
| `GCP_PROJECT_ID` | Historical GCP project ID | Retired 2026-10-19; do not provision | GCP project ID string | Archived BigQuery extraction only; see [Raw backfill data](#raw-backfill-data) |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap, metadata, and structured data | Required for the production Cloudflare build and Worker | `https://gitstarclub.com` without a trailing slash | `web/vite.config.ts`, [Worker configuration](../web/cloudflare.config.ts), `web/app/robots.ts`, `web/app/_shell/RootShell.tsx` |
| `BING_SITE_VERIFICATION` | Bing `msvalidate.01` token | Optional. Set it in the shell that runs the Cloudflare production build | Bing-provided token | `web/vite.config.ts` inherits that shell. `web/app/_shell/RootShell.tsx` emits the meta tag when the variable is set. Confirm the tag in the generated HTML. A Vercel project variable does not change Cloudflare output. No XML file is needed |
| `INDEXNOW_ENABLED` | IndexNow post-commit submission switch | Optional (default off) | The string `1` enables it | live cron calls IndexNow after the pointer is committed; dry-run / pre-commit do not call it |
| `SEO_LIVE_BASE` | Live-line origin fetched by integration tests (default `https://www.gitstarclub.com`; leave empty to skip the test) | Tests only | `https://www.gitstarclub.com` or an empty string | `web/lib/integration/seo.test.ts:23` |
| `SEO_EXPECT_INDEXABLE` | Live SEO acceptance environment policy (Preview `0`, Production `1`; when unset, inferred from the canonical host) | Tests only | `0` or `1` | `web/lib/integration/seo.test.ts` · `.github/workflows/ci.yml` |
| `SEO_CANON_ORIGIN` | canonical origin asserted by integration tests (default `https://gitstarclub.com`) | Tests only | Absolute origin (**no trailing slash**) | `web/lib/integration/seo.test.ts:25` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Optional header secret read by `web/lib/vercel-protection-bypass.ts`. `https://pre.gitstarclub.com` is public and does not use this as a login lock | Optional | Token string | `web/lib/vercel-protection-bypass.ts` · `web/scripts/resolve-vercel-preview.ts`; not sent to the browser, and not put on production pages |

Platform and development-tool variables also belong to the maintained inventory; they must not be mistaken for application secrets:

| Variable | Scope | Purpose |
|---|---|---|
| `VINEXT_PRERENDER` | Framework build only | Internal prerender process flag; not a public control or deployed environment variable |
| `NEXT_RUNTIME` | Next.js injected | `nodejs` / `edge`; enables the shared Data Cache 404 sentinel for `bootstrap/latest.json` |
| `VERCEL_ENV` | Legacy production signal; not set on either Worker. Retained for environment-conflict checks and Vercel compatibility | `web/lib/runtime-config.ts` |
| `VERCEL_URL` | Not set on either Worker. When unset, Cloudflare deployment identity uses the preview origin | `web/lib/deployment-identity.ts` |
| `VERCEL_GIT_COMMIT_SHA` | Optional commit input for `/.well-known/deployment`. Workers pass `CF_PREVIEW_COMMIT_SHA` or the SHA baked by `Vite build` | `web/lib/deployment-identity.ts` |
| `NODE_ENV` | runtime/tooling | Next.js and tests standard runtime mode |
| `CI` | CI | Enables CI-only timeouts, output, and security gates |
| `PORT` | Local tooling | Port the local fixture/dev server listens on |
| `PATH` | Local tooling / offline pipeline tests | Locates pinned Node/Bun for offline pipeline tests and the local R2 rehearsal; forwarded into otherwise clean child environments, never a Worker binding |
| `KANBAN_TMP` | Local preview-gap rehearsal tools only | Required card-local temporary directory; preparation outputs must be in a child directory and fold-proof output must remain beneath it. Set it to the same excluded card path as `TMPDIR`; never a Worker binding or secret |
| `BACKFILL_FIXTURE_CONFIG` | Offline pipeline tests only | Disposable synthetic transport configuration; never a production setting |
| `BACKFILL_FIXTURE_TRACE` | Offline pipeline tests only | Local JSONL request trace written by the subprocess network interceptor |
| `BACKFILL_FIXTURE_REMOTE` | Offline pipeline tests only | Disposable file backing synthetic R2 responses; never a bucket or credential file |
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

### Incident #543: read-only views version fallback

The original shared-Blob incident #543 involved a missing `views/latest.json`, which could leave rankings without data before the fallback was added. Production subsequently switched to the copied R2 store under the accepted stage-4 contract. At the [dated October 13 check](./R2-CUTOVER.md#read-only-state-check-2026-10-13), the production R2 views pointer still returned 404 and metadata for `refresh-2026-09-13T06-00-16-398Z` returned 200. Preserve that exact frozen fallback in both the Worker and production build shell while the pointer is absent. This stopgap never writes a pointer; the historical Blob incident is not the current production storage contract.

`VIEWS_VERSION_FALLBACK` is set on the production Worker only (top-level `vars` in the Worker typed configuration config). A published read uses it only after a confirmed 404 of `views/latest.json`. A timeout, a 5xx response, or invalid JSON does not use it. If the pointer exists, it wins. Authoritative reads (refresh and other write paths) ignore the variable and still see no pointer. `published_at` is `generated_at` from `views/<version>/meta.json` when that field is a real timestamp, otherwise null. While the fallback is in effect the Worker logs one warning per isolate. Preview `env.pre` must not set the variable.

Removal requires separate owner authorization and the same prerequisites as the [production build procedure](#production-build-and-deploy) and [R2 stage 4](./R2-CUTOVER.md#stage-4-cutover-i-5b):

1. Confirm `https://data.gitstarclub.com/views/latest.json` returns HTTP 200 and is authoritative for the version rendered by production pages.
2. Verify a production build without `VIEWS_VERSION_FALLBACK` still prerenders real data, including repository rows and star counts on rankings. HTTP 200 alone is insufficient.
3. Remove the top-level Worker var and its production build-shell export together in that separately authorized build/deploy change.
4. Keep the existing `scripts/cf-ci-gates.mjs` assertion: it already permits an absent fallback or exactly `refresh-2026-09-13T06-00-16-398Z`, and preview must still reject the var. No gate deletion or relaxation is needed. Do not remove `BLOB_READ_WRITE_TOKEN` before the separately authorized stage-6 criteria are accepted.

A valid pointer already takes priority over the fallback. Do not remove or change the fallback merely because issue #543 closes or to rotate cache keys. Until the removal prerequisites are met and the change is authorized, keep the exact frozen value. After authorized removal, a later 404 must not silently select that frozen generation again.

**Conventions**:

- `NEXT_PUBLIC_*` goes into the client bundle; **put only non-sensitive values there**. Everything else is Server-only.
- Both Worker contracts use the R2 public base and guarded `DATA` binding. Production builds preserve the frozen fallback while the pointer is absent and clear Blob shell vars. Explicit use of the retained Blob driver needs its public base and, for mutation only, the Blob token. Preview must not set `BLOB_*` or the production fallback. `CRON_SECRET` and `GITHUB_TOKEN` stay off the client and out of the repository.
- Strip leading and trailing whitespace and a BOM from values. Whitespace on `CRON_SECRET` makes the bearer header illegal, and a BOM on `BLOB_BASE_URL` makes the Next.js build report `ERR_INVALID_URL` at the sitemap stage.
- **The two GCP items are retired (2026-10-19)**: project `gitstarclub` entered deletion after raw preservation in private R2 `gitstarclub-raw`. Do not provision credentials or run GH Archive extraction. See [Raw backfill data](#raw-backfill-data) for inventory, checksums, and the recovery deadline.
- At startup, verify that required secrets exist; if any are missing, fail-fast (do not swallow them silently).
- Current R2 status and the stage plan are in [R2-CUTOVER.md](./R2-CUTOVER.md). Production uses R2 after the accepted 2026-10-04 cutover. Superseded phase notes are in `docs/archive/`. **Do not cut DNS** from this runbook.
- Both Workers serve the site. A preview fault rolls back Worker `gitstarclub-web-pre` (`--env pre`) only. Do not roll back production Worker `gitstarclub-web` from a preview incident. Production hosting rollback for the R2 cutover is the stage 4 version command later in this runbook. The production trigger remains unverified. Both `triggers.crons` arrays stay `[]` until an owner-approved stage 5 change.

## Vercel Blob rollback layout (retained until stage 6)

This retained historical layout supports Blob rollback and explicitly selected local Blob operations. It is not the current production read/write procedure; keep it until stage 6 acceptance. The accepted R2 copy retained relevant keys at the production bucket root. The Blob layout uses **one PUBLIC store**: the large set of JSON views is read by the build / runtime via **direct-link URL**; public reads are the simplest and hit the CDN. The first bootstrap's views + canonical are sealed first in an immutable generation and committed once by `bootstrap/latest.json`; later canonical changes enter that generation's copy-on-write overlay. The full definition of the new layout see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4 and [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.11–2.13.

```text
blob://
├── bootstrap/
│   ├── latest.json                                  # atomic bootstrap pointer (Blob previous=null means legacy-flat)
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
│           ├── manifest.json                        #     step list + status (running / published / failed) + published_version
│           ├── canonical-manifest.json              #     record count, SHA-256, and integrity receipt of the required canonical shard
│           ├── validation.json                      #     publish gate result (ok · checked · invariants · failures)
│           ├── renames.json                         #     rename step output (old_full_name → new_full_name, web-layer 308)
│           ├── error.json                           #     written on failure (run_id · error · at · phase; post_commit / commit_unknown add committed_version / candidate_version · failed_step)
│           └── post-commit-failure.json             #     only when the lease was lost after the pointer switched (create-only; run_id · phase · published_version · failed_step · error · at)
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
| **Cache propagation** | A same-path overwrite takes up to **60s** to take effect network-wide | The page process still memo `live/latest.json` 60s. Pointer writes use `max-age=0`. **the retained Blob implementation fences publish with the origin `head()` etag recorded at claim time**, and no longer uses a public GET to decide whether the lease is still held. A public store cannot private get; the CDN caches by path, and `?v=` has no effect. The Sunday weekly fast path is 1–2s, otherwise it reads `lease: null`. generation paths are immutable |

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

Endpoint method, auth, query, response, cache, and status contract see [API.md](./API.md). This section maintains the intended cadence, idempotency, and the operations runbook.

Neither checked-in Worker declares cron triggers. Production `triggers.crons` and preview `env.pre` `triggers.crons` are both `[]`. The production caller is unverified. `web/vercel.json` is in the repository and is not proof of a live caller. Do not infer the caller from that file.

Intended cadence when an owner later enables schedules. Cloudflare numbers Sunday as `SUN` or `1` and rejects `0`. `7` is Saturday.

| Job | Intended schedule (UTC) | Action | Triggers a deploy? |
|---|---|---|---|
| **Daily** | `0 3 * * *` (~03:00) | JSON-only: GraphQL looks up current_stars, then generate and validate a complete immutable live generation, switch `live/latest.json`, and `revalidatePath` the hot-set pages | **No** |
| **Weekly** | `0 4 * * SUN` (Sunday ~04:00) | Incremental live overlay. Reuse the same generation and pointer protocol, and write `ops/sync-runs.json` | **No** |
| **Weekly refresh** | `0 6 * * SUN` (Sunday 06:00) | Managed refresh: `/api/workflows/refresh/start` authenticates, acquires a lease, and `startRefresh` runs whitelist, rename, metadata, fold, rank / entity / heatmap recompute, validate, publish, and version GC. Steps continue through `/api/workflows/refresh/step` | **No** |

`web/vercel.json` still lists Sunday as `0`. That file is not the Worker schedule.

The Worker `scheduled` handler dispatches by `event.cron` to the three paths in the table. Cloudflare Cron Triggers number weekdays `1` = Sunday through `7` = Saturday and reject `0` ([Cloudflare docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/)). Weekly and refresh accept `SUN` (or Cloudflare `1`); `7` is Saturday and dispatches as unknown. Daily stays `0 3 * * *`. Production `triggers.crons` **must stay `[]`** until stage 5. Preview `env.pre` `triggers.crons` **must stay `[]`** while preview schedules are paused (#543); the CI gate enforces it through `PREVIEW_CRONS_PAUSED` in `scripts/cf-ci-gates.mjs`. The intended preview expressions, when the owner re-enables them, are `0 3 * * *`, `0 4 * * SUN`, and `0 6 * * SUN`. A cron string in the Worker config does not by itself turn platform schedules on. This repo does not enable platform schedules.

Both Worker write contracts use `r2_binding` through their own guarded `DATA` bindings. The retained Blob driver uses `web/lib/storage/vercel-blob-fetch-client.ts`; it is not the current production contract. `?dry=1` writes no objects.

> **Cron route behavior**: daily job = `web/app/api/cron/daily/route.ts`, weekly job = `web/app/api/cron/weekly/route.ts`, and both delegate to `web/lib/cron/handlers.ts` and support `?dry=1`. CRON_SECRET auth → with the idempotency key `<job>:<UTC-day>`, acquire a 15-minute ETag/CAS lease on `live/latest.json` → GraphQL pulls current_stars → `live-refresh.ts` idempotently rebuilds that day's state → validate all JSON → write `live/generations/<run_id>/**` (`current_month.json` v2 index + `current_month/shards/<0-31>.json`) and the manifest → the same control object does a fenced CAS generation switch → only **after that** come `revalidatePath` / IndexNow / `ops/sync-runs.json`. On UTC Sunday, daily returns `skipped: weekly-owns-sunday` before acquiring the lease, so it does not contend with the 04:00 weekly for live/health. Different keys in parallel return 409; the same key still running returns 202 attached, and one already committed returns 200 already-published. A manual same-day refresh must supply a new `idempotency_key`. Publish/release fence with the configured store's origin ETag captured at acquire, not a public GET of the pointer body. The retained Blob driver uses its `head()` API for that fence (#402). Health CAS is at most 5 tries, with exponential backoff + jitter; do not resolve a sustained conflict by raising the count.

**Failed weekly / leftover lease:** A false-fence (or any failure after acquire) used to leave `lease` on `live/latest.json` until `expires_at` (~15 min) because release also read the CDN-stale `lease: null` body and skipped the clear. Release now CAS-clears when `claimedEtag` still matches origin `head()`. If an old deploy left a lease stuck, wait until `expires_at` before the next acquire; do not skip that wait by writing `main` or calling production cron unless the user said push main. Sunday **workflow-refresh** failures are the next section, not this path.

### Sunday 06:00 UTC workflow-refresh failure

Schedule: intended `0 6 * * SUN` UTC (Cloudflare also accepts `1` and rejects `0`) → `GET /api/workflows/refresh/start` (managed refresh, no Workflow SDK). This is **not** the Sunday 04:00 weekly live cron above. A leftover `live/latest.json` lease is that other path (#402). The production scheduler is unverified; see the dated evidence above.

Paging already exists — do not invent new alerts. `markFailed` in `web/lib/workflows/checkpoint.ts` calls `recordHealth("workflow-refresh", "failed", …)` and `sendAlert`. Start-route lease/enqueue failures in `web/lib/workflows/start.ts` also `sendAlert`. `sendAlert` always writes a structured `[ALERT] workflow-refresh failed` Worker log; it POSTs a webhook only when `ALERT_WEBHOOK_URL` is set on that Worker.

1. Read **`ops/workflows/health/workflow-refresh.json`** (`status`, `last_failure`, `freshness.stale_after`). **Do not read** retired `ops/workflows/health.json`.
2. Read Worker logs for `[ALERT] workflow-refresh` on `gitstarclub-web`. A preview incident uses `gitstarclub-web-pre` logs and must not roll back `gitstarclub-web`.
3. Check `ops/workflows/active.json` (`run_id`, `expires_at`, `fencing_token`, `idempotency_key`). Default Sunday key is week-scoped (`workflow-refresh:YYYY-Www`). Same-key retries attach; a different active trigger is 409.
4. Check `ops/workflows/<run_id>/manifest.json`, `error.json`, `post-commit-failure.json`, and `validation.json`. Validate is fail-closed; do not relax invariants.
5. Check `views/latest.json`. If the failure was before publish, the pointer must be unchanged. Do not hand-edit the pointer.
   A `failed` manifest with a non-null `published_version` (`error.json` `phase: "post_commit"`) means that version is already live and only `failed_step` did not finish. The publish step already retried it in-step by replaying the intent. After the run is marked failed, nothing repairs it automatically. Do not roll back or start a new run because of it; the next successful run rewrites those artifacts. Until then, `recovery` / `whitelist_pointer` leave `latest-success.json` or `canonical/v2/whitelist/latest.json` on the previous version. `invalidate` / `indexnow` leave caches on their normal revalidation window. `gc` / `markPublished` leave old versions or the manifest status. `ownership` means the run lost its lease after the pointer switched. The run cannot renew the lease to write `manifest.json` or `error.json`, so its manifest can still read `running` with `published_version: null`. Read `ops/workflows/<run_id>/post-commit-failure.json` instead (`published_version`, `failed_step: "ownership"`). It is create-only, lives under the run's own prefix, and touches no lease or shared pointer. Another run may now hold the lease; do not release or overwrite it. The next successful run rewrites the unfinished artifacts. `phase: "commit_unknown"` (`candidate_version`, `published_version: null`) means the pointer could not be read after the failure: read `views/latest.json` to see whether the candidate is live. See [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.12.
6. Enqueue with a **new** Idempotency-Key only after leftover lease `expires_at`, and only if same-week attach is not the right move. How: authenticated `GET /api/workflows/refresh/start` with a new `Idempotency-Key`. There is **no** dry-run for managed refresh.
7. Hard stops: no validate-invariant relaxation; no inventing `bootstrap/latest.json`; do not push `main` or call production cron unless the user said push main; wait leftover lease; product-gates stay fail-closed.
8. After a successful publish, static exports still need the [DATA-EXPORTS.md](./DATA-EXPORTS.md) regenerate path (#375). Do not duplicate that runbook here.

**Optional — retire the stale flat object (do not run unless the user authorized a write to the retained production Blob store).** Writers no longer touch `ops/workflows/health.json`. `blob-del-prefix.ts` hard-blocks `ops/**`. If the Jul-2026 object is still confusing operators, overwrite or delete that **single** pathname from the Vercel Blob dashboard after confirming `healthPath` still has no flat-file writer. Do not prefix-delete `ops/`. Do not call production cron to refresh it.

**Auth mode (CRON_SECRET)**:

- The handler requires `Authorization: Bearer <CRON_SECRET>`. A manual request is not proof of a scheduler. Do not call production cron to ship a code change.
- The exact status and response contract is in [API.md](./API.md). `robots.txt` disallows `/api/`; auth is the real line of defense.

**Idempotency (critical constraint)**:

> A schedule or a manual call can run twice. Both handlers **must be idempotent**:
> - Daily / weekly: the default key is `<job>:<UTC-day>`; the same key publishes at most once. The lease, the current generation, and the fencing token coexist on `live/latest.json`, so an old process that has lost the lease cannot arrive late and overwrite the new pointer.
> - Generation files are immutable; if an object write fails at any step, the `generation` field still points at the previous complete version. After a partial failure, releasing or letting the lease expire is enough to retry with the same key, and an existing same-byte immutable object can be reused safely.
> - Inside `current_month`, upsert is still by UTC day, so a same-day additional refresh with an explicit new key does not accumulate twice.
> - Failures are covered by **alerts** (see below), not by retries.

A full recompute stays in managed-refresh steps. Do not put a DuckDB or Parquet rebuild in one request.

**Daily cron live-run runbook**:

1. A manual `GET /api/cron/daily?dry=1` with `Authorization: Bearer <CRON_SECRET>` is a no-write check. It is not proof of a scheduler and is not a production hotfix. Read Worker logs on `gitstarclub-web`. If those logs show a GitHub GraphQL `403`, `Retry-After`, or rate-limit remaining near 0, stop and lower the batch size or add waits.
2. Before a live run, record `live/latest.json` (especially `generation` / `previous_generation` / `lease`). Immutable generation files do not need to be backed up one by one.
3. A live `GET /api/cron/daily` with the same header writes through the guarded production R2 DATA binding. The client may disconnect before the route finishes. Worker logs and the written objects are the record. Do not use this call to ship a code change.
4. After the write, from the repository root run `bun web/scripts/validate-live-views.ts --bust <UTC day>`; the script first resolves `live/latest.json`, then validates `current_month` / `hot-snapshot` and freshness for the same generation. Then check `/` and `/pulse`. The script uses `getPublicReadBases()` for the configured read driver, checks the primary origin, and reports `storage_read_driver` and `public_read_base` (#578). A missing R2 base fails even when a Blob base is available. A page returning 200 does not prove the tool is off Blob. Stage 6 still requires it to complete against the production R2 origin with Blob variables unset; see [R2-CUTOVER.md](./R2-CUTOVER.md).
5. If it fails, confirm the pointer's `generation` did not change; a partial generation that was written but is not referenced does not affect production and can be left for a later GC. If committed content is wrong, point `generation` back at `previous_generation` (also use an ETag conditional write; do not overwrite an active lease).

## Managed refresh runbook

> Long tasks that carry the history / metadata / canonical full refresh. This section gives only the **operations steps**. Step names are in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §3.
>
> Critical constraint: Search only discovers membership; metadata calls GraphQL `nodes()` bucket by bucket, across 32 buckets, for every active repo, and writes the sole authoritative `current_stars` from `stargazerCount`. A single bucket is at most about two batches of requests and keeps inter-batch throttling; if any active repo is missing a GraphQL result, publishing stops, and it must not fall back to Search stars.
>
> Intended cadence is `0 6 * * SUN`, independent of daily and weekly. Neither checked-in Worker declares that cron. The production caller is unverified.

**Why steps**: a full recompute does not fit one request. Each step is ordinary async plus explicit retry, advanced by an HTTP self-chain or the Worker queue. Do not add a second engine on the request path.

**Run prerequisites**:
- `CRON_SECRET` and `GITHUB_TOKEN` on the Worker that runs the refresh.
- Both Worker write contracts use their own guarded R2 DATA binding, matching `DEPLOY_ENV` and bucket identity. They do not need a Blob token. Explicit use of the retained Blob write driver needs its Blob base and token.
- `WORKFLOW_RUNTIME` is `cf-queue` on both Workers. The code default when unset is `http`.
- Deploy with the typed configuration commands earlier in this runbook. Do not use a Vercel deploy command.

**Manual trigger runbook**:

1. `GET <deployment>/api/workflows/refresh/start`, with `Authorization: Bearer <CRON_SECRET>` → the route first read-only validates `canonical/v2/meta.json` and all 32 `repos` shard (including `active` / `tracked_since` / `d`, key/id/bucket), and only after that passes does it acquire the lease and `startRefresh`, then immediately return `run_id` (non-blocking). A preflight failure does not enqueue or acquire a lease; step `preflight` validates all 128 required shard again before any canonical mutation. CF / HTTP orchestration splits this recheck into 4-bucket windows (16 shard per window, `ops/workflows/<run_id>/steps/preflight-0.json` … `preflight-28.json`), so Workers do not read all 128 objects at once and trigger 1102. When preview has `PREFLIGHT_RELAX_EMPTY_SHARDS=1`, a confirmed 404 / empty bucket is treated as a `{}` placeholder and a `preview-empty-canonical-placeholder` log is recorded, without voiding the whole run; production stays fail closed.
2. Read `ops/workflows/active.json` and `ops/workflows/<run_id>/steps/<step>.json`. Compare that run log and the health JSON with Workers Observability on the Worker that ran the refresh. A preview incident uses `gitstarclub-web-pre` and must not roll back `gitstarclub-web`.
3. Read `(run_id, fencing_token, expires_at)` on `ops/workflows/active.json`, `ops/workflows/<run_id>/manifest.json` (status running / published / failed), plus artifacts `canonical/v2/whitelist/<run_id>.json`, `canonical/v2/repos/<bucket>.json`, `renames.json`, `views/<run_id>/lookup/aliases.json`, `publish-intent.json`, and `latest-success.json`.
4. Check the whitelist count, that repos shard buckets are complete, and that diff / rename look reasonable.
5. The route exists. Neither Worker cron list includes it, and the production caller is unverified. This managed refresh **has no dry-run mode**; any `dry` query returns `400` before a lease is acquired or state is written. A no-write probe can only use `/api/cron/daily?dry=1` or `/api/cron/weekly?dry=1`. A manual refresh is not proof of a scheduler. Watch a real run through the steps above.

> Full-chain steps: `preflight` (validate every canonical shard again) → `fold` (month + week; each time `fold-decision.json` is written first. When there is closed pending, also write compact `fold-month-plan.json` / `fold-week-plan.json`, split by 1-bucket windows into `fold-month-*` / `fold-week-*`, and still write `fold.json` at the end. If already folded through the current month and no weeks remain, then `reason=no_closed_month`; missing a month plan is not a stall) → `recomputeRank` (on CF: month-pack + 8-period month/monthOrg, then year derived from month buckets followed by 8-period year/yearOrg, then week-pack + 8-period week/weekOrg, and finally rest by repos bucket; after fold, write `recompute-enqueued.json`, and each hop first writes `recomputeRank-<phase>-start.json`. The #497 whole-window week OOM has been split by bucket; month/year/rest likewise no longer load a whole window, see [archive/CF-MIGRATION-P1.md](./archive/CF-MIGRATION-P1.md)) → `buildAliases` (→ `lookup/aliases.json`) → `validate` publish gate → `publish` switches the `views/latest.json` pointer / rollback → `gc` version reclamation (design see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7). CF preview Blob filenames are runtime steps: after fold, `recompute-enqueued.json`, `recomputeRank-month-pack.json` / `recomputeRank-month-*.json` should appear through the terminal `recomputeRank-month.json`, plus year-pack / week-pack / `recomputeRank-rest-*.json` and the terminal `recomputeRank.json` (not the manifest alias `recompute.json`). When `WORKFLOW_RUNTIME=cf-queue`, the Queue consumer reads the step JSON (or `x-gitstarclub-queue-successor`) and then `JOBS.send`s the next step; writing only `fold-decision`+`fold.json` and then a silent queue, a fetch source of `Worker exceeded memory limit`, no `error.json`, and an expired lease is a stall that is still not closed after #486 (the root cause is that the month hop still loads an object window, not that fold-decision failed to enqueue; see [archive/CF-MIGRATION-P1.md](./archive/CF-MIGRATION-P1.md)). `/` `/rankings` returning 500 while `/preview/health` returns 200 is the same isolate OOM (application vs shell), not a published pointer written corrupt. The pass/fail table for a preview Bearer full refresh see [archive/CF-MIGRATION-P1.md](./archive/CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix). An OOM or a silent Queue counts as failure, not "still running".

**Auth / credentials**: `CRON_SECRET` (trigger) and `GITHUB_TOKEN` (Search / GraphQL). The retained Blob write path needs `BLOB_READ_WRITE_TOKEN`; the current R2 `DATA` path does not. Refresh is 0 GCP end to end (GCP is bootstrap only).

### Preview cold-start first run (one time, #662)

`env.pre` sets `WORKFLOW_COLD_START=1` and `PREFLIGHT_RELAX_EMPTY_SHARDS=1` and no longer sets `WORKFLOW_FIXTURE`, so a Bearer `GET /start` on `gitstarclub-web-pre` starts the real refresh instead of a fixture no-op. `triggers.crons` stays `[]` and `PREVIEW_CRONS_PAUSED` stays true: nothing runs until the owner calls it. Re-enabling the preview schedule is a separate owner decision. `scripts/cf-ci-gates.mjs` allows the two flags only as `"1"` on `env.pre`, refuses them on the production top level, and refuses `WORKFLOW_FIXTURE` in both blocks. Fixture mode stays testable by passing `WORKFLOW_FIXTURE` in a test env object (`web/lib/workers-host/*.test.ts`).

What this run is: a **rehearsal dataset**. Membership comes from GitHub Search and stars from GraphQL only. There is no GH Archive history: `seam_date` is the bootstrap UTC day, stars history and monthly/weekly series start empty, and `MIN_TRACKED_STARS` stays `10000`. Do not read the result as production data.

First-publication validation (#676) permits exactly an empty sampled repository curve and a missing prior-calendar-year heatmap when `WORKFLOW_COLD_START=1`, `DEPLOY_ENV=pre`, no production signal is present, and an authoritative read confirms `views/latest.json` is absent. It never invents historical rows. A present but malformed heatmap, a missing entity, or any other publication-gate failure still blocks. An unreadable or malformed pointer cannot enable the exception. Each actual exception logs `[workflow-refresh] cold-start validation relaxed` with `run_id` and `check`; `ops/workflows/<run_id>/validation.json` records `cold_start_empty_curve_relaxed` and `cold_start_missing_prior_year_heatmap_relaxed` as booleans (false when unused). After a pointer exists, both historical checks are strict again even if the flags remain set. A later refresh without the required history can therefore fail validation; this exception supports only the first preview publication, never production.

Preconditions (check read-only; an agent must not change them):
1. The deployed `gitstarclub-web-pre` carries the #662 config. `typed configuration.jsonc` does not deploy itself. The owner deploys `--env pre` as a separate step.
2. `_meta/bucket-identity.json` exists in `gitstarclub-data-pre` (`bucket=gitstarclub-data-pre`, `deploy_env=pre`; public read at `https://data-pre.gitstarclub.com/_meta/bucket-identity.json`). Guarded R2 writes refuse without it.
3. `views/latest.json` and `canonical/v2/meta.json` are both still 404 (cold start only arms in that state).
4. `CRON_SECRET` and `GITHUB_TOKEN` are set on the preview Worker.

Who runs it: the owner, or an agent the owner names for that run. One call only: `GET https://pre.gitstarclub.com/api/workflows/refresh/start` with `Authorization: Bearer <CRON_SECRET>` (the secret is not in the repository). Do not retry blindly: read `ops/workflows/active.json` first.

What to watch: `ops/workflows/active.json` (run id, lease `expires_at`), `ops/workflows/<run_id>/manifest.json` and the per-step files, in the order `preflight` → `fold` → `recomputeRank` → `buildAliases` → `validate` → `publish`, plus Workers Observability logs for `gitstarclub-web-pre` (look for `preview-empty-canonical-placeholder`, `error.json`, `Worker exceeded memory limit`, an expired lease). A silent queue or an OOM counts as failure, not "still running" (see the full-chain note above). Success is `views/latest.json` appearing and `manifest.json` status `published`.

After the first publish, cold start disarms by itself (`views/latest.json` exists), so the flags are inert, and later runs go through the normal fail-closed preflight against the new store. To remove the flags, delete both vars from `env.pre` (the gate accepts absent). On failure, do not hand-write pointers; remove bad generation objects only under the owner authorization described in the bad-first-publish recipe above, then ask the owner before a second attempt.

### Preview fault rollback

A preview fault rolls back Worker `gitstarclub-web-pre` (Vite mode `pre`) only. Do not apply that rollback to production Worker `gitstarclub-web`. Do not empty production `triggers.crons` as a preview fix; they are already `[]`. Do not set `HOSTING_TARGET=vercel`. Do not add a login wall on `https://pre.gitstarclub.com`. Do not cut DNS. Do not delete production Blob.

The historical production cutover rollback reference, requiring operator checks and separate authorization, is recorded later in this runbook: the retired version rollback recorded in [R2-CUTOVER.md](R2-CUTOVER.md).

**Alerts**: a refresh failure writes a structured Worker log, an optional webhook, a run checkpoint, and an independent health state. The repository has no Sentry SDK. A failure before publish does not switch the live pointer.

### Post-publish checklist: static data exports

Workflow publish switches the configured store's views pointer; the current production write contract is R2. Committed static exports under
`web/public/data/exports/v1/` do **not** update automatically. Product-gates
`export-manifest-age` requires the deployed manifest `data_as_of` within
**14 days** (`EXPORT_MAX_AGE_MS`). Full copy-paste runbook:
[DATA-EXPORTS.md](./DATA-EXPORTS.md) §After a successful weekly publish.

After a successful `views/latest.json` publish (cron or manual):

1. Confirm `views/latest.json` has the intended `version` / `published_at`.
2. On a branch from `pre`: `cd web && bun run exports:generate`.
   `web/scripts/generate-data-exports.ts` and `web/scripts/validate-live-views.ts` use `getPublicReadBases()` for the configured read driver (#578). The validator checks the primary origin and reports `storage_read_driver` and `public_read_base`. Their offline CLI regression tests run with an R2 loopback base and no Blob vars; a missing R2 base fails even when a Blob base is available. A page returning 200 does not prove those tools are off Blob. Before the stage 6 retirement in [R2-CUTOVER.md](./R2-CUTOVER.md), both commands must complete against the production R2 public origin with Blob variables unset. This runbook does not edit the scripts.
3. PR the new dated directory `web/public/data/exports/v1/YYYY-MM-DD/` **into
   `pre`**. Do not commit a `latest/` tree; do not push straight to `main`.
4. Verify Preview
   `https://pre.gitstarclub.com/data/exports/v1/latest/manifest.json`.
5. Promote `pre` → `main` through the normal PR path only — no silent
   production overwrite and no runtime export regenerate endpoint.

A data update does not by itself require a new Worker deploy. Daily and weekly routes call `revalidatePath` for the hot set. Long-tail pages stay on-demand ISR. Deploy with the typed configuration commands in this runbook when the code or the Worker config changes.

## Monitoring and alerts

Workers Observability is enabled on `gitstarclub-web` and `gitstarclub-web-pre`.

| Watch | Tool | Trigger |
|---|---|---|
| Runtime errors | Workers Observability on the Worker that served the request | Uncaught exceptions and route errors. There is no Sentry integration |
| Build and deploy errors | The GitHub `production-build` job, or the local `Vite build` / typed configuration stdout and stderr | Vite compilation and cf build output happen before a Worker serves the new build. There is no separate build-log integration |
| pipeline run records | **`ops/sync-runs.json` log** (each daily / weekly job appends one entry: start / end time, query count, paths written, status) | For reconciliation and traceback; together with `ops/workflows/<run_id>/steps/*.json` they form the self-built run log |
| Preview incidents | Workers Observability on `gitstarclub-web-pre` | Do not roll back production Worker `gitstarclub-web` from a preview incident. Preview is public; `noindex` is not access control |
| Production incidents | Workers Observability on `gitstarclub-web` | Production uses R2 after the accepted 2026-10-04 cutover. Hosting rollback for that cutover is the stage 4 version command |
| **Data drift** | Compare the GraphQL authoritative total against the summed adds total | **Alert when drift > a threshold (for example 2%)**, and re-anchor with GraphQL as the anchor (see ARCHITECTURE "Data validation / reconciliation") |
| **Cron failure** | `[ALERT]` Worker log + optional `ALERT_WEBHOOK_URL` + `sync-runs` + pipeline health | webhook delivery is best-effort; when it fails or is unset, logs and health are authoritative |
| Single-day spike | pipeline sanity check | An extreme single-day addition spike is logged as an alert (net is allowed to be negative) |

For aggregate GEO crawler and AI-referrer reporting, use [geo/ai-log-reporting.md](./geo/ai-log-reporting.md). That script accepts the Vercel Log Drains field shape and does not parse Cloudflare Worker logs.

**Alert channel**: `sendAlert` always writes a structured Worker log. `ALERT_WEBHOOK_URL`, when set on that Worker, can point at an endpoint that receives a JSON POST, such as Slack or Discord. Watch especially for a failed run and for data drift past the bound. Webhook is not a reliable queue and must not be the only source of state. A missing schedule is not something this log can prove; the production caller stays unverified.

> `sync_runs` does not need a database: the current implementation overwrite-writes `ops/sync-runs.json` through the configured store and keeps the most recent 100 runs. When reliable delivery or paging is needed, attach a separate alerting service with durable retries; the current code does not declare that capability.

### Alert webhook (`ALERT_WEBHOOK_URL`, optional)

When managed refresh or the daily / weekly route fails, it calls `sendAlert` (`web/lib/observability/alert.ts`). `sendAlert` has two delivery surfaces, both **best-effort and never throwing** (an alert failure must not take down the pipeline):

1. **Always** write one grep-able structured log line `[ALERT] <pipeline> failed` (including `run_id` / `step` / `error`) to the Worker log. That line is written even when no webhook is configured.
2. **If and only if** `ALERT_WEBHOOK_URL` is set on that Worker, also `POST` a JSON failure summary to that URL (`{ text, pipeline, run_id, step, error, at }`, 5s timeout per attempt). Only HTTP 2xx counts as success; 408 / 425 / 429 / 5xx, timeouts, and network errors are tried at most 3 times (100ms / 250ms backoff), and other 4xx are marked delivery-failed immediately. The final result includes `delivered` / `failed` / `disabled`, the attempt count, and a safe diagnosis, and is written to the structured log; webhook errors are not thrown back into the pipeline.

`error` text passes through `sanitizeErrorText` (`web/lib/observability/sanitize-error.ts`) before the log line, the webhook body, sync-run records (including `post_commit_errors` and older history that lacks that array), workflow checkpoints, metadata `last_error`, validation failure strings, health records (including retained success and failure signals), rollback or step diagnostic responses, the Worker queue consumer log, and other runtime console diagnostics. GitHub HTTP error text is redacted before it is bounded. The sanitizer drops bearer credentials, known runtime secret values from the live Worker env and from `process.env` (including `VERCEL_AUTOMATION_BYPASS_SECRET`), credential URLs, and token-shaped strings. A credential assignment redacts the whole value, including punctuation, through the next break or the matching quote. GraphQL diagnostics are sanitized before they are serialized and again on the serialized text. It keeps a bounded failure category such as `GitHub GraphQL 502` or `timeout`.

Set `ALERT_WEBHOOK_URL` on the Worker that should send it. Leave it unset to stay in logs-only mode. Do not put the URL in the repository.

> `recordHealth` writes `ops/workflows/health/{workflow-refresh|cron-daily|cron-weekly}.json` separately. The only operator signal for Sunday 06:00 is `ops/workflows/health/workflow-refresh.json`. The flat `ops/workflows/health.json` is retired; do not read it. Each record is updated with an ETag compare-and-set, keeps `last_success`, `last_failure`, and `correlation_id` / `run_id` / `idempotency_key`, and provides `freshness.stale_after`. Every non-dry success and failure of the daily and weekly cron updates its record; `attached` / `rejected` only change that pipeline's latest signal and do not delete historical successes or failures. Concurrent runs of different pipelines cannot overwrite each other.

## Raw backfill data

**Current as of 2026-10-19 (GSC_0071). Raw data lives only in the private Cloudflare R2 bucket `gitstarclub-raw` on the ZKSC.KK account.** It is separate from the public production and preview data buckets. The managed `r2.dev` domain is disabled and there are no custom domains. Do not make it public or configure the site to read raw Parquet.

| Object key(s) | Objects | Bytes | Rows | Meaning |
| --- | --- | --- | --- | --- |
| `star_daily_gross/data-0000000000{00..19}.parquet` | 20 | 30,907,971 | 12,375,426 total | Original gross archive, 2015-01-01 through 2026-05-29; schema `repo_id` BIGINT, `day` DATE, `gross_adds` BIGINT |
| `bigquery-export/whitelist/data-000000000000.parquet` | 1 | 50,868 | 5,249 | Preserved whitelist table |
| `bigquery-export/star_daily_gross_gap_260530_260930_20261019/data-000000000000.parquet` | 1 | 196,554 | 90,797 | Preserved 2026-05-30 through 2026-09-30 gap table; historical evidence, not an approved repair |
| **Total** | **22** | **31,155,393** | — | Private raw archive only |

The original 20 files were previously at `gs://gitstarclub-backfill-746384388303/star_daily_gross/` in Google Cloud Storage (GCS). That is a historical location, not a second usable copy. GSC_0071 preserved the whitelist and gap under `bigquery-export/<table>/`, verified their SHA-256 and decoded row counts after the R2 round trip, confirmed the original 20 objects were unchanged, then deleted GCP project `gitstarclub`. The deletion request started at **2026-10-19T11:12:41Z**; the observed lifecycle state was **`DELETE_REQUESTED`**, not final purge. Google's 30-day recovery window ends **2026-11-18T11:12:41Z**, calculated from that recorded start. Recover well before that deadline if separately authorized. GCP is retired and is not an operational data dependency.

The versioned [SHA-256 manifest](./raw-data.sha256) contains all 22 keys. The two `bigquery-export/` hashes are the GSC_0071 verified export/round-trip hashes. GSC_0073 recorded the original 20 hashes from read-only R2 downloads on 2026-10-19, checked every byte size against the GSC_0071 inventory, and rechecked both export hashes. Those 20 hashes establish an R2 verification baseline; they are not a newly performed comparison with deleted GCS. Row counts above are the decoded counts recorded in GSC_0071.

### Read-only raw verification with the cf CLI

Use the Cloudflare `cf` command-line tool, never typed configuration. Select the authorized ZKSC.KK account with `CLOUDFLARE_ACCOUNT_ID` or an existing `cf` profile; do not print or copy credentials. Discover commands with anonymous searches such as `cf cli search "list R2 objects"` and `cf cli search "get R2 object"`, then inspect the returned command's help.

Set `TMPDIR` and `KANBAN_TMP` to the active card's directory under this checkout's `.kanban-work/`, excluded in local Git metadata. All listings and downloaded files must stay there. From the repository root:

```bash
: "${TMPDIR:?Set TMPDIR to the active card directory first}"
: "${KANBAN_TMP:?Set KANBAN_TMP to the same card directory}"
: "${CLOUDFLARE_ACCOUNT_ID:?Select the authorized account first}"
manifest="$PWD/docs/raw-data.sha256"
check_dir="$KANBAN_TMP/raw-data-check"
mkdir -p "$check_dir"
cf r2 objects list --bucket-name gitstarclub-raw --per-page 1000 > "$check_dir/objects.json"
cf r2 buckets domains managed list --bucket-name gitstarclub-raw > "$check_dir/managed-domain.json"
cf r2 buckets domains custom list --bucket-name gitstarclub-raw > "$check_dir/custom-domains.json"
while read -r digest key; do
  mkdir -p "$check_dir/$(dirname "$key")"
  cf r2 objects get "$key" --bucket-name gitstarclub-raw > "$check_dir/$key"
done < "$manifest"
(cd "$check_dir" && shasum -a 256 -c "$manifest")
```

Require all 22 checksum lines to report `OK`. Compare the listing to the table: exactly 20 original keys totaling 30,907,971 bytes, plus the two export keys and sizes (22 objects, 31,155,393 bytes overall). If a list response is paginated, follow its cursor before comparing. Confirm managed-domain `enabled=false` and custom `domains=[]`. A mismatch is a failed check, not permission to overwrite, re-export, enable public access, or recreate GCP. Remove local raw downloads after verification; retain the command results in the handoff rather than relying on temporary files.

## One-time bootstrap Runbook (historical; extraction retired 2026-10-19)

> **Historical recipe; BigQuery / GH Archive extraction retired on 2026-10-19.** Do not run the extraction commands below. GSC_0045 measured only about 4% capture against GitHub's own star-history proxy in a 40-repository 2026 sample (12,761 / 342,659, about 3.7%; not a population-weighted site estimate). GitHub's own star history is the replacement source under owner decision d1019-001344-1. Collection, rebuild, validation, and publication require separate authorization. The frozen published net series stays. See [Raw backfill data](#raw-backfill-data) for the R2 archive and GCP deletion/recovery record. The following text preserves the original one-off bootstrap design. After the artifacts are uploaded, the host's live routes and managed refresh take over. Production data uses R2 after the accepted 2026-10-04 cutover. The production caller is unverified. Routine operations are **0 local dependencies · 0 GCP**.

The original one-time backfill used **BigQuery** (historical GCP credentials and an approximately $10 cost estimate, including a stable repo.id). Free alternatives (the ClickHouse public instance, self-hosted ingestion) were all judged infeasible after evaluation; see [ARCHITECTURE historical bootstrap rationale](./ARCHITECTURE.md#historical-bigquery-bootstrap-rationale-retired-2026-10-19).

**Historical prerequisites (retired extraction; do not provision GCP credentials)**: GCP credentials (`GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID`) · GitHub PAT (`GITHUB_TOKEN`) · Blob token (`BLOB_READ_WRITE_TOKEN`) only for the retained Blob path. The R2 path uses a bucket-scoped key in the uncommitted pipeline env file (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) plus `R2_BUCKET_PRE` or `R2_BUCKET_PROD`. Run it on a local machine / a full Node environment. See [R2-CUTOVER.md](./R2-CUTOVER.md).

Historical renderer/dry-run example, retained for audit only; do not start a BigQuery job: `pipeline/backfill/02-extract.sql`. The renderer refuses the unsuffixed table `gitstarclub.star_daily_gross`.

```bash
cd pipeline
node backfill/02-extract.mjs --cutoff-suffix 260531 --destination gitstarclub.star_daily_gross_260531 > rendered.sql
bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql
```

```text
1. RETIRED: Query GH Archive WatchEvents (BigQuery)
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
- The two GCP variables and extraction step were retired on 2026-10-19; they are not prerequisites for a new rebuild.
- Steps 5 and 6 above are the Blob path (`--store` defaults to blob). Blob still uploads unless `--dry-run` (step 6) or `--no-upload` (step 7).

### R2 rehearsal and empty-bucket first commit

**Historical empty-bucket recipe; stages 2/3 remain unaccepted.** This did not supply the accepted production store: the operator instead copied Blob and completed the separately accepted stage-4 cutover. Do not apply initial-commit or bad-first-publish cleanup to the populated production copy. Any new rehearsal/rebuild requires its own authorized empty target. In the original recipe, rehearse preview first, then load an eligible production target. The owner places `_meta/bucket-identity.json` at the bucket root out of band. `bucket` must equal the target bucket name. `deploy_env` is `pre` for `--target pre` and `production` for `--target prod`. The scripts never write or delete `_meta/`.

Before the real-bucket rehearsal, run the offline local rehearsal first. Use the SHA-256-verified Node v24.20.0 and Bun 1.4.2 bootstrap in [AGENTS.md](../AGENTS.md), with dependencies installed in both `web/` and `pipeline/` using `bun --no-env-file install --frozen-lockfile`. From the repository root:

```bash
cd web
bun --no-env-file scripts/r2-local-rehearsal.ts
```

Success prints `R2_LOCAL_REHEARSAL_OK` and exits 0. Stage 2 still requires the real public origins and preview site acceptance in [R2-CUTOVER.md](./R2-CUTOVER.md#stage-2-preview-rehearsal). The local command uses fixtures and a clean environment, with no deployment or added CI job (#586).

R2 performs no writes unless `--execute`. `--target` without `--store r2` is refused. A dry run prints the object count, byte count, and target bucket. When R2 credentials are set, that dry run also reads `_meta/bucket-identity.json` and refuses a mismatched marker. When they are unset, it does not contact the bucket. `--initial-commit` is R2 only. It publishes `previous_generation: null` when `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` are all absent, and it refuses if any of those already exist. The first pointer is create-only. Retrying the same `--initial-commit` after that generation is visible returns already-published; a different existing pointer is refused. The identity marker and staged generation objects do not block that check. This null is not a legacy-flat rollback: `--rollback legacy-flat` fails closed because the flat layout is not in the new bucket.

A first publish has no prior generation. `--rollback` of the generation just committed returns `already-rolled-back` and leaves the pointer in place. That status is not an undo. The same rule is in [R2-CUTOVER.md](./R2-CUTOVER.md) stages 2 and 3.

Preview commands use Worker `gitstarclub-web-pre`, Vite mode `pre`, and bucket `gitstarclub-data-pre`. They do not deploy that Worker and do not write bucket `gitstarclub-data-prod`.

```bash
cd pipeline
# Worker gitstarclub-web-pre, typed configuration env pre, bucket gitstarclub-data-pre
GEN=bootstrap-20260717T120000Z

node backfill/06-upload.mjs --store r2 --target pre --generation "$GEN"
node backfill/06-upload.mjs --store r2 --target pre --generation "$GEN" --execute

node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN"
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN" --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN" --execute --initial-commit
```

Later publishes roll back to `previous_generation` on `https://data-pre.gitstarclub.com/bootstrap/latest.json`. Do not pass the current generation. `$GEN` above is the generation just committed, so it is not the rollback target.

```bash
cd pipeline
# Worker gitstarclub-web-pre, typed configuration env pre, bucket gitstarclub-data-pre
# PREVIOUS is bootstrap/latest.json previous_generation, not the current generation.
node backfill/07-export-v2.mjs --store r2 --target pre --rollback "$PREVIOUS" --execute
```

A bad first publish has no rollback. In this historical pre-cutover recipe, production `https://gitstarclub.com` would read Vercel Blob on Worker `gitstarclub-web` (top-level, no `--env`). Preview Worker `gitstarclub-web-pre` (Vite mode `pre`, bucket `gitstarclub-data-pre`) is a rehearsal and may show broken or empty data. Do not block preview hosts, do not publish through an isolated dashboard or API path, and do not prepare a Workers Static Assets cache.

Stop and record what went wrong. Read `https://data-pre.gitstarclub.com/bootstrap/latest.json`. `previous_generation` must be JSON null. If it is a generation id, use the later-publish command above.

Deleting objects uses the same owner authorization as a bucket write. Never delete `_meta/`, including `_meta/bucket-identity.json`. `web/scripts/blob-del-prefix.ts` refuses `_meta/`, `bootstrap/latest.json`, `canonical/`, the current generation prefix, and the broad prefix `bootstrap/generations/`. The owner removes the bad generation objects in bucket `gitstarclub-data-pre` under `bootstrap/generations/<bad-id>/`. Also remove `bootstrap/latest.json`, and remove `canonical/v2/meta.json` and `views/latest.json` when those objects exist. `--initial-commit` refuses while any of those three paths is present. Do not hand-write `bootstrap/latest.json` or `views/latest.json`. Never point production at the preview bucket. Do not change the current production R2 binding as part of this historical rehearsal.

Rerun the preview upload and `--initial-commit` commands above with a new generation id. Then redeploy preview the normal way (the Preview deploy section in this file) and check the live rankings page. Worker `gitstarclub-web-pre`, Vite mode `pre`, bucket `gitstarclub-data-pre`:

```bash
# Worker gitstarclub-web-pre, typed configuration env pre, bucket gitstarclub-data-pre
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data-pre.gitstarclub.com
bun run build:pre
bun run validate:host -- --mode pre
# A separately authorized owner uses deploy:pre after reviewing the non-fixture build.
```

`https://pre.gitstarclub.com/rankings` must return 200, stay `noindex`, and show repository rows from the new generation. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure. Repeat stage 2 acceptance after that live check. Real rollback starts at stage 4 and requires a separately reviewed cf operation.

Production uses the same upload and `--initial-commit` commands with `--target prod` after the pre rehearsal. That target is Worker `gitstarclub-web`, mode production, bucket `gitstarclub-data-prod`. The first publish there has the same null `previous_generation`. `--rollback` of that same generation returns `already-rolled-back` and leaves the pointer in place. In the original pre-cutover recipe, production would stay on Blob and that initial publish would not change the site. This was not the accepted operator copy/cutover route. Do not run it against the current copied production bucket.

Stop and record what went wrong. Deleting objects uses the same owner authorization as a bucket write. Never delete `_meta/`, including `_meta/bucket-identity.json`. The owner removes `bootstrap/generations/<bad-id>/` and `bootstrap/latest.json` in bucket `gitstarclub-data-prod`, and removes `canonical/v2/meta.json` and `views/latest.json` when those objects exist, so `--initial-commit` can run again. `web/scripts/blob-del-prefix.ts` refuses `_meta/`, the pointer, and the current generation prefix. Do not hand-write a pointer. Do not write bucket `gitstarclub-data-pre`. Do not deploy Worker `gitstarclub-web-pre`. Then rerun the production upload and `--initial-commit` commands. A later publish on that bucket rolls back with `--target prod` and `$PREVIOUS` from `https://data.gitstarclub.com/bootstrap/latest.json`.

Stage 2 acceptance uses the bootstrap pointer, the phase manifests, and real page data. It does not require `views/latest.json`. On Worker `gitstarclub-web-pre`, Vite mode `pre`, bucket `gitstarclub-data-pre`:

- `https://data-pre.gitstarclub.com/bootstrap/latest.json` returns 200 and names the committed generation. On the first publish, `previous_generation` is null.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/manifests/base.json` and `.../manifests/canonical.json` return 200, and each SHA-256 matches the pointer.
- `https://data-pre.gitstarclub.com/bootstrap/generations/<id>/views/rank/all-time/repo/stock.json` returns 200 and contains at least one repository row with a star count.
- `https://data-pre.gitstarclub.com/views/latest.json` may 404. Do not hand-write it. Preview does not set `VIEWS_VERSION_FALLBACK`, so pages read the bootstrap generation.
- `https://pre.gitstarclub.com/rankings` returns 200, is `noindex`, and shows repository rows. The English empty copy "Ranking data is waiting for the next published recompute." on both ranking sections is a failure.
- Deployment identity must equal the commit that was actually deployed. `https://pre.gitstarclub.com/.well-known/deployment` `commitSha` equals the SHA baked by the preview `Vite build` for that deploy. A runtime `CF_PREVIEW_COMMIT_SHA` or `VERCEL_GIT_COMMIT_SHA` counts only when it names that same commit.

If a managed views pointer is required, the only writer is the publish step of an owner-authorized managed refresh. Stage 2 acceptance does not run it.

```bash
# Owner-authorized. Worker gitstarclub-web-pre, typed configuration env pre, bucket gitstarclub-data-pre
# Do not call the production Worker gitstarclub-web or https://gitstarclub.com/api/cron/*
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://pre.gitstarclub.com/api/workflows/refresh/start
```

That run's publish step writes `views/latest.json` in bucket `gitstarclub-data-pre`. Never hand-write the pointer.

Stage 3 acceptance is the same bootstrap pointer, manifests, and sealed `views/rank/all-time/repo/stock.json` on `https://data.gitstarclub.com`, bucket `gitstarclub-data-prod`. `views/latest.json` on that origin is not required. A 404 is expected. Do not hand-write it. In that historical recipe, `https://gitstarclub.com/rankings` would show Blob rows for version `refresh-2026-09-13T06-00-16-398Z` via `VIEWS_VERSION_FALLBACK`, because that pre-cutover Worker would not yet read R2. This is not a statement about the current production Worker. After stage 4, the command that creates `views/latest.json` on that bucket is an owner-authorized refresh publish:

```bash
# Owner-authorized, and only after stage 4. Worker gitstarclub-web, top-level
# production (no --env), bucket gitstarclub-data-prod
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://gitstarclub.com/api/workflows/refresh/start
```

Do not call `https://gitstarclub.com/api/cron/*` to create the pointer. Never hand-write `views/latest.json`.

### Stage 4 cutover rollback

The 2026-10-04 Worker version and rollback commands are historical evidence in
[R2-CUTOVER.md](R2-CUTOVER.md), not a vinext rollback procedure. Any future Worker
rollback requires separate owner authorization and a reviewed cf operation.

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

Blob dry-run loads only `BLOB_BASE_URL` and does not need `BLOB_READ_WRITE_TOKEN`. R2 dry-run (`--store r2 --target pre` or `--target prod`) loads `R2_PUBLIC_BASE_URL_PRE` or `R2_PUBLIC_BASE_URL_PROD` when set, otherwise `R2_PUBLIC_BASE_URL`, plus the bucket name. It fetches the public `_meta/bucket-identity.json` and does not load `R2_SECRET_ACCESS_KEY`. Neither dry-run calls create / put / delete. Review checks at least:

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

## Build shape

The build reads precomputed JSON and renders it. It does not aggregate, and it does not load an engine or a native module. Do not prerender the long tail in one build. Historical repo, org, and period pages use on-demand ISR. Data changes use `revalidatePath` from the live routes. OG images are drawn by the four `next/og` routes on request (`revalidate=86400`) and then cached. There is no pipeline-side OG object. Current platform price and duration caps are not recorded here. A full recompute stays in the managed refresh steps above.

## Bootstrap pointer repair

Operator command for the missing bootstrap pointer (dry-run first):

```text
cd web && bun scripts/ensure-bootstrap-pointer.ts
cd web && bun scripts/ensure-bootstrap-pointer.ts --execute
cd web && bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre
cd web && bun scripts/ensure-bootstrap-pointer.ts --store r2 --target pre --execute --initial-commit
```

`--execute` only writes when a sealed `bootstrap/generations/<id>` already
exists. If none exists, the plan is `leave-legacy-flat` and no pointer is
invented. `--initial-commit` is R2 only and is the empty-bucket exception
documented in the bootstrap runbook. That execute path acquires the same
`ops/workflows/active.json` publication lease as step 07, with idempotency key
`bootstrap:publish:<generation>`. A running unexpired workflow blocks the
write. After the lease renewal the command re-reads `bootstrap/latest.json`,
`views/latest.json`, and `canonical/v2/meta.json`, and refuses if any of them
appeared in that window. It renews the lease again immediately before the
create-only write, so a valid takeover during those reads does not publish. Creating a pointer is not the root-cost fix: a missing pointer is a
normal long-lived legacy state and must stay negatively cached with coalesced
reads even if the object disappears again.

## Rollback

- **Pointer rollback (Workflow publish)**: do not overwrite Blob directly. Call the protected rollback API with a stable idempotency key; it acquires a fenced lease, pins the rollback intent, syncs the recovery / whitelist pointers, and invalidates pages and the pointer cache. Example: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Idempotency-Key: rollback-<incident>" -H "Content-Type: application/json" --data '{"target_version":"<views/latest.prev_version>"}' https://www.gitstarclub.com/api/workflows/refresh/rollback`. After a successful return, check the pages and `views/latest.json` within the **≤60s** visibility SLA. Design see [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.
- **bootstrap generation / legacy rollback**: first read `bootstrap/latest.previous_generation`. When the value is a generation, run `cd pipeline && node backfill/07-export-v2.mjs --rollback <bootstrap-generation> --execute` for the Blob store. On Blob, a first publish stores null, and that null means `cd pipeline && node backfill/07-export-v2.mjs --rollback legacy-flat --execute`. On R2, `--initial-commit` also stores null, and that null means there is no prior generation. `--rollback` of the generation just committed returns `already-rolled-back` and is not an undo. `--rollback legacy-flat` fails closed because the flat files were never uploaded. A bad first R2 publish (`previous_generation` null) has no rollback. On bucket `gitstarclub-data-pre` (Worker `gitstarclub-web-pre`, Vite mode `pre`), stop, record the failure, and under the same owner authorization as a bucket write remove `bootstrap/generations/<bad-id>/` plus `bootstrap/latest.json` (and `canonical/v2/meta.json` or `views/latest.json` when present). Never delete `_meta/`. Then rerun that stage and redeploy preview the normal way. The original empty-bucket production stage 3 was never accepted and was superseded by the copied-store cutover. Its bad-first-publish cleanup must not be applied to current `gitstarclub-data-prod`. `web/scripts/blob-del-prefix.ts` refuses the current generation and `_meta/`. The same rule is in the R2 rehearsal section and in [R2-CUTOVER.md](./R2-CUTOVER.md). The accepted cutover has a separate historical Worker rollback reference; do not confuse it with bootstrap publication rollback. An R2 rollback after a later publish names `previous_generation`: `cd pipeline && node backfill/07-export-v2.mjs --store r2 --target pre --rollback <previous-generation> --execute` for Worker `gitstarclub-web-pre`, Vite mode `pre`, bucket `gitstarclub-data-pre` (use `--target prod` for Worker `gitstarclub-web`, top-level production with no `--env`, bucket `gitstarclub-data-prod`). Do not pass the current generation. A generation target rechecks sealed manifests and every object before the lease; a mutable legacy target, after acquiring the same Workflow CAS lease, verifies the key flat base artifacts and all `4 × 32` canonical shards. The command then rereads the pointer inside the lease and overwrites the pointer only once; a legacy target atomically deletes `bootstrap/latest.json`. If the pointer write/delete succeeded but the response was lost, retrying the same target returns `already-rolled-back`. Do not hand-edit the pointer. After a later publish, roll back to `previous_generation` and do not delete that current or previous generation or overlay.
- **Deploy rollback**: roll back the Worker that served the bad version. A preview incident rolls back `gitstarclub-web-pre` (Vite mode `pre`) and must not roll back production Worker `gitstarclub-web`. The retained historical R2 cutover version command above requires operator verification of availability/security suitability and separate authorization: the retired version rollback recorded in [R2-CUTOVER.md](R2-CUTOVER.md). Do not pass `--env pre`. That command does not write bucket `gitstarclub-data-prod` and does not write the blob store.
- **Daily live tail**: `live/generations/<run_id>/**` is immutable, and `live/latest.json` is the only publish switch. A failure before commit needs no data rollback (the pointer still points at the old generation); if bad data is found after commit, point the pointer's `generation` back at `previous_generation`. Rollback must also first confirm there is no active `lease` and use an ETag conditional write, so it does not overwrite a cron that is publishing.
- **Order**: roll the published pointer back first, then roll back the matching Worker version, then check that `sync_runs` and drift are back to normal. Do not roll back `gitstarclub-web` for a preview-only fault.

## Verify a manual CF preview deployment

Follow [VINEXT-HOST.md](VINEXT-HOST.md). Build the intended clean commit for pre,
validate its artifact inventory and record the embedded SHA. A separately
authorized operator deploys through cf. Afterwards, compare the deployment
identity, check locale routing/CSP/fonts/OG images, preview noindex, and cache
states. Local fixture builds are evidence only and must not be deployed.
