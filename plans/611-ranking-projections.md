# Issue 611: Shared ranking projections and available archive children

## Goal

Address code-health findings A08, A09, A13, A14, and the ranking-detail portion of A15. Share server-rendered ranking presentation and typed data projections while preserving locale copy, display caps, period metrics, request budgets, and resolved navigation. Historical archive child links must reference published rank data.

## Scope

- `web/app/_localized/pulse.tsx`
- `web/app/_localized/rankings.tsx`
- `web/app/_localized/ranking-detail.tsx`
- `web/app/_localized/ranking-page-data.ts` (new)
- `web/app/_localized/ranking-ui.tsx` (new)
- `web/lib/rankings-archive.test.ts`
- `web/lib/ranking-detail-data.test.ts` (new)
- This required plan and before/after screenshot evidence under `plans/611-screenshots/`.

The issue's file list excludes repository/organization detail pages and locale copy tables. Those portions of A14/A15 remain outside this task.

## Out of scope and safety

Do not change the availability resolver, sitemap semantics, CSP, language switching, Star, infrastructure configuration, workflows, lockfiles, or deployment scripts. Do not access credentials, real data stores, platform APIs, or production endpoints. Do not merge or push protected branches. The feature branch starts at latest `origin/pre` (`b9650f0`) and the pull request targets `pre`.

## Implementation steps

1. Install pinned Node 24.20.0 / Bun 1.3.14 dependencies; record local baseline HTML and visual fixtures.
2. Extract row projections, detail reads/guards/category leads/timestamps, and repeated ranking presentation. Keep weekly optional panels absent and year/month metric reads explicit.
3. Probe historical December/final-ISO-week rank candidates at the archive caller; omit missing or unprobed children. Bound Cloudflare probes to protect the subrequest budget. Keep current resolved child targets unchanged.
4. Add sparse-history, cap, projection, metric, timestamp, locale, and request-budget regression coverage. Prove historical-link tests fail with the old calendar inference restored.
5. Capture desktop/mobile before and after pages for Pulse, all-time, year, month, week, and empty states. Run the full static job and local fixture builds at the final implementation commit in a fresh detached temporary worktree.
6. Push only `refactor/611-ranking-projections`, open one PR with `Closes #611`, and hand off to an independent Claude-family reviewer. Owner screenshot approval is required before merge.

## Acceptance and verification

- Sparse historic fixtures contain no child links to absent ranks. Resolved current navigation and localized labels remain intact.
- Pulse caps remain 8 movers / 6 giants / 8 anniversary entries; details remain 100 rows / 18 primary / 10 secondary / 3 related category entries.
- Full web suite and coverage thresholds pass, along with dependency audits, pipeline tests, docs lint, web lint, three typechecks, and view validation.
- Production build and pre-only Cloudflare dry run use a local read-only fixture under a clean environment.
- Behavior-fix regression tests fail under the old archive inference and pass after restoration.
- All temporary scripts, logs, and verification trees live in `/tmp/GSC_0055/` or the system temporary directory. No lockfile churn; final `git status --short` is empty.

## Implemented behavior and review notes

- `ranking-page-data.ts` owns typed row projection, explicit per-period reads, required-view guards, leading category selection, timestamp precedence, named caps, and shared detail structured data.
- `ranking-ui.tsx` owns the identical overview empty state and period-switcher labels, plus the reused detail panels. The detail empty-state shape remains a separate variant.
- Archive candidates are December and the final ISO week of each historical year. Each candidate is shown only after `getRank` returns a published view, including recovered live-only ranks. Missing candidates are omitted; this task does not scan backwards to discover a different child.
- Current resolved month/week children require no additional probes. Historic probes are bounded at 24 on the ordinary host and 4 on Cloudflare (newest candidates first). Unprobed older children are omitted, while the year links and year-spine totals remain visible.
- Timestamp selection keeps the existing first-valid-candidate precedence; it does not select the newest optional-panel timestamp.
- Exact local output comparison against base `b9650f0`: all 70 populated/empty HTML fixtures (five page families, seven locales) are identical. A separate sparse historical fixture changes only the two absent child links.

Local rendering uses fixed, synthetic data and the real server-rendered page components. Screenshot fixtures use the repository's Tailwind CSS and locally served Plus Jakarta Sans / Geist Mono fonts, with Edge at 1440 x 1000 and 390 x 844, light mode and reduced motion. These fixtures do not hydrate client islands and do not establish deployed behavior. Owner screenshot sign-off and independent Claude-family review remain required before merge.

## Regression fault checks

In a disposable detached worktree at implementation commit `4e6e098`, restoring the old `latestMonthForYear` / `latestWeekForYear` calendar inference at the archive caller caused `bun test lib/rankings-archive.test.ts --isolate` to fail (9 pass / 10 fail, exit 1), including both English and Japanese rendered-page tests. A separate one-at-a-time fault moving the detail row cap after the lookup join caused `bun test lib/ranking-detail-data.test.ts --isolate` to fail (25 pass / 1 fail, exit 1). Restoring both files yielded 45 pass / 0 fail, exit 0. The disposable tree was clean before removal. Logs remain outside the repository in `/tmp/GSC_0055/`.

The full static run exposed an existing source-contract test requiring the detail page's Cloudflare category-assignment guard to remain at its caller boundary. The page retains that host-policy wrapper and passes it into the shared loader; the shared loader still owns leading-ID selection and projection. No out-of-scope test was changed. A fresh final-head verification replaces that initial failed run.
