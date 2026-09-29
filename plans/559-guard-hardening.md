# Issue 559: harden DEPLOY_ENV and bucket-identity guards

## Goal

Close the review follow-ups from #558. R2 writes must refuse a Vercel production signal that disagrees with `DEPLOY_ENV`. Fixture refresh on Cloudflare must not run when `DEPLOY_ENV` is missing or invalid. The guarded store must not write the `_meta/` namespace. The positive identity cache must use the endpoint the store actually uses.

## Scope

- `assertR2WriteDeployEnv` refuses `VERCEL_ENV=production` unless `DEPLOY_ENV=production`.
- The refresh step route refuses fixture jobs when `HOSTING_TARGET=cf` and `DEPLOY_ENV` is unset or not `production` | `pre` | `local`.
- Guarded `put` / `del` refuse any key under `_meta/`, on the caller path or the key after the store prefix.
- `assertR2WritesAllowed` takes the store endpoint (config after extras) and uses it in the positive-cache key.
- The `resolveRuntimeEnv` module mock moves to its own test file.
- Docs and `.env.example` drop the removed `migrate-*` write rule and describe the out-of-band marker.

## Out of scope

- The Worker wrangler config, CI workflows, `.delivery.yml`, and pipeline code.
- A new storage driver, and any Cloudflare, Vercel, or BigQuery write or deploy.

## Acceptance

- `VERCEL_ENV=production` with `DEPLOY_ENV=pre` refuses an R2 write.
- A fixture job with `HOSTING_TARGET=cf` and no `DEPLOY_ENV` returns 400.
- Guarded `put` / `del` of `_meta/x` is refused.
- `git grep -n -E 'migrate-dev|non-production migrate' -- docs .env.example` shows only historical changelog mentions, if any.
- Static verification from AGENTS.md passes.
