# Issue 588: unit tests for the Worker entry

## Goal

Cover the Worker entry files `index.ts`, `cron-dispatch.ts`, `shell.ts`, and `next-app.ts` with unit tests that the existing CI static job already runs via `bun test lib/` from the web package. No behavior change.

## Scope

- New tests under `web/lib/workers-host/` so `web` `test` and `test:cov` pick them up. Do not edit CI workflows, `.delivery.yml`, or the Worker wrangler config.
- Cron dispatch: expression to route, paused/empty cron lists, Bearer auth, failures.
- Shell and Worker `fetch` routing, including the default export in `index.ts`.
- `handleNextRequest` forwards to the OpenNext worker.
- Env typing assumptions for `WorkerEnv`, `RefreshJob`, and invalidate bodies. Do not edit `env.ts` comments.

## Out of scope

- Runtime behavior changes, except a test-only import seam if the OpenNext bundle cannot be loaded in unit tests and the request path stays the same.
- Cloudflare or Vercel API calls, deploys, real buckets, BigQuery, and secret files.
- `bun.lock` churn.

## Acceptance

- `bun test lib/ --isolate` from `web/` executes the new files.
- A fresh detached worktree passes the AGENTS.md static job.
- The pull request to `pre` contains `Closes #588`.
