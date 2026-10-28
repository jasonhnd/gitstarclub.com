# Footer summary date alignment

## Goal

Make the footer use the same resolved date as the home and all-time rankings summary.

## Scope

- Pass the summary date resolved during page rendering into the shared layout.
- Retain the global metadata fallback for pages without a resolved summary date.
- Add English and Japanese regression coverage with different global, snapshot and ranking dates.
- Document the date precedence and run the complete Astro and web verification suites.

## Out of scope

Deployments, merges, branch changes, repository copies and new page routes. Verification runs on the current branch inside ~/w, following the owner's workspace override. Screenshots are never committed; any visual evidence goes in ~/evidence as explicitly authorized by the owner.

## Acceptance

- Home uses its snapshot-first summary date in the footer.
- Rankings uses its ranking-first summary date in the footer, falling back to snapshot data.
- Pages without a summary retain the metadata fallback.
- Regression assertions distinguish all three metadata sources and cover English and Japanese.
- Complete Astro tests and relevant static/build checks pass or existing failures are reported.

## Verification and evidence

The implementation is in ec0d25a; 8d3c06e corrects the regression assertions to use the shared date-label formatter directly. Verification used Node v24.20.0 and Bun 1.4.2. Official archive checksums passed, and the installed Bun binary matches the verified archive byte for byte. All commands ran in the current checkout under the owner's workspace override; caches, profiles and logs are under `.ktmp/`.

- Astro preview build, built-Worker checks: 7 passed, zero failed.
- Final full Astro suite: 351 passed, zero failed, 2,591 assertions. Astro typecheck and dependency graph pass.
- Astro preview and production builds plus matching host validators pass. Both modes pass all 18 local aggregate-import guard cases.
- Full web coverage suite: 2,172 passed, 49 skipped, zero failed; line coverage 90.05%, function coverage 90.70%; coverage gate passes.
- Web lint, all three typechecks, dependency audit, dependency graph and generated-view validation pass. Runtime and Cloudflare configuration gates pass.
- Pipeline full suite: 205 passed, zero failed. Its dependency audit still reports existing high-severity undici 6.28.1 and zod 4.1.11 advisories; no dependencies changed.
- Both web build modes and matching artifact validators pass: 234 routes and 467 artifacts each.
- At the recorded time, documentation validation failed on four existing unresolved references to the root paths for [performance runner](../astro/scripts/perf-local.ts) and [performance metrics](../astro/scripts/perf-metrics.ts) in `plans/760-astro-preview-deploy-guard.md` and `plans/astro-accept-1-baseline.md`. No new reference error was introduced by that card.
- Before/after screenshots for home and rankings in English/Japanese at 1440 and 390 pixels are saved outside the repository at `~/evidence/779-r1/`, with extracted summary/footer text in the accompanying JSON files. Only Playwright-bundled Chromium with fresh temporary profiles was used. Before evidence temporarily uses the reviewed layout source; the fixed source was restored and rebuilt afterward.
- The skewed fixture uses global July 20, snapshot July 18 and ranking July 16. Before, all four route footers showed July 20. After, home footers match July 18 summaries and rankings footers match July 16 summaries. Regression tests also verify missing rankings fall back to July 18 and About retains the July 20 global fallback.
- No screenshots, generated files, lockfile changes or browser profiles are committed. No deployment, remote data mutation, branch switch or merge was performed.

Logs: `.ktmp/astro-verification.log`, `.ktmp/final-astro-verification.log`, `.ktmp/static-verification.log`, `.ktmp/docs-verification.log`, `.ktmp/web-build-verification.log`, and `.ktmp/evidence.log`.
