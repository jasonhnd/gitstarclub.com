---
owner: product / requirements
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - product baseline
  - project scope and constraints
  - repository and view counts
---

# gitstarclub requirements baseline

## Scope

This document is the **single baseline** of product requirements——defining "what to build". All structural disputes, new-feature proposals, and definition adjustments align here first. "How to build it" is spread across the layer documents: architecture [ARCHITECTURE](./ARCHITECTURE.md), data operations [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md), contract [DATA-CONTRACTS](./DATA-CONTRACTS.md), bootstrap pipeline [PIPELINE](./PIPELINE.md), ranking definitions [RANKING](./RANKING.md), frontend [FRONTEND](./FRONTEND.md), design system [DESIGN-SYSTEM](./DESIGN-SYSTEM.md), SEO [SEO](./SEO.md), operations [OPS](./OPS.md), testing [TESTING](./TESTING.md); the UX navigation narrative is in [INFORMATION-ARCHITECTURE](./INFORMATION-ARCHITECTURE.md). Unbuilt features and blocked decisions are in [ROADMAP.md](./ROADMAP.md).

## 0. Requirement IDs / priority / traceability matrix

Requirement ID is the stable key for traceability across BRD/PRD/FSD/UX/testing. When adding or adjusting a core capability, first register in this section the ID, priority, user story, and acceptance criteria, then cite the same ID into the product, frontend, data-contract, and test documentation.

### 0.1 Core requirement catalog

| ID | Priority | User story | Testable acceptance criteria | Owning docs / implementation / tests |
|---|---|---|---|---|
| `REQ-CHRONICLE-001` | P0 | As a developer or researcher, I want year/month/week/repo/org/all-time history pages, so that I can replay GitHub star history from stable snapshots. | Valid historical URLs return `200`, canonical to themselves, read values from the same `views/<version>` rank/heatmap/entity views, and completed periods do not change after daily cron. See `P0-AC1`, `P0-AC3`. | Requirements §3/§6; Product core pages; Frontend §1/§2; Data Contracts §2.3/§2.5-§2.7; Testing §1/§4. |
| `REQ-PULSE-001` | P0 | As a returning visitor, I want today's and this week's movers plus revival/spike signals, so that I can see what is changing now. | `/` and `/pulse` use the latest successful `hot-snapshot.json` / `current_month.json`, daily cron records success in `ops/sync-runs.json`, and locale pulse URLs render the same data freshness. See `P0-AC2`, `P0-AC3`. | Requirements §3/§6; Product `/pulse` and home; Frontend `PulseView` and cron refresh; Data Contracts §2.8-§2.10; Testing §1.5 and live-refresh tests. |
| `REQ-RANKING-001` | P0 | As a reader comparing projects or organizations, I want a consistent ranking matrix and derived growth/new lists, so that every leaderboard has a clear metric and scope. | Week/month/year/all-time rank files exist for repo/org flow/stock where required; derived month/year repo `growth` and `new` files obey floor, dedupe, sort, rank-continuity, and top-N rules. See `P0-AC4`. | Requirements §4; Product ranking definitions; Frontend ranking pages; Data Contracts §2.3-§2.4; Testing §1.1-§1.5. |
| `REQ-I18N-001` | P0 | As a non-English visitor, I want locale-specific URLs, metadata, and chrome, so that search engines and readers get the correct language without changing data fields. | English uses unprefixed canonical URLs; ja/zh/zh-TW/ko/es/fr use prefixed canonical URLs; `<html lang>`, `hreflang`, sitemap entries, metadata, and language switcher links agree. See `P0-AC3`. | Requirements §9; Product i18n; Frontend §1.2/§7; Data fields remain language-neutral; Testing §4.1 and i18n/SEO tests. |
| `REQ-DATAOPS-001` | P0 | As an operator, I want recurring data jobs to run inside Vercel with validation gates, so that production does not depend on local machines or unpublished data. | Daily/weekly cron and refresh Workflow are scheduled in `web/vercel.json`; recurring jobs write live artifacts and workflow validation artifacts; only `ok=true` cuts `views/latest.json`; production recurring paths do not require GCP, DuckDB, or Parquet. See `P0-AC6`. | Requirements §8/§8a/§11; Architecture and Vercel Data Operations; Frontend cron routes; Data Contracts §2.11-§2.13; Testing §1.5. |
| `REQ-PERF-001` | P0 | As a high-volume reader, I want static, low-JS pages with explicit performance budgets, so that the site can serve CDN-scale traffic. | Key pages meet CWV targets, content HTML stays under 20KB, content pages avoid non-whitelisted client JS, and repeat requests hit CDN/ISR instead of GitHub/API/database/workflow paths. See `P0-AC5`. | Requirements §7; Product visual stance; Frontend §2/§4; Testing §5 and planned browser/render gates. |
| `REQ-SEARCH-001` | P1 | As a visitor who knows a repo name, I want global search in the top chrome, so that I can jump directly to tracked repositories and add results to comparison. | First focus lazy-loads versioned `search/index.json`; prefix/fuzzy search is star-weighted; results link to `/{owner}/{name}`; selected rows can create `/compare?repos=...`; no `/search?q=` page is required. | Requirements §3; Product discovery entry; Frontend `SearchBox` / `/search-index`; Data Contracts §2.14; Testing §1.6. |
| `REQ-COMPARE-001` | P1 | As a reader comparing multiple projects, I want a shareable multi-repo compare URL, so that I can inspect growth curves side by side. | `/compare?repos=a/b,c/d` restores state from the URL, allows up to 5 indexed >=10k-star repos, fetches slim curves through `/repo-curve`, and supports absolute plus aligned-to-10k modes. | Requirements §3; Product compare tool; Frontend compare route/client; Data Contracts §2.15; compare tests. |
| `REQ-CATEGORY-001` | P1 | As a reader exploring ecosystems, I want category browsing by language/ecosystem/domain/type/owner/maturity, so that I can discover ranked repos by dimension. | `/categories`, dimension pages, detail pages, and paginated detail routes are registry-driven, only expose public categories, render server-side lists, and emit matching `ItemList` JSON-LD. | Requirements §3; Product URL structure; Frontend §11; Data Contracts §2.4a; category tests. |

