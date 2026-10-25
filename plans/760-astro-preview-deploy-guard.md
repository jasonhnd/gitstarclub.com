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

## Results

Implementation commit: `e9c2bc3`.

- `cd astro && bun run test`: 180 passed, zero failed, including four preview trigger tests.
- `cd astro && bun run typecheck`: passed.
- `cd pipeline && bun run test`: 205 passed, zero failed.
- Web lint, all three typechecks, graph validation, and fixture view validation: passed.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`: 2,172 passed, 49 skipped, zero failed; line coverage 90.05%, function coverage 90.70%.
- `node scripts/assert-cf-ci-gates.mjs`: passed; source preview and production contracts remain unchanged.
- Static checks used checksum-verified Node v24.20.0 and Bun 1.4.2 in a clean environment without live-service opt-ins. The Astro tests ran with Bun 1.4.2 and card-local `KANBAN_TMP`.
- The full static job is not green: existing high-severity `undici` and `zod` dependency advisories fail both dependency audits. Existing unresolved references to `scripts/perf-local.ts` and `scripts/perf-metrics.ts` in `plans/astro-accept-1-baseline.md:24` fail documentation lint. Those files and dependency pins are unchanged by this card.
- Local builds were not run because this card forbids platform CLI calls. No deployment, platform CLI, or remote schedule mutation ran.
- GitHub CLI authentication is unavailable, so this card could not open its pull request against `pre`. The current branch remains `ib/gsc-760`.

Logs and generated verification output remain under `.kanban-work/760/` (locally ignored).
