---
owner: testing
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - test pyramid
  - contract tests
  - recompute parity gates
  - validation invariants
  - smoke tests
---

# gitstarclub Testing strategy

> A concise, decision-oriented testing strategy. Core principle: **data correctness is the product itself** — historical accuracy is the selling point, and wrong data is more fatal than an ugly page.
> Therefore the test pyramid is not the usual inverted triangle: **pipeline / data-quality tests are the foundation**, and visual / a11y / E2E sit on top of it. For architecture see [ARCHITECTURE.md](./ARCHITECTURE.md); for the product see [PRODUCT.md](./PRODUCT.md).

## Scope

This document owns the project's test pyramid and testing boundaries: current CI checks, contract tests, recompute parity, Workflow validation invariants, smoke checks, and target browser/performance/a11y coverage. It separates checks that are enforced today from target-state coverage and planned gates; use **Current automation** for real blockers, **Target coverage** for strategy, and **Planned gates** for implementation status.

Out of scope: development playbooks and local workflow live in [DEVELOPMENT.md](./DEVELOPMENT.md), issue/PR workflow lives in [WORKFLOW.md](./WORKFLOW.md), production operations live in [OPS.md](./OPS.md) and [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md), and schema or ranking truth lives in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) and [RANKING.md](./RANKING.md). This document should reference those owners instead of restating their rules.

## Current automation

GitHub Actions is committed at `.github/workflows/ci.yml`. Every job installs Node from `.node-version` (major 24) and Bun from the root `packageManager` pin (`1.3.14`), then runs `scripts/assert-runtime-versions.mjs`; a mismatch fails before project work starts. On PRs and pushes to `pre` or `main`, `verify / static` runs `scripts/assert-cf-ci-gates.mjs` (preview Worker `gitstarclub-web-pre`, no live `wrangler deploy` to `gitstarclub-web`, production `triggers.crons` stays `[]`, `CF_PREVIEW_ORIGIN` defaults to the preview host; the same Worker names are recorded in `.delivery.yml`) and root `bun run lint:docs` (Markdown/frontmatter, maintained repository paths, env inventory, route/API ownership, pinned facts); from `pipeline/` it runs the dependency audit and `bun run test`; and from `web/` it runs the dependency audit, `bun run lint`, all three typechecks, exhaustive view-fixture validation, and `bun run test:cov`. It sets `SEO_LIVE_BASE=""` so network-dependent suites stay out of the deterministic gate. `verify / production-build` then runs `next build` against a bounded local HTTP fixture that permits only `GET` and `HEAD`; it receives no Blob write, cron, Workflow, Vercel, or GitHub credential, and explicitly rejects `BLOB_READ_WRITE_TOKEN`.

After both jobs pass, `verify / preview-e2e` tries to resolve a Vercel Preview for the PR head or pushed SHA. When Vercel posts `Canceled by Ignored Build Step` (or Preview Comments complete without a preview URL) the resolver writes `skipped=true` and exits 0; Playwright and live SEO steps do not run, and `product-gates` is skipped. That is a soft exit, not a failure. When a Preview URL does exist, the job waits for `/.well-known/deployment` (using `VERCEL_AUTOMATION_BYPASS_SECRET` and following the bypass `_vercel_jwt` cookie because Preview is Vercel-authenticated), re-verifies the SHA on the immutable `*.vercel.app` deployment URL, and runs Chromium. It runs `e2e/accessibility-responsive.spec.ts`, `e2e/horizontal-overflow.spec.ts`, and `e2e/search-compare-interactions.spec.ts`; serious or critical axe findings, explicit contrast failures, response failures, horizontal overflow, Search keyboard/focus regressions, or Search/Compare retry failures fail the job. Failed runs retain traces and screenshots plus the HTML report and deployment metadata as a GitHub Actions artifact. On `pre` and `main` pushes the same job also runs `bun test lib/integration/seo.test.ts` against that immutable deployment when it was resolved; preview remains noindex while production must be indexable.

The GitHub required-check ruleset for `pre` / `main` is **only** `verify / static` and `verify / production-build`. `preview-e2e` and `product-gates` are not required merge gates: they soft-skip when Ignored Build leaves no Vercel Preview. Workflow files cannot edit that GitHub-hosted rule; maintainers update ruleset required contexts in repository settings. Do **not** add `verify / cf-preview` or `verify / cf-workers-host` to that required-check set: they are optional Cloudflare dual-runs (P2 identity / P3 OpenNext dry-run) gated by `vars.CF_PREVIEW_ENABLED` / `vars.CF_WORKERS_HOST_ENABLED` and are omitted from `.delivery.yml`. Functional Cloudflare preview acceptance is ops / manual on `pre.gitstarclub.com` (or the optional CF jobs), not a GitHub required check. Preview resolution stays `web/scripts/resolve-vercel-preview.ts`. See [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) and [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md).

Dependency audit is also a PR gate. CI runs `bun run audit:deps` in both `web/` and `pipeline/`, with `bun audit --audit-level=high` as the default policy; new high-severity advisories must be fixed by upgrading the direct dependency or documented as a temporary exception before merge. Moderate and low advisories are reviewed during dependency maintenance, but they do not fail CI unless the advisory affects a production server-side path or is escalated by maintainers.

Temporary dependency-audit overrides live in the affected package manifest, next to the lockfile they protect. As of this policy, `web/package.json` pins `undici` to `7.29.0` and `js-yaml` to `4.3.2` above their current high-advisory floors, pins `nanoid` to `5.1.16` so transitive exact pins cannot drop to the advisory-vulnerable 5.1.6 line, pins `piscina` to the first fixed 4.x release while `@swc/cli` has not released an updated dependency range, and pins `postcss` to `8.5.23` and `sharp` to `0.35.4` while their parents retain older compatible ranges. `find-up@7` is a compatibility pin, not a security exception: it keeps Vercel Bun resolving the ESM package while eslint keeps its own compatible nested `find-up@5`. The `workflow` package is no longer a web dependency.

