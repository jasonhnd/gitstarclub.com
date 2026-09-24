# Issue 537: Safe production wrangler deploy

## Goal

A plain production deploy of the top-level Worker config must keep the live `gitstarclub-web` plain-text bindings and must not turn `workers.dev` or version preview URLs back on.

## Scope

- Declare the five live production plain-text values on top-level `vars`: `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, `CF_CRON_ORIGIN`, `WORKFLOW_RUNTIME`, `WORKFLOW_QUEUE_ENQUEUE_URL`. Same public Blob base the preview Worker already uses. `CF_PREVIEW_COMMIT_SHA` stays out of the file and is passed with `--var` on each deploy.
- Set top-level `workers_dev` and `preview_urls` to `false`.
- Set `env.pre` `workers_dev` to `true` and `preview_urls` to `false`. Both keys are inheritable. Preview must not inherit the closed production subdomain, because the probe host is `https://gitstarclub-web-pre.worldgo.workers.dev`. Version preview URLs stay off. `pre.gitstarclub.com/*` is the staging route and is not added to this file.
- Extend `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs` so removing any of the five vars, or either production `false` flag, fails the gate.
- Document the production build env, `wrangler deploy --env=""`, and the post-deploy checks in `docs/OPS.md`. Point the duplicate command block in `docs/SEO.md` at that procedure.

## Out of scope

- No live `wrangler deploy`, `wrangler versions upload`, schedule, DNS, secret, or production HTTP calls.
- No hotfix PR to `main`. This lands on `pre` and rides the next promote.
- No change to preview-only flags (`MIN_TRACKED_STARS`, `PREFLIGHT_RELAX_EMPTY_SHARDS`, `WORKFLOW_COLD_START`).
- No `bun.lock` commit.

## Acceptance

- `wrangler deploy --dry-run --env=""` binding list covers the live non-secret bindings from the 2026-09-24 Cloudflare API snapshot. `CF_PREVIEW_COMMIT_SHA` is deploy-time only.
- The gate fails if any of the five vars or the two production `false` flags is removed.
- `node scripts/assert-cf-ci-gates.mjs`, `node --test scripts/cf-ci-gates.test.mjs`, `bun run lint:docs`, and `cd web && SEO_LIVE_BASE='' RUN_LIVE_SMOKE=0 bun run test` pass.
