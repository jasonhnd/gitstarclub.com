# Issue 746: apply history availability to canonical completeness

## Goal

Allow the honest absence of monthly history in preview only when card A's
validated history-availability marker explicitly declares it unavailable.

## Scope

- Read the marker for the final windowed preflight family check and final
  canonical validation, using the existing preview guard and pure reader.
- Exempt only a zero monthly repository-key count; preserve required files,
  schemas, repository identity, anchoring factor `d`, orphan checks, and non-empty
  weekly and recent-daily families.
- Add regression tests for valid, absent, malformed, and production markers and
  update the completeness contract and preflight documentation.

## Out of scope

- Publication history gates, live calls, deployment, and platform configuration.
- Cold-start flags, manufactured monthly data, and aggregate-derived monthly net.
- Branch changes and repository copies; verification uses the current checkout
  under the owner's workspace rule, with caches/logs in `.kanban-work/746/`.

## Acceptance

- A valid preview marker permits zero monthly keys in both family checks.
- Missing or malformed markers retain existing failure messages; production
  remains strict, including conflicting preview/production signals.
- Every other completeness and integrity check remains enforced.
- Focused tests, the full offline web coverage suite, static checks, and local
  fixture builds pass using Node 24.20.0 and Bun 1.4.2 where available.
