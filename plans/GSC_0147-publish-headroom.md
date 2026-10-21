# Refresh publication operation headroom

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
