# Astro P2: repository pages and curve endpoint

## Goal

Port the existing repository experience to Astro on `feat/astro-site`, with
unchanged URLs, data contracts, appearance, localized copy and cache semantics.

## Scope

- Own `astro/src/packages/p2/`, repository page entries, `/repo-curve`, repository
  social images and `astro/tests/p2/`.
- Import existing dictionaries, schemas, normalization, chart and Star components.
  Read only through shared `withPublishedReaders` and the unchanged web readers.
- Preserve aliases, missing/invalid paths, daily provenance, structured data,
  metadata and the share/copy controls as small interactive islands.
- Compare three fixture repositories in seven locales, desktop and mobile.
- Make only minimal additive shared changes required for page-specific social
  metadata and exact curve publication-failure bytes; document them.

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

## Review round 1 integration

Merge the current `feat/astro-site` base containing P7 before re-verification.
Resolve only the shared host response conflict: retain P7's API operation
wrapper, authentication responses, page-only header rules and unwrapped
publication failures, alongside P2's curve headers and exact failure bytes.
Keep every integrated P7 route and test. Re-run the complete exact-head local
gates, both packages' actual Worker checks, P2 page/API parity and sampled
screenshots. Update the existing PR and confirm GitHub reports it mergeable.
No other package behavior, data, deployment or delivery policy changes.

P1 landed while the first review-fix verification was running. Merge its current
base as well. Reuse P1's integrated image plugin, Layout inputs and Wasm loader;
remove the superseded P2 image bridge instead of registering two renderers.
Preserve both P1's not-found exports and P2's pathname bridge. Include the P1
actual Worker page/image probe in the final new-head checks.

The P2 route probe must preserve P1's real unavailable-period 404 response;
it must no longer expect P0's temporary 200 shell at that ranking URL.
