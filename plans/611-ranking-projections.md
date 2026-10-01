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