### 0.2 Cross-document traceability

| Requirement ID | REQUIREMENTS source | PRODUCT mapping | FRONTEND / DATA-CONTRACTS mapping | TESTING mapping |
|---|---|---|---|---|
| `REQ-CHRONICLE-001` | §3 page surfaces, §6 freshness model | Core pages: home, year, month, week, repo, org, all-time | FRONTEND §1.1 routes and §2 layering; DATA-CONTRACTS §2.3/§2.5-§2.7 | `P0-AC1`, `P0-AC3`; TESTING §1.1, §1.5, §4 |
| `REQ-PULSE-001` | §3 `/pulse`, §6 mover refresh | Home + `/pulse` current movers | FRONTEND `PulseView`, cron revalidation; DATA-CONTRACTS §2.8-§2.10 | `P0-AC2`, `P0-AC3`; TESTING §1.5, live-refresh tests |
| `REQ-RANKING-001` | §4 ranking matrix | Ranking matrix and derived list definitions | FRONTEND ranking pages; DATA-CONTRACTS §2.3-§2.4 | `P0-AC4`; TESTING §1.1-§1.5 |
| `REQ-I18N-001` | §9 SEO / i18n | Multilingual product stance | FRONTEND §1.2/§7; data fields stay language-neutral | `P0-AC3`; TESTING §4.1 |
| `REQ-DATAOPS-001` | §8/§8a/§11 production data operations | Data freshness and honesty stance | FRONTEND cron/workflow routes; DATA-CONTRACTS §2.11-§2.13 | `P0-AC6`; TESTING §1.5 |
| `REQ-PERF-001` | §7 rendering / traffic | Static, low-JS reading experience | FRONTEND §2/§4; DATA-CONTRACTS budgeted JSON views | `P0-AC5`; TESTING §5 |
| `REQ-SEARCH-001` | §3 global search | Discovery entry: global search | FRONTEND `SearchBox` and `/search-index`; DATA-CONTRACTS §2.14 | TESTING §1.6 |
| `REQ-COMPARE-001` | §3 multi-repo compare | Compare tool `/compare` | FRONTEND compare route/client and `/repo-curve`; DATA-CONTRACTS §2.15 | compare tests and planned E2E |
| `REQ-CATEGORY-001` | §3 category browsing | URL structure and category entry points | FRONTEND §11; DATA-CONTRACTS §2.4a | category recompute/rules tests |

