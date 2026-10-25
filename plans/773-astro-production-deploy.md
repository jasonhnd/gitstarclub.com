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
