# Astro second integration sync

## Goal

Resolve #735 by syncing `feat/astro-site` at `3014d75` with `pre` at `f7601df`,
carrying PR #728 (preview schedules), #729 (aggregate history import) and #731
(weekly source mix) into the Astro host.

## Scope

1. Install the pinned dependencies, then commit this plan on the card branch
   based on `origin/feat/astro-site`.
2. Merge `origin/pre` with a merge commit. Preserve both hosts and the shared
   importer/recompute changes without rebasing shared history.
3. Align Astro configuration, host validation and gate expectations with the
   web preview's daily, Sunday weekly and Sunday managed-refresh schedules.
   Remove the same first-publication flags; production stays queue-only. Test
   the actual built Astro scheduled entry and shared dispatch behavior locally.
4. Reuse the shared mixed-source dictionary keys on Astro weekly ranking and
   pulse surfaces. Add regression/parity coverage and update host documentation.
5. Investigate About-page largest contentful paint (LCP, when the largest visible
   element appears). Fix a cheap cause or document measured evidence and limits.
6. Verify the exact final commit in one fresh shared detached clone, open one
   PR to `feat/astro-site` (explicit brief exception), and hand off for review.

## Out of scope

No PR merge, deployment, protected-branch push, force-push, shared rebase,
Wrangler or forbidden packaging command, remote cron/refresh invocation,
remote configuration/secret/data mutation, CI or delivery workflow change,
or coverage expansion. GitHub Actions stays disabled. `cf:dry-run` is skipped
by owner order. Only the explicitly authorized source scheduling configuration
and related gates may change.

## Acceptance

- Recheck official toolchain archives and Node v24.20.0/Bun 1.4.2 binaries;
  use the owner-authorized shared toolchain and HOME Bun cache. All other
  temporary output stays in this card's workspace directory.
- Run the complete AGENTS static job, full web coverage suite, and local
  GET/HEAD fixture production/pre builds with matching host validation.
- Run Astro `verify:local`, `bun audit --audit-level=high`, every P1-P7 runner
  (including actual Worker with 30000 ms timeout, HTTP parity and queue-budget),
  and the design lint.
- Run explicit root production/pre builds and matching host validation: pre
  contains exactly the three schedules; production contains none.
- `crawl:local` reports zero internal 404s and HTTP errors; `perf:local` passes
  all page budgets and records the About-page investigation.
- Record exact-head commands/results, screenshot evidence for source-note UI
  changes, owner skips and remaining limitations in the PR. Commit each step,
  deliver a clean checkout, remove disposable copies/builds/logs, and report the
  final card-directory size in the handoff.