## 1. Product positioning (two faces)

- **Chronicle side**: look back at "which projects rose in a given period". A completed period = **frozen, exact, and replayable**. The main body of the product.
- **Pulse side**: see "who is rising / exploding right now", especially **an old project suddenly waking up**. **Time-sensitive**; it is the engine of return visits and spread.
- Differentiation: vs GitHub Trending (the present only) / star-history (a single repo) / gitstar-ranking (the current overall ranking only)——replayable + structured + has a pulse.
- Visits: mainly long-tail search (`X star history`, `github trending 2024`, `who is rising`).

## 2. Dataset scope

- Whitelist = public repos whose current stars are ≥ **10,000** (bootstrap ≈5,248 measured @2026-05 → currently about 5,302; it floats weekly). Refreshed weekly; newcomers get history backfilled; those that drop out keep history and polling stops.
- Time **2015-01 to the present** (before 2015, watch≠star and the schema is unstable).
- Dimensions: **repo + org** (org = aggregated by owner, including both User and Organization).

## 3. Pages (page-surface)

| Page | URL | Points |
|---|---|---|
| Home | `/` | Year spine · this-month focus · **rising-right-now section** · on this day in history |
| Year page | `/rankings/YYYY` | Year ranking · 12-month heatmap · new members |
| Month page | `/rankings/YYYY/MM` | Month ranking (repo+org × flow+stock) · growth rate · new members · daily heatmap · previous/next month comparison |
| Week page | `/rankings/YYYY/W##` | **Standalone page**; the current week is live, and past weeks are frozen |
| repo page | `/:owner/:name` | Curve · milestones · monthly table |
| org page | `/o/:login` | Combined curve · members · rank |
| All-time ranking | `/rankings` | Current-total repo / org TOP |
| Category browsing | `/categories` · `/categories/:dimension` · `/categories/:dimension/:slug` | Multi-dimensional drill-down by language/ecosystem/domain/type/owner/maturity |
| Pulse page | `/pulse` | Today/this week's big rises + revival/spike |
| About | `/about` | Data-definition statement |

- English URLs stay unprefixed; a non-default locale uses a prefixed URL, and metadata / canonical / sitemap / hreflang are emitted by route locale (the current SEO definition is in [SEO.md](./SEO.md) §10; the architecture is in [I18N.md](./I18N.md)).
- Month/year pages display the **repo ranking and the org ranking side by side**.
- **Navbar site-wide search**: a client combobox in the top-bar chrome that, on first focus, lazy-loads versioned `search/index.json` + MiniSearch (zero backend, via CDN), with typo tolerance + weighting by stars, going straight to `/{owner}/{name}`; a "jump by name" entry, and there is no `/search?q=` results page.
- **Multi-repo compare**: a `/compare` static shell + the URL carries `?repos=a/b,c/d`; the frontend fetches versioned curves on demand and overlays them to compare; two normalization modes (absolute / aligned to crossing 10k); a limit of 5; the comparable set = indexed ≥10,000-star repos. Arbitrary repos / ≥100-star drill-down are future work; see [ROADMAP.md](./ROADMAP.md).

## 4. Rankings

- Matrix **{week / month / year / all-time} × {repo / org} × {flow new adds / stock total}**.
- Derived: **growth rate** (flow ÷ period-start stock, floor period-start ≥ 20k); **new members** (stock first ≥ 10k).
- Dedupe: new members do not enter growth rate. Boundaries: flow may be negative, ties use a secondary sort (stock→id), and no data means not on the ranking.
- Definition details are in [RANKING.md](./RANKING.md).

## 5. Data sources and definitions

