# Changelog

Notable changes to gitstarclub. Newest first. Versioning is informal: the running site is always the tip of `main`.

For what is not yet built, see [ROADMAP.md](./ROADMAP.md). For the system as it currently works, start at [README.md](./README.md).

---

## Unreleased

### Added

- **Vercel Web Analytics.** Enabled cookieless aggregate page-view measurement through Vercel Web Analytics and corrected the privacy page copy to reflect that no analytics cookies or personal data are collected.

### Changed

- **Repo-page star milestones use frozen exact crossings.** The per-repo milestone list and curve markers now read `entity/repo.milestones.crossed_10k/50k/100k`; higher thresholds are hidden until a frozen first-crossing field exists, so estimated curve-derived dates are not presented as exact newcomer evidence.

### Fixed

- **Renamed repos no longer 404 on their old URL.** When a tracked repo is renamed or transferred on GitHub (e.g. `facebook/react` → `react/react`), the recurring refresh now accumulates every retained rename delta into a published `lookup/aliases.json`, and the repo route `/[owner]/[name]` issues a 308 permanent redirect from a stale slug to the repo's current `full_name` instead of returning 404. This implements the rename→redirect behavior the docs had long described but the web layer never consumed. New `buildAliases` workflow step (unions all retained `renames.json` deltas → current ids) and `AliasMap` contract; publish validation now rejects aliases that dangle or shadow a live repo.

---

## 0.2.0 — 2026-06-04

Theme: narrative and discovery — make the chronicle easier to find and easier to read.

### Added

- **Multi-repo star-history compare** (`/compare`). URL-as-state overlay of any tracked repos (≥10k stars). Two normalization modes: absolute calendar, and "align to 10k" (each line re-bases to the month it crossed 10,000 stars). Capped at five repos. A thin `/repo-curve?id=` route projects `entity/repo/<id>.json` to a lean payload through the publish pointer; the browser composes the overlay client-side. Three entry points: a nav link, a per-repo "Add to compare" button, and a multi-select toggle on the global `SearchBox`. Pure normalization core in `web/lib/compare/core.ts` (unit-tested). Contract: `CompareCurve`. No new Blob artifact and no new external dependency.
- **Monthly narrative**. Each ranking month renders a one-paragraph en/zh summary built at render time from that month's existing rows (top movers, fastest growth, newcomers). Pure function in `web/lib/narrative.ts`. No AI, no stored artifact.
- **Star-curve inflection detection**. Per-repo changepoint algorithm in `web/lib/workflows/recompute/inflections.ts` (K × six-month rolling median + absolute floor) writes `entity/repo.inflections`; `StarCurve` renders marker points with tooltips. Zero client JS.
- **Shareable cards**. Dynamic OG images for monthly, weekly, and yearly rankings via `next/og`; `ShareButton` (copy-link + X intent) on repo, rankings, and yearly pages.
- **Full-text repo search**. `search/index.json` derived by the recompute (one entry per tracked repo, current count tracks the whitelist). Client-side MiniSearch in `web/app/_explore/SearchBox.tsx`, lazy-loaded on first focus. Served through `/search-index` (server-side reads the versioned artifact, response is CDN-cached via `s-maxage`).
- **Category development spec**. [CATEGORIES.md](./CATEGORIES.md) defines the first finite category taxonomy, deterministic classification rules, generated data artifacts, category routes, sitemap behavior, and phased rollout for language and broader category pages.
- **Category artifact foundation**. The recompute now derives deterministic category rules, `categories/registry.json`, `categories/assignments.json`, `lookup/categories.json`, and bounded all-time category repo stock ranks. Publish validation checks category schemas, single-value assignment invariants, registry references, and sampled category rank membership.
- **Category browsing pages**. `/categories`, `/categories/[dimension]`, and priority language detail pages render registry-driven category navigation, all-time category ranks, canonical metadata, top-nav discovery, and sitemap entries from `lookup/categories.json`.
- **Broader category browsing**. The category index now groups public categories across all registry dimensions; detail static params include public registry categories, and sitemap generation respects per-category `sitemap` eligibility.

### Changed

- The `ai` package and Vercel AI Gateway dependency were removed before launch. The monthly narrative pipeline that briefly used `generateObject` was replaced with the deterministic template above. The project is deliberately AI-free — see [ARCHITECTURE.md](./ARCHITECTURE.md) "Hard constraints" for the rationale.

### Fixed

- Cold-generation 500 on long-tail ISR pages. `resolveVersion()` used `cache: "no-store"` on the publish-pointer fetch, which forced the page from static to dynamic at render time and crashed before the in-memory memo warmed. Switched to a 60s-revalidated fetch (same pointer freshness, static-safe).
- Sitemap discovery now includes the static `/compare` tool page and canonical weekly ranking pages (`/rankings/YYYY/W##`) so on-demand ISR week pages are discoverable without relying only on internal links.
- Sitemap `lastModified` no longer falls back to request/build time when `meta.json` is missing. It resolves from `backfilled_at`, then `generated_at`, then a fixed stable fallback date to avoid crawl-budget churn on exceptional data reads.

