# Preview R2 bucket config (#567)

## Goal

Point wrangler `env.pre` at its own R2 bucket with a production-like rehearsal config, and add CI gates plus a build-time public-read check so preview and production storage stay apart.

## Scope

- Worker wrangler config, env.pre only (file: workers/gitstarclub-web/wrangler.jsonc)
- `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs`
- `web/scripts/cf-opennext-build.ts`
- `.delivery.yml`, `AGENTS.md`, `.env.example`, and the Worker `.dev.vars.example`
- Docs that state the current preview floor or the preview Blob read path

## Out of scope

- Top-level (production) wrangler `vars`, `triggers`, and `r2_buckets`
- Cron expressions, Worker runtime, pipeline, and `.github/workflows/*`
- Bucket creation, deploys, and Cloudflare or Vercel writes

## Acceptance

- Preview `DATA` bucket is `gitstarclub-data-pre`. Public base is `https://data-pre.gitstarclub.com`.
- `DEPLOY_ENV=pre`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, and `R2_PREFIX` is unset.
- `env.pre` has no `BLOB_*`, `VIEWS_VERSION_FALLBACK`, `WORKFLOW_COLD_START`, or `PREFLIGHT_RELAX_EMPTY_SHARDS`.
- `env.pre` `MIN_TRACKED_STARS` equals the production floor (`10000`).
- Gate tests fail on a prod bucket in `env.pre`, the pre domain at top level, `BLOB_BASE_URL` in `env.pre`, cold start in `env.pre`, a missing `DEPLOY_ENV`, and `R2_PREFIX=migrate-dev/`.
- `cf:build` fails when the shell public read base does not match the target env. The loopback fixture used by CI stays allowed.
- Production top-level wrangler blocks stay byte-identical to `origin/pre`.
