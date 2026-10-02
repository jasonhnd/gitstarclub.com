# Issue 643: publication invalidation origin and post-commit failures

Source: GSC_0035 audit findings F01 and F09. Both were re-checked on
`origin/pre` 2b8f9fc and are still present.

## Goal

1. F01. A publish or rollback calls the cache-invalidation callback
   (`POST /api/workflows/refresh/revalidate`) on the deployment that is
   actually running. A preview run never calls a production host. A missing
   origin fails closed with a clear error. Production targets stay the same.
2. F09. A failure after the `views/latest.json` pointer commit is recorded
   with the committed version and the failing step. It must be
   distinguishable from a failure before the commit.

## Scope

- `web/lib/workflows/publication-invalidation-request.ts`
  - `resolvePublicationInvalidationOrigin(env)`:
    - Cloudflare host (`HOSTING_TARGET=cf`): the origin is the validated
      `CF_CRON_ORIGIN`. That is the same var the Worker already uses for
      its self-calls, and `scripts/cf-ci-gates.mjs` pins it per
      environment. `VERCEL_URL` and `NEXT_PUBLIC_SITE_URL` are ignored
      there.
    - Vercel host: `VERCEL_URL`, then `NEXT_PUBLIC_SITE_URL`, as before.
      `VERCEL_URL` is always the running deployment's own host.
    - No hard-coded production default. Missing config throws.
    - Validation: an https origin with no credentials, path, query, or
      fragment. Plain http is accepted only for a loopback host. The closed
      production `workers.dev` host is refused. `DEPLOY_ENV=pre` refuses
      production hosts on either host. A production deployment on
      Cloudflare (`DEPLOY_ENV=production` or `VERCEL_ENV=production`)
      requires a production host. An invalid `DEPLOY_ENV` or
      `HOSTING_TARGET` throws.
  - `requestPublishedViewsInvalidation({ env, fetchImpl, timeoutMs })`:
    adds a timeout (default 30 s). Timeout, network, and non-2xx errors
    name the target URL and never include the bearer secret.
- `web/lib/workflows/publication-core.ts`
  - `PublicationPostCommitError` carries `version`, `step`, and `cause`.
  - After the pointer write, the recovery, whitelist pointer,
    invalidation, and IndexNow calls are wrapped. Ownership checks are not
    wrapped, so `WorkflowLeaseOwnershipError` keeps its no-retry handling.
  - If the pointer write or a replay step before it throws, the live
    pointer is read once. When it already holds this intent, the failure is
    raised as post-commit with step `pointer`. If that read fails, the
    original error is raised unchanged.
- `web/lib/workflows/checkpoint.ts`
  - `markFailed(..., postCommit?)` writes `published_version` = the
    committed version. `error.json` gets `phase`, plus `committed_version`
    and `failed_step` for post-commit failures. The alert title and step
    say the version is live. The lease still releases as `failed`.
- `web/lib/workflows/runtime/execute.ts`
  - `failRefreshJob` passes post-commit details for a
    `PublicationPostCommitError` and for `gc` / `markPublished` failures,
    which run only after publish succeeded.
- Tests (written first, run red on the old code):
  - `publication-invalidation-request.test.ts`: preview, production, Vercel,
    missing config, invalid origins, timeout, non-2xx, network error, and
    no secret in errors. The tests inject an in-memory fetch capture and do
    not replace `globalThis.fetch`.
  - `steps/publish.test.ts`: the typed post-commit error for each
    post-commit step, the ambiguous pointer write, the unchanged pre-commit
    errors, and a replay that repairs an invalidation failure.
  - `checkpoint.test.ts`: post-commit manifest and `error.json` fields.
  - `runtime/step-route.test.ts`: the full step route with a preview env,
    the real invalidation request, and a permanent 503 after commit.
- Docs: `docs/CHANGELOG.md`, `docs/OPS.md` (`CF_CRON_ORIGIN` row and run
  ledger), `docs/DATA-CONTRACTS.md` §2.12, `docs/VERCEL-DATA-OPERATIONS.md`
  (publish row and `error.json`), `docs/CF-MIGRATION-P2.md`, and
  `docs/API.md` (callback row).

## Out of scope

- Storage driver selection (#572, #573, #578).
- Wrangler config, CI workflows, `.delivery.yml`, and deploy scripts. No
  new var is needed, because `CF_CRON_ORIGIN` is already set on both
  environments.
- The `WorkflowManifest` contract. `published_version` is already nullable
  text, and `error.json` has no schema.
- Worker service-binding self-calls in place of the public origin.
- Deploys, real refresh or GC runs, and calls to any cron, refresh, or
  revalidate endpoint.

## Acceptance

- The full AGENTS.md static job passes in a fresh detached worktree: web
  lint, typecheck, typecheck:tests, typecheck:scripts, validate:views, and
  test:cov with line and function coverage at least 80%.
- The new tests fail on the old code and pass on the new code.
- `git diff origin/pre --stat` lists only the files above.