- **Historical backfill (one-off)**: BigQuery queries GH Archive WatchEvent (including a stable `repo.id`), ~$10. (The free options, a ClickHouse public instance with a 1000-row cap and a self-hosted 4–12TB, were both evaluated and excluded.)
- **Membership and daily monitoring**: GitHub Search's open upper bound `stars:>=MIN_TRACKED_STARS` (default 10000; preview may set 1000) only discovers the active set (bucketed by the dynamic maximum, with no 600k ceiling); every day GitHub GraphQL batch-queries only active repos' `current_stars` (100 repos per batch) → a diff yields the net daily add. Opening a page does not compute it live.
- **Metadata**: GraphQL (owner + owner_type, language, topics, createdAt, current_stars, isArchived).
- **Definition**: history = gross (GH Archive has no unstar events) / after launch = net (includes unstars, and may be negative); the **seam** is the boundary. **`current_stars` is the only number that must be exact**; historical stock = gross accumulation × anchoring factor `d` aligned to current_stars (an estimate, marked as-of; `d >= 0` and it may be `> 1`).
- **Lifecycle**: whitelist `count` = the current active tracked count; a drop keeps entity/history but stops polling and current-ranking aggregation; re-entry reactivates and keeps the first `tracked_since`. Before publish, the active sets/counts of whitelist, canonical, lookup, and meta must agree.

## 6. Freshness model ⭐ (core)

**Metaphor: a newspaper**. Past newspapers (history) are printed, archived, and **never reprinted**; today's front page ("rising now") is replaced every day; when big news arrives (an old project suddenly explodes) it makes the front page + that one page is updated, but **the whole newspaper archive is never reprinted**.

- **Chronicle (historical periods + stable entities)**: frozen / marked **"as of date"**; zero churn.
- **Pulse = freshness follows "movement" (event-driven)**: a daily poll of the full set → compute each repo's daily add → **refresh only "that small set which is moving significantly" + the "rising now" page**; everything else is left untouched.
- **The set refreshed every day = the union of the three classes below (usually tens to a few hundred)**:
  1. **Today's top ~50 by gain**.
  2. **Spike/revival**: today's gain ≥ **5×** its daily average over the recent 90 days, and the same-day net add ≥ **200**.
  3. **Milestone crossed**: today crosses 10k / 50k / 100k.
  > The numbers (50 / 5× / 200) are tunable knobs, calibrated against real data after launch.
- An old project spikes → it enters the refresh set → it is on `/pulse` that day + its repo page refreshes that day (the curve shows this wave immediately).
- **Do not refresh the long-tail pages in full** (currently about 5,302 repos; including org/period pages the cap leaves ~16k of headroom; a full refresh would destroy static rendering / be expensive), and **do not freeze everything** (that would miss a spike).

## 7. Rendering / carrying the load

- SSG-first; content pages have **zero client JS** (charts are server-side SVG); HTML < 20KB.
- Page layers: **core** (built at deploy, a small set) / **long tail** (on-demand ISR, a durable store) / **mover** (refreshed daily, event-driven) / **history** (frozen).
- Carries **100 × 10,000–1000 × 10,000/day**; the hot path is pure static via CDN, with zero Function; the Vercel build has a **45min cap** ⇒ do not build everything.
- CWV：LCP<2.5s · INP<200ms · CLS<0.1。

## 8. Data form / pipeline

- Production canonical = **JSON shard** (per-repo month/week rollup + site daily totals + the repo dimension, recomputable on Vercel); serving = precomputed **JSON views** (read-only at build / runtime). The bootstrap form is a Parquet fact table (archived).
- Engines (BigQuery/DuckDB) are used **only in the one-off bootstrap**; **production recurring recompute (history/metadata/full) goes through Vercel Workflow, pure JS + JSON shard, with no engine**; **build / cron / runtime have zero engine and zero native modules**.
- Daily / weekly live cron is JSON-only; full recompute + publish + rollback + fold + GC go through Vercel Workflow. See [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md), [DATA-CONTRACTS](./DATA-CONTRACTS.md), and [PIPELINE](./PIPELINE.md).

## 8a. Non-functional requirement: production does not depend on local compute ⭐

- **All recurring data jobs are triggered, run, and recorded on Vercel** (Cron / Function / Workflow); local `pipeline/backfill` is only a one-off bootstrap / historical archive / emergency manual tool, and is **not on the day-to-day operations path**.
- A single Function is limited by 800s / 4GB / bundle 250MB / a 4.5MB response body——**full recompute must be Workflow shards**, and large files go through a Blob direct link.
- Newcomer repo history is **conservative by default** (tracked from the discovery day, and marked `tracked_since`), and GCP is not introduced as a recurring dependency in order to backfill history (the tradeoff is in [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md) §6).

