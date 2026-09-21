---
owner: release history
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - versioned release history
  - shipped changes
---

# Changelog

Notable changes to gitstarclub. Newest first. Versioning is informal: the running site is always the tip of `main`.

For what is not yet built, see [ROADMAP.md](./ROADMAP.md). For the system as it currently works, start at [README.md](./README.md).

---

## Unreleased

### Added

- **CF preview Bearer full-refresh acceptance matrix.** After #486, docs now have a pass/fail table for preview Worker Bearer full refresh: `fold-decision.json` is required; `reason=no_closed_month` without month/week plans is normal; recompute is month/week/rest then `publish`/`gc`; fetch-origin OOM or Queue silence is fail; production `triggers.crons` stays `[]` and Vercel cron is not stopped. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Docs only; does not enable production CF Cron or stop Vercel.

- **CF Cron scheduled dispatch (preview draft).** Worker `scheduled` / `handleScheduled` now branches on `event.cron`: daily and weekly GET `{CF_CRON_ORIGIN}/api/cron/{daily,weekly}` with Bearer `CRON_SECRET`; Sunday 06:00 keeps `triggerStart` (or the preview fixture). Unknown expressions fail observably. Preview wrangler may list the three cron strings; production `triggers.crons` stays `[]`. Secrets and platform schedule enablement are ops follow-ups, not this change. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not enable production CF Cron or stop Vercel.

- **Cloudflare migrate P3 Workers host (OpenNext preview).** The existing `gitstarclub-web` Worker now wraps `@opennextjs/cloudflare` so `/`, `/rankings`, and other Next routes can be previewed on workers.dev or `wrangler preview`. Adapter choice is OpenNext (same `next build` as Vercel); `vinext check` was 92% and is recorded, not adopted. R2 `MEDIA` and Queue `JOBS` stay bound. Vercel Web Analytics is off on `HOSTING_TARGET=cf`. Optional `verify / cf-workers-host` is **not** a required check and does not need Access. Production apex/www stay Vercel. See [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md). Does not cut DNS.

- **Cloudflare migrate P2 ISR / Preview / observability.** Injectable `cache-invalidation` port wraps `revalidatePath` / `revalidateTag` (Vercel default; `cf-stub` is non-production and testable). Preview resolution accepts `PREVIEW_TARGET=vercel|cf`; production gates stay on Vercel. Optional `verify / cf-preview` job is **not** a required check. Access is documented only for `gitstarclub-web.worldgo.workers.dev` (`gitstarclub-web-preview`, `@zksc.io` OTP, CI Service Token env names `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`). Operators use Workers Observability + self-built run logs instead of the Vercel Workflows UI. See [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md). Does not cut DNS.

- **Cloudflare migrate P1 workflow runtime.** Managed refresh no longer hard-depends on the Vercel Workflow SDK (`workflow/api`, `"use workflow"`, `"use step"`). Steps are ordinary async functions with explicit retry, scheduled by `startRefresh` / `enqueueStep` / `completeStep`. Tests drain an in-memory shrink fixture through the P0 storage port (lease CAS + views). Non-production CF Cron/Queue lives in `workers/gitstarclub-web/`. Production scheduling stays the three Vercel crons in `web/vercel.json`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not cut DNS.

- **Cloudflare migrate P0 storage port.** Injectable `vercel-blob` / `r2-s3` drivers for write, live-publication CAS, workflow lease, health CAS, recompute I/O, aliases list, and version GC. Default read/write remains Vercel Blob. R2 writes require an explicit non-production `migrate-*` prefix and are refused when `VERCEL_ENV=production`. See [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md). Does not cut DNS.

- **Track C data-layer option analysis.** Comparative write-up of Tinybird, Vercel Postgres / Neon, extra JSON views, a six-month deferral, and the later lock-002 product veto, plus the historical POC must-prove list. Draft lean was defer; product outcome is **veto**. **POC allowed: no.** See [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md). The dated lock-002 record is under Changed below.
- **Vercel Web Analytics.** Enabled cookieless aggregate page-view measurement through Vercel Web Analytics and corrected the privacy page copy to reflect that no analytics cookies or personal data are collected.

### Changed

