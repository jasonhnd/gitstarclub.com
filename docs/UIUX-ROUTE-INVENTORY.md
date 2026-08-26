---
owner: frontend / docs
status: active
last_reviewed: 2026-08-22
source_of_truth_for:
  - route and source inventory
---

# UI/UX Route Inventory

This is the sole maintained route/source inventory. It is verified against the
current Next.js App Router tree. Rendering policy belongs to
[FRONTEND.md](./FRONTEND.md), endpoint contracts belong to [API.md](./API.md),
and historical planning deltas do not override this inventory.

English canonical URLs are unprefixed. Non-default locales use a first path
segment prefix for the same canonical route: `ja`, `zh`, `zh-TW`, `ko`, `es`,
and `fr`. The default English prefix `/en/*` is not canonical and `web/proxy.ts`
redirects it to the unprefixed URL.

## Route Inventory

| Family | Actual URL pattern | Sample URL | Defining file(s) | Render mode | Localized variants | Sitemap inclusion | Data source / loader |
|---|---|---|---|---|---|---|---|
| Home | `/` | `/` | `web/app/(en)/page.tsx`, `web/app/(localized)/[locale]/page.tsx`, `web/app/_localized/pulse.tsx` | Static (`revalidate=false`) | `/{locale}` | Yes, canonical path `""` in `web/lib/sitemap.ts` and every locale sitemap | `PulsePageView`: `getHotSnapshot()`, `getReposLookup()`, recent weekly `getRank("week", ..., "repo", "flow")`; Blob views `hot-snapshot.json`, `lookup/repos.json`, live/base rank views |
| Pulse | `/pulse` | `/pulse` | `web/app/(en)/pulse/page.tsx`, `web/app/(localized)/[locale]/pulse/page.tsx`, `web/app/_localized/pulse.tsx` | Static (`revalidate=false`), refreshed by cron invalidation | `/{locale}/pulse` | Yes, `/pulse` in `web/lib/sitemap.ts` | Same as Home, without the home-only `WebSite` JSON-LD |
| All-time rankings | `/rankings` | `/rankings` | `web/app/(en)/rankings/page.tsx`, `web/app/(localized)/[locale]/rankings/page.tsx`, `web/app/_localized/rankings.tsx` | Static (`revalidate=false`) | `/{locale}/rankings` | Yes, `/rankings` in `web/lib/sitemap.ts` | `getAllTime("repo")`, `getAllTime("org")`, `getReposLookup()`, `getOrgsLookup()`; Blob views `rank/all-time/repo/stock.json`, `rank/all-time/org/stock.json`, `lookup/repos.json`, `lookup/orgs.json` |
| Year ranking detail | `/rankings/{year}` | `/rankings/2026` | `web/app/(en)/rankings/[year]/page.tsx`, `web/app/(localized)/[locale]/rankings/[year]/page.tsx`, `web/app/_localized/ranking-detail.tsx` | Static with on-demand params (`dynamicParams=true`, `revalidate=false`); current year is prebuilt | `/{locale}/rankings/{year}` | Yes, all years from `FIRST_YEAR` through current UTC year | `getRank("year", year, "repo", "flow")`, `getHeatmap("year", year)`, `getReposLookup()`; Blob views `rank/year/{year}/repo/flow.json`, `heatmap/year/{year}.json`, `lookup/repos.json` |
| Month ranking detail | `/rankings/{year}/{month}` | `/rankings/2026/6` | `web/app/(en)/rankings/[year]/[period]/page.tsx`, `web/app/(localized)/[locale]/rankings/[year]/[period]/page.tsx`, `web/app/_localized/ranking-detail.tsx` | Static with on-demand params (`dynamicParams=true`, `revalidate=false`); current month is prebuilt | `/{locale}/rankings/{year}/{month}` | Yes, months from `FIRST_YEAR` through the current UTC month | `getRank("month", YYYY-MM, "repo", "flow" / "growth" / "new")`, `getHeatmap("month", YYYY-MM)`, `getReposLookup()`; live overlay can override current month |
| Week ranking detail | `/rankings/{year}/W{week}` | `/rankings/2026/W27` | `web/app/(en)/rankings/[year]/[period]/page.tsx`, `web/app/(localized)/[locale]/rankings/[year]/[period]/page.tsx`, `web/app/_localized/ranking-detail.tsx` | Static with on-demand params (`dynamicParams=true`, `revalidate=false`); current week is prebuilt | `/{locale}/rankings/{year}/W{week}` | Yes, valid ISO weeks through the current UTC ISO week | `getRank("week", YYYY-W##, "repo", "flow")`, `getReposLookup()`; live overlay can override current week |
| Category index | `/categories` | `/categories` | `web/app/(en)/categories/page.tsx`, `web/app/(localized)/[locale]/categories/page.tsx`, `web/app/_localized/categories.tsx` | ISR (`revalidate=86400`) | `/{locale}/categories` | Yes, `/categories` in `web/lib/sitemap.ts` | `getCategoryRegistry()`, `getMeta()`; Blob views `categories/registry.json`, `meta.json` |
| Category dimension | `/categories/{dimension}` | `/categories/language` | `web/app/(en)/categories/[dimension]/page.tsx`, `web/app/(localized)/[locale]/categories/[dimension]/page.tsx`, `web/app/_localized/categories.tsx`, `web/app/categories/category-page-data.ts` | ISR (`dynamicParams=true`, `revalidate=86400`); dimensions are prebuilt from `CATEGORY_DIMENSIONS` | `/{locale}/categories/{dimension}` | Yes for registry dimensions when category lookup is present; `/categories/language` is also in the base sitemap path list | `getCategoryRegistry()`, `getMeta()`, `findDimension()`; Blob views `categories/registry.json`, `meta.json` |
| Category detail | `/categories/{dimension}/{slug}` | `/categories/language/python` | `web/app/(en)/categories/[dimension]/[slug]/page.tsx`, `web/app/(localized)/[locale]/categories/[dimension]/[slug]/page.tsx`, `web/app/_localized/categories.tsx`, `web/app/categories/category-page-data.ts` | ISR (`dynamicParams=true`, `revalidate=86400`); details are generated on demand | `/{locale}/categories/{dimension}/{slug}` | Yes when `lookup/categories.json` category has `sitemap !== false` | `getCategoryRegistry()`, `getCategoryAllTimePage(dimension, slug, 1)`, `getReposLookupDaily()`, `getMeta()`; Blob views `rank/category/{dimension}/{slug}/all-time/repo/stock.json`, `lookup/repos.json`, `categories/registry.json` |
| Category detail pagination | `/categories/{dimension}/{slug}/page/{page}` | `/categories/language/python/page/2` | `web/app/(en)/categories/[dimension]/[slug]/page/[page]/page.tsx`, `web/app/(localized)/[locale]/categories/[dimension]/[slug]/page/[page]/page.tsx`, `web/app/_localized/categories.tsx`, `web/app/categories/category-page-data.ts` | ISR (`dynamicParams=true`, `revalidate=86400`); page 1 redirects to canonical detail URL | `/{locale}/categories/{dimension}/{slug}/page/{page}` | Yes for category pages where `sitemap !== false`, using `CATEGORY_DETAIL_PAGE_SIZE` | `getCategoryAllTimePage(dimension, slug, page)`; Blob views `rank/category/{dimension}/{slug}/all-time/repo/stock/page/{page}.json` for page 2+ |
| Repository detail | `/{owner}/{name}` | `/react/react` | `web/app/(en)/[locale]/[owner]/page.tsx`, `web/app/(localized)/[locale]/[owner]/[name]/page.tsx`, `web/app/_localized/repo.tsx`, `web/lib/repo-route.ts`, `web/lib/repo-page.ts` | ISR (`dynamicParams=true`, `revalidate=86400`); repo params are generated on demand. The English file's parameter names intentionally align with the localized tree while its two URL segments still mean owner/name. | `/{locale}/{owner}/{name}` | Yes for every repo in `lookup/repos.json` | `getRepoIdByFullNameDaily()`, `getAliasMapDaily()`, `getReposLookupDaily()`, `getRepoEntityDaily(id)`, `getCategoryAssignments()`, `getCategoryRegistry()`, `getMeta()`; Blob views `lookup/repos.json`, `lookup/aliases.json`, `entity/repo/{id}.json`, `categories/assignments.json`, `categories/registry.json`, `meta.json` |
| Organization index | `/o`, `/o/page/{page}` | `/o`, `/o/page/2` | `web/app/(en)/o/page.tsx`, `web/app/(en)/o/page/[page]/page.tsx`, `web/app/(localized)/[locale]/o/page.tsx`, `web/app/(localized)/[locale]/o/page/[page]/page.tsx`, `web/app/_localized/org-index.tsx`, `web/app/o/org-index-data.ts` | ISR (`revalidate=3600`); English page 2+ params are generated from org count, localized pagination is on demand | `/{locale}/o`, `/{locale}/o/page/{page}` | Yes when `lookup/orgs.json` is present, including pagination | `getOrgsLookup()`; Blob view `lookup/orgs.json` |
| Organization detail | `/o/{login}` | `/o/vercel` | `web/app/(en)/o/[login]/page.tsx`, `web/app/(localized)/[locale]/o/[login]/page.tsx`, `web/app/_localized/org.tsx` | ISR (`dynamicParams=true`, `revalidate=86400`); org params are generated on demand | `/{locale}/o/{login}` | Yes for every login in `lookup/orgs.json` | `getOrgEntityDaily(login)`, `getReposLookupDaily()`, `getMeta()`; Blob views `entity/org/{login}.json`, `lookup/repos.json`, `meta.json` |
| Compare | `/compare` with optional client state `?repos={owner/name,...}` | `/compare?repos=facebook/react,vuejs/vue` | `web/app/(en)/compare/page.tsx`, `web/app/(localized)/[locale]/compare/page.tsx`, `web/app/_localized/compare.tsx`, `web/app/compare/CompareClient.tsx` | Static shell (`dynamic="force-static"`, `revalidate=false`) | `/{locale}/compare`; query state is preserved client-side | Yes for `/compare` only; query combinations are not enumerated | Server: `getMeta()`, `getRepoIdByFullName()`, `getRepoCurve()` for curated pairs. Client: `/search-index` and `/repo-curve?id={id}` |
| About | `/about` | `/about` | `web/app/(en)/about/page.tsx`, `web/app/(localized)/[locale]/about/page.tsx`, `web/app/_localized/about.tsx` | Static (`revalidate=false`) | `/{locale}/about` | Yes, `/about` in `web/lib/sitemap.ts` | `getMeta()` plus static dictionary copy and public export links; Blob view `meta.json` |
| Privacy | `/privacy` | `/privacy` | `web/app/(en)/privacy/page.tsx`, `web/app/(localized)/[locale]/privacy/page.tsx`, `web/app/_localized/privacy.tsx` | Static (`revalidate=false`) | `/{locale}/privacy` | No, `web/lib/sitemap.ts` does not include `/privacy` | Static dictionary copy only |
| Cockpit spike (pre) | `/cockpit` | `/cockpit` | `web/app/(en)/cockpit/page.tsx`, `web/app/(en)/cockpit/CockpitClient.tsx`, `web/lib/cockpit/**` | Static (`dynamic="force-static"`, `revalidate=false`); client island for the timeline/radar | English only in this spike; `/{locale}/cockpit` is not implemented | **No.** Hard `robots: noindex`. Not in `web/lib/sitemap.ts`. Not in chrome nav | Posed in-repo frames (`web/lib/cockpit/posed-frames.ts`). No Blob / rank / entity reads |

