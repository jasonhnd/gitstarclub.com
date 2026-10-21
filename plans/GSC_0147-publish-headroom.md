# Refresh publication operation headroom

Issue: #723. Base: `pre` at `6bd2728e30a5ab956cb28702d461db072cd329c1`.

## Goal

Reduce the peak per-invocation publish cost at 5,669 repositories and owners,
following review P2 of PR #722, without changing the publication commit point.

## Scope

- Measure the existing fake counter and retain before/after counts in the PR.
- Page post-commit IndexNow derivation by repository and organization, using
  the existing candidate selection and submission limits.
- Keep the pointer switch, immutable intent, recovery writes and fencing intact.
- Add regression checks for operation ceilings, replay, notification equivalence
  and post-commit failure handling; remove budget-test debug logging.
- Update the operations note for the changed publish sequencing.

## Out of scope

No coverage expansion, public data contract changes, live endpoint calls,
deployment, R2/secrets changes, CI/configuration changes, protected-branch pushes
or merges. The executor only opens a PR against `pre` for independent review.

## Steps

1. Confirm PR #722 is merged, install pinned dependencies, measure the baseline,
   and record this plan.
2. Implement bounded post-commit pages with durable predecessor state and tests;
   commit the code, tests and operations note.
3. Run the complete AGENTS.md bootstrap/static/build blocks in a fresh detached
   shared clone of the exact final commit; push only this card branch and open
   one issue-linked PR against `pre` with verification and operation counts.

## Acceptance

- Publish invocations stay well below 600 modeled operations, including queue
  overhead and enabled IndexNow submission fetches, at the existing 5,669 scale.
- Combined notification candidates match the existing derivation; publication
  remains atomic and fenced, and page replay cannot change rollback metadata.
- The full offline static job, full web coverage suite, and both fixture-backed
  production/pre builds and host validations pass on the exact head.
- The PR includes `Closes #N`, before/after counts, commands/results and risks;
  the card is handed to review with a clean working tree and no merge.

## Implementation evidence

The baseline publish peak was 863 modeled operations (865 with two IndexNow
POSTs): 850 reads, one lease read, nine writes, one invalidation and two queue
operations. Up to 800 reads compare 200 repository and 200 organization entities
across the old and new versions. The three new runtime invocations measure 23,
452 and 455 operations, including both simulated submission POSTs. The retained
serial helper and rollback still use the existing publication core.

The focused budget suite passes 20 tests. It checks candidate/payload equivalence,
all three page replays, lost progress after commit, best-effort derivation failure,
missing predecessors and lease takeover before/during post-commit work. Final
delivery still requires the full exact-head gate described above.
