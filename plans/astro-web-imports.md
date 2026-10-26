# Remaining Astro dependencies on web

F1 direct-import inventory. Extensionless imports resolve to the files below;
type imports are included. The runtime/build list includes Astro config, source
and the build script; the verification list adds local runners and tests.
Imports inside the shared modules remain their existing transitive dependencies.
The `@` alias points at `web/`. The category view plugin loads the existing
localized category view and its routing helper rather than copying either.

## Runtime and build modules

- `web`
- `web/app/(en)/rankings/[year]/[period]/opengraph-image.tsx`
- `web/app/(en)/rankings/[year]/opengraph-image.tsx`
- `web/app/_explore/AnswerCapsule.tsx`
- `web/app/_explore/ArchiveGrid.tsx`
- `web/app/_explore/Breadcrumbs.tsx`
- `web/app/_explore/CompareCurve.tsx`
- `web/app/_explore/FaqBlock.tsx`
- `web/app/_explore/Heatmap.tsx`
- `web/app/_explore/JsonLd.tsx`
- `web/app/_explore/Narrative.tsx`
- `web/app/_explore/PageHero.tsx`
- `web/app/_explore/PaginationNav.tsx`
- `web/app/_explore/PeriodSwitcher.tsx`
- `web/app/_explore/RankingList.tsx`
- `web/app/_explore/RelatedPages.tsx`
- `web/app/_explore/SearchBox.tsx`
- `web/app/_explore/SemanticDataTable.tsx`
- `web/app/_explore/ShareButton.tsx`
- `web/app/_explore/ShareableSnippet.tsx`
- `web/app/_explore/SnippetActions.tsx`
- `web/app/_explore/Star.tsx`
- `web/app/_explore/StarCurve.tsx`
- `web/app/_explore/layout-tokens.ts`
- `web/app/_localized`
- `web/app/_localized/categories.tsx`
- `web/app/_localized/comparison-page-data.ts`
- `web/app/_localized/detail-copy`
- `web/app/_localized/not-found.tsx`
- `web/app/_localized/ranking-category-exits.tsx`
- `web/app/_localized/ranking-page-data.ts`
- `web/app/_localized/routing.ts`
- `web/app/_localized/seo-copy.ts`
- `web/app/api/workflows/refresh/rollback/route.ts`
- `web/app/components/ThemeToggle.tsx`
- `web/app/globals.css`
- `web/app/manifest.ts`
- `web/app/o/org-index-data.ts`
- `web/app/robots.ts`
- `web/cloudflare.config.ts`
- `web/host-contract.mjs`
- `web/lib/client/latest-request.ts`
- `web/lib/compare/conclusions.ts`
- `web/lib/compare/core.ts`
- `web/lib/compare/curve-fetch.ts`
- `web/lib/contracts/index.ts`
- `web/lib/cron/handlers.ts`
- `web/lib/csp.ts`
- `web/lib/data/compare.ts`
- `web/lib/data/core-revalidate-paths.ts`
- `web/lib/data/index.ts`
- `web/lib/data/rank-periods.ts`
- `web/lib/data/search.ts`
- `web/lib/external-url.ts`
- `web/lib/fetch-timeout.mjs`
- `web/lib/format.ts`
- `web/lib/geo-capsules.ts`
- `web/lib/i18n/client.tsx`
- `web/lib/i18n/index.ts`
- `web/lib/i18n/locales.ts`
- `web/lib/i18n/routing.ts`
- `web/lib/jsonld.ts`
- `web/lib/narrative.ts`
- `web/lib/og-card.tsx`
- `web/lib/org-page.ts`
- `web/lib/pagination.ts`
- `web/lib/periods.ts`
- `web/lib/public-params.ts`
- `web/lib/pulse-board-links.ts`
- `web/lib/rank-period-labels.ts`
- `web/lib/ranking-category-exits.ts`
- `web/lib/repo-milestones.ts`
- `web/lib/repo-og.ts`
- `web/lib/repo-page.ts`
- `web/lib/repo-readiness.ts`
- `web/lib/repo-route.ts`
- `web/lib/route-utils.ts`
- `web/lib/runtime-config.ts`
- `web/lib/search-index-response.ts`
- `web/lib/search/core.ts`
- `web/lib/search/index-fetch.ts`
- `web/lib/security.ts`
- `web/lib/seo.ts`
- `web/lib/shareable-snippets.ts`
- `web/lib/sitemap-routes.ts`
- `web/lib/star-history-provenance.ts`
- `web/lib/storage/r2-binding-store.ts`
- `web/lib/template-format.ts`
- `web/lib/theme-script.ts`
- `web/lib/workers-host/cache/policy.ts`
- `web/lib/workers-host/cache/store.ts`
- `web/lib/workers-host/publication-fence.ts`
- `web/lib/workers-host/runtime-env.ts`
- `web/lib/workers-host/shell-routes.ts`
- `web/lib/workflows/publication-cache.ts`
- `web/lib/workflows/runtime/resolve.ts`
- `web/lib/workflows/runtime/step-route.ts`
- `web/lib/workflows/start.ts`
- `web/node_modules/@vercel/og/dist/Geist-Regular.ttf`
- `web/node_modules/@vercel/og/dist/index.edge.js`
- `web/node_modules/vinext/dist/plugins/og-harfbuzz.js`
- `web/public/data/exports/v1`

