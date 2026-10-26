# Reapply issue 818

## Goal
Restore singular and plural visible-row counts while preserving issue 785 observation-start dates.

## Scope
Cherry-pick 45eb918 on the current branch, resolve the format import conflict, and run the requested web and Astro verification.

## Out of scope
Deployment, secrets, branch changes, and committed screenshots.

## Acceptance
Exactly one new commit with the original cherry-pick reference, no conflict markers, both features preserved, and the requested verification passing.

## Result
Resolved the sole import conflict by retaining dateLabel and removing the unused formatInteger. Observation-start imports and behavior remain intact.

The requested install, web coverage, Astro preview build, Worker tests (30-second timeout), and Astro tests all passed. Web: 2,225 passed, 49 skipped, zero failed; coverage: 90.20% lines and 90.76% functions. Worker: 22 passed. Astro: 420 passed. Verification used Bun 1.4.2 and Node 24.21.0. Temporary artifacts stayed in .kanban-work/818 to honor the workspace restriction. No conflict markers remain.