## 9. SEO / i18n

- Each page = a long-tail landing page (the title contains real search terms); the sitemap uses index + per-locale XML, English is unprefixed, and a non-default locale has a prefixed URL and hreflang (**the authoritative URL scale is in [SEO.md](./SEO.md)** §1.3 / §10); schema.org (Dataset/ItemList/Organization/BreadcrumbList…); OG images (graphite gray+gold, generated at build); the preview site is noindex. See [SEO.md](./SEO.md).

## 10. Design tone

- **M3 Expressive**; **cool graphite-gray surface + gold "star" accent**; Plus Jakarta Sans + Geist Mono; **hand-written tokens + Tailwind 4** (not using @material/web); light and dark modes; CSS springs / cross-document View Transitions with zero JS. See [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## 11. Deployment / constraints

- **A single Vercel project**: `zkscio/gitstarclub.com` hosts Production and Preview; the production domains are `gitstarclub.com` / `www.gitstarclub.com`, and the test domain is `pre.gitstarclub.com` (private/noindex).
- **Vercel-first / avoid scattered bills** (a one-off BigQuery ~$10 is the only exception).
- Time zone: store UTC, and display UTC + JST. Cron auth + idempotency + monitoring + rollback are in [OPS.md](./OPS.md).

## 12. Compliance

- GH Archive attribution; comply with the GitHub ToS / limits; display only public data of public repos.
- The About page states the definitions: gross/net seam, survivor bias, the 2015 start, as-of, and the anchoring estimate.

---

## Acceptance (requirement level)

This section holds only observable pass / fail signals; strategic judgment stays above. A P0 item must be re-checkable by PR CI, a Vercel Workflow gate, or an explicit manual runbook.

- [ ] **P0-AC1 [`REQ-CHRONICLE-001`] Historical periods can be looked back on, and periods that have already closed are frozen.** Given a Preview/Production deployment that reads `views/latest.json`, When reviewer requests `GET https://pre.gitstarclub.com/rankings/2024`, `/rankings/2024/10`, `/rankings/2024/W41`, Then each valid historical period returns `200`, canonical points at its own URL, and page values come from the same version's `views/<version>/rank/**` / `heatmap/**` artifacts; after the daily cron finishes, requesting the same 2024 historical period again, ranking values must not change. Verification entry: `.github/workflows/ci.yml` (under `web/`: `bun run lint`, `bunx tsc --noEmit -p tsconfig.json`, `BLOB_BASE_URL=https://blob.example.com bun run test`), with the key tests `web/lib/workflows/recompute/windows.test.ts`, `web/lib/workflows/steps/fold.test.ts`, `web/lib/integration/week-fold.test.ts`, `web/lib/integration/seam-fold.test.ts`, `web/lib/data/watermark.test.ts`; before a production publish it must also pass the Workflow `validate` step (`web/lib/workflows/steps/validate.ts`).
- [ ] **P0-AC2 [`REQ-PULSE-001`] `/pulse` reflects the current movers after the daily cron.** Given the daily cron for UTC date `<D>` has finished, When reviewer requests `GET https://pre.gitstarclub.com/pulse` and `GET https://pre.gitstarclub.com/ja/pulse`, Then both return `200`, the page uses the same `<D>` or latest successful run data as `hot-snapshot.json` / `current_month.json`, `ops/sync-runs.json` records the most recent daily run as success, and `current_month.json` contains the per-repo delta for `<D>`; if `<D>` is missing or the snapshot is older than the most recent successful run, it fails. Verification entry: step 4 of the OPS "Daily cron live-run runbook" (`bun web/scripts/validate-live-views.ts --bust <UTC day>`) and `web/lib/cron/live-refresh.test.ts`.
- [ ] **P0-AC3 [`REQ-CHRONICLE-001`, `REQ-PULSE-001`, `REQ-I18N-001`] Core pages, SEO, and the 7-language URL matrix are verifiable.** Given `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com`, When reviewer requests English URLs `/`, `/pulse`, `/rankings`, `/rankings/2024`, `/rankings/2024/10`, `/rankings/2024/W41`, `/categories`, `/compare`, `/about`, `/react/react`, `/o/vercel`, and locale samples `/ja`, `/zh/rankings/2024/10`, `/zh-TW/rankings/2024/10`, `/ko/pulse`, `/es/rankings`, `/fr/react/react`, Then an indexed entity / period returns `200`; an English canonical does not carry a locale prefix; a non-default locale canonical carries a prefix; `<html lang>` agrees with the route locale; `hreflang` exactly includes `x-default`, `en`, `ja`, `zh-CN`, `zh-TW`, `ko`, `es`, `fr`; sitemap shards include these canonical URLs. Verification entry: `web/lib/i18n/routing.test.ts`, `web/lib/i18n/middleware.test.ts`, `web/lib/seo.test.ts`, `web/lib/sitemap.test.ts`, `web/lib/integration/seo.test.ts`, all covered by `cd web && bun run test`.
- [ ] **P0-AC4 [`REQ-RANKING-001`] The ranking matrix and derived-ranking file shapes are correct.** Given a canonical JSON shard fixture or a Workflow staging version, When recompute finishes, Then the following must exist and pass schema: `rank/week/2024-W41/{repo,org}/{flow,stock}.json`, `rank/month/2024-10/{repo,org}/{flow,stock}.json`, `rank/year/2024/{repo,org}/{flow,stock}.json`, `rank/all-time/{repo,org}/stock.json`; derived repo rankings are required only for month/year: `rank/month/2024-10/repo/{growth,new}.json`, `rank/year/2024/repo/{growth,new}.json`. Each rank item must have only one of `id` or `login`, rank is contiguous from 1, there are no duplicate entities, order is descending by metric and tie-break, and top-N does not exceed 100; growth must satisfy period-start stock ≥ 20,000 and flow > 0, and new must come from the frozen `crossed_10k`. Verification entry: `web/lib/workflows/recompute/ranks.test.ts`, `web/lib/workflows/recompute/windows.test.ts`, `web/lib/contracts/contracts.test.ts`, `web/lib/integration/recompute.test.ts`, and the Workflow `validate` step.
- [ ] **P0-AC5 [`REQ-PERF-001`] Static reads, performance thresholds, and the 10M/day assumption have re-checkable evidence.** Given a Preview/Production deployment has warmed up, When reviewer runs Lighthouse / Web Vitals and a `curl` body-size smoke against `/`, `/rankings/2024/10`, and `/react/react`, Then LCP < 2.5s, INP < 200ms, CLS < 0.1, and FCP < 1.5s; content-page HTML < 20KB; content pages do not load non-whitelist client JS; the second request is a CDN / ISR cache hit or stale-while-revalidate, and does not trigger the GitHub API, DuckDB, BigQuery, a database, or Workflow on the request path. Verification entry: the performance / zero-JS runbook in `docs/TESTING.md` §5; before automation lands, the PR must attach the corresponding Preview report or state that the rendering-performance surface was not touched.
- [ ] **P0-AC6 [`REQ-DATAOPS-001`] Recurring data operations go only through Vercel, and the publish gate can block bad data.** Given daily/weekly cron and the weekly Workflow schedule, When reviewer inspects Vercel logs and Blob ops artifacts, Then `/api/cron/daily`, `/api/cron/weekly`, and `/api/workflows/refresh/start` are all scheduled by `web/vercel.json`; a daily/weekly run writes `current_month.json`, `hot-snapshot.json`, `live/*`, and `ops/sync-runs.json`; the Workflow writes `ops/workflows/<run_id>/validation.json`, and only `ok=true` cuts `views/latest.json`; a Production / Preview recurring environment must not depend on `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT_ID`, DuckDB, or Parquet. Verification entry: OPS "Cron schedule", "Daily cron live-run runbook", and "Vercel Workflow runbook", `web/lib/cron/live-refresh.test.ts`, `web/lib/workflows/steps/validate.test.ts`, `web/lib/workflows/steps/week-dates.test.ts`, `web/scripts/validate-live-views.ts`.
