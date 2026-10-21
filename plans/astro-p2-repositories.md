# Astro P2: repository pages and curve endpoint

## Goal

Port the existing repository experience to Astro on `feat/astro-site`, with
unchanged URLs, data contracts, appearance, localized copy and cache semantics.

## Scope

- Own `astro/src/packages/p2/`, repository page entries, `/repo-curve`, repository
  social images and `astro/tests/p2/`.
- Import existing dictionaries, schemas, normalization, chart and Star components.
  Read published base views through P0's request-scoped read-only facade.
- Preserve aliases, missing/invalid paths, daily provenance, structured data,
  metadata and the share/copy controls as small interactive islands.
- Compare three fixture repositories in seven locales, desktop and mobile.
- Make only minimal additive shared changes required for page-specific social
  metadata and preservation of non-HTML endpoint cache headers; document them.

## Out of scope and prohibitions

Do not change `web/`, data coverage, pipeline, publication, dictionaries, design
tokens, other packages, CI or deployment configuration. No deployment, Wrangler,
live cron/refresh, merge, force push, protected-branch push or Actions enablement.
The migration plan clarifies that the old English `[locale]/[owner]` parameters
represent owner/name; no new single-segment owner page is introduced.

## Acceptance

- All three fixture repositories return HTTP 200 in all seven locales, with
  strict full-page status/text/metadata/canonical/hreflang/JSON-LD parity.
- Desktop/mobile screenshot pairs show unchanged layout; delete images after
  inspection and retain the findings only.
- `/repo-curve` keeps exact payload bytes, status and cache headers, including
  invalid and absent IDs. Aliases remain 308 and invalid/missing pages 404.
- Body/chart HTML is server-rendered; hydrate only existing interactive controls.
- Design lint reports zero errors. Astro checks, tests and actual Worker build
  pass. The complete AGENTS bootstrap/static/local-build blocks pass on a fresh
  detached clone of the exact final commit, using owner-ordered shared caches.
- One issue and one PR into `feat/astro-site`, with `Closes #N`, commands/results,
  shared-file changes and limitations. Independent review performs acceptance.
