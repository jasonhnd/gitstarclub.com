# Astro P1: home and rankings

## Goal and scope

Move the existing home and ranking page layer to Astro without changing URLs,
appearance, localized content, data coverage, or publication semantics. Follow
`plans/astro-migration.md` and Product's 2026-10-21 migration specification.
This package targets `feat/astro-site`, overriding the general `pre` target.

P1 owns `astro/src/packages/p1/`, root/localized home and ranking page entries,
and `astro/tests/p1/`. Reuse the existing dictionaries, schemas, rank readers,
live-history selection, availability resolver, presentation components, stars,
and structured-data builders. Preserve PR #690's weekly provenance notes.
The existing site has year/month/week ranking URLs; daily movement is shown
inside monthly pages rather than a separate day route. Do not invent URLs.

Minimal additive shared changes supply native read transport for the unchanged
readers, Layout title/social-image options, missing-route signaling and CSS
source discovery. Document each shared change for integration ordering.

## Out of scope and prohibited actions

No `web/`, data contract, pipeline, publication, translation, coverage, CI,
delivery configuration, existing Worker configuration or deployment changes.
No other package bodies, cockpit migration, production/preview refresh calls,
Wrangler commands, Actions enablement, protected-branch pushes, merges,
force-pushes, branch deletion or shared-branch rebases.

## Steps and acceptance

1. Install frozen dependencies using checksum-verified Node 24.20.0/Bun 1.4.2;
   record the plan and create one issue. Commit this planning step.
2. Port the home, all-time, year, month and week views into P1 routes. Keep
   markup/styles and reader behavior aligned with the existing implementation.
   Limit browser code to existing search/theme and share/copy controls. Commit.
3. Add P1 contract/route tests, seven-locale path samples and a repeatable local
   comparison runner. Compare at least three populated pages against the web
   pre build: status, full visible text, title/meta/canonical/hreflang and
   structured facts. Inspect desktop/mobile screenshot pairs, then delete them.
   Commit code and relevant documentation.
4. On a fresh detached shared clone of the exact head, run full AGENTS bootstrap
   and static/local fixture builds, design lint, Astro checks/tests/actual Worker
   build and route/parity checks. Use the shared toolchain cache and shared Bun
   install cache; all other artifacts remain in this card's temporary directory.
5. Push only this card branch and open one PR into `feat/astro-site`, including
   `Closes #N`, tested SHA, commands/results, shared changes and limitations.
   Remove temporary clones/builds/screenshots after recording evidence, confirm
   clean Git status, report final temporary-directory size and hand off for
   independent review. No executor merge or final owner acceptance.
