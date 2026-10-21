# Astro P7 backend API migration

## Goal

Preserve the seven existing operational endpoint contracts while moving their
framework entrypoints to Astro on `feat/astro-site`.

## Scope

- Add daily/weekly cron, language, and refresh start/step/revalidate/rollback
  endpoints under `astro/src/pages/api/` and adapters under `src/packages/p7/`.
- Reuse the existing cron, workflow, authentication, storage, lease and publication
  code by import. Preserve status, headers, redirects and response bytes.
- Use the P0 language helper and await the P0 page invalidation hook. Adapt
  Next's deferred task scheduling to the Worker's request lifetime.
- Port operational tests and compare old/new responses with local fixtures only.
- Document P7 behavior, local commands and remaining integration boundaries.

## Out of scope

No changes to `web/`, data coverage, data contracts, production/preview resources,
secrets, schedules, CI, deployment configuration or other packages. No live
operational requests, Wrangler, deployments, merge or protected-branch push.
This package adds no HTML pages, visual changes or client JavaScript; page
screenshots, document metadata and seven localized API copies do not apply.
Language switching is compared for all seven locales instead.

## Steps

1. Read the Product specification and P0 conventions, install frozen dependencies,
   create the issue and commit this plan.
2. Implement thin endpoints and framework adapters; commit the completed port.
3. Port the existing tests and add byte-level old/new and built-Worker checks;
   commit tests and package documentation.
4. Verify the exact committed head in one clean detached shared clone: complete
   AGENTS bootstrap/static/fixture builds, design lint and Astro local verification.
5. Push only this card branch and open one PR into `feat/astro-site` with
   `Closes #N`, commands/results and explicit limitations. Clean temporary output
   and hand off for independent review. Do not merge.

## Acceptance

- All seven route entrypoints retain their original methods, auth checks,
  idempotency, lease fencing, JSON and redirects using deterministic local tests.
- Start and step keep their deferred HTTP chain/queue semantics. Revalidation
  awaits both existing data-cache invalidation and Astro path invalidation.
- Language GET/HEAD and authenticated revalidation do not require a readable
  publication pointer, matching PR #691; other operational routes keep the
  existing host publication fence and are never replayed after mutation.
- Old/new comparisons cover at least three endpoint families, including every
  route, seven language choices, malformed/unauthorized requests and success.
- Full `web/` coverage suite, static gates, fixture production/pre builds, design
  lint, Astro typecheck/tests/build and actual Worker checks pass on the head.
- Working tree is clean and the PR is ready for a different-model reviewer.
