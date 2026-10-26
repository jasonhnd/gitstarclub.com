---
owner: frontend
status: active
last_reviewed: 2026-10-22
source_of_truth_for:
  - rendering strategy
  - component catalog
  - data access layer
  - i18n implementation
---

# GitStarClub frontend

`astro/` is the current integrated page layer: Astro 7.4.1, React 19.3.1,
TypeScript 6 and Tailwind 4. The official Cloudflare adapter hosts server HTML
with small interactive islands. [ASTRO-HOST.md](ASTRO-HOST.md) owns build, resource,
cache and delivery details. This describes source, not a deployed cutover.
`web/` remains the unchanged vinext comparison host and shared-code dependency;
Next.js 16.4.2 remains its types/lint compatibility dependency.
See [the migration plan](../plans/astro-migration.md),
[DESIGN.md](../DESIGN.md), [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md),
[DATA-CONTRACTS.md](DATA-CONTRACTS.md), [API.md](API.md) and [SEO.md](SEO.md).

## Routes and rendering

English is prefixless; ja, zh, zh-TW, ko, es and fr keep their existing prefixes.
The public route families are unchanged:

| Package | Routes | Source under astro/src/packages/ |
| --- | --- | --- |
| P1 | `/`, `/rankings`, `/rankings/{year}`, `/rankings/{year}/{month or Wweek}` | `p1/` |
| P2 | `/{owner}/{name}`, `/repo-curve`, repository social image | `p2/` |
| P3 | `/categories`, dimension, category and category pagination | `p3/` |
| P4 | `/o`, `/o/page/{page}`, `/o/{login}` | `p4/` |
| P5 | `/compare`, `/pulse` | `p5/` |
| P6 | `/about`, `/privacy`, eight sitemaps, `/search-index` | `p6/` |
| P7 | `/api/lang`, daily/weekly cron and refresh start/step/revalidate/rollback | `p7/` |

Thin page entries choose the route locale and render package bodies inside
`src/layouts/Layout.astro`. Unknown pages return 404. `/cockpit` is deferred:
its implementation remains in `web/` and Astro returns 404. Shared default
`/opengraph-image`, robots and manifest endpoints remain available.
Production is indexable; pre emits noindex in HTML, headers and robots.
Language links retain `/api/lang?lang=...&next=...`, cookie serialization,
same-origin redirect protection and ordinary full-document navigation.

The Worker captures the publication once, scopes data readers to it and owns
all shared HTML caching. Core pages use publication-specific keys. Long tails
render on first visit, stay fresh seven days and can serve stale for one day.
Core GET/HEAD output is buffered and checked for publication races before
serving; mutations are never replayed, including the legacy cron and refresh-start
GET/HEAD handlers. Read-only API cache bypass does not waive that check. P7 awaits explicit invalidation after publication. See the host document
for pointer-outage behavior, exceptions and operational dispatch.

## Shared data and deterministic output

Astro imports the existing `web/lib/contracts/` schemas, `web/lib/data/` readers,
normalization, availability, SEO and presentation helpers. The native DATA
facade reads precomputed R2 views; `withPublishedReaders` preserves the existing
base/bootstrap/live-generation choices and schema checks within that scope.
Only an absent native object becomes HTTP 404. A present JSON `null` remains a
successful transport read so the shared schema checks reject malformed data
without trying older generations or treating it as unavailable preview history.
It never replaces global fetch or copies secrets into process.env. No database,
runtime AI, live search, data-coverage expansion or alternate writer is added.
Rankings still join ids against lookup data; dictionaries translate interface
copy while repository names, descriptions, numbers and dates stay authoritative.

Available ranking links and sitemaps use `resolveAvailableRankPeriods`, including
published week/month discovery and bounded fallback rules. They never derive
availability from the wall clock. Categories retain registry filtering,
contiguous pagination and canonical page-1 redirects. Curves preserve historical
provenance; aggregate daily counts are never appended to cumulative monthly totals.
Near-zero client JavaScript does not mean client-side fetching of page facts.
Rankings, lists, descriptions, capsules, FAQ, breadcrumbs and structured facts
are already present in the server HTML.

## Components and client islands

The existing design tokens, classes and static React presentation components
remain shared. Astro imports `web/app/globals.css`; Tailwind scans the reused
components. Both font families are locally packaged. Material accent stays
amber `#F2A900`; all data stars use the existing `Star` component. Responsive
navigation uses native details/summary controls, and SVG/DOM data charts remain
server-rendered. CSP stays `script-src 'self' 'unsafe-inline'`.

| Surface | Browser behavior |
| --- | --- |
| Shared shell | Existing SearchBox and ThemeToggle React islands; native language menu |
| Home, all-time rankings, categories, directories, About/Privacy | Static server body; no body hydration |
| Year/month/week rankings | Small native share/snippet controls; tables stay server HTML |
| Repository | Native share/snippet controls; StarCurve stays static SVG |
| Organization detail | Existing ShareButton and SnippetActions islands |
| Compare | CompareClient/CompareCurve island; same-origin `/search-index` and `/repo-curve`, URL selection, popstate, cancellation/retry and scroll preservation |
| Pulse | Static server body, including deterministic narrative and structured data |

Search still lazy-loads a precomputed index and runs MiniSearch inside a browser
Worker. It performs no live server search. Compare selection remains shareable
through `?repos=...`. P5 integration has no old-host API proxy. Share/snippet copy
retains feedback and embed behavior. Do not hydrate page bodies or add islands
without the existing design-system exception policy.

## Localization, metadata and verification

The seven dictionaries remain import-only under `web/lib/i18n/dictionaries/`.
Route locale selects shell, body, metadata, FAQ and JSON-LD on the server;
canonical URLs and hreflang/x-default keep the existing localized matrix.
`Layout.astro` uses each page's resolved summary date for the footer. Home and
Pulse prefer snapshot metadata, then weekly and monthly ranking metadata.
All-time rankings prefer repository and organization ranking metadata, then
snapshot metadata. Year and period rankings prefer that period's ranking
metadata. Category index and dimension pages prefer the category registry
timestamp, then global metadata. Category detail pages prefer the category
ranking timestamp, then the registry, then global metadata. Pages without a
resolved summary date fall back to global metadata. The same localized date
formatter serves summaries and footers.
`Layout.astro` owns social defaults; package repo/ranking endpoints reuse the
existing deterministic 1200 x 630 renderer and packaged fonts/Wasm.

Use the complete AGENTS exact-head offline block, Astro `verify:local`, audit,
every package runner, both host modes and whole-site local crawl. Compare all
seven locales at desktop/mobile sizes against the retained host using one
fixture. Report all text, metadata and structured-fact differences. Product
appearance remains unchanged; independent review and owner acceptance precede
merge/cutover. Shared imports and renderer dependencies are inventoried in the
migration plan before any eventual removal of `web/`.

Astro release details at `/releases/<id>` use the shared layout and seven-locale
release copy. Publication details, repository counts, layer dates and available
public record links render on the server. They add no client island or page
script. Previous-version links and language switching preserve the release path.

About this data citations identify the publication date, matching the metadata row.
The footer separately describes the date through which data was updated.
