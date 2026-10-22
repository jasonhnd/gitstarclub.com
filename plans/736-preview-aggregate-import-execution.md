# Preview aggregate import execution

## Goal

Deploy the exact current merged `pre` containing PR #734 to
`gitstarclub-web-pre`, then import the sealed 2026-05-30 through 2026-09-30
aggregate history into `gitstarclub-data-pre`. Issue #736 / card GSC_0161
records the operation for independent review.

## Scope

1. Read the predecessor evidence, PR #734 runbook and
   `docs/analysis/PREVIEW-AGGREGATE-IMPORT.md`. Install pinned dependencies in
   one fresh detached shared clone of exact `origin/pre`.
2. Run the complete AGENTS archive bootstrap, offline static job and both
   fixture builds with matching host validation. Use the owner-approved
   shared toolchain and Bun caches; keep other output under this card.
3. Build against real preview data, validate the pre artifact, inspect every
   generated binding/variable/schedule, deploy through pinned cf and read back
   version, allocation, deployed commit and secret names only.
4. Outside cron windows, confirm idle workflow and live leases, record the
   read-only plan and inspect all imported/skipped entries and edge joins.
   Execute/resume only the approved Worker transport with the existing
   `--secret-file` and a retained checkpoint.
5. Run the supplied verifier, inspect three retained repository pages in
   English and Japanese, confirm unavailable repositories stay unknown, and
   compare workflow health. Record sanitized durable evidence and open one
   documentation PR against `pre` for the independent reviewer.

## Out of scope and prohibited operations

Production Worker/bucket/main, protected-branch pushes, merge, force push,
credential creation/request/rotation, cron/refresh or `/start` calls,
Wrangler/OpenNext, GitHub Actions enablement, schedule/DNS/route/secret
changes, manual object/pointer edits, coverage expansion and private manifest
uploads are excluded. The authorized importer alone publishes preview data
through its existing conditional lease and immutable generation protocol.
Do not run during 02:50-03:30 UTC daily or Sunday 03:50-08:00 UTC.

## Acceptance

- The exact deployed merged pre passes the full local gate; production and
  preview fixture artifacts validate. `cf:dry-run` is skipped by owner order.
- Real-source pre artifacts target only the preview Worker, DATA/JOBS/self
  bindings, preserve the three preview crons, contain no cold-start or fixture
  overrides, and set `SITE_INDEXABLE=0`.
- Deployment SHA/version and 100% allocation are recorded; the existing
  `CRON_SECRET` name is present without exposing its value.
- Idle leases precede execution. Actual import/skipped counts, complete skip
  list/reason totals, generation and recovery pointers are recorded.
- The approved verifier passes. React and two smaller retained repositories
  have matching daily/weekly aggregate data and visible source/gap notes in
  English and Japanese. Current star counts stay positive and unchanged;
  the six unavailable source repositories remain unknown. Preview workflow
  health remains ok.
- Verification commands/results, page evidence, limitations and final disk
  use are delivered in the PR and handoff. The executor does not perform
  final acceptance or merge.

## Progress

- Plan committed before deployment or import. Execution evidence follows in
  a separate completed step.
