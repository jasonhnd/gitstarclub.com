# Astro P6: static pages and indexes

## Goal

Port the existing About, Privacy and index endpoints to Astro with identical
URLs, localized copy, metadata, structured data and layout. Target the dedicated
`feat/astro-site` integration branch under the owner's migration exception.

## Scope

- P6-owned page entries, server-rendered package components, endpoint wrappers,
  route lists and tests under `astro/`.
- Reuse dictionaries, presentational components, sitemap builders, published
  ranking-period resolution and search response generation from `web/`.
- Preserve eight global sitemap URLs, robots.txt, manifest.webmanifest and
  search-index. About and Privacy have seven locale variants.
- Minimal additive shared fetch alias, response-cache handling, presentational
  style sources and smoke assertion updates needed for faithful Worker parity.

## Out of scope

No web edits, new copy, data coverage, publication/writer changes, cockpit,
page-level social cards (neither static page defines one), shared default social
card, deployment, Wrangler, Actions changes, protected-branch pushes or merges.
Shared default social media and production activation remain integration work.

## Steps

1. Install frozen dependencies, inventory existing routes and commit this plan.
2. Port page bodies and endpoints with package-owned tests and documentation;
   commit the completed implementation.
3. Verify the exact head in one fresh detached shared clone. Run the complete
   AGENTS bootstrap/static/build gates, Astro checks/tests/build, design lint,
   full-page and response parity, and desktop/mobile screenshots. Delete the
   screenshots after recording comparison results.
4. Push only this card branch, open one PR into `feat/astro-site` with an issue
   closing reference and full verification, clean scratch artifacts, and hand
   off to an independent reviewer. Do not merge or claim final acceptance.

## Acceptance

All 14 localized page URLs and the global endpoints return HTTP 200 on the
fixture. Compare About and Privacy across all locales plus a representative
index response (at least three sampled URLs); status, visible text, title/meta,
canonical/hreflang, JSON-LD and response bodies must match the unchanged web
build. Desktop/mobile screenshots retain layout. The package runner also compares
body element geometry and computed layout on three representative URLs. Body components add no client
JavaScript; only existing shared search/theme islands hydrate. Design lint has
zero errors. Full offline web/pipeline gates, both local web build modes and
Astro verification pass on the exact committed head; cf:dry-run is skipped by
owner order. Record any shared-shell limitations honestly for review.
