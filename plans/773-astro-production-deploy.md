# Guarded Astro production deployment entry point

## Goal

Add an owner-run production deployment entry point that accepts only a reviewed, clean, exact-commit, non-fixture production artifact and reuses existing production resources.

## Scope

- Inspect the production Worker's GSC_CACHE binding using read-only pinned cf commands and record the result.
- Add production stamp, resource, indexing, trigger, route and KV guards with tests.
- Reuse the self-contained prebuilt deployment directory and pinned cf 1.0.0-beta.18 with provisioning disabled.
- Expose root and Astro deploy:production scripts and update docs/ASTRO-HOST.md.
- Verify the complete Astro suite, static checks and the production build artifact without invoking deployment.

## Out of scope

Deployment, Cloudflare writes, namespace creation, schedule activation, route/DNS/secret changes, CI changes, branch switches and repository copies. Work stays on the current branch in ~/w, as explicitly required by the owner; verification runs here with a clean environment instead of a detached copy.

## Acceptance

- Only production, non-fixture, exact-HEAD builds from a clean checkout are accepted.
- Production Worker, DATA/R2, queue, public data origin, read driver, indexing and existing KV identity are enforced.
- Exactly one production queue trigger, no schedules and no routes are accepted.
- Host validation runs before deployment and cf receives a real directory with --prebuilt --mode production --no-provision.
- Tests cover valid production configuration and each required refusal.
- Full Astro tests and local production build/host validation pass; the production guard is checked without executing deployment.
- Missing production KV or unavailable read-only account access is reported explicitly; no namespace is created or guessed.

## Verification evidence

Implementation is committed as 8abffa7; cec7c05 only corrects a documentation link.
Checks use checksum-verified Node v24.20.0 and Bun 1.4.2, clean environments,
and card-local output under .kanban-work/gsc-773. No environment files were
copied and no live-test opt-ins were enabled.

- Astro full suite: 348 passed, zero failed. Tests include production configuration with an explicitly synthetic KV ID, preview/config/trigger/resource/indexing refusals, missing KV, fixture/stale stamps, dirty checkout statuses, and real deployment-directory copying in both modes. The synthetic ID is never written to the host contract or build artifact.
- Astro typecheck and dependency graph: passed, zero type errors.
- Production build without fixture variables and production host validation: passed at cec7c05. The stamp records production mode, fixture false and the exact commit. Validation confirms empty schedules, production resources, indexing, content security policy, packaged fonts and identity; 18 aggregate-import guard cases also pass.
- Local production artifact guard: refuses the missing production GSC_CACHE ID. This is an acceptance blocker, not a successful deployability check. No ID was guessed or inserted into the artifact.
- Web lint, all three typechecks, dependency graph, generated-view fixtures, runtime contract and Cloudflare configuration gates: passed.
- Web full coverage suite: 2,172 passed, 49 skipped, zero failed; coverage gate passes with 90.05% lines and 90.70% functions.
- Pipeline full suite: 205 passed, zero failed. Web dependency audit passes.
- Both web build modes and matching local host validators: passed, each validating 234 routes and 467 artifacts.
- Documentation validation still fails on four existing references in plans/760-astro-preview-deploy-guard.md and plans/astro-accept-1-baseline.md, referring to performance scripts as root scripts. This card introduces no remaining reference error.
- Pipeline dependency audit still fails on two existing high-severity advisories: undici 6.28.1 (GHSA-xjj6-f33q-929c) and zod 4.1.11 (GHSA-mrhx-c7xc-m3w5). Dependency changes are outside this card.

Final-head production build, host validation and the guard-only check run again
after committing this evidence; the guard must remain blocked until the actual
production KV binding is resolved and pinned in reviewed source.

## Read-only production KV investigation and delivery blocker

The installed cf package is exactly 1.0.0-beta.18. Its read-only `cf auth whoami`
returns `authenticated: false` with `Not logged in`. No Cloudflare credential
is available in the sandbox environment. Therefore the namespace currently
bound to gitstarclub-web cannot be determined here. This does not establish
that the production Worker has no namespace. The current reviewed production
contract still declares GSC_CACHE without an ID, and the new entry point
deliberately refuses it. Authenticated read-only inspection and pinning the
same existing namespace remain unfinished; if inspection establishes that no
binding exists, stop and report instead of creating one.

GitHub CLI also reports no authentication. Changes remain committed on
ib/gsc-773; no push or pull request was possible. A draft pull request body is
prepared in the card-local scratch directory and explicitly reports these
blockers. No deployment, Cloudflare write call, resource creation, schedule,
route, production data, secret, CI configuration, branch switch or repository
copy was performed.
