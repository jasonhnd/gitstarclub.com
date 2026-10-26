# Issue 783: home yearly state rework

## Goal
Apply Pulse's existing annual availability rule and localized empty state to the home year column and year leader card in all seven locales.

## Scope
Share the rule and row filter between home and Pulse. Reuse existing dictionary copy. Verify unavailable annual data (both fallback navigation and explicitly null freshness), populated annual data, and unaffected monthly gains in English and Japanese. Inspect footer and About this data dates without changing their behavior.

## Out of scope
Published data, pipeline changes, date behavior changes, deployment, secrets, new pages, and committed screenshots.

## Acceptance
Home and Pulse show the existing localized yearly empty state in both placements when annual coverage is unavailable. Published annual rows remain visible. The requested build, full web coverage suite, Worker checks, and Astro tests pass. A local 1440px light-mode home screenshot is available outside Git.

## Date investigation
- Home summary: `astro/src/packages/p1/pulse.tsx:103` resolves `asOf` from the first usable value of `hot-snapshot.json.generated_at`, active weekly ranking `meta.generated_at`, then active monthly ranking `meta.generated_at`. This is first-valid priority, not the maximum date (`web/lib/geo-capsules.ts:60`). It returns that summary with the body and `astro/src/packages/p1/page.ts:37` passes it as page `asOf` through `astro/src/packages/p1/Page.astro:9` to Layout.
- Pulse summary: `astro/src/packages/p5/PulseBody.tsx:40` uses the same snapshot/week/month priority; `astro/src/packages/p5/PulsePage.astro:11` passes it to Layout.
- Footer: `astro/src/layouts/Layout.astro:17` prefers the supplied summary `asOf`, then passes it to Footer at line 51. `astro/src/components/Footer.astro:19` appends that formatted value to `dictionary.footer.dataThrough`. When a summary is absent, the fallback is global `meta.generated_at`, then `meta.backfilled_at`, then `meta.folded_through.month` (`web/lib/geo-capsules.ts:83`). It does not read the release publication date or `data_as_of.seam_date`.
- About this data: home loads `getMeta()` into `aboutMeta` (`astro/src/packages/p1/pulse.tsx:77`) and supplies it to AboutThisDataContent. `astro/src/components/AboutThisDataContent.tsx:34` reads `meta.generated_at`, falling back to `meta.backfilled_at`; lines 35 and 42 render its UTC calendar date. The citation uses the same date at line 39. This is global metadata from the captured publication, not the summary timestamp and not `meta.seam_date` or release `data_as_of.seam_date`.
- Release identity: `astro/src/packages/p1/page.ts:32` and `astro/src/packages/p5/PulsePage.astro:15` pass `data.publication.views.version`; `astro/src/components/AboutThisDataContent.tsx:46` displays it. The version string is not parsed to determine either visible date, and `views/latest.json.published_at` is not used for either date.
- Read-only preview inspection of `https://pre.gitstarclub.com/pulse` confirmed summary/footer October 25, 2026, About this data Oct 26, 2026, and release `refresh-2026-10-26T04-37-06-584Z`. Different source and publication dates are expected by the #808 design: the footer follows the page summary, even when the global metadata reflects a newer publication. No date behavior changed.
- Recommendation: retain the summary-aligned footer; consider separately clarifying the About this data label as the publication metadata date.

## Remaining Pulse gain
Read-only preview inspection found the remaining `+1.8k` in the weekly panel: rank 5, `Nutlope/hallmark`, week `2026-W44`. It is not an annual leftover and remains unchanged. Tests additionally preserve a same-sized synthetic monthly gain when annual data is unavailable.

## Verification
- Dependencies: root, pipeline, web, and Astro frozen-lockfile installs passed; no lockfile changes. Runtime contract passed with Node v24.21.0 and Bun 1.4.2.
- Build first: `cd astro && bun run build:pre` passed before the built Worker and page tests.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`: 2,451 tests passed, zero failures; coverage gate passed at 90.47% lines and 91.05% functions.
- `cd astro && bun run test:worker -- --timeout 30000`: 23 tests passed, zero failures.
- `cd astro && bun run test`: 428 tests passed, zero failures after fixing the new test matcher to ignore React HTML text-boundary comments. Home and Pulse fallback, explicitly unavailable, and populated annual cases pass in English and Japanese.
- Additional checks: pipeline suite passed (208 tests); web lint (zero errors, existing warnings), typecheck, typecheck:tests, typecheck:scripts, validate:views, validate:graph, runtime contract, and Cloudflare CI gate assertion passed.
- Existing unrelated failures: pipeline dependency audit reports high-severity findings in transitive undici and zod; lint:docs reports unresolved paths in older plans (760, 779, 781, and astro-accept-1); Astro typecheck reports missing `currentMonth` and `monthHeat` in `tests/p5/on-this-day.test.ts:54`. These were left outside this display-only rework.
- Final review capture: serve the built preview with `homeYearFixture("fallback")`, which retains saved snapshot fragments but has no published annual rankings. Use a fresh Playwright Chromium context, light mode, width 1440, and capture through both annual empty placements and the leader cards to `~/evidence-783/en-1440-home.png`. The screenshot and local evidence scripts remain uncommitted.
- All commands ran in the current repository and branch; no deployment or published-data writes.
