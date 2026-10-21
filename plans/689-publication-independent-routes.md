# Publication-independent Worker routes (#689)

## Goal

Keep routes that do not consume published data available when the R2 publication
pointers cannot be read, while preserving the serving fence for data-dependent
pages and endpoints. This follows the nonblocking P2 review of PR #684.

## Scope

- Audit every shell, bypass, and API route and record the publication decision in
  the host documentation.
- Explicitly allow the language redirect and publication invalidation callback
  to enter the application without the page/data cache publication scope.
- Keep data-dependent requests, including requests with cookies, authorization,
  range headers, or non-GET methods, on the existing publication-fenced path.
- Add Worker-entry regressions for the real language redirect during pointer
  failure, the invalidation callback, and fail-closed page/data routes.
- Run the complete local gate on the exact final commit, then open one PR into
  `pre` with `Closes #689` and hand off to the independent reviewer.

## Out of scope

No new pages, data coverage, UI changes, security-header/CSP changes, deployment,
Wrangler invocation, live cron/refresh calls, Cloudflare configuration or object
changes, CI/workflow changes, protected-branch pushes, force-pushes, branch
removal, shared-branch rebases, or PR merges. GitHub Actions stays disabled.

## Acceptance

- `/api/lang` returns the correct same-origin locale redirect and preference
  cookie without reading R2 pointers or using the shared page/data cache.
- The authenticated revalidation callback does not acquire a serving publication;
  its authentication and invalidation behavior stay in its existing handler.
- Every page and data-dependent endpoint still fails closed with 503 if its
  authoritative publication cannot be read, even when shared page caching is
  bypassed. Security headers retain `script-src 'self' 'unsafe-inline'`.
- Each bypass/API route has an explicit documented decision.
- Checksum-verified Node v24.20.0 and Bun 1.4.2 bootstrap passes. A single fresh
  detached shared clone of the exact head passes the full offline AGENTS.md
  static gate, fixture `build`, `build:pre`, and `build:production`, each with
  matching `validate:host`. `cf:dry-run` is skipped by owner order.
- Use the shared toolchain and Bun caches as ordered. Remove the verification
  clone and temporary outputs after recording results; report final card size.
