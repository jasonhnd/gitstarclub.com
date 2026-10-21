# Issue 687: Aggregate star-history labels

## Goal

Explain the surviving-star source and approximate UTC day boundaries for the
approved 2026-05-30 through 2026-09-30 daily and weekly data in all seven locales.

## Scope

1. Install the pinned toolchain and dependencies; inspect GSC_0090's provenance.
2. Accept its exact provenance object on daily curves and weekly rank metadata.
   Require both provenance and displayed-date overlap; reuse server-rendered
   chart and text components. Keep monthly totals and their curve untouched.
3. Add localized dictionary copy, show/hide regression tests and contract docs.
4. Capture English/Japanese repository, weekly and monthly before/after evidence.
5. Run the full static gate and fixture production build in a fresh detached
   local clone of the exact head, then open one PR into `pre` for review.

## Out of scope

Data fetching/publication, coverage expansion, monthly reconstruction, runtime
search/AI, new client islands, deployment, CI changes and merging. No Wrangler
or OpenNext command runs; skip `cf:dry-run` by owner order. Never push `pre`,
`main` or `preview`, force-push, rebase shared branches or call refresh endpoints.

## Acceptance

- Marked daily dates and ISO weeks overlapping the approved range show natural
  copy describing GitHub's summary of stars still present at collection time and
  approximately UTC day boundaries that may differ by a few hours.
- No source note for unmarked/outside-range data or monthly rankings; published
  monthly values remain unchanged. Missing data never becomes zero.
- Tests cover source validation, date/week edges, all seven locales and rendering.
- PR closes #687, includes before/after screenshots for English/Japanese repo,
  weekly and monthly pages, exact-head local verification results and limitations.
- GitHub Actions stays off; independent review owns acceptance and merge.
