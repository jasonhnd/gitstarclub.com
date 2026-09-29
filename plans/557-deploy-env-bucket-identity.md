# Issue 557: DEPLOY_ENV and bucket-identity write guard

## Goal

Production-safety checks must work on Cloudflare Workers. `VERCEL_ENV` is never set there, so cold-start, empty-shard relaxation, and the R2 write guard currently do nothing on that host.

## Scope

- Add `DEPLOY_ENV` (`production` | `pre` | `local`) and `isProductionDeployment()` in `web/lib/runtime-config.ts`. Storage and deploy settings are read through `resolveRuntimeEnv()` when the caller does not pass an env object.
- `WORKFLOW_COLD_START` and `PREFLIGHT_RELAX_EMPTY_SHARDS` arm only when `DEPLOY_ENV=pre`. Unset `DEPLOY_ENV` stays off, including `HOSTING_TARGET=cf`. `DEPLOY_ENV=production` and `VERCEL_ENV=production` stay off.
- Replace the `migrate-*` prefix rule in `assertR2WritesAllowed` with a bucket-identity read of `_meta/bucket-identity.json` (`bucket`, `deploy_env`). Refuse the write when `DEPLOY_ENV` is unset, when the marker is missing or unreadable, or when `deploy_env` or `bucket` does not match. Cache a positive result per isolate.
- Default `R2_PREFIX` to empty.
- Protect `_meta/` in `web/lib/blob-deletion.ts`.
- Fixture refresh on the step route uses `isProductionDeployment()`.
- While `STORAGE_WRITE_DRIVER=blob` (the live default), Blob writes do not consult the marker.

## Out of scope

- The Worker wrangler config, `scripts/cf-ci-gates.mjs`, CI workflows, `.delivery.yml`, and pipeline code.
- A new storage driver, and any Cloudflare, Vercel, or BigQuery write or deploy.

## Acceptance

- Unit tests cover the mismatch, Cloudflare-unset, missing, and unreadable marker cases; cold start on `production` vs `pre`; an empty default prefix; and deletion under `_meta/`.
- Static verification from AGENTS.md: lint, typechecks, `bun run test:cov` at or above 80%, pipeline `bun run test`, and `node scripts/assert-cf-ci-gates.mjs`.
