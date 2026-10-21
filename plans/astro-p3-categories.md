# Astro P3: category pages

## Goal and scope

Migrate the existing category index, dimension, detail and detail pagination
pages to Astro, including all seven locales, without changing URLs, appearance,
localized copy, published-data contracts or coverage. Base this package on
`feat/astro-site` and open one issue and one PR against that integration branch.

## Implementation

1. Install checksum-verified Node 24.20.0 / Bun 1.4.2 dependencies. Reuse the
   existing category server views and pure components through a package-scoped
   build adapter, replacing only their data reads, navigation errors and chrome.
   Keep localized copy import-only rather than duplicating it into Astro.
2. Add explicit root/localized category entries and request-scoped native R2
   reads through P0's captured-publication facade. Preserve sparse pagination,
   canonical page-one redirects, private/unknown 404s, metadata and JSON-LD.
3. Add package tests, fixture route coverage and full-page parity tooling.
   Compare at least three representative pages in all locales at desktop/mobile
   sizes, inspect screenshots, record the result and delete the images.
4. Commit each completed step. Verify the exact head in one fresh detached
   shared clone; publish the branch and PR, then hand off for independent review.

## Boundaries

Only P3 package/pages/tests and this plan are owned here. A small additive Vite
plugin registration is needed to import the unchanged category views with
request-scoped readers; disclose that shared configuration change in the PR.
Do not edit `web/`, dictionaries, locks, pipeline, Worker configuration, CI or
other packages. No merge, deployment, Wrangler, live refresh, remote resource
write, protected-branch push or data expansion is authorized. Cockpit is out of
scope. GitHub Actions stays disabled.

## Acceptance

- Four route families work in every locale; invalid/private/unpublished routes
  retain their original status and page-one redirects remain permanent.
- Same-fixture status, visible text, title/meta, canonical/hreflang and JSON-LD
  match the current web host for index, dimension, detail and pagination samples.
- Desktop/mobile screenshot comparisons preserve the existing layout. Images
  are temporary and deleted after inspection, without committing or attaching.
- Category body HTML adds no browser JavaScript. Existing shared search/theme
  islands retain their original purpose.
- Root design lint has zero errors; full Astro checks/tests/build and the full
  AGENTS bootstrap/static/local builds pass at the exact delivered commit.
  Use shared toolchain/Bun caches, an isolated offline fixture and card-local
  artifacts. Skip cf:dry-run by owner order. Record commands/results in the PR.
- Leave Git clean and remove disposable clones, logs, builds and screenshots.
  Handoff includes files, verification, risks, exact SHA and final scratch size.
