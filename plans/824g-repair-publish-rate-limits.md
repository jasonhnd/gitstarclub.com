# Issue #824 follow-up: repair publisher rate limits

## Goal

Keep the guarded repair publisher safe and resumable when the pinned Cloudflare
CLI rejects requests with HTTP 429.

## Scope

- Inspect the installed `cf@1.0.0-beta.18` error renderer.
- Add shared, bounded retries with injectable waiting, jitter, and wait logs.
- Recheck exact-key presence, size, and SHA-256 before retrying a put.
- Use the same bounded upload concurrency for recovery and staging, defaulting to four.
- Add fake-runner regression tests and update the operations runbook.

## Out of scope

Bucket access, credentials, deployment, branch changes, pushes, production
operations, and changes to CI or deployment configuration.

## Acceptance

- Only an authoritative HTTP 429 status triggers retries, including boxed and
  ANSI-colored errors; other statuses mentioning 429 fail immediately.
- Retry the same call at most six times, honoring an exposed Retry-After value
  or a 30-second fallback, plus small jitter; log key, attempt, and wait seconds.
- Before every put retry, an identical existing object completes the call,
  different bytes refuse it, and proven absence permits resending.
- Recovery and staging uploads are bounded with a default concurrency of four.
- Fake-runner tests cover retries, conflicts, exhaustion, and timing without
  real waits. Run the requested pipeline suite and full web coverage suite,
  plus applicable static checks, on this branch without copying the repository.

## Verification

Implemented in `3cd3b48`, with the test environment fixture corrected in
`b47c16c`. The owner's current workspace and branch instructions override the
detached-copy verification workflow. All work remained on `ib/gsc-824g`.

- Inspected the pinned CLI's `Gr` API error renderer and `blocks.l` box renderer:
  the authoritative status is the final box line; response headers are omitted.
- Shared retries cover target identity reads, recovery/control operations, and
  staging. Put retries recheck exact-key presence and compare byte size and
  SHA-256; tests also cover ambiguous listings and local file changes.
- Recovery and staging default to four uploads; a shared child-call limiter
  also bounds lease-renewal calls. The pipeline staging pool now stops scheduling
  after failure and drains in-flight workers before returning, with a regression
  test preventing lease release from racing unfinished uploads.
- Ran the owner's frozen-install, complete pipeline test, and complete web
  coverage command with `KANBAN_TMP` and `TMPDIR` set to the requested directory.
  Pipeline: 209 passed, zero failed. Web: 2,508 passed, 49 skipped, zero failed
  across 224 files. Coverage gate passed: 90.49% lines and 91.06% functions.
- Runtime assertion passed with Node v24.21.0 and Bun 1.4.2. Lint passed with
  14 warnings in unchanged files. All three typechecks, view fixture validation,
  host graph validation, and CI configuration assertions passed.
- Production and pre builds and matching host validations passed on `b47c16c`:
  234 routes and 467 artifacts each. Static typechecks were run with generated
  Worker type output temporarily excluded to match the static-before-build CI
  order; generated build artifacts were restored afterward.
- Full static verification remains blocked by existing issues: both dependency
  audits report high-severity advisories for transitive undici 6.28.1 and zod
  4.1.11; documentation checks report ten unresolved performance-script
  references across five unchanged plans. Dependency locks and those plans
  were not changed.

No browser, credentials, bucket access, deployment, push, or branch switch was
used. Logs are in the requested temporary directory. No product UI changed.