## Public Endpoints And Metadata Routes

| Family | Actual URL pattern | Sample URL | Defining file(s) | Render mode | Localized variants | Sitemap inclusion | Data source / loader |
|---|---|---|---|---|---|---|---|
| Sitemap index | `/sitemap.xml` | `/sitemap.xml` | `web/app/sitemap.xml/route.ts`, `web/lib/sitemap-routes.ts`, `web/lib/sitemap.ts` | Cached route handler (`revalidate=86400`, `s-maxage=86400`) | One index for all locales | It is the sitemap index | Reads `lookup/repos.json`, `lookup/orgs.json`, `lookup/categories.json`, `meta.json`, then emits one locale sitemap URL per locale |
| Locale sitemaps | `/sitemap-{locale}.xml` | `/sitemap-ja.xml` | `web/app/sitemap-en.xml/route.ts`, `web/app/sitemap-ja.xml/route.ts`, `web/app/sitemap-zh.xml/route.ts`, `web/app/sitemap-zh-TW.xml/route.ts`, `web/app/sitemap-ko.xml/route.ts`, `web/app/sitemap-es.xml/route.ts`, `web/app/sitemap-fr.xml/route.ts`, `web/lib/sitemap-routes.ts`, `web/lib/sitemap.ts` | Cached route handlers (`revalidate=86400`, `s-maxage=86400`) | One file per locale | Each file contains localized URLs and `hreflang` alternates | Same sitemap data as the index; `buildLocaleSitemapEntries()` localizes the canonical path set |
| Search index JSON | `/search-index` | `/search-index` | `web/app/search-index/route.ts`, `web/lib/data/search.ts` | Dynamic route handler with CDN cache (`s-maxage=3600`, stale while revalidate 86400) | None; `web/proxy.ts` ignores it | No | `getSearchIndex()`; Blob view `search/index.json`; descriptions are truncated before response |
| Repo curve JSON | `/repo-curve?id={id}` | `/repo-curve?id=10270250` | `web/app/repo-curve/route.ts`, `web/lib/data/compare.ts` | Dynamic route handler with CDN cache (`s-maxage=3600`, stale while revalidate 86400) | None; `web/proxy.ts` ignores it | No | `getRepoCurve(id)` projects `entity/repo/{id}.json` into the compare curve payload |
| Language redirect | `/api/lang?lang={locale}&next={path}` | `/api/lang?lang=fr&next=/rankings` | `web/app/api/lang/route.ts`, `web/lib/i18n/routing.ts`, `web/lib/route-utils.ts` | Dynamic redirect route handler | Redirect target uses localized path | No; `/api/*` is disallowed by robots when indexing is enabled | Validates locale, sets `gsc_lang`, normalizes `next` via `safeInternalRedirectPath()` and `stripLocale()` |
| Deployment identity | `/.well-known/deployment` | `/.well-known/deployment` | `web/app/.well-known/deployment/route.ts` | Dynamic public route; `Cache-Control: no-store` | None; `web/proxy.ts` ignores it | No | Returns the current Vercel commit SHA and immutable deployment URL from platform metadata; no Blob access |
| Default OG image | `/opengraph-image` | `/opengraph-image` | `web/app/opengraph-image.tsx`, `web/lib/og-theme.ts` | ISR image route (`revalidate=86400`) | None; `web/proxy.ts` ignores OG image paths | No | Static OG theme constants |
| Repo OG image | `/{owner}/{name}/opengraph-image` | `/react/react/opengraph-image` | `web/app/(en)/[locale]/[owner]/opengraph-image.tsx` | ISR image route (`revalidate=86400`) | No localized OG file currently exists for repo pages | No | `getRepoIdByFullNameDaily()`, `getRepoEntityDaily(id)`; Blob views `lookup/repos.json`, `entity/repo/{id}.json` |
| Ranking year OG image | `/rankings/{year}/opengraph-image` | `/rankings/2026/opengraph-image` | `web/app/(en)/rankings/[year]/opengraph-image.tsx` | ISR image route (`revalidate=86400`) | No localized OG file currently exists | No | `getRankDaily("year", year, "repo", "flow")`, `getReposLookupDaily()` |
| Ranking period OG image | `/rankings/{year}/{period}/opengraph-image` | `/rankings/2026/6/opengraph-image` | `web/app/(en)/rankings/[year]/[period]/opengraph-image.tsx` | ISR image route (`revalidate=86400`) | No localized OG file currently exists | No | `getRankDaily("month" or "week", period, "repo", "flow")`, `getReposLookupDaily()` |
| Robots | `/robots.txt` | `/robots.txt` | `web/app/robots.ts`, `web/lib/robots-policy.ts` | Static metadata route, environment-sensitive | None; `web/proxy.ts` ignores it | No | `SITE_INDEXABLE` controls preview disallow vs public allow rules; when public, advertises `/sitemap.xml`, allows retrieval/search crawlers plus `*`, disallows `/api/`, and blocks listed bulk/training crawlers |
| Web app manifest | `/manifest.webmanifest` | `/manifest.webmanifest` | `web/app/manifest.ts` | Static metadata route | None | No | Static manifest metadata and icon paths |
| llms.txt | `/llms.txt` | `/llms.txt` | `web/public/llms.txt`, generated/validated by `web/lib/llms.ts` and `web/lib/llms.test.ts` | Static public asset | None | No; it is a curated discovery file, not a sitemap replacement | Checked-in Markdown with curated links to core data surfaces and methodology docs |
| RSS / Atom | Not present | N/A | No `app/**/route.ts` or public asset for RSS/Atom was found | N/A | N/A | No | N/A |

