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