`web` no longer ignores any advisory in `bun audit`. Major-line overrides keep `brace-expansion` on the security backports `1.1.18`, `2.1.4`, and `5.0.9`. Legacy ESLint / SWC CLI / file-list tooling still require the callable CommonJS 1.x/2.x export, so a global 5.x override would break `bun run lint`. The public advisory now recognizes those backports, so the previous `GHSA-mh99-v99m-4gvg` ignore was removed (issue #321).

Those commands are the current PR/`pre`/`main` static blockers; production build is the other required GitHub gate. Chromium / live product-gates run only when a Vercel Preview exists and are not required merge checks. `bun run typecheck` keeps the main Next.js app config focused on production code. `bun run typecheck:tests` uses `web/tsconfig.tests.json` for `*.test.ts(x)` and `web/lib/integration/**`, which stay excluded from the main app typecheck only to keep the production program narrow. `bun run typecheck:scripts` uses the root `tsconfig.scripts.json` with `checkJs` for root scripts, pipeline `.mjs` utilities, web `.mjs` configs/helpers, and `web/public/sw.js`. The `bun run test` command in `pipeline/` exercises the extracted bootstrap publication core, including interrupted uploads, deterministic resume, validation failure, pointer commit/rollback replay, and the shared publication lease. The `bun run test:cov` command in `web/` maps to `bun test lib/ --coverage` followed by `scripts/check-coverage-threshold.mjs`; the latter sums the generated LCOV records and exits non-zero when aggregate line or function coverage is below 80%. The measured web scope is every first-party module loaded by the `web/lib` suite, including directly imported pure helpers under `pipeline/lib`; destructive/offline `pipeline/backfill` entrypoints remain covered by typecheck, the publication-core tests, contract/parity tests, and fixture validation rather than artificial line execution. The static job sets `BLOB_BASE_URL=https://blob.example.com` for tests that need a truthy Blob base. Each job summary records exact Node/Bun versions, and the static summary records the aggregate function/line coverage row. Lighthouse, visual-baseline, browser-flow, and multi-engine coverage remain unenforced.

`web/tsconfig.json` still has `allowJs` because first-party `.mjs` modules such as `web/lib/fetch-timeout.mjs` are shared with Node pipeline scripts. `skipLibCheck` remains enabled in the TypeScript configs to keep CI focused on first-party code and avoid framework/dependency declaration churn from Next, React, Bun, and Node type packages. App and test code stay under `strict`; `tsconfig.scripts.json` also runs `checkJs`, but intentionally leaves `noImplicitAny` off for archived `.mjs` pipeline utilities whose DuckDB/API row shapes are dynamic until they are migrated or annotated more deeply.

The Vercel Workflow `validate` step is a separate production-data publish gate: it samples `views/<run_id>/**` after recompute and blocks the `views/latest.json` pointer cut on validation failure. It is not a page-rendering or PR CI gate.

## Target coverage

The responsive-overflow, serious/critical axe, and Search/Compare interaction subset below is enforced in Chromium. Visual baselines, broader browser flows, performance, keyboard/manual accessibility outside the Search/Compare flow, and cross-browser coverage remain targets until their tooling is added. The status table in **Planned gates** is the source of truth for whether each check is `enforced`, `manual`, `report-only`, `planned`, or `not implemented`.

The issue #25 Lighthouse / Core Web Vitals baseline is archived in [perf/CWV-25.md](./perf/CWV-25.md). Treat that file as supporting evidence for one measured run; this document owns current performance targets and test expectations.

## Requirement Traceability

Requirement IDs are defined in [REQUIREMENTS.md §0](./REQUIREMENTS.md#0-requirement-ids--priority--traceability-matrix). New tests that validate a core product behavior should name the relevant `REQ-*` ID in the test description, fixture name, or surrounding comment when the mapping is not obvious from the file path.

| Requirement ID | Acceptance link | Current automated evidence | Planned / manual evidence |
|---|---|---|---|
| `REQ-CHRONICLE-001` | `P0-AC1`, `P0-AC3` | `web/lib/workflows/recompute/windows.test.ts`, `web/lib/workflows/steps/fold.test.ts`, `web/lib/integration/week-fold.test.ts`, `web/lib/integration/seam-fold.test.ts`, `web/lib/data/watermark.test.ts`, SEO/routing tests | Browser E2E navigation graph, visual regression, manual Preview page review |
| `REQ-PULSE-001` | `P0-AC2`, `P0-AC3` | `web/lib/cron/live-refresh.test.ts`, workflow/live smoke tests, SEO/routing tests | Daily cron runbook validation and Preview `/pulse` freshness check |
| `REQ-RANKING-001` | `P0-AC4` | `web/lib/workflows/recompute/ranks.test.ts`, `web/lib/workflows/recompute/windows.test.ts`, `web/lib/contracts/contracts.test.ts`, `web/lib/integration/recompute.test.ts`, Workflow `validate` step | Golden-file milestones and full publish/rollback E2E |
| `REQ-I18N-001` | `P0-AC3` | `web/lib/i18n/routing.test.ts`, `web/lib/i18n/middleware.test.ts`, `web/lib/seo.test.ts`, `web/lib/sitemap.test.ts`, `web/lib/integration/seo.test.ts` | Browser language-switcher E2E and locale smoke on Preview |
| `REQ-DATAOPS-001` | `P0-AC6` | `pipeline/lib/bootstrap-publication.test.mjs`, `web/lib/blob-deletion.test.ts`, `web/lib/cron/live-refresh.test.ts`, `web/lib/workflows/steps/validate.test.ts`, `web/lib/workflows/steps/week-dates.test.ts`, workflow start/lease tests | Vercel logs / Blob ops artifact review from OPS runbooks |
| `REQ-PERF-001` | `P0-AC5` | Current CI does not enforce browser/perf budgets; supporting baseline lives in `docs/perf/CWV-25.md` | Lighthouse/CWV, zero-JS, HTML-size, and cross-browser gates in §5/§6 |
| `REQ-SEARCH-001` | P1 catalog criteria | Search core/worker/fetch/keyboard unit tests plus `web/e2e/search-compare-interactions.spec.ts` keyboard, focus, compare-toggle, and populated-dialog Axe coverage | Cross-browser and visual coverage |
| `REQ-COMPARE-001` | P1 catalog criteria | Compare core, curve-fetch/retry tests, and `web/e2e/search-compare-interactions.spec.ts` first-failure/second-success recovery | URL-share, cross-browser, and visual coverage |
| `REQ-CATEGORY-001` | P1 catalog criteria | `web/lib/workflows/recompute/categories.test.ts`, `web/lib/categories/rules.test.ts`, category SEO/route tests, `web/lib/repo-page.test.ts` hub category chips, `web/lib/category-bidirectional.test.ts` (public assignment ↔ repo chip and category rank / pagination path) | Category browser E2E and pagination visual checks |
| Repo hub (#356 / #363) | Owner, public category, compare, non-all-time ranking period, bounded related repos | `web/lib/repo-page.test.ts`, `web/lib/repo-hub-contract.test.tsx` (fails if a #356 link type disappears from `RepoPageView`) | Manual Preview of `/{owner}/{name}` |
| Repo milestone → month (#364) | Frozen `crossed_*` dates link `/rankings/{year}/{month}` only when the UTC month is a valid ranking route | `rankingMonthHrefIfRoutable` in `web/lib/repo-page.test.ts`, `web/lib/repo-milestones.test.ts` | Manual Preview of a pre-2015 10k crossing |
| Org hub (#356 / #366) | Public categories from members, compare of top members, ranking month only if `rank_history` exists | `web/lib/org-page.test.ts`, `web/lib/org-hub-contract.test.tsx` | Manual Preview of `/o/{login}` |
| Related-repo empty / fallback (#367) | Owner-first, language fallback explained, inactive excluded, empty dashed-box copy in all locales | `web/lib/repo-page.test.ts`, `web/lib/repo-related-empty.test.tsx` | Manual Preview of a solo-owner repo |
| Ranking → public category (#368) | All-time / year / month / week boards exit to registry-public language and ecosystem pages from leading rows | `web/lib/ranking-category-exits.test.ts`, `web/lib/integration/uiux-seo.test.tsx` | Manual Preview of `/rankings` and a month board |
| Thin category honesty (#369) | Few-repo category pages state they are a ≥10k whitelist rule slice; related categories stay public and bounded | `web/lib/category-page-data.test.ts`, `web/lib/integration/uiux-seo.test.tsx` | Manual Preview of a low-count category |
| Weekly live origin-etag fence (#402) | Weekly reuse publish must not false-fence on a CDN-stale `live/latest.json` body; a changed origin `head()` etag still fences | `web/lib/cron/live-publication.test.ts` | Sunday weekly `ops/sync-runs.json` newest non-dry run is `ok` |
| Pulse movers → ranking period (#372) | Week / month / year / all-time panels link the resolved ranking route; rows stay on repo hubs; locale prefixes apply | `web/lib/pulse-board-links.test.tsx` | Manual Preview of `/` and `/ja` |
| GEO capsule gaps (#376) | High-value routes keep a dated, attributed capsule and FAQ; Pulse capsule is after the period switcher and before ranking panels; compare capsule stays generic | `web/lib/geo-capsules.test.ts`, `web/lib/geo-faq.test.ts`, `web/lib/pulse-board-links.test.tsx`, `web/lib/integration/uiux-seo.test.tsx` | Manual Preview of `/` and `/pulse` |
| Sunday refresh health path (#377 / #379) | Operator signal is only `ops/workflows/health/workflow-refresh.json`; never the retired flat `ops/workflows/health.json` | `web/lib/observability/health.test.ts` | Sunday runbook in [OPS.md](./OPS.md) |
| CF migrate P1 refresh runtime (#446) | Refresh main path runs without Workflow SDK; memory runtime drains a shrink fixture; lease CAS still wins/loses on ETag | `web/lib/workflows/runtime/*.test.ts`, `web/lib/workflows/lease.test.ts`, `web/lib/workflows/start.test.ts` | Production cron table unchanged; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF Cron scheduled dispatch (#466) | `event.cron` maps daily / weekly / refresh; unknown cron throws; production wrangler crons stay empty; origins stay env-specific | `web/lib/workers-host/cron-dispatch.test.ts`, `scripts/cf-ci-gates.test.mjs` | Ops injects secrets and enables preview schedules later; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF Cron Sunday DoW 0/7 alias (#468) | weekly accepts `0 4 * * 0` and `0 4 * * 7` (and `SUN`); refresh accepts `0 6 * * 0` and `0 6 * * 7` (and `SUN`); daily stays `0 3 * * *`; production `triggers.crons` stays `[]` | `web/lib/workers-host/cron-dispatch.test.ts`, `scripts/cf-ci-gates.test.mjs` | Platform schedules stay off; production cron is not enabled; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF Cron GraphQL UA + Blob fetch write (#470) | GraphQL `gql()` sends `User-Agent: gitstarclub` and `Accept: application/vnd.github+json`; Blob lease/write on `HOSTING_TARGET=cf` uses runtime `fetch` (no `ALPNProtocols`) | `web/lib/github.test.ts`, `web/lib/github-timeout.test.ts`, `web/lib/storage/vercel-blob-fetch-client.test.ts`, `web/lib/storage/object-store.test.ts` | Preview Bearer `refresh/start` is 2xx; full daily must not 500 on ALPN; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF refresh preflight 1102 (#472) | Workflow preflight reads 4-bucket windows (16 shards) at CF concurrency 2; SHA-256 deferred to `validate`; graph re-enqueues until 128 shards pass; cf-queue stays the preview runtime | `web/lib/workflows/canonical-validation.test.ts`, `web/lib/workflows/steps/preflight.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workflows/runtime/step-route.test.ts` | After CF preview deploy: Bearer start 200 → queue consume → step `preflight` is **not** 503/1102; Blob shows `preflight-0` then a later step; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF refresh lease renew (#474) | Renew withholds a CDN-stale public GET ETag, backs off CAS, coalesces same-owner overlap, and throws retryable `WorkflowLeaseCasError` instead of `lost ownership while renewing`; whitelist proves the fence before Search; Queue consumer uses `WORKER_SELF_REFERENCE` | `web/lib/workflows/lease.test.ts`, `web/lib/workflows/steps/whitelist.test.ts`, `web/lib/workflows/runtime/retry.test.ts`, `web/lib/workers-host/refresh-step-fetch.test.ts`, `web/lib/storage/vercel-blob-fetch-client.test.ts` | After CF preview deploy: Bearer start 200 → preflight batches ok → no `lost ownership while renewing` → `steps/whitelist.json` or later; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| Preview sharded whitelist Search (#509) | `WHITELIST_SEARCH_SHARDS=1` yields Search between star-range hops inside a 10 min budget; progress is not a snapshot; shard-off is single-hop | `web/lib/github.test.ts`, `web/lib/workflows/steps/whitelist.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/runtime-config.test.ts` | After CF preview deploy of this change: full (non-fixture) refresh whitelist hops finish under the 15 min Queue wall and write `canonical/v2/whitelist/<run>.json` (~65k vs 5534). Do not re-run the old single-hop Bearer path. Production `triggers.crons` stays `[]`. |
| Preview empty/missing canonical preflight (#515) | `PREFLIGHT_RELAX_EMPTY_SHARDS=1` treats confirmed-missing shards as empty `{}` placeholders (`preview-empty-canonical-placeholder`) so hop 4-style gaps do not void the run; production / flag-off stay fail-closed; schema/`d`/identity still fail | `web/lib/workflows/canonical-validation.test.ts`, `web/lib/workflows/steps/preflight.test.ts`, `web/lib/runtime-config.test.ts`, `scripts/cf-ci-gates.test.mjs` | After CF preview deploy: Bearer start 200 → preflight windows ok even if some `canonical/v2/{repos,repo-monthly,…}/{4–7}.json` are 404; Observability shows the policy log; do **not** trigger Bearer from this PR. Production `triggers.crons` stays `[]`. |
| Preview cold-start first publish (#519) | With `WORKFLOW_COLD_START=1` and unpublished `views/latest.json`, route preflight allows start when `meta.json` is absent; workflow writes minimal meta under lease; whitelist baseline `[]`; missing lookup/repos/series read as `{}` until first publish; GitHub still supplies `node_id`/stars | `web/lib/workflows/cold-start.test.ts`, `web/lib/runtime-config.test.ts`, `scripts/cf-ci-gates.test.mjs` | Do **not** Bearer-trigger full refresh from CI/PR. After deploy + Jason-authorized run: expect Search → metadata → recompute → publish; entity/heatmap hops may still OOM on large universes. |
| CF refresh fold→recompute stall (#476) | Queue consumer reads the step JSON body and `JOBS.send`s `nextRefreshJob`; `cf-queue` + `x-gitstarclub-queue-advance: consumer` skips the public `/enqueue` hop after fold; `loadCanonicalModel` caps CF shard reads | `web/lib/workers-host/queue-advance.test.ts`, `web/lib/workers-host/consume-job.test.ts`, `web/lib/workflows/runtime/step-route.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workflows/recompute/io.test.ts`, `web/lib/workflows/recompute/io-load.test.ts` | After CF preview deploy: Bearer start 200 → `fold.json` ok → queue consume `recomputeRank` (not silent) → later `publish.json`; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF refresh fold OOM + advance (#478) | Fold runs 4-bucket month/week windows; busted reads skip parse memo; step route clears memo and sets `x-gitstarclub-queue-successor`; consumer enqueues from that header if the body is lost | `web/lib/workflows/steps/fold-step.test.ts`, `web/lib/workflows/steps/fold.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workflows/runtime/step-route.test.ts`, `web/lib/workers-host/queue-advance.test.ts`, `web/lib/workers-host/consume-job.test.ts`, `web/lib/data/parse-view.test.ts` | After CF preview deploy: Bearer start 200 → `fold-month-0` / `fold-week-*` / `fold.json` → queue still live → `recomputeRank.json` → `publish.json` (and `gc.json` if that step ran); no stable fetch-origin memory kill after fold; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF refresh fold still OOM after fold-month-0 (#483) | Fold uses 1-bucket windows; month/week plan hops write compact plans without shards; later windows do not reload pending; retry after a plan exists is one shard | `web/lib/workflows/steps/fold-step.test.ts`, `web/lib/workflows/steps/fold.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workers-host/consume-job.test.ts` | After CF preview deploy of this PR: Bearer start 200 → `fold-month-0` (plan) → later `fold-month-*` / `fold-week-*` → `fold.json` → queue still live → `recomputeRank.json` → `publish.json` (and `gc.json` if that step ran); no silent gap after the first month window; production `triggers.crons` stays `[]`; see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) |
| CF refresh plan hop skip + recompute OOM after #484 (#485) | First fold hop writes `fold-decision.json` (`no_closed_month` when already folded through the last closed month); month/week plans only when there is closed-period work; CF pending/shard reads skip a second Zod clone; `recomputeRank` is month/week/rest hops that load only the needed families | `web/lib/workflows/steps/fold-step.test.ts`, `web/lib/workflows/steps/recompute-rank-step.test.ts`, `web/lib/workflows/recompute/io-load.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workers-host/consume-job.test.ts`, `web/lib/data/source.test.ts` | After CF preview deploy: score the [preview Bearer full-refresh acceptance matrix](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix) (F1–F4 / R1–R3 / X1–X2 / P1–P2). `no_closed_month` without month/week plans is normal; OOM or Queue silence is fail; production `triggers.crons` stays `[]` |
| CF refresh recompute still OOM after #486 (#494) | Packed typed-array window; slim repo meta; seven rank hops (month / monthOrg / year / yearOrg / week / weekOrg / rest); persist `recompute/{month,week}-win`; fold writes `recompute-enqueued.json`; each hop writes `recomputeRank-<phase>-start.json`; entity steps stream packed + one bucket | `web/lib/workflows/recompute/packed-window.test.ts`, `web/lib/workflows/steps/recompute-rank-step.test.ts`, `web/lib/workflows/recompute/io-load.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workers-host/consume-job.test.ts` | After CF preview deploy: score the [preview Bearer full-refresh acceptance matrix](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix) including **H1** and **H2**. Must reach `publish.json` (prefer `gc.json`). Page 500 + health 200 after fold **while X1 is red** is the same OOM isolate (**H1**). Independently, `liveHistory` >64 / newer-than-head is **H2** (#496, already on this branch). Production `triggers.crons` stays `[]` |
| CF refresh week-start OOM after #497 (#498) | Week pack hop persists flat v2 one repo-bucket at a time; week/weekOrg rank 8-period windows by streaming one persist shard (never assemble the full week window); carry file keeps prev_rank / org stock; terminal `recomputeRank-week.json` / `recomputeRank-weekOrg.json` still written | `web/lib/workflows/recompute/packed-window.test.ts`, `web/lib/workflows/steps/recompute-rank-step.test.ts`, `web/lib/workflows/recompute/io.test.ts`, `web/lib/workflows/recompute/io-load.test.ts`, `web/lib/workflows/runtime/graph.test.ts`, `web/lib/workers-host/consume-job.test.ts` | After CF preview deploy: score the [preview Bearer full-refresh acceptance matrix](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix) including **R1** week-pack / week-* windows. Must pass `recomputeRank-week-start` → `recomputeRank-week` → `publish.json` (prefer `gc.json`). Stuck week-start + OOM ×3 is fail. Production `triggers.crons` stays `[]` |
| CF refresh month/year/rest full-window OOM (#517) | Month and year pack per repo bucket (year derived from month buckets); rank streams 8 periods; growth keeps top-100 per period; rest folds one repos bucket then writes all-time, lookup, search, and categories without `loadCanonicalModel`; terminal phase checkpoints remain | `web/lib/workflows/recompute/packed-window.test.ts`, `web/lib/workflows/recompute/rest-fold.test.ts`, `web/lib/workflows/steps/recompute-rank-step.test.ts`, `web/lib/workflows/runtime/graph.test.ts` | Do not Bearer-start or live-deploy from this change. After a later preview deploy, score [R1](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix): month-pack / month-* / year-pack / year-* / rest-* then terminal `recomputeRank-*.json`. One isolate assembling month, year, or every repo is fail. Production `triggers.crons` stays `[]` |
| CF refresh lease origin ETag after #499 (#500) | Empty write cache + CDN GET / origin `head()` diverge uses origin `getOrigin()` body+etag; successor on origin fails closed (no stale-body CAS); public-only stores still withhold a divergent GET ETag | `web/lib/workflows/lease.test.ts`, `web/lib/storage/vercel-blob-fetch-client.test.ts`, `web/lib/storage/vercel-blob-store.test.ts` | After CF preview deploy: score the [preview Bearer full-refresh acceptance matrix](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix) including **L1**. Must pass week hops → weekOrg → rest → `publish.json` (prefer `gc.json`). `could not read a consistent origin ETag while renewing` on a still-owned token is fail. Production `triggers.crons` stays `[]` |
| CF preview Bearer full-refresh acceptance (#488) | After #486: `fold-decision.json` is always present; `reason=no_closed_month` without month/week plans is normal; recompute is month/week/rest then `publish`/`gc`; fetch-origin OOM or Queue silence is fail; production `triggers.crons` stays `[]` and Vercel cron is not stopped | Same unit files as the #485 row (docs-only acceptance table; no new CI job) | Operator scores [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix). This is not a GitHub required check and must not open production schedules |
| CF live history >64 page 500 (#495) | Period-scoped liveHistory truncates at 64 hops (null, no throw, no unverified legacy); a requested week/month newer than the hop stops without walking the rest of the chain; cycle / schema / listed-but-missing still fail closed; production `triggers.crons` stays `[]` | `web/lib/data/live-generation-history.test.ts`, `web/lib/data/source.test.ts` | After CF preview deploy of this PR: `GET /preview/health` 200; `GET /` and `GET /rankings` 200 (base / previous period / empty is OK). Do not PUT production schedules or stop Vercel cron |
| CF migrate P3 Workers host (#452) | OpenNext selected over vinext; `/` is Next; shell keeps `/preview/*` + `/start`; Analytics off on `HOSTING_TARGET=cf` | `web/lib/workers-host/*.test.ts`, `web/lib/analytics-policy.test.ts`, `web/lib/deployment-identity.test.ts`, `web/lib/runtime-config.test.ts` | Optional `verify / cf-workers-host` dry-run; local `bun run cf:smoke`; production stays Vercel; see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) |
| Cloudflare R2 P0 adapter (#444) | Default Blob drivers; R2 CAS 412 / list prefix / production write guard; no real production bucket token | `web/lib/storage/*.test.ts`, `web/lib/runtime-config.test.ts` | Dry-run `web/scripts/sync-blob-to-r2.ts` against `migrate-dev/` only |
| View parse-once + Zod fingerprints | Same path+generation is parsed once; unrecognized lifecycle keys are not `.passthrough()`; old and new Meta/lookup/entity shapes both parse | `web/lib/data/parse-view.test.ts`, `web/lib/contracts/contracts.test.ts` | 24h `ZodError` volume drops; no per-request repeat of the same fingerprint |
| current_month shards under Data Cache limit | Writer emits index + 32 shards; reader accepts v1 monolith and v2 index; Sunday daily does not claim live lease | `web/lib/cron/current-month-shards.test.ts`, `web/lib/cron/live-refresh.test.ts`, `web/lib/cron/handlers.test.ts` | `items over 2MB can not be cached` is 0 after the next live publish |
| category assignments shards under Data Cache limit | Writer emits index + 32 repo-id shards; reader accepts v1 monolith; publish gate checks UTF-8 JSON byte length < 1.50 MiB; ISR stays cached | `web/lib/data/category-assignment-shards.test.ts`, `web/lib/workflows/recompute/categories.test.ts`, `web/lib/view-size.test.ts` | `items over 2MB can not be cached` is 0 after the next base publish |
| CF `/rankings` assignment shard fan-out (#454) | Index-mode reader never starts more than 6 (4 on CF) shard reads at once; `/rankings` only reads leading-row buckets; v1 monolith stays one GET | `web/lib/data/categories.test.ts`, `web/lib/data/category-assignment-shards.test.ts` | `gitstarclub-web.*.workers.dev/rankings` is 200; Workers logs have no `Too many subrequests` on three repeats |
| CF `/rankings` skip assignment fan-out (#456) | CF `/rankings` issues 0 assignment shard reads; language exits remain; month/week lookback capped at 1; Vercel path still reads leading-row shards | `web/lib/data/rankings-cf-subrequests.test.tsx`, `web/lib/data/categories.test.ts`, `web/lib/data/rank-periods.test.ts` | `gitstarclub-web.*.workers.dev/rankings` and `/ja/rankings` are 200 after CF redeploy; no `Too many subrequests` on three repeats |
| CF ranking-detail / repo / org skip assignment fan-out (#458) | CF ranking-detail, repo hub, and org hub issue 0 full 32-shard assignment reads; language exits remain; Vercel still reads page-id shards | `web/lib/data/heavy-pages-cf-subrequests.test.tsx`, `web/lib/data/categories.test.ts` | After CF redeploy: one `/rankings/{year}` or period detail, one `/r`/`/{owner}/{name}`, one `/o/{login}` are 200; no `Too many subrequests` on 2–3 GETs each |
| non-negative entity stock | `computeRepoWindow` clamps published `stock_est` to ≥ 0; every RepoEntity/OrgEntity is Zod-parsed before Blob write and again at publish | `web/lib/workflows/recompute/windows.test.ts`, `web/lib/workflows/recompute/entities.test.ts` | `/o/astrid-runtime` and locale routes return 200; no negative `MonthlyPoint` |
| bootstrap pointer 403 is not a 404 | Bounded retry + jitter; last-known-good pointer; one structured error per TTL; `unstable_cache` loader failures do not call `load()` again | `web/lib/data/bootstrap-pointer-cache.test.ts` | bootstrap pointer 403 does not form a repeat storm |

This document describes this project's test pyramid: **Zod contract tests**, **unit tests** of pure core logic, **integration tests** (recompute parity, live overlay), **end-to-end smoke tests**, and in the workflow the **validation gates**(validation gates). Before adding any feature or changing any contract, please read this document first, and ensure the change lands inside the existing test boundaries.

## Testing orientation(set the tone first)

| Orientation | Decision | Rationale |
|---|---|---|
| real data > mock | aggregation / ranking / schema tests **run a real Parquet subset + real JSON artifacts directly**, and do not mock when real data can be used | bugs in this product are almost all hidden in the "dirty corners of real data" (canceled stars, renames, spikes, empty months); mock can never catch them |
| Structure | **AAA** (Arrange-Act-Assert) three-part form | Data-test assertions are dense; AAA makes the boundary of "make data / compute / validate" clear |
| Naming | describe behavior, do not describe function names | e.g. `org total equals the sum of its member repos' totals`, `weekly window across months does not drop a day`; a failure is the documentation |
| Philosophy | visual regression **supplements** rather than replaces logic coverage | A screenshot can catch "it looks wrong", and cannot catch "the flow sum is short one day" — the latter relies on unit tests |

## Coverage targets

- **Logic code ≥ 80%** (aggregation / ranking / windows / anchoring / schema / i18n routing — that is, the pure functions of `pipeline/` and `web/lib/`). This is the project's hard line.
- **Visual regression** is not counted in the coverage number; it is an independent signal layer (see §2).
- Do not pad unit-test coverage for pure presentational SVG components with zero client JS — their signal is in visual regression, and unit-testing their markup is both brittle and low-value.

---

## 1. Pipeline / data-quality tests (most important)

In the data layer (bootstrap / Vercel Workflow), data is aggregated into JSON views, and **once published to the 16k static pages it cannot be corrected at runtime**. So this layer is a heavily guarded zone, split into five kinds: aggregation math, schema validation, sanity invariants, golden file, and publish gates (§1.5).

### 1.1 Aggregation + ranking math (unit tests, real-data subset)

Pure functions for the aggregation-budget logic / or assertions directly on the output. **Use a small real slice** (Parquet subset + same-source canonical JSON shard, 5–10 well-known repos, spanning 2–3 years) as the fixture, so synthetic data does not hide real boundaries; and from that, do the §1.5 equivalence parity check of "shard pure-JS recompute == DuckDB recompute".

- **flow (∑delta)**: the sum of each day's delta inside the window == that window's ranking value; a month whose delta is negative (canceled stars) is still correct
- **stock cumulative + anchoring**: the total accumulated to the end of the window; the endpoint must **anchor to GraphQL `current_stars`** (when the gross curve's endpoint ≠ the current total, GraphQL is authoritative; see ARCHITECTURE "data validation/reconciliation")
- **Window boundaries**:
  - A week does not divide a month evenly — `weekly window across a month boundary neither double-counts nor drops`
  - Month / year boundaries: leap-year month 2, year-crossing 12→1, month-end 28/29/30/31 days
  - All-time = from the 2015-01 start to the current period, neither earlier than the seam nor missing the start month
- **org aggregation**: group-sum by `owner` (including both User and Organization `owner_type`) == the sum of its member repos

```ts
// illustration, not actual test code
test('weekly ranking window across months does not drop a day', () => {
  // Arrange: an ISO week in the real slice spanning 9/29–10/05
  // Act:    take that week's flow ranking
  // Assert: ranking value == the sum of this repo's 7 days of delta (including the two segments across the month)
});
```

### 1.2 JSON view schema validation (Zod)

All of `rank/* · entity/* · heatmap/* · lookup/*` and the live tail `current_month.json` / `hot-snapshot.json` have a **Zod schema**, validated immediately after the pipeline produces them, and validated once more before the build reads them (fail-fast; dirty JSON never enters the build).

- Field types / required / enums (`owner_type ∈ {User, Org}`, `metric ∈ {flow, stock}`, `window ∈ {week,month,year,all-time}`)
- Referential integrity: every `repo_id` in a ranking has a corresponding entry in `lookup/repos.json`
- The Zod schema is the source of the TS types with which the build reads JSON (single source of truth, avoiding drift between schema and types)
- **Implementation**: `web/scripts/validate-views.ts` (`bun run validate:views -- <viewsDir>` fully validates every JSON in the directory against the contract; unknown paths, malformed JSON, or a schema mismatch all fail; only a narrow allowlist with a reason in `web/lib/view-validation.ts` may be exempted). CI runs the same command on a read-only fixture that covers every registered view family. Every bootstrap precompute artifact must also run this gate, expecting `skipped=0`, `failed=0`; this and offline parity are two different metrics — **offline parity tests** compare the generated views with the DuckDB recompute results byte for byte (`web/lib/integration/recompute.test.ts`); do not confuse file-contract validation with byte parity. **Workflow `validate` step reuses the same set of Zod contracts to validate `views/<run_id>/**`** (§1.5; at runtime it also adds completeness / cross-view invariants); the logic has the same source, and only the place it runs changes.

### 1.3 Sanity invariants (data-level assertions, run against the full artifacts)

These are the "laws of data physics". The target state is to assert on **every full pipeline output**, and any violation blocks the corresponding gate; the scope already automated today is in the **Planned gates** status table below:

| Invariant | Threshold / rule |
|---|---|
| stock total is non-negative | the cumulative total of any repo / org at the end of any window ≥ 0 |
| daily delta is within sane bounds | single-day additions do not exceed a sane cap (e.g. N times the historical single-day peak); net may be negative but has a lower bound |
| ranking list length | top-N JSON is exactly N rows (or the full set when the full set < N), with no duplicate `repo_id` |
| ranking is ordered | strict descending order by the corresponding metric |
| org == ∑members | each org's total in each window == the sum of its member repos (tolerance 0) |
| drift check | `total accumulated by adds` vs GraphQL `current_stars` drift ≤ a threshold (e.g. 2%); over the threshold, record `total_drift_pct` and re-anchor with GraphQL (see ARCHITECTURE) |
| seam continuity | no break in the curve before and after the gross→net seam day (`meta.seam_date`) / no double-counted day |

### 1.4 Golden file (known milestones of known repos)

Pick a few well-known repos whose **facts are publicly checkable** as regression baselines, and freeze their key points into golden snapshots; compare after a pipeline change, to prevent a refactor from quietly changing the historical definition.

- e.g.: the **exact month** a famous repo crossed 10k / 50k / 100k, and the ranking at that time
- e.g.: some AI project's breakout month, and its flow ranking place
- golden values are manually checked once and then frozen; a change requires explicit review (to prevent "the tests changing along with the bug")

> A golden file tests "history should not change"; §1.1 tests "the algorithm should be correct". The two complement each other: the former catches regressions, the latter catches logic.

### 1.5 Workflow publish gate / staging validation / rollback

> **The "last gate" of data validation is at managed refresh's `validate` step** — run **sampled assertions** on `views/<run_id>/**`, and **cut the `views/latest.json` pointer only if they pass** (implementation `web/lib/workflows/steps/validate.ts`; the contract is in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)).

**Invariants actually asserted today** (the gap from the full list in §1.3 is in the table below):

| Assertion | What is checked |
|---|---|
| `meta.json` | `seam_date` exists |
| all-time stock overall ranking | repo/org all-time rank are both read against schema; `items` is non-empty, `rank[0]==1`, `value` is non-increasing; rank is contiguous from 1, no duplicate rank, no duplicate `id/login` |
| `lookup/repos.json` | entry count ≥ 1000; the ID set must match this run's canonical repos exactly, and relative to the previous published version the only new IDs that may appear are those approved by whitelist `diff.added` (historical repos that fell out of the whitelist are kept) |
| rank referential integrity | the repo `id` of a staging all-time rank item must be in `lookup/repos.json`; the org `login` must be in `lookup/orgs.json` |
| `meta.folded_through` | does not go backwards relative to the previous published version (month/week monotonic) |
| `lookup/aliases.json` | alias integrity: no dangling (every alias id is still inside `lookup/repos.json`), no live-shadow (an alias's old name must not collide with some current repo's `full_name`), and the alias count is not smaller than the previous published version |
| canonical completeness | every bucket of `repos` / `repo-monthly` / `repo-weekly` / `repo-recent-daily` must exist and pass schema; repo key/id/bucket must be consistent; the three time series must not be entirely empty or reference an unknown repo; write a `canonical-manifest.json` containing the path, the record count, and the SHA-256 |
| `canonical/v2/repos/*` `d` factor | `d > 2` is still a warning; a historical repo missing a finite `d` is a hard failure, and a newcomer repo (one that has `tracked_since`) is explicitly modeled as `d=0` |
| `search/index.json` | `count` ≥ 1000 and `count == repos.length` (to prevent index drift) |
| `categories/registry.json` | non-empty; at least one `public` category |
| `categories/assignments.json` | v2 index or v1 monolith; assembled entry count ≥ 1000; each repo has `language` / `language_family` each ≥ 1, and `owner_kind` exactly 1; no unknown category reference; index + each shard's UTF-8 JSON < 1.50 MiB |
| `lookup/categories.json` | non-empty |
| sampled category-rank | take the first public category's `rank/category/<dim>/<slug>/all-time/repo/stock.json`, and every one of its items is already assigned to that category in assignments |
| full entities | every repo/org entity in lookup passes `RepoEntity` / `OrgEntity`; `stock_est` ≥ 0; head repos' `curve.monthly` is non-empty |
| previous-year heatmap | `heatmap/year/<Y-1>.json` is readable, and its fields are complete |

| Test | Where it runs | Assertion | Failure action |
|---|---|---|---|
| **staging validation gate** | Workflow `validate` step (Vercel) | the view sampled assertions in the table above + full canonical shard/ID completeness | `ok=false` → **do not cut the pointer**; what is live is still the previous version; the staging version is kept for investigation; write `canonical-manifest.json` and `validation.json` |
| **canonical shard equivalence** | unit tests (CI) + Workflow step | the result of "JSON shard pure-JS aggregation" == the result of "bootstrap DuckDB, same definition" (tolerance 0); DuckDB parity is only a legacy equivalence parity check for `folded_through <= seam`, not a post-seam oracle | CI blocks / step error |
| **publish-pointer atomicity** | integration tests | the versions the read side gets before and after the pointer cut are self-consistent; a request caught mid-cut gets the old version (not a half-publish) | CI blocks |
| **rollback is reversible** | integration tests | after pointing `views/latest.json.version` back to `prev_version`, the read side immediately gets the previous version back; `views/<prev>` is still there | CI blocks |
| **step idempotence** | unit tests | rerunning the step for the same `(run_id, shard)` → overwrites the same artifact, and does not accumulate again ([VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §8) | CI blocks |
| **authoritative Blob reads** | unit tests + Workflow preflight | page reads keep WAF tolerance; Workflow/control-plane and daily/weekly cron mutation input fail closed on 403, timeout, and pointer/schema errors, and an overlay non-404 error must not fall back to sealed bytes; a 404 of a required shard must also abort | CI blocks / do not acquire the lease or do not enter the mutation step |
| **fold pending completeness** | unit tests + Workflow step | every frozen month pending that the weekly fold needs must exist, and `period` must match the path; when one is missing, do not generate a zero-value week, and do not advance the watermark | CI blocks / step error |

- **fixture**: the real slice from §1.1 is likewise exported as a **canonical JSON shard fixture** (same source as the Parquet slice), and unit tests parity-check "shard recompute" against "DuckDB recompute".
- **Isolation**: Workflow validation only reads staging, and does not touch the `live/*` live tail; live-tail validation is still placed after the daily/weekly cron (see "cadence" below).
- **Current gap** (not executed inside the validate step, left as future work): org `stock == ∑members` equivalence, monthly ↔ recent-daily seam continuity, the `total_drift_pct` threshold, and completeness of the full historical period file set — these invariants are recorded in §1.3 but **currently do not block publish**, and serve only as test targets for §1.1/§1.4.

### 1.6 Site-wide search tests

`search/index.json` and client MiniSearch retrieval are tested on their own:

- `web/lib/search/core.test.ts`: MiniSearch assembly (prefix / fuzzy 0.2 typo tolerance / `starBoost` weighted by stars, with popular repos pinned to the top).
- The `searchIndex` case of `web/lib/workflows/recompute/entities.test.ts`: recompute derives the index from the `repos` dimension (entry count, fields, description truncation).
- contracts `SearchIndex` / `SearchDoc` schema contract tests (`web/lib/contracts/search.ts`).
- The full suite is run at once via `bun test lib/` (**current scale: 424 tests / 28 files**, used as a freshness anchor).

> **Alias- and category-related tests** (covering the logic that corresponds to the alias/category assertions inside the §1.5 gate above):
> - `web/lib/workflows/recompute/aliases.test.ts`: alias-map construction (union-retained `renames.json` increments → current id).
> - `web/lib/workflows/recompute/categories.test.ts`: derivation of category artifacts (registry / assignments / lookup / paged all-time category rank, public eligibility, curated bypassing `minimum_repo_count`).
> - `web/lib/categories/rules.test.ts`: deterministic category rules (slug normalization, language-family mapping, topic/keyword rules).

- **parity skip / boundary**: `web/lib/integration/recompute.test.ts` via `NO_DISK_REF` skips `search/index.json` (a derived view; DuckDB has no reference it can parity-check), listed alongside the live-artifact skip — the other views are still parity-checked byte for byte. This DuckDB disk reference is an equivalence reference only when `folded_through <= seam`; the post-seam formula is asserted by the synthetic fixture of `web/lib/integration/post-seam-oracle.test.ts` as `round(cumGross@seam * d) + Σ(post-seam net)`.

---

## 2. Visual regression (high signal — this is a site one "looks at")

The whole site is a visual SSG of server-rendered SVG + zero client JS, and the screenshot-diff signal is extremely high. Use **Playwright screenshots**.

- **Breakpoints**: 320 / 768 / 1024 / 1440 (aligned with the web testing rules)
- **Both themes**: light + dark are **both captured** (M3E light and dark modes are both first-class citizens; do not test only one set)
- **Key pages** (each page × 4 breakpoints × 2 themes):
  - Home: **year spine** (bar width = additions for the whole year, year labels)
  - Month page `/rankings/2024/10`: **calendar heatmap** + three core rankings (additions / growth rate / newcomers)
  - Year page `/rankings/2024`: a 12-month cell heatmap + yearly TOP
  - Repo detail page `/:owner/:name`: **full-history star curve** + milestone annotations
  - org page (the route is pending a PRODUCT decision, see ARCHITECTURE): an org-dimension curve + a member ranking
  - all-time overall ranking page
- Screenshots target a **fixed data snapshot** (use the real-slice fixture from §1 to build one deterministic site), to avoid daily data changes causing screenshot drift
- Baseline images are checked in; a diff over the threshold gets manual review (a reasonable change caused by a data update updates the baseline after approval)

---

## 3. Accessibility (a11y)

Align with the ARCHITECTURE "accessibility" section, combining automatic + manual:

- **Automatic axe checks**: run axe-core on key pages (home / year / month / repo), with zero critical/serious violations
- **Keyboard navigation**: every internal link can be Tab-focused, the Tab order is sensible, and the **focus state is visible** (M3 focus ring); no keyboard trap
- **prefers-reduced-motion**: when it is on, View Transitions / spring motion degrades or turns off (motion is pure CSS, and one must verify that the media query actually takes effect)
- **Contrast WCAG AA**: under both light and dark themes, text / on-* roles against surface all reach AA (guaranteed by the M3 tone mapping, but it must be verified by assertion)
- **SVG charts are accessible**: the star curve / heatmap carry `<title>` + `aria-label`, and there is a **visually hidden data-table fallback** (a screen reader can read the numbers, not just "a picture")

---

## 4. E2E key flows

Verify that the **mesh of internal links** is really connected (both SEO and the product depend on it; see SEO.md "internal-link strategy"). Use Playwright, and assert navigation rather than pixels.

- **Navigation graph connected through**: home → year page → month page → repo page → org page → all-time ranking, and any page is reachable within 3 hops
- **Previous/next period navigation**: the month page `← Sep | Nov →`, and the year page `← 2023 | 2025 →`, are always at the top and jump to the right place
- **Milestone link → month-page anchor**: clicking a milestone on the repo page lands on the correct anchor of the corresponding month
- **Ranking row → entity page**: a repo name in the ranking → the repo page; an org name → the org page

### 4.1 i18n locale URL, language dropdown, and cookie redirect

- Visiting `/`, `/pulse`, and `/rankings` with no `gsc_lang` cookie should render English; on a first visit to `/` with a non-default `Accept-Language`, middleware may 307 to the corresponding locale root.
- The language switcher shows the current route locale, and after it expands it lists `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, `fr`; every item is an ordinary `<a>` link.
- Clicking Japanese from English should navigate to `/ja/...`; clicking English from `/ja/...` should navigate back to the unprefixed URL; from any non-English language one must be able to switch back to English.
- `LanguageSwitcher` does not write `gsc_lang`, does not dispatch `gsc:localechange`, and does not rely on the client to refresh the current RSC view; after navigation the server returns the HTML of the corresponding language.
- `/api/lang?lang=fr&next=/rankings`, as a compatibility entry, should write `gsc_lang=fr` and redirect to `/fr/rankings`; `next=//evil.example` must fall back to an in-site safe path, to prevent an open redirect.
- Visiting an unprefixed page navigation with `gsc_lang=ja` (such as `/rankings`) should 307 to `/ja/rankings`; an explicit locale URL (such as `/fr/rankings`) must take priority over the cookie.
- Service worker must not cache HTML navigations or `/api/*` responses; a redirect from middleware / `/api/lang` must not be polluted by a stale HTML cache.
- After a language switch, `<html lang>`, UI copy, canonical, and the `hreflang` alternate should match the route locale; data fields such as repo name, language, topic, and numbers must not be translated.
- **locale URL × data-language neutrality**: one should test that `/`, `/ja`, `/rankings/2024/10`, `/zh-TW/rankings/2024/10`, `/:owner/:name`, and `/fr/:owner/:name` all return 200 (given a valid entity), that UI chrome is translated by route locale, and that data fields such as repo name/language/topic/numbers keep the source-data form.
- Use a deterministic wait (wait for an element / URL), **do not hard-wait on a timeout**, to avoid flaky

---

## 5. Performance (Core Web Vitals + the zero-JS red line)

Align with ARCHITECTURE "performance strategy". Lighthouse / CWV run on representative pages (home + one repo page + one month page).

| Metric | Target |
|---|---|
| LCP | < 2.5s |
| INP | < 200ms |
| CLS | < 0.1 |
| FCP | < 1.5s |

**Structural hard assertions** (more reliable than a Lighthouse score, and planned to be brought into later gates):

- **Content pages have zero client JS**: a bundle check — aside from one short inline theme-toggle script, a content page must not ship any client JS chunk. This is an architecture red line, and a regression is a fail
- **HTML < 20KB**: an assertion of the HTML size cap after key pages render (it directly cuts bandwidth; see ARCHITECTURE "Bandwidth defense ladder")
- **Font subset**: the Plus Jakarta Sans subset woff2 ≤ ~30KB; preload only the one weight that is truly critical
- **Chart size is fixed**: the SVG has an explicit width and height, to prevent CLS

---

## 6. Cross-browser

Playwright's three engines run the key pages, and the focus is the **progressive-enhancement degradation path**:

- **Chrome / Firefox / Safari** (chromium / firefox / webkit)
- Verify: scrolling, pure-CSS spring motion, **View Transitions fallback** (a browser that does not support them must degrade gracefully to no transition, with no error and no blank screen)
- Because content pages have zero JS, the cross-browser risk surface is small, and one mainly watches the fallback of new CSS features (`backdrop-filter` frosted glass, the `linear()` spring curve, and cross-document View Transitions)

---

## Planned gates

> **Do not confuse current CI, the production-data publish gate, and the target render gates**: ① The only GitHub **must-pass** gates are `verify / static` and `verify / production-build`. `preview-e2e` / `product-gates` still run when a Vercel Preview exists (Chromium responsive/overflow/axe / Search/Compare, plus exact-SHA Preview + public Blob read-only continuity); on Ignored Build / no Preview URL they skip (not a failure), and they are **not** ruleset required. The optional `verify / cf-preview` and `verify / cf-workers-host` are draft dual-runs of the CF migration P2/P3, and **must not** be added to GitHub required on one's own. CF preview acceptance goes through ops / manual (`pre.gitstarclub.com`). ② The Workflow `validate` step is the publish gate after a production-data recompute; it only reads staging `views/<run_id>/**`, and if it does not pass it does not cut the pointer; it does not render pages. ③ Lighthouse, visual baselines, the remaining full browser flows, and multi-engine coverage are still target coverage.

Status meanings: `enforced` = a current automated gate blocks merge; `soft` = when a Vercel Preview exists a job failure turns red, but it is not GitHub required, and when there is no Preview / Ignored Build it skips (not a failure); `manual` = a reviewer / operator may check by hand but it does not block automatically; `report-only` = there is a report or a baseline but it does not block; `planned` = the target is defined, and there is no committed gate yet; `not implemented` = there is no current tooling.

| Check | Status | Where it runs today | Notes / target gate |
|---|---|---|---|
| Node/Bun runtime pins | `enforced` | all GitHub Actions jobs: setup + `assert-runtime-versions.mjs` | Node 24.x, Bun 1.3.14; any mismatch fails before a project command runs |
| Documentation contracts | `enforced` | `verify / static`: root `bun run lint:docs` | a missing language fence, missing/illegal frontmatter, a broken backtick path, an omitted env, a duplicate route owner, and API route/version drift all block; a historical path is allowed only by an explicit reasoned allowlist |
| `lint` | `enforced` | GitHub Actions PR/`pre`/`main`: `bun run lint` | current PR blocker |
| TypeScript app | `enforced` | GitHub Actions PR/`pre`/`main`: `bun run typecheck` | Current PR blocker for production app code through `web/tsconfig.json` |
| TypeScript tests / integration | `enforced` | GitHub Actions PR/`pre`/`main`: `bun run typecheck:tests` | Current PR blocker for `*.test.ts(x)` and `web/lib/integration/**` through `web/tsconfig.tests.json` |
| TypeScript scripts / JS | `enforced` | GitHub Actions PR/`pre`/`main`: `bun run typecheck:scripts` | Current PR blocker for root scripts, pipeline `.mjs`, web `.mjs`, and `web/public/sw.js` through `tsconfig.scripts.json` with `checkJs` |
| Pipeline publication tests | `enforced` | GitHub Actions PR/`pre`/`main`: in `pipeline/` run `bun run test` | Interrupted uploads, resume, validation failure, lease fencing, single-pointer commit, and explicit rollback replay |
| Logic tests + coverage | `enforced` | GitHub Actions PR/`pre`/`main`: `bun run test:cov` | the `web/lib` suite and the `pipeline/lib` pure helpers it loads directly; lines/functions may not fall below 80% |
| Production `next build` | `enforced` | GitHub Actions PR/`pre`/`main`: `verify / production-build` | uses a local GET/HEAD-only bounded fixture; no write-capable credentials |
| Responsive / horizontal overflow | `soft` | GitHub Actions PR/`pre`/`main`: `verify / preview-e2e` | when a Vercel Preview exists, Chromium runs the committed responsive/overflow suites against the exact-SHA immutable deployment; on Ignored Build, skip |
| Axe serious / critical | `soft` | GitHub Actions PR/`pre`/`main`: `verify / preview-e2e` | when a Preview exists, for key routes in light and dark themes and for an open Search dialog that has results, serious/critical must be 0; when there is no Preview, skip |
| Search / Compare interaction recovery | `soft` | GitHub Actions PR/`pre`/`main`: `verify / preview-e2e` | when a Preview exists, Search Arrow/Enter/Escape/Tab, focus/compare toggle, and Compare index/curve retry are all Chromium blockers; when there is no Preview, skip |
| Live generation / period continuity | `soft` | GitHub Actions PR/`pre`/`main`: `verify / product-gates` | the same conditions as preview-e2e: skip when there is no Preview; when a Preview exists, parse `live/latest.json` with the same semantics as the page, and fail closed on a pointer/manifest/object-integrity anomaly |
| Live SEO acceptance | `soft` | GitHub Actions `pre`/`main` push: `verify / preview-e2e` → `bun test lib/integration/seo.test.ts` | runs only when an exact-SHA Vercel deployment has been resolved; skip on Ignored Build |
| 1.1 aggregation / ranking unit tests | `enforced` | the recompute / ranking / window / integration suites inside `bun test lib/` | coverage targets still follow §1.1 |
| 1.2 Zod schema contract | `enforced` | `bun test lib/` contract tests; Workflow `validate` samples staging views | full-artifact validation is still target coverage |
| 1.3 sanity invariants | `enforced` | Workflow `validate` step; related unit tests | the scope automated today is the sampled assertions listed in §1.5; the full §1.3 list is still target coverage |
| 1.4 golden file | `planned` | no independent gate | there are already tests of milestone fields/display logic; a manually checked golden baseline of ≥3 well-known repos has not landed on its own yet |
| 1.5 staging validate / pointer cut | `enforced` | Vercel Workflow `validate` step | `ok=false` does not cut `views/latest.json`; it is not a PR page-render gate |
| 1.5 full publish / rollback E2E | `planned` | no independent gate | the target is end-to-end verification of publish, rollback, and read-side atomicity |
| 2. visual regression | `not implemented` | no Playwright visual-baseline job | failure screenshots are already kept on file; the target is still key pages × 4 breakpoints × light and dark themes, with baselines checked in |
| 3. a11y (axe + keyboard) | `soft` | `verify / preview-e2e` | when a Preview exists, it enforces axe critical/serious, `/pulse` contrast, and Search keyboard/focus; when there is no Preview, skip; the remaining keyboard, reduced-motion, and manual review are still targets |
| 4. E2E navigation / i18n browser flows | `not implemented` | the Search/Compare subset is already in `preview-e2e` (when a Preview exists); there is no full navigation/i18n suite | the Search/Compare recovery flow blocks when a Preview exists; the remaining in-site navigation and i18n browser flows are not implemented yet |
| 5. Lighthouse / CWV | `report-only` | `docs/perf/CWV-25.md` historical baseline | target: automatic Lighthouse/CWV reports for representative pages; field INP needs RUM/CrUX |
| 5. zero JS / HTML / font budgets | `planned` | no independent budget gate | target: scripted structural checks, and block inside the gate |
| 6. cross-browser | `not implemented` | no Playwright multi-engine job | target: chromium / firefox / webkit key pages and progressive-enhancement fallback |
| Vercel preview visual/perf review | `manual` | Reviewer checks by the pages that changed | not a current automatic gate; suitable for adding a review signal before browser tooling lands |
| CF Preview Access dual-run | `report-only` | optional `verify / cf-preview` (`CF_PREVIEW_ENABLED=1`, `pre` only) | an Access Service Token probes `gitstarclub-web-pre.worldgo.workers.dev`; **must not** replace `preview-e2e` / `product-gates`; **must not** be added to required checks; see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md) |
| CF Workers host OpenNext dry-run | `report-only` | optional `verify / cf-workers-host` (`CF_WORKERS_HOST_ENABLED=1`, `pre` only) | fixture + OpenNext + `wrangler deploy --dry-run --env pre` (Worker `gitstarclub-web-pre`); **does not need Access**; must not live-deploy `gitstarclub-web`; must not replace the production must-pass; see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md) |
| CF preview Bearer full-refresh acceptance matrix (#488) | `manual` | ops scores it per [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix) | preview Bearer full refresh: `fold-decision.json` must be present; `no_closed_month` with no month/week plan counts as normal; after the recompute segments come `publish`/`gc`; OOM or Queue silence = failure; **H1** = page 500 after fold and **X1** red (same isolate OOM); **H2** = `liveHistory` >64 / newer-than-head when **X1** is green (#496). Production `triggers.crons` stays `[]`, and Vercel cron is not stopped. It is not GitHub required, and it does not open production schedules |
| CF live history >64 page 500 (#495) | `manual` | preview `GET /preview/health`, `GET /`, `GET /rankings` | after this PR is deployed to `pre`: health 200; `/` and `/rankings` 200 (may fall back to base / the previous published week / empty). Obs no longer turns `live generation history exceeds 64 entries` into a page 500. Matrix **H2**; tracked apart from #494 **H1** recompute OOM; production `triggers.crons` stays `[]`, and Vercel cron is not stopped |
| CF refresh week-start OOM after #497 (#498) | `manual` | preview Bearer full refresh; Blob `recomputeRank-week-pack` / `recomputeRank-week-*` / `publish.json` | after this PR is deployed to `pre`: it must pass week-start → week-pack → week period windows → `recomputeRank-week.json` → publish (preferably gc). Stuck at week-start + Obs memory limit ×3 / queue silence = failure. Production `triggers.crons` stays `[]`, and Vercel cron is not stopped |

**Cadence points**:

- **CI (every PR / `pre` push / `main` push)**: jobs pin and assert Node 24.x / Bun 1.3.14. The only **must-pass** items are `verify / static` (audit, Markdown/frontmatter, lint, the three typechecks, the view fixture, and coverage tests with the 80% dual threshold) and `verify / production-build` (run `next build` against the read-only local fixture). `verify / preview-e2e` runs Chromium axe/responsive/overflow and Search/Compare against the exact-SHA immutable URL only when a Vercel Preview exists; after Ignored Build it skips (not a failure), and `product-gates` has the same conditions. Lighthouse, the visual baseline, the remaining full browser flows, and multi-engine coverage still do not block. Do not add `cf-preview` / `cf-workers-host` as required.
- **Publish gate (refresh `validate` step)**: after a production full recompute writes artifacts to `views/<run_id>/**` (version=run_id), run the current sampled Zod + sanity of §1.2/1.3 on that version, and if any current assertion fails **do not cut the `views/latest.json` pointer** (what is live is still the previous version). Implementation: `web/lib/workflows/steps/validate.ts`; gate validation does not anchor `current_stars` (the stock curve is seam-anchored, stars are live, and the two are deliberately unequal).
- **Issue #326 lifecycle migration**: `web/lib/migrations/canonical-lifecycle.test.ts` covers published-whitelist membership, the first-seen day of immutable history, bootstrap-vs-newcomer discrimination, deterministic plan SHA, zero anchor guessing, full repository preflight, source/shard drift, exact confirmation, fenced execution, partial retry, validation failure, lease loss, and rollback. The production dry-run of `web/scripts/migrate-canonical-lifecycle.ts` is manually reviewed evidence, and is not put into CI's live/network gate; the default path must report `production_writes=0`, and must not load a write token. The execute/rollback runbook is in [OPS.md](./OPS.md).
- **Planned browser/render gates**: the visual baseline, full E2E navigation, Lighthouse, and cross-browser automation still need the corresponding tooling; a11y's axe serious/critical and the responsive overflow subset are already committed, they run when a Vercel Preview exists and skip when there is no Preview, and they are **not** GitHub required.
- **Daily / weekly cron**: does not trigger a deploy; live-tail schema/sanity alerts after cron writes `current_month.json` / `hot-snapshot.json` / `live/*` belong to ops targets, and are not the current PR CI gate.
- **Local / manual**: when changing aggregation logic, first run the relevant `bun test lib/...`; when changing a component, one may look by hand at the relevant pages' visuals, a11y, and performance on the Vercel preview, but these manual checks are not the current automatic PR blocker.

## Acceptance checklist

### Required current checks

- [ ] every CI job reports Node 24.x and Bun 1.3.14 after `assert-runtime-versions.mjs`
- [ ] root `bun run lint:docs` passes Markdown/frontmatter, repository-path, env-inventory, route/API ownership, and pinned-fact validation
- [ ] `web/` PR/`pre`/`main` CI passes `bun run lint`
- [ ] `web/` PR/`pre`/`main` CI passes `bun run typecheck`
- [ ] `web/` PR/`pre`/`main` CI passes `bun run typecheck:tests`
- [ ] `web/` PR/`pre`/`main` CI passes `bun run typecheck:scripts`
- [ ] `web/` PR/`pre`/`main` CI passes `bun run test:cov`, with line and function coverage both ≥ 80%
- [ ] `web/` PR/`pre`/`main` CI passes `next build` against the read-only fixture
- [ ] `verify / preview-e2e` and `verify / product-gates` soft-skip (non-failure) when Vercel reports Ignored Build / no Preview URL; they are not GitHub required checks
- [ ] when a Vercel Preview URL exists, that exact-SHA immutable deployment passes all three committed Playwright release suites
- [ ] when a Vercel Preview URL exists, `pre`/`main` push release verification passes `bun test lib/integration/seo.test.ts` against that immutable deployment
- [ ] When a production-data publish is involved, a Workflow `validate` failure still does not cut the `views/latest.json` pointer
- [ ] The reviewed dry-run before Issue #326 execution keeps the exact plan SHA; after execution, full canonical validation is complete, and a repeated dry-run is 0 changes
- [ ] Score the CF preview Bearer full refresh per [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md#preview-bearer-full-refresh-acceptance-matrix): `fold-decision.json` must be present; `no_closed_month` with no month/week plan counts as normal; recompute must pass the week-pack / week-* windows to `recomputeRank-week.json` and then `publish`/`gc`; being stuck at `recomputeRank-week-start`, OOM, or Queue silence counts as failure; production `triggers.crons` stays `[]`, and Vercel cron is not stopped

### Target-state / planned checks

- [ ] Aggregation / ranking unit tests cover flow / stock+anchoring / week-month-year-all-time boundaries / org sums, and run a real slice (Parquet subset + same-source JSON shard)
- [ ] Every JSON view has a Zod schema, with dual validation on output + build read
- [ ] sanity invariants (non-negative / delta bounds / ranking length and order / org==∑members / drift / seam) run against the full artifacts, and block publish
- [ ] staging validation gate: if it does not pass, do not cut the `views/latest.json` pointer; shard equivalence parity, and publish/rollback are reversible (§1.5)
- [ ] golden files cover the milestones and rankings of ≥3 well-known repos, and the values have been manually checked and frozen
- [ ] Visual regression: key pages × 4 breakpoints × light and dark themes, baselines checked in
- [ ] axe has zero critical; keyboard reachable + focus visible; reduced-motion takes effect; AA contrast; SVG has title/aria + a data-table fallback
- [ ] E2E: the navigation graph is connected within 3 hops, previous/next period navigation, milestone anchors, ranking jumps, and i18n locale URL navigation (`<html lang>` / canonical / hreflang / chrome translation consistent)
- [ ] Content pages have zero client JS (bundle assertion) + HTML < 20KB + font subset ≤ ~30KB
- [ ] CWV meets the targets (LCP<2.5s / INP<200ms / CLS<0.1 / FCP<1.5s)
- [ ] Cross-browser key pages pass, and View Transitions degrade gracefully
