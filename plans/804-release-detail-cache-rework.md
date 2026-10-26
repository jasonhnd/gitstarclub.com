# Issue 804 / PR 815: release detail cache rework

## Goal

Keep newly appended releases visible at the same detail URL in all seven locales.

## Scope

Round 2 changes only the Worker regression ID and this plan. Use
`managed-2026-10-25`, which contains no `refresh` substring, at the same detail
URL before and after append in all seven locales. Keep the existing
`["list", "detail"]` host policy and both `x-gsc-cache: BYPASS` assertions.

## Out of scope

Other route cache policies, UI changes, deployment, secrets, branch changes,
repository copies, screenshots and generated artifacts.

## Acceptance

The same localized detail URL returns 404 before append and 200 with the release
id after append; both responses report `x-gsc-cache: BYPASS`. Other routes keep
their existing cache behavior. Run the requested preview build, full Worker checks
and full Astro tests, plus the full web suite. Keep temporary files inside the
repository and deliver one small commit on the current branch.

## Regression evidence

The original Worker test used an ID containing `refresh`, which independently
bypasses the page cache. It therefore passed with the old `["list"]` policy.
Also, the host only caches HTTP 200 responses, so the 404-before/200-after status
pair alone does not prove that the old cache hid an append. The corrected test
checks explicit detail-route bypass through the `BYPASS` headers, using an ID
that does not match the generic refresh bypass.

Round 2 acceptance also requires temporarily restoring `["list"]`, rebuilding,
and observing the corrected regression fail, then restoring `["list", "detail"]`,
rebuilding, and passing the requested complete Worker and Astro suites. The
policy mutation must not be committed.

## Round 2 verification

Ran in place on `ib/gsc-804-r2` with Node 24.21.0 and Bun 1.4.2; scratch
output and fresh Playwright Chromium profiles stayed in `.kanban-work/804-r2`.
No repository copy or branch switch was used.

- Temporarily changed the host set to `["list"]`, ran `build:pre`, then
  `bun test worker-checks/releases.test.ts --timeout 30000 -t 'release detail URLs bypass'`:
  failed at `/releases/managed-2026-10-25`, expected `BYPASS`, received `MISS`.
- Restored `["list", "detail"]` and reran the root/Astro frozen installs and
  `build:pre`: passed. The host file has no final diff.
- Full `bun run test:worker -- --timeout 30000`: 11 passed, zero failures,
  including the corrected same-URL regression in all seven locales. Initial
  runs timed out in unrelated browser checks; the complete rerun passed in a
  clean environment with `DEBUG=pw:api`.
- Full Astro `bun run test`: 386 passed, zero failures.
- Full web `bun run test:cov` with live checks disabled: 2,204 passed, 49 skipped,
  zero failures; line coverage 90.18%, function coverage 90.74%.
- `bun run lint:docs`: still blocked by the same eight pre-existing unresolved
  performance-script references in unrelated plans listed below.

Only this plan and the regression test are included in the round 2 commit.

## Previous round verification

These results describe round 1 only. Its same-URL Worker result did not distinguish
the old cache policy for the reasons above.

Verification ran in place on `ib/gsc-804-r1`, without copying the repository or
switching branches. Temporary files, logs and fresh Chromium profiles stayed in
`.kanban-work/804`; browsers used the preinstalled Playwright Chromium binaries.
Runtime: Node 24.21.0 and Bun 1.4.2; the runtime contract assertion passed.

- Requested root/Astro frozen installs and `build:pre`: passed after installing
  the existing web dependencies required by the Astro configuration.
- Full `test:worker -- --timeout 30000`: 11 passed, including the original, insufficient
  missing-record/append test in all seven locales.
- Full Astro `test`: 386 passed.
- Astro typecheck and preview host validation: passed (15 existing hints).
- Full web coverage suite: 2,204 passed, 49 skipped, zero failures; line coverage
  90.18%, function coverage 90.74%. The first run needed the existing pipeline
  dependencies installed; the complete rerun passed.
- Pipeline tests: 205 passed.
- Web lint, all three typechecks and view validation: passed (14 existing lint
  warnings).
- Web dependency audit, host graph and CI gate assertions: passed.
- Documentation lint: blocked by eight existing unresolved references to moved
  performance scripts in unrelated plans for issues 760, 779, 781 and the Astro
  baseline.
- Pipeline dependency audit: existing high-severity advisories for transitive
  `undici@6.28.1` and `zod@4.1.11`; dependencies and lockfiles unchanged.

No deployment, secret access, repository copy, branch change or remote write.
No screenshots or generated artifacts are included in the commit.
