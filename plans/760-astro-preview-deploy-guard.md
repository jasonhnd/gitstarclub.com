# Astro preview deployment guard (#760)

## Goal

Allow the current preview trigger contract through the deployment guard while rejecting drift.

## Scope

- Reuse the existing shared preview schedule list in a testable trigger assertion.
- Require exactly one preview queue and all three schedules, with no routes or other triggers.
- Update the host documentation and add acceptance and rejection tests.

## Out of scope

Deployment, platform CLI calls, schedule/configuration changes, production changes, and branch changes.

## Acceptance

- The real preview contract passes; missing, extra, duplicate, wrong-queue, and route triggers fail.
- `cd astro && bun run test` passes with card-local `KANBAN_TMP`.
- Other deployment assertions remain unchanged and no deployment executes.

## Verification approach

Use the current checkout as required by the owner; do not create a detached copy or switch branches. Keep temporary files and logs in `.kanban-work/760/` and run checks without live-service opt-ins.
