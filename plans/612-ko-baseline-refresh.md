# Korean successful-page baseline refresh for PR #637

## Goal

Resolve the stability-test conflict introduced when PR #637 incorporated #636.
Issue #612 intentionally replaces English conjunctions in Korean category lists.

## Scope

Update only the affected Korean successful-page hash in
`web/lib/index-compare-resilience.test.tsx`, explain its provenance, and preserve
all other baseline values. Keep this plan and PR verification records current.

## Out of scope

Product code, other locales, CI/configuration, deployment, platform APIs,
protected-branch pushes, force pushes, and PR merges.

## Acceptance

- Capture fixture HTML before and after the intended formatter change; confirm
  differences occur only in Korean category conjunctions.
- Preserve all six other locale baselines and the Korean org/compare baselines.
- Pass the entire resilience test and the complete documented static job on a
  fresh detached worktree of the final commit with verified pinned tools.
- Pass the documented fixture builds and required GitHub `static` and
  `production-build` checks; update PR #637 verification to the new head.
- Leave the working tree clean and hand off to independent Claude-family review.

## Baseline evidence

The original formatter from `pre b9650f0` was injected only into a temporary
capture test under `/tmp/GSC_0068`; repository product code stayed untouched.
All 21 captured pages then matched the original hashes. With the issue #612
formatter, 20 HTML strings remained byte-identical. The Korean category page
changed in exactly three places: the summary, visible FAQ answer, and FAQ
structured-data answer. Each change replaces the English conjunction with the
Korean conjunction; substituting those three tokens reconstructs the entire new
HTML byte for byte.

Only `baseline.ko.categories` changes from
`b7aba71b96bbd7cd43d976e849bcc1e8ac93cb15dbfbc0cd2ad8dccb62615e5e` to
`6c37f0a641aa887b228fc1bf51f3b75f02fe593c072301aa3562448ae6dd133c`.
All 18 hashes for the other six locales and both remaining Korean hashes stay
unchanged. The test label now refers to the documented baseline to account for
the intentional exception. Captured HTML, logs, and the exact replacement proof
are temporary verification artifacts under `/tmp/GSC_0068`.