- **CF preview `/` and `/rankings` no longer 500 when live generation history exceeds 64 hops.** Period-scoped liveHistory reads still cap at 64 validated manifests and fail closed on cycle / schema / listed-but-missing. A request newer than the hop's `week`/`month` stops immediately (older hops cannot have that period). Hitting the hop bound without `previous_generation:null` now truncates to a miss so pages fall back to base / empty instead of throwing `live generation history exceeds 64 entries`. This is acceptance-matrix **H2**, independent of refresh OOM isolate **H1** (#494). Does not raise the scan cap, change the refresh pipeline, enable production CF Cron, or stop Vercel cron. See [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.9. Closes #495.

- **CF CI gates keep preview Worker `gitstarclub-web-pre` and refuse a live production hit.** `.delivery.yml` and `scripts/assert-cf-ci-gates.mjs` use the same names (`main` → `gitstarclub-web`, `pre` → `gitstarclub-web-pre`). Production `triggers.crons` must be an explicit `[]`. Probe origins are allowlisted; `--dry-run=false` and `wrangler versions upload` count as live deploys. Repo automation must not PUT Cloudflare schedules. See [OPS.md](./OPS.md).
- **Docs: remaining "preview-e2e / product-gates are required" copy is gone.** Current required GitHub CI is still only `static` + `production-build`. `preview-e2e` / `product-gates` stay optional and skippable. Does not change the GitHub Ruleset, reopen Vercel Preview, add `cf-preview` as required, stop Cron, or touch fold/recompute. Closes #489.
- **Required GitHub CI gates are only `static` + `production-build`.** Vercel Ignored Build no longer creates Preview URLs, so `preview-e2e` and `product-gates` soft-skip (exit 0 / job skip) instead of failing red. Cloudflare preview acceptance stays ops / manual on `pre.gitstarclub.com`; do **not** add `cf-preview` / `cf-workers-host` to required checks. Ruleset edit is GitHub ops (not this PR). Closes #480.
- **CF refresh lease renew no longer fail-closes a still-owned fencing token.** After #473 preflight batching, preview died on `lost ownership while renewing fencing token` (CAS 412 × 3 against a CDN GET ETag, often overlapping a Queue retry of long whitelist Search). Renew now fences with origin `head()` , backs off, coalesces same-owner renews, and throws retryable `WorkflowLeaseCasError`. Whitelist proves the fence before Search. Queue consumer uses `WORKER_SELF_REFERENCE` instead of the public 524 hop. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF refresh preflight no longer fans out 128 canonical shards in one Worker invocation.** Workflow step `preflight` now reads 4-bucket windows (16 shards) at concurrency 2 on `HOSTING_TARGET=cf`, skips SHA-256 until `validate`, and re-enqueues via cf-queue / HTTP until all 128 shards pass. Avoids Cloudflare 1102 on preview `POST /api/workflows/refresh/step` preflight (~13s wall clock). Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF Cron Sunday DoW 0/7 alias.** Worker dispatch treats weekly `0 4 * * 0` / `0 4 * * 7` (and `SUN`) and refresh `0 6 * * 0` / `0 6 * * 7` (and `SUN`) as the same jobs. Daily stays `0 3 * * *`. Production `triggers.crons` stays `[]`. This does not enable Cloudflare schedules, inject secrets, or stop Vercel. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md).
- **CF CI gates + preview Worker name.** In-repo preview Worker is `gitstarclub-web-pre` (`wrangler` env `pre`; replaces `gitstarclub-web-nonprod`). `CF_PREVIEW_ORIGIN` defaults to `https://gitstarclub-web-pre.worldgo.workers.dev`. GitHub Actions may dry-run `env.pre` only and must not live-deploy production Worker `gitstarclub-web`. Optional `cf-preview` / `cf-workers-host` stay off the required-check list. See [OPS.md](./OPS.md).
- **Track C lock-002: product veto of the request-path query plane.** No live computation on the request path. No POC. No dated auto-review (the 2027-03-12 #383 revisit is void). Reopening requires a constitution-level revision that amends the hard constraints, not a feature PR and not a calendar reminder. The four #362 expansion items stay paused with no implementation children. Dated record: [ROADMAP.md](./ROADMAP.md) Track C; comparison history: [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md). Closes #430.
- **Track C #383 deferral (six months, review 2027-03-12, no POC) is superseded by lock-002.** Recorded 2026-08-31 ahead of the #383 deadline, accepting [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md) as comparison history. Tinybird, Vercel Postgres / Neon, and self-hosted ClickHouse remain rejected; extra precomputed JSON views stay allowed only as tiny finite whitelist-derived shards. No hard constraint changes.
- **Preview deployments require Vercel Authentication.** `ssoProtection` is `preview` only: `pre.gitstarclub.com` and PR preview URLs are login-gated; `gitstarclub.com` stays public. CI uses the automation bypass secret. This stops AI crawlers from billing Fluid duration on public staging.
- **Track A first pass is complete on `pre`.** A1–A4 children (#363–#376) are closed. Repo/org hubs, category topic entries, Pulse period + board exits, and honest search/citation are the shipped loop.
- **Production Firewall custom rules are empty.** Four Deny rules (Meta, GoogleOther, GPTBot training, SEO scrapers) were published 2026-08-20 and removed the same day after the operator chose to allow those crawlers. Facebook/WhatsApp link previews work again. The unclassified/tool rate-limit was never published.
- **Sunday operator signal is per-pipeline health only.** Read `ops/workflows/health/workflow-refresh.json`, not the retired flat `ops/workflows/health.json`. OPS.md now has a one-screen Sunday 06:00 UTC refresh-failure runbook.
- **Org pages gained hub exits.** `/o/{login}` now links public categories derived from member assignments, and compares the owner's top tracked repositories. Member rows still go to repo hubs. Org ranking-month links appear only when the published org entity already has `rank_history`.
- **Repo related-repository lists state why peers appear.** Same-owner repos stay first. When that set is empty, the page says the list is the largest active same-language peers already tracked. Inactive historical repos stay out. A dashed empty state is shown when neither set exists.
- **Ranking boards exit into public categories.** All-time, year, month, and week ranking pages link precomputed public language and ecosystem slices that appear among the leading rows. Copy does not describe this as a live GitHub filter.
- **Thin category pages state their whitelist scope.** Category detail pages with few assigned repos say they are a rule slice of the ≥10,000-star set, not a complete GitHub language or topic catalog. Related categories stay public and bounded.
- **Pulse movers open the matching ranking board.** Each Pulse week, month, year, and all-time panel has one Full board link to the already-resolved ranking route, including locale prefixes. Row clicks stay on the repo hub.
- **Pulse answer capsule sits near the top.** Home and `/pulse` render the compact GEO capsule immediately after the period switcher, before ranking panels, so extractors see the dated GitStarClub summary without scrolling past tables.
- **Repo-page star milestones use frozen exact crossings.** The per-repo milestone list and curve markers now read `entity/repo.milestones.crossed_10k/50k/100k`; higher thresholds are hidden until a frozen first-crossing field exists, so estimated curve-derived dates are not presented as exact newcomer evidence.

### Fixed

- **CF refresh recompute no longer builds object windows after a no-op fold.** After #486, preview wrote `fold-decision.json` `reason=no_closed_month` (normal) then never produced `recomputeRank-month` / publish: fetch-origin `Worker exceeded memory limit` ×3, queue silent, `/` and `/rankings` 500 while `/preview/health` stayed 200. The month hop still held fat repo meta plus object month/year/org windows. Recompute now streams a packed typed-array window, slims repo fields, splits month/monthOrg/year/yearOrg/week/weekOrg/rest, persists the packed window, and writes fold→recompute enqueue evidence. Page 500 after fold **while X1 is red** is the same isolate (**H1**), not a published-view rewrite. Independently, #496 (now on this branch via `pre`) fail-softs period-scoped `liveHistory` walks that exceed 64 hops or request a period newer than head (**H2**) — a second page-500 cause that does not need a refresh OOM. `WORKFLOW_RUNTIME=cf-queue` stays. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF refresh no-op fold is explicit; recompute no longer OOM-stalls after it.** After #484, preview wrote `fold-month-0` + `fold.json` at the same instant and never produced `fold-month-plan.json` / multi-window fold / `recomputeRank`. Live `folded_through` was already `2026-08` / `2026-W35` (current month `2026-09`), so the plan hop correctly had no closed month (`fold-decision.json` `reason=no_closed_month`); the OOM ×3 was the `recomputeRank` successor loading ~33 MiB of weekly shards in one isolate. Fold now always writes `fold-decision.json`; CF pending reads skip a second Zod clone; `recomputeRank` is month / week / rest hops that load only the families they need. `WORKFLOW_RUNTIME=cf-queue` stays. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF refresh fold no longer stalls after the first month window.** After #479, preview wrote `fold-month-0` then the Queue went silent: fetch-origin `Worker exceeded memory limit` ×3, no `fold-week-*` / `recomputeRank` / publish. Each later 4-bucket window still reloaded the full pending, and a Queue retry repeated that heavy isolate. Fold now uses 1-bucket windows; `fold-month-plan.json` / `fold-week-plan.json` are their own hops (shard jobs do not reread pending); the step isolate clears the parse memo at the start of each window. `x-gitstarclub-queue-successor` and `WORKFLOW_RUNTIME=cf-queue` stay. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF refresh fold no longer OOM-stalls before recompute.** After #477, preview still wrote `steps/fold.json` ok then the Queue went silent: fetch-origin `Worker exceeded memory limit`, no `workflow.advance` fold→`recomputeRank`. Fold now runs in 4-bucket windows (sequential pending absorb, compact week plan); busted workflow reads are not parse-memoized; the step isolate clears the memo before returning; `x-gitstarclub-queue-successor` lets the consumer enqueue even if the body dies after the checkpoint. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF refresh no longer stalls after fold before recompute.** After #475, preview wrote `steps/fold.json` ok then the Queue went silent: lease expired, no `error.json`, never `recomputeRank` / publish. The Queue consumer now reads the step JSON body (so the service-bound isolate is not killed after headers) and `JOBS.send`s the successor; `cf-queue` step requests with `x-gitstarclub-queue-advance: consumer` skip the public `/enqueue` hop. `loadCanonicalModel` uses the preflight CF shard-read cap so recompute does not immediately 1102. Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not roll back cf-queue, stop Vercel cron, or cut DNS.
- **CF Workers Blob lease/write no longer uses `@vercel/blob` undici TLS.** Refresh start and full daily/weekly mutation on `HOSTING_TARGET=cf` talk to `https://vercel.com/api/blob` with runtime `fetch` (`web/lib/storage/vercel-blob-fetch-client.ts`) so workerd does not throw `options.ALPNProtocols option is not implemented`. GraphQL `gql()` now sends `User-Agent: gitstarclub` and `Accept: application/vnd.github+json` (REST already did). Production `triggers.crons` stays `[]`. See [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md). Does not enable production CF Cron or stop Vercel.
- **OpenNext ranking-detail / repo / org skip full assignment-shard fan-out on the CF host.** After #457, `/rankings` is 200 but those three pages still called `getCategoryAssignments()` (32 shards). CF now skips that fan-out (language exits remain); Vercel loads only the page's repo-id shards. Full omit-path `loadCategoryAssignments` is hard-short-circuited on `HOSTING_TARGET=cf`. Does not cut DNS.
- **OpenNext `/rankings` skips assignment-shard fan-out on the CF host (v2).** Free Workers count total subrequests (~50), not peak concurrency; each Blob `fetch` also does an OpenNext ASSETS cache GET. CF `/rankings` no longer calls the leading-row assignment loader (language exits remain) and caps month/week lookback at 1. Vercel `/rankings` is unchanged. Does not cut DNS.
- **OpenNext `/rankings` no longer fans out 32 assignment-shard reads in one Worker invocation.** `loadCategoryAssignments` batches shard GETs (concurrency 6, 4 on `HOSTING_TARGET=cf`) and memoizes a full assemble per isolate. `/rankings` loads assignments after the core views and only the shards needed for leading rows. Avoids `Too many subrequests by single Worker invocation`. Does not cut DNS.
- **Static data exports regenerated after `refresh-2026-09-06`.** `web/public/data/exports/v1/2026-09-06/` tracks Blob view `generated_at` (`data_as_of` 2026-09-06T06:37:28.831Z) so live `export-manifest-age` stays inside 14 days. No invented freshness date.
- **Preview/production builds no longer dynamically `readdir` the repo root for data-export JSON-LD.** Dataset pages read the checked-in `public/data/exports/v1` folder through a statically scoped path, so Turbopack does not trace the whole project.
- **Category assignments no longer exceed the 2MB Next.js Data Cache limit.** Recompute writes a small index plus 32 repo-id shards at `categories/assignments/shards/<id%32>.json`. Readers still accept the v1 monolith. The publish gate checks real UTF-8 JSON byte length; each ISR-cached view must stay under 1.50 MiB. Repo, org, and ranking pages keep daily ISR cache — they are not switched to `no-store`.
- **Entity stock counts cannot go negative.** `computeRepoWindow` still uses seam-aware `anchor + cumNet`, but published `stock_est` is `max(0, formula)` so `d=0` newcomers and first-period unstars cannot fail `MonthlyPoint` `NonNegativeInt`. Every `RepoEntity` / `OrgEntity` is Zod-parsed before Blob write; validate re-parses the full lookup set, not only the top repo.
- **Published bootstrap pointer 403s no longer storm origin.** 403/429/5xx retry with exponential backoff and jitter; 403 is never stored as a 404; published reads reuse last-known-good pointer or the managed generation; `unstable_cache` loader failures do not call `load()` again; one structured error is logged per TTL.
- **Issue 25 CWV report no longer publishes an immutable Vercel deployment URL.** The lab baseline is the public production host. Retired `*.vercel.app` deployment URLs are not kept in docs so crawlers and uptime checks cannot pin traffic to old immutable deployments.
- **Preview identity reads follow the Vercel bypass cookie.** Protection Bypass 307s with `_vercel_jwt`; CI fetch now replays that cookie so `preview-e2e` and `product-gates` can resolve `/.well-known/deployment` after Preview was locked.
- **Static data exports regenerated for 2026-08-28.** `web/public/data/exports/v1/2026-08-28/` refreshes `data_as_of` so `export-manifest-age` stays inside 14 days.
- **Observability cost: stop re-parsing and re-logging the same view.** `readView` memoizes Zod parse per path+generation and logs each error fingerprint once (later hits increment a counter; workflow end prints a summary). Official lifecycle fields stay on their contracts as optional for old blobs: `active` / `tracked_since` on lookup/search/entity/canonical repos; `active_repo_count` / `historical_repo_count` on `Meta` only — not on `CanonicalMeta`, and not via `.passthrough()`.
- **Live `current_month` no longer exceeds the 2MB Next.js Data Cache limit.** Cron now publishes a small index plus 32 repo shards (`current_month/shards/<id%32>.json`). Readers still accept the legacy monolith. `/search-index` skips Next Data Cache and relies on the Blob/CDN `s-maxage` response. Sunday daily live refresh is skipped so weekly owns that day's `live/latest.json` write; health CAS uses exponential backoff with jitter instead of spinning.
- **Sunday weekly live refresh no longer fences itself on a stale pointer read.** Publish fences with the Blob API `head()` etag captured at lease acquire, not a public GET of `live/latest.json`. Release with that same etag can clear a CDN-stale body so the lease does not sit until expiry. The public pointer is CDN-cached (query strings do not bust a path key; `useCache: false` is private-only). Weekly reuse publishes in 1–2s and otherwise re-read `lease: null`. Pointer writes use `max-age=0`. Page readers still memoize generation for 60s.
- **Repo milestone chips no longer 404 on out-of-range ranking months.** A frozen `crossed_10k/50k/100k` date still shows on the repo page, but it only links to `/rankings/{year}/{month}` when that UTC month is a valid ranking route (2015 through the current UTC month). Pre-2015 and future months stay unlinked.
- **Vercel preview builds no longer pre-render the entire category long tail.** Deploy-time category params are bounded to the 19 priority languages across supported locales; other public categories and all page 2+ routes use the existing daily on-demand ISR path. This removes thousands of concurrent Blob-backed renders from each deployment while preserving sitemap discovery and canonical URLs.
- **Workflow refresh starts are now lease-protected.** The refresh start route acquires `ops/workflows/active.json` with a Blob ETag conditional write before enqueueing the managed workflow, attaches same-week scheduler retries to the existing `run_id`, and returns `409` for a different active trigger.
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