## Additional verification-only modules

- `web/app/api/cron/daily/route.ts`
- `web/app/api/cron/weekly/route.ts`
- `web/app/api/lang/route.ts`
- `web/app/api/workflows/refresh/revalidate/route.ts`
- `web/app/api/workflows/refresh/start/route.ts`
- `web/app/api/workflows/refresh/step/route.ts`
- `web/app/categories/category-page-data.ts`
- `web/app/repo-curve/route.ts`
- `web/lib/categories/availability.ts`
- `web/lib/categories/rank-pages.ts`
- `web/lib/categories/rules.ts`
- `web/lib/cron/live-publication.ts`
- `web/lib/cron/live-refresh.ts`
- `web/lib/cron/sync-runs.ts`
- `web/lib/data/entity.ts`
- `web/lib/data/source.ts`
- `web/lib/data/write.ts`
- `web/lib/observability/alert.ts`
- `web/lib/observability/health.ts`
- `web/lib/workers-host/queue-advance.ts`
- `web/lib/workflows/cold-start.ts`
- `web/lib/workflows/lease.ts`
- `web/lib/workflows/owned-write.ts`
- `web/lib/workflows/publication-core.ts`
- `web/lib/workflows/publication-invalidation-request.ts`
- `web/lib/workflows/rollback.ts`
- `web/lib/workflows/runtime/execute.ts`
- `web/lib/workflows/runtime/types.ts`
- `web/lib/workflows/steps/whitelist.ts`
- `web/node_modules/next/server.js`
- `web/node_modules/vinext/dist/server/app-route-handler-response.js`
- `web/proxy.ts`
- `web/scripts/fixtures/views`

## Directory inputs and transitive packages

- `web/lib/i18n/index.ts` imports all seven dictionaries in
  `web/lib/i18n/dictionaries/` and their existing
  locale/routing/type helpers: en.ts, ja.ts, zh.ts, zh-tw.ts, ko.ts, es.ts and fr.ts.
  No dictionary is copied or edited.
- `web/public/` is the Astro public directory, including all dated static data
  exports, icons, favicon and service-worker assets. The existing latest-export
  rewrite is baked from its newest dated directory, without duplicating data.
- Tailwind scans `web/app/_explore/` and `web/app/_localized/` plus the explicit
  shared SearchBox, SearchPanel, ThemeToggle, Star, AnswerCapsule, FaqBlock,
  PageHero and RelatedPages sources. `web/app/globals.css` owns the design tokens.
- `web/scripts/fixtures/views/` supplies synthetic data for local verification.
- The image bridge directly uses
  `web/node_modules/vinext/dist/plugins/og-harfbuzz.js`,
  `web/node_modules/@vercel/og/dist/index.edge.js` and
  `web/node_modules/@vercel/og/dist/Geist-Regular.ttf`. Its pinned renderer graph
  provides the existing Satori/Harfbuzz, Yoga and Resvg Wasm/font dependencies;
  Vite packages precompiled Wasm and the font into the Worker. `next/og` imports
  are redirected to that edge renderer. No runtime font service is used.
- The [shell](../workers/gitstarclub-web/src/shell.ts),
  [cron dispatcher](../workers/gitstarclub-web/src/cron-dispatch.ts) and
  [environment types](../workers/gitstarclub-web/src/env.ts) is an additional
  shared operational dependency outside web. The Astro entry reuses it directly.
  The generated cf-build-identity.ts module is replaced by Astro's virtual
  baked-commit module in the Astro build; it is not a runtime filesystem input.

Relocation order and the decision to retain a single shared library are in the
[after-cutover plan](astro-migration.md#after-cutover). Do not delete web before
those moves, equivalent tests, renderer pinning and an independently accepted
cutover are complete.
