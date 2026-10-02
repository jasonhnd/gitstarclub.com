# Bound cache-invalidation and preview POSTs (#614)

## Goal

The two Worker stub POSTs must stop if the request or its response body does not finish. A successful call still sends the same headers and JSON body. HTTP failure messages stay the same. Nothing calls Cloudflare or Vercel.

## Scope

- `web/lib/cache-invalidation/cf-stub.ts`: bound `CfStubCacheInvalidation` POST, including the body read after a 2xx response. Default deadline is 15 seconds, the same bound as the preview identity GET. Tests can pass `deadlineMs`.
- `web/lib/preview/cf.ts`: bound `invalidateCfPreviewHotPaths` the same way, including `response.json()`. Optional third argument `deadlineMs`.
- `web/lib/cache-invalidation/cache-invalidation.test.ts` and `web/lib/preview/preview.test.ts`: injected never-settling request and body, plus the existing success payload checks.

## Out of scope

- Preview identity GET. It already passes `AbortSignal.timeout(15_000)` and swallows probe failures.
- Docs, CI workflows, `.delivery.yml`, Worker wrangler config, and any file not listed on the issue.
- Deploys, Cloudflare or Vercel API calls, and real buckets.
- Page appearance.

## Acceptance

- An injected fetch that never settles rejects with `TimeoutError`, and the `AbortSignal` passed to fetch is aborted.
- An injected 2xx body that never settles rejects the same way. The body cancel hook runs when the response exposes one.
- A non-OK status still throws `CF cache-invalidation stub -> <status>` or `CF Preview hot-path invalidate -> <status>` without waiting on the body.
- Successful requests still send `content-type`, Access headers, `Authorization` when a secret is set, and the same JSON envelope.
- Removing the deadline wrapper makes the new abort tests fail within about half a second (they treat a still-pending call as a failure).
- The static job in `AGENTS.md` passes in a fresh detached worktree of the pull request head.