## Operational Route Sources

These routes are not public navigation surfaces, but they are part of the
maintained source inventory. Authentication, request, response, and cache
semantics remain in [API.md](./API.md).

| Route | Defining file | Role |
|---|---|---|
| `/api/cron/daily` | `web/app/api/cron/daily/route.ts` | Daily immutable live generation |
| `/api/cron/weekly` | `web/app/api/cron/weekly/route.ts` | Weekly immutable live generation |
| `/api/workflows/refresh/start` | `web/app/api/workflows/refresh/start/route.ts` | Start managed refresh |
| `/api/workflows/refresh/revalidate` | `web/app/api/workflows/refresh/revalidate/route.ts` | Authenticated post-publish invalidation callback |
| `/api/workflows/refresh/rollback` | `web/app/api/workflows/refresh/rollback/route.ts` | Fenced rollback to a retained view version |

## Sitemap Source Of Truth

Sitemap generation is centralized in `web/lib/sitemap.ts` and
`web/lib/sitemap-routes.ts`.

- `/sitemap.xml` is an index, not a URL list. It points to the seven locale
  sitemap files: `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, and `fr`.
- Each locale sitemap receives the same canonical path set. English outputs
  unprefixed URLs; non-default locales output prefixed URLs via
  `localizedPath(locale, canonicalPath)`.
- The path set includes `/`, `/pulse`, `/rankings`, historical year/month/week
  ranking pages, `/categories`, category dimensions, public category details
  and pagination, all repo details from `lookup/repos.json`, `/o`, org index
  pagination, all org details from `lookup/orgs.json`, `/compare`, and `/about`.
- `/privacy`, `/search-index`, `/repo-curve`, `/api/lang`, OG image routes,
  `robots.txt`, `manifest.webmanifest`, `llms.txt`, and RSS/Atom are not in the
  sitemap.
- Category sitemap eligibility is data-driven: a category is included unless
  `lookup/categories.json` marks it with `sitemap: false`.

## Roadmap Vs Reality Delta

| Assumed | Status | Actual |
|---|---|---|
| Repo detail is `/repo/{owner}/{name}` or another `/repo/...` namespace | MISMATCH | Repo detail is `/{owner}/{name}`. Files are `web/app/(en)/[locale]/[owner]/page.tsx` and `web/app/(localized)/[locale]/[owner]/[name]/page.tsx`; the English parameter names intentionally align with the localized route tree. |
| Org detail is `/org/{login}` | MISMATCH | Org detail is `/o/{login}`. Files are `web/app/(en)/o/[login]/page.tsx` and `web/app/(localized)/[locale]/o/[login]/page.tsx`. |
| There is no org index route family | MISMATCH | `/o` and `/o/page/{page}` are public route families with `revalidate=3600`; they are included in the sitemap when `lookup/orgs.json` is present. |
| Route files live directly under the old pre-split App Router tree | MISMATCH | Public page files are split into the `(en)` and `(localized)/[locale]` route groups, with shared implementations in `web/app/_localized/*.tsx`. Root handlers remain under `web/app/*/route.ts` or metadata files. |
| Localized routes use old shapes like `/{lang}/{year}` or `/{lang}/{year}/{month}` | MISMATCH | Localized ranking routes keep the canonical route family under the locale prefix: `/{locale}/rankings/{year}` and `/{locale}/rankings/{year}/{month or W##}`. |
| Weekly rankings have a separate top-level week namespace | MISMATCH | Weekly rankings share the ranking detail route: `/rankings/{year}/W{week}`. The `[period]` segment dispatches month vs week by `W` prefix. |
| All-time repo and org rankings are separate public paths such as `/rankings/org` or `/rankings?metric=org` | MISMATCH | `/rankings` renders both all-time repo and org rankings. Sitemap lists only `/rankings`. |
| Compare has pair-specific server routes | MISMATCH | `/compare` is the only compare page. Selected repos are client URL state in `?repos=...`; the sitemap includes only `/compare`. |
| Compare can load arbitrary GitHub repos | MISMATCH | Current `/compare` is limited to tracked repos in the precomputed search index. Arbitrary repo compare is still backlog work in `docs/ROADMAP.md`. |
| Category browsing is only `/categories/{dimension}/{slug}` | MISMATCH | Category browsing has `/categories`, `/categories/{dimension}`, `/categories/{dimension}/{slug}`, and `/categories/{dimension}/{slug}/page/{page}`. |
| Sitemap is a single URL list route or future Next metadata shards like `/sitemap/pages.xml`, `/r/sitemap/...`, `/o/sitemap/...` | MISMATCH | Current implementation is `/sitemap.xml` as an index plus `/sitemap-{locale}.xml` route handlers. Builders live in `web/lib/sitemap.ts` and `web/lib/sitemap-routes.ts`. |
| `llms.txt` is generated by a runtime route | MISMATCH | `/llms.txt` is a static file at `web/public/llms.txt`; `web/lib/llms.ts` and tests validate the content. |
| RSS/Atom feed endpoint exists | MISMATCH | No RSS or Atom route/static asset is present. |
| Home and `/pulse` are separate visual/data surfaces | MATCH WITH DETAIL | Both route families render `PulsePageView`; `/` passes `includeWebsiteLd` and uses canonical path `/`, while `/pulse` uses canonical path `/pulse`. |
| Privacy is a public localized route | MATCH WITH DETAIL | `/privacy` and `/{locale}/privacy` exist, but they are not currently included in the sitemap. |
| Search index is a public endpoint | MATCH | `/search-index` exists and returns CDN-cached JSON from `search/index.json`; it is not localized and not in the sitemap. |
| OG image endpoints are present | MATCH WITH DETAIL | Default, repo, year, and ranking-period OG image routes exist. Current concrete OG files are under root and `(en)` route groups; localized OG files are not defined. |