---

## 0.1.5 — 2026-06-03

Theme: finish the Vercel-only data lifecycle (folding, garbage collection, alerting, static rendering).

### Added

- **Month and week canonical folds**. Closed periods collapse into stable monthly and weekly shards in `canonical/v2/...`. The read side carries a `folded_through` watermark so it knows which window to read from canonical vs. from the live overlay.
- **Version garbage collection**. The publisher prunes old `views/<run_id>/**` directories behind the publish pointer, keeping the rollback horizon bounded.
- **L3 managed refresh** wired into the weekly cron. Recompute → validate → publish runs end-to-end on Vercel without local involvement.
- **Failure alerts** via `ALERT_WEBHOOK_URL` and a health endpoint covering cron and workflow pipelines.
- **Static page bodies + client-side chrome i18n** (option C). Pages rendered in the default English locale into static HTML, and chrome labels swapped to the then-current preference locale after hydration. Historical note: the current implementation is server-rendered per-locale URL routing with `hreflang`.
- **End-to-end fold→recompute integration test** asserting byte-identical output across the fold seam.

### Fixed

- A handful of long-tail rendering bugs around the gross→net seam and non-monotonic recent points.

---

## 0.1.4 — 2026-06-02 / 06-03

Theme: pure-JS recompute and the publish pointer.

### Added

- **Pure-JS recompute core** in `web/lib/workflows/recompute/` produces ranks, entity shards, heatmaps, and the search index, writing to `views/<run_id>/**` (staged). No engine, no DB.
- **Parity gate** against the DuckDB bootstrap output: 12,899 views, byte-identical, before any publish.
- **Validate step** over the staged shards (Zod schema + invariants like monotonicity, max rank, count thresholds).
- **Atomic publish pointer**: `views/latest.json` → `views/<run_id>/...`. Read side resolves the pointer with a flat-layout fallback when the pointer is missing. Rollback is a single pointer write.
- **Canonical/v2 shards** exported once from the bootstrap (DuckDB), supplying the seed the workflow recompute rebuilds from each run.

---

## 0.1.3 — 2026-06-02

Theme: move recurring work off the laptop and onto Vercel.

### Added

- **Vercel Workflow SDK** (`workflow@4.3.1`) and `web/lib/workflows/refresh.ts` orchestration. `api/workflows/refresh/start` is the cron entry point. Step checkpoints persist to Blob for resumability.
- **Whitelist step** (re-implementing the bootstrap `01-whitelist`).
- **Metadata step**, later split per-bucket to avoid GitHub secondary rate limits. Metadata is seeded from the bootstrap snapshot; GitHub is queried only for newcomers.
- **Rename detection** and newcomer tracking.

### Changed

- Daily and weekly cron jobs run entirely on Vercel (live-overlay refresh). The local cron path is retired.

---

## 0.1.2 — 2026-05-31

Theme: SEO depth and design polish.

### Added

- Per-page **dynamic OG cards** (`next/og`) for repo, rankings, and pulse.
- **JSON-LD structured data** per page type (Dataset, BreadcrumbList, Organization).
- **Breadcrumb trail** with matching `BreadcrumbList` JSON-LD.
- **Localized site footer** on every page; multilingual chrome via `[lang]` segment for en/ja/zh (later superseded by 0.1.5 client preference switching, and then by the current per-locale URL rendering model).
- **Pulse + rankings IA** reorganized into the current structure.

### Changed

- Brand name displayed as "GitStarClub".

---

## 0.1.1 — 2026-05-30

Theme: real data flows end to end for the first time.

### Added

- **Bootstrap pipeline**: `whitelist` (Search adaptive bucketing → `whitelist.json`) → `extract` (BigQuery `WatchEvent` → Parquet) → `metadata` (GraphQL) → `rollup` (DuckDB → `star_daily.parquet`, milestones, daily totals) → `precompute` (DuckDB → JSON views, Zod-validated) → `upload` (Vercel Blob).
- **Web data layer** in `web/lib/data/` reads Blob views with Zod parse + React `cache()`. Placeholder data removed.
- **New page types**: organization (`/o/[login]`), all-time rankings (`/rankings`), weekly rankings, pulse.
- **Zod contracts** in `web/lib/contracts/` — the single source of truth between pipeline and web.

---

## 0.1.0 — 2026-05-28

Theme: project skeleton.

### Added

- Next.js 16 app scaffold with Tailwind 4 and the bun toolchain.
- Material 3 Expressive design system (graphite + amber).
- Coming-soon teaser page (since retired).
- Initial system docs: PRODUCT, ARCHITECTURE, SEO, REQUIREMENTS.
- Domain set to `gitstarclub.com`.
