# Issue 613: Index empty state and optional comparison reads

## Goal

Explain a valid empty organization index and keep the comparison workbench available when optional example reads fail. Reuse the identical server-rendered hero facts without changing successful HTML.

## Scope

- `web/app/_localized/org-index.tsx`
- `web/app/_localized/compare.tsx`
- `web/app/_localized/categories.tsx`
- `web/app/compare/CompareClient.tsx` only if required; preserve retry and abort behavior.
- New `web/app/_localized/comparison-page-data.ts`
- New `web/lib/index-compare-resilience.test.tsx`
- This required plan and committed screenshot evidence under `plans/613-screenshots/`.

## Out of scope

No data-source or authoritative write changes, dictionary changes, deployment, live storage, platform APIs, credentials, CI changes, merge, or push to protected branches. Use local fixtures only. Keep temporary fixtures, logs, and verification checkout under `/tmp/GSC_0057/`.

## Steps

1. Install frozen dependencies using checksum-verified Node 24.20.0 and Bun 1.3.14; commit this plan.
2. Add localized index pending copy, isolate optional example reads with diagnostics, and share hero facts; commit implementation and regression tests.
3. Verify full static job, fixture production build, and pre-only CF dry run in a fresh detached checkout. Confirm regression tests fail with the behavior fixes removed.
4. Capture desktop/mobile before and after for empty, partial-error, and success states, document evidence, and commit it.
5. Push only `refactor/613-empty-states`, open a PR against `pre` with `Closes #613`, and hand off to the Claude-family reviewer. Owner screenshot sign-off is required before merge.

## Acceptance

- Null or empty organization lookup renders localized pending text on the valid index route; successful markup stays unchanged.
- A rejected optional curve read skips only its example pair, retains diagnostics, and renders the remaining summary and workbench. Missing curves and missing IDs remain normal omissions.
- Authoritative metadata/index failures still propagate. Client retry, cache bypass, and stale-request cancellation remain intact.
- Successful comparison/category HTML matches the baseline in every locale.
- Complete static job, production fixture build, and pre-only dry run pass. Regression faults produce nonzero test exits; restored tests pass.
- No lockfile churn or temporary untracked files remain. All repository prose is English.

## Delivery status

Implementation and verification pending.
