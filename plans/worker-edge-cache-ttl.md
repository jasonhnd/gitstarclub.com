# Worker edge cache storage TTL

## Goal

Give eligible Worker cache entries an independent storage lifetime of one hour.

## Scope

- Add optional EDGE_CACHE_TTL environment types, strict positive integer parsing,
  a 3600-second fallback, and the existing 86400-second storage cap.
- Preserve response eligibility, request bypass rules, and client cache policy.
- Cover storage defaults, overrides, invalid values, restored HIT policy, and
  actual imported build identity in host tests.
- Update the R2 cutover runbook with weekly cache invalidation requirements.

## Out of scope

No wrangler configuration changes, commits, deployment, production access,
secret reads, or changes to cache keys and request exclusions.

## Acceptance

The requested web lint, application and test typechecks, and isolated workers-host
suite pass. Run the full offline web library suite and documentation lint as well.

## Verification results

Used checksum-verified Node v24.20.0 and Bun 1.3.14 in a clean environment.
Bun environment-file loading was disabled; live suites were not enabled.

- `cd web && bun run lint`: passed with 16 warnings and no errors.
- `cd web && bun run typecheck`: passed.
- `cd web && bun run typecheck:tests`: passed.
- `cd web && bun test lib/workers-host --isolate`: 68 passed, zero failed.
- Full offline `bun test lib/ --isolate`: 1779 passed, 49 skipped, 18 failed.
  Failures are in coverage CLI output assertions and local server startup for
  R2 data tools and workerd binding tests; no edge cache tests failed.
- `bun run lint:docs`: failed in the unchanged CF CI gates test because its
  child process returned no expected stdout.
- `bun scripts/check-docs.mjs`: passed.
- `git diff --check`: passed.

No commits, deployment, production access, or secret reads were performed.
