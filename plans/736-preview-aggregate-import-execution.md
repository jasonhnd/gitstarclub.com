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

- Exact merged pre `96b6189` passed the isolated AGENTS gate and both fixture
  builds, then the real-source pre build and artifact validation.
- Preview deployed as version `5907d936-3ec4-43b1-9d0e-d5f20f45b3df` at 100%;
  public identity/config/secret-name readback passed.
- Complete read-only plan passed: 5238 imports, 441 skips, 649512 daily and
  89046 weekly additions, 10476 incomplete edge joins. Every import, skip and
  edge join was checked; the full skip list exactly matches GSC_0154.
- The actual import is intentionally paused/unpublished for continuation at
  `2026-10-22T03:30:00Z`. The observed base-write rate cannot finish before
  the forbidden daily window. Token 5 is released; the same checkpoint is
  retained with terminal `failed` status through normal publisher cleanup.

## Continuation checklist

1. Read this plan, the execution report, the card comments and the original
   PR #734 runbook. Recreate at most one detached operator clone under this
   card's `KANBAN_TMP`, using the exact deployed SHA
   `96b618933baadab7ebb622580c3da05efbb15f5f`. Recheck official toolchain
   archives/binaries and install frozen dependencies before work. No owner
   environment files; keep the shared toolchain/Bun cache overrides.
2. After `03:30 UTC`, read back deployment identity, workflow lease and
   `live/latest.json`. Wait for any scheduled writer to release its own lease;
   never release another writer's lease. Preserve the historical before files.
3. Keep generation `bootstrap-aggregate-gap-20261022T001946Z` and
   `$KANBAN_TMP/aggregate-checkpoint.json`. Do not reset either. Recovery
   canonical is sealed at 134 objects; recovery base stopped at 220/10775.
   Partial immutable objects must remain in place for idempotent resume.
4. Record a fresh resume preflight and read-only plan. Review any pointer or
   report difference before executing. Daily cron may legitimately advance
   the live pointer while this card is waiting. The temporary `operator.sh`
   includes an extra equality check against the *original* live baseline;
   use a separately recorded, reviewed resume baseline or the original
   runbook commands after fresh checks. Do not silently bypass a changed
   bootstrap/views source or an immutable conflict.
5. Run the exact approved same-generation import command with the existing
   secret supplied only by `--secret-file` and the retained `--checkpoint`.
   The reviewed client can acquire a new token after the released session.
   Keep foreground polling and the scheduled-window guard in force. If a
   long operation requires handoff, follow the board's explicit waitingOn
   rule and never claim that publication has finished without its result.
6. After a real successful publication, the retained `post-verify.sh` wraps
   the original verifier/inspection, extra unavailable/positive-star/weekly
   page checks, health reads, six after screenshots and evidence recording.
   Read these temporary scripts before use. Preserve the six before captures.
7. Update actual counts/pointers/page evidence, commit, run the complete
   AGENTS gate on the exact final delivery head in one fresh detached clone,
   clean temporary output, push only this card branch and open one PR into
   `pre` with `Closes #736`. No PR or final acceptance is complete yet.

Retained operational state lives only in `.kanban-work/GSC_0161/`: generation,
checkpoint, before/pause/plan JSON, sample screenshots and operator/verification
helpers. The source bundle and secret remain at their original owner-managed
locations. The detached clone can be removed while waiting and recreated for
continuation; never delete the checkpoint or partial remote generations.
