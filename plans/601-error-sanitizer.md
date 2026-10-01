# Issue 601: secret-safe error sanitizer

## Goal

Stop raw error strings from carrying secrets into console logs, alert webhooks, sync-run records, workflow checkpoints, health records, and rollback or step diagnostic responses. One bounded sanitizer runs at each of those sinks.

## Scope

- Add `sanitizeErrorText` in `web/lib/observability/sanitize-error.ts`.
- Redact bearer headers, known runtime secret values (`CRON_SECRET`, Blob read-write token, GitHub token, R2 and AWS keys, Cloudflare Access secrets, alert webhook URL, deploy hook URL, Vercel automation bypass secret), credential URLs, and token-shaped strings.
- Keep a useful failure category such as `GitHub GraphQL 502`, `timeout`, or `schema validation failed`.
- Apply the sanitizer where text leaves the process:
  - `sendAlert` log line and webhook body, including the assembled webhook transport diagnostic (`error.name` and message)
  - `failedRun` / `recordSyncRun` / `safeRecordSyncRun`, including `result.post_commit_errors` on the new run and on retained history
  - cron success JSON, which spreads the same sanitized refresh result
  - `recordHealth` stored `error`, retained health signals, and the health-write failure log
  - `markFailed` checkpoint `error.json`, alert, and health detail
  - metadata progress `last_error` and validation report `failures` immediately before those ops JSON writes
  - step checkpoint `error`, step failure log, and step JSON response `error`
  - rollback failure log
  - refresh start failure logs, alert text, and the rejected-start response `error`
  - cron lease-release failure log
  - runtime console diagnostics in bootstrap-pointer, search-index, IndexNow, GitHub partial/invalid-node warnings, view-schema parse logs, and the Worker queue consumer
  - GitHub HTTP error bodies, redacted in full before the constructor bound
  - legacy sync-run history that omits `post_commit_errors`
- Known secrets come from the live Worker env and from stale `process.env` when those maps differ. An explicit `env` option stays hermetic.
- Every nonempty known secret is redacted. Bearer credentials of any nonempty length are redacted. Patterns run on the full string, then the result is truncated.
- Username-only URL userinfo and quoted token assignments are redacted.
- Tests use synthetic canaries and assert those strings are absent from logs, mocked webhook bodies, and stored JSON.
- Note the sanitizer in `docs/OPS.md` where alert and ops diagnostics are described.

## Out of scope

- Refactoring workflow step logic or the storage driver. R2 migration stays in the storage layer. `web/lib/workflows` only changes the call at each sink.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Reading pipeline or web environment files, or any live credential.
- Cloudflare or Vercel API calls, deploys, or requests against production hosts.

## Acceptance

- A canary placed in an error string does not appear in the alert log, the mocked webhook JSON, sync-run JSON, checkpoint JSON, or health JSON.
- The same output still contains the non-secret failure category.
- New tests fail if the sanitizer calls are removed. To see that, make `sanitizeErrorText` return the raw string (`value instanceof Error ? value.message : String(value ?? "")`) and run `bun test lib/observability/sanitize-error.test.ts lib/observability/alert.test.ts lib/observability/health.test.ts lib/cron/sync-runs.test.ts lib/cron/handlers.test.ts lib/workflows/checkpoint.test.ts lib/workflows/runtime/step-route.test.ts lib/workflows/rollback-route.test.ts lib/workflows/start.test.ts lib/workflows/steps/metadata.test.ts lib/workflows/steps/validate-sink.test.ts lib/data/bootstrap-pointer-cache.test.ts lib/search-index-route.test.ts lib/indexnow.test.ts lib/github-diagnostics.test.ts lib/data/parse-view.test.ts --isolate` from `web/`. The canary assertions fail. Restore the function afterward.
- The static job and the fixture production build from `AGENTS.md` pass in a fresh detached worktree.
- No `bun.lock` churn is committed.
