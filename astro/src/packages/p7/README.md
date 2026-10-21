# P7 operational endpoints

The unprefixed endpoints preserve their existing public methods and contracts:

| Path | Method | Implementation |
| --- | --- | --- |
| `/api/cron/daily` | GET, implicit HEAD | Existing daily live refresh handler |
| `/api/cron/weekly` | GET, implicit HEAD | Existing weekly live refresh handler |
| `/api/lang` | GET, implicit HEAD | P0 language helper, seven locale choices |
| `/api/workflows/refresh/start` | GET, implicit HEAD | Existing managed refresh start and runtime resolver |
| `/api/workflows/refresh/step` | POST | Existing step executor and successor headers |
| `/api/workflows/refresh/revalidate` | POST | Existing data invalidation plus awaited P0 page hook |
| `/api/workflows/refresh/rollback` | POST | Existing framework-independent rollback route |

`OPTIONS` returns 204 with the original sorted `Allow` header; other recognized
unsupported methods return 405 and unrecognized methods return 400, as in the
existing vinext route dispatcher. API responses retain the original security
and private/no-store headers. No localized API copies or HTML pages are added.
There are no new client islands or client JavaScript.

## Framework boundary

`operations.ts` imports the existing authentication, leases, refresh and
publication code instead of copying it. Rollback already uses standard Request
and Response, so its existing route function is imported directly. Start/step
replace Next's `after(task)` registration with the official adapter's
`locals.cfContext.waitUntil` to keep deferred HTTP successor tasks alive. Queue
consumer successor behavior and runtime configuration remain shared.

P0's host captures publication for operational routes and never retries their
mutations. Only language GET/HEAD and revalidation POST bypass pointer reads,
matching PR #691. Revalidation authenticates first, clears the existing pointer
memo/data cache tags, then awaits Astro invalidation of the same core paths.
Long-tail pages retain the existing lifetime policy; no new tail purge is added.
The P0 `invalidatePaths` hook remains available for explicit invalidation.

Minimal shared P0 corrections required for public response parity:

- `astro/src/lib/routing.ts`: preserve the original cookie's expiry, attribute order,
  casing and production-only Secure flag. The old framework removes its
  internal middleware cookie header before returning the public response.
- `astro/src/lib/host.ts`: preserve the API header set and original pointer-outage
  response body while retaining the skeleton's page indexing policy.
- [astro/scripts/local-worker.ts](../../../scripts/local-worker.ts): optional synthetic text bindings for local tests;
  existing callers and defaults are unchanged. No Worker config changes.
- `astro/tests/routing.test.ts`: match the original cookie casing/environment rules.

## Verification

Run all commands with checksum-verified Node 24.20.0/Bun 1.4.2, a clean environment,
card-local TMPDIR=KANBAN_TMP and no owner environment files, as in root AGENTS.md.

```bash
cd astro
bun run verify:local
GSC_P7_WORKER_TEST=1 bun test tests/p7/worker.test.ts
```

The ordinary suite ports the complete cron handler, workflow start, workflow step
and rollback-route tests. `astro/tests/p7/parity.test.ts` compares original handlers
with the new route entrypoints: status, every public response header and every
body byte, with a fixed clock and no network. It also compares deferred HTTP
successors and tests awaited invalidation/error propagation. The original
vinext response finalizer removes internal framework headers from the baseline.
The built-Worker suite verifies every endpoint, methods, real auth/bindings,
real cache invalidation and publication-pointer outage behavior.

After the full AGENTS fixture pre build and Astro build in the detached clone:

```bash
bun tests/p7/http-parity.ts
```

This compares the actual two built hosts on loopback for all seven endpoints,
all seven language choices, implicit HEAD/OPTIONS and unsupported methods. The
report is `KANBAN_TMP/p7-http-parity.json`. It compares application headers and
body bytes, normalizing only the different loopback origin in Location and
excluding documented HTTP transport framing/compression/server timestamps.
Cookie expiry is compared byte for byte; a second-boundary mismatch is retried.
It sends no authenticated operational HTTP requests. Success/lease/publication
branches use the isolated in-process comparison and synthetic Worker bindings.

P7 has no document body, metadata, structured data, layout or responsive UI.
Page screenshot comparison and the page-only seven-locale HTTP-200 criterion
therefore do not apply. Language switching is covered for all seven locales;
API success/error statuses are preserved instead of changed to 200.
Full web/static/fixture production/pre gates and root design lint still apply.
No deployment, live cron/refresh request, resource/secret/schedule change,
Wrangler command, Actions enablement or merge is part of verification.
