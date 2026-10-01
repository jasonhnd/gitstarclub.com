# Issue 606: align bounded GitHub retries and validate upload options

## Goal

Close code-health proposal E03 (findings P01, P02, P03, P06, L06). GitHub clients reject non-OK responses before they read a payload, use one bounded retry policy, and upload retries reject bad rate or retry settings. Tests call the real helpers and clients with an injected fetch. No page looks different.

## Scope

1. `pipeline/lib/github.mjs`: named attempt and page limits aligned with `web/lib/github.ts`. Retry 403, 429, and 5xx at most four extra times. Cap Retry-After and reset waits at 60 seconds and ignore non-finite header values. Backoff stays capped at 30 seconds. Reject non-OK GraphQL and REST status with a diagnostic of at most 200 characters. Require a GraphQL `data` object and a `nodes` array. Drop unused `batchStargazerCounts`. Callers can pass `fetcher` and `sleep`. The token is read when a request is made.
2. `pipeline/lib/github.test.mjs` (new): injected fetch and sleep. Covers 400, 401, 403, 429, 5xx, invalid GraphQL data, valid empty data, and retry exhaustion. `globalThis.fetch` is restored and must not run.
3. `pipeline/lib/upload-retry.mjs`: `maxPerSec` must be a finite number greater than 0. `retries` must be a finite nonnegative integer. Retry only the documented set (408, 429, 500, 502, 503, 504, plus timeout and socket failures). 400, 401, and 403 fail on the first attempt.
4. `pipeline/lib/upload-retry.test.mjs`: bad settings throw before any attempt. Status and exhaustion cases go through `withUploadRetry`.
5. `web/lib/github.ts`: export the existing pure delay helpers and the named limits. Pass optional `fetcher` and `sleep` through the real GraphQL and Search clients. Default transport and delays stay the same.
6. `web/lib/github.test.ts`: delete the private-helper replicas. Call the exported helpers and the real clients with injected fetch.

## Out of scope

- Push to `main`, `pre`, or `preview`. Merge. Force-push. Deleting branches or files outside this list.
- Cloudflare or Vercel API calls, `wrangler deploy`, `wrangler versions upload`, and any real bucket or GitHub request.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- CSP, the language switcher, the `Star` component, and `resolveAvailableRankPeriods`.
- A new shared module. Pipeline scripts run under Node and cannot import `web/lib/github.ts`, so the same policy is copied and locked by tests.
- `bun.lock` changes.

## Acceptance

- Injected-fetch tests exercise the real policy for 400, 401, 403, 429, and 5xx, invalid GraphQL data, valid empty data, bad rate and retry settings, and retry exhaustion. They make zero real service calls.
- Removing the non-OK reject, the 60 second cap, the upload option checks, or the retryable-status check makes those new tests fail.
- The AGENTS.md static job, fixture production build, and `cf:dry-run` pass in a fresh detached worktree.
