# Issue 563: route hardcoded Blob reads through storage drivers

## Goal

Stop bootstrap pointer reads, sync-run history reads, workflow and cron config checks, the rankings cache key, and the live release-gate default from assuming Vercel Blob. They follow `STORAGE_READ_DRIVER` / `STORAGE_WRITE_DRIVER` (`blob | r2_binding | r2_s3 | r2 | r2_then_blob`). Unset drivers and `blob` keep today's Blob errors and reads.

## Scope

- `web/lib/runtime-config.ts`: `requirePublicReadBase()`, `requireStorageWriteConfig()`, `getPublicReadCacheKey()`, `getLivePublicReadBaseUrl()`. Blob helpers stay exported for `web/scripts/` and the Blob store.
- Call sites from the issue: `web/lib/data/bootstrap-publication.ts`, `web/lib/cron/sync-runs.ts`, `web/lib/cron/handlers.ts`, `web/lib/workflows/start.ts`, `web/app/api/workflows/refresh/rollback/route.ts`, `web/lib/data/rank-periods.ts`, `web/lib/integration/release-gates-live.ts`.
- `web/lib/storage/r2-binding-store.ts`: test hook so `r2_binding` write checks can see a `DATA` binding without a Worker.
- `web/lib/integration/route-smoke-runner.ts`: the acceptance grep also matches this file's `process.env.BLOB_BASE_URL` assignment. The assignment moves into `runtime-config.ts`.
- Tests for those sites.
- `docs/OPS.md` driver enum `blob | r2_binding | r2_s3 | r2 | r2_then_blob`, `docs/R2-MIGRATION-P0.md`, `docs/CHANGELOG.md`.

## Out of scope

`workers/gitstarclub-web/wrangler.jsonc`, `scripts/cf-ci-gates.mjs`, `.github/workflows/*`, `.delivery.yml`, pipeline code, `web/scripts/*`, and `web/lib/data/source.ts` fallback / `VIEWS_VERSION_FALLBACK` logic. No Cloudflare, Vercel, or BigQuery writes. No deploy. No push to `main`, `pre`, or `preview`.

## Behavior

- Reads use the primary base from `getPublicReadBases()`. Sync-run history still treats a missing Blob base as empty history, because `getBlobBaseUrl()` did not throw.
- `requireStorageWriteConfig()`: `blob` requires the Blob base and `BLOB_READ_WRITE_TOKEN` with the same messages; `r2_binding` requires a `DATA` binding, `R2_BUCKET`, and a valid `DEPLOY_ENV`; `r2` / `r2_s3` require S3 credentials, bucket, endpoint, and a valid `DEPLOY_ENV`. Errors do not include secret values. The config check does not read the bucket-identity marker.
- Rankings cache key comes from the resolved public read base. A missing Blob base still uses an empty key.
- Live gates prefer `LIVE_PUBLIC_READ_BASE_URL`, then `RELEASE_GATE_BLOB_BASE`, then `BLOB_BASE_URL`, then the current public Blob URL. That last fallback is temporary and goes away in stage 6.

## Acceptance

- The issue greps for `requireBlobBaseUrl` / `requireBlobWriteToken` and `process.env.BLOB_BASE_URL` under `web/lib` and `web/app` are empty outside storage, `runtime-config`, and tests.
- Each changed call site has a test with `STORAGE_READ_DRIVER=r2_binding`, `R2_PUBLIC_BASE_URL`, and no `BLOB_*` variables. Write checks also set `STORAGE_WRITE_DRIVER=r2_binding`.
- AGENTS.md static flow: lint, typechecks, `bun run test:cov` at or above 80%, pipeline `bun run test`, `node scripts/assert-cf-ci-gates.mjs`.
