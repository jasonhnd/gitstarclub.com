# Issue 748: history-free preview steady-state chain

## Goal

Prove an in-memory preview can publish a second managed refresh after a history-free cold start and aggregate import, using only the preview history-availability marker.

## Scope

- Extend the in-memory refresh chain: cold-start first publish, aggregate import that leaves `repo-monthly` empty, flags removed, marker set, second refresh publishes.
- Removing the marker returns the strict empty-monthly failure.
- A closed month with the marker still set folds from the pending snapshot into `repo-monthly`.
- Share one helper for the repo-monthly exemption in preflight family checks and final canonical validation.
- Reject a preview run when the marker read throws (403, timeout, invalid JSON).

## Out of scope

Production behavior changes, cold-start flags, manufactured monthly zeros, monthly values derived from the aggregate import, live calls, deployment, and branch switches.

## Acceptance

- The new chain test and the direct thrown-read tests pass.
- The full web coverage suite and the repository static gate pass, or pre-existing blockers are recorded.
