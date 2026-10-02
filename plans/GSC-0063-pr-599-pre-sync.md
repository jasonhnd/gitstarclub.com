# PR #599 integration synchronization

## Goal

Merge the latest `origin/pre` into `docs/576-docs-set-b` with a merge commit,
resolve documentation conflicts, and retain the #574 runbook fixes in #599.

## Scope

- Resolve overlapping documentation edits without introducing new operating facts.
- Keep the current-host rewrite and the historical files under `docs/archive/`.
- Retain incoming publication locking, stage-4 gates and builds, deployment
  identity, redirect protection, error sanitization, and any local rehearsal or
  R2 timeout documentation present on the fetched integration branch.
- Keep the first-publish recovery, bootstrap acceptance, and stage-4 rollback
  instructions consistent between `docs/R2-CUTOVER.md` and `docs/OPS.md`.
- Update the existing pull request body with `Closes #574`, the tested head,
  conflict decisions, and verification evidence.

## Out of scope

No rebase, force-push, pull request merge, protected-branch push, branch deletion,
deployment, provider API call, credential or environment-file read, or new
operating procedure. Incoming code changes are preserved by the merge, not
edited by this task. Work stays in the card workspace.

## Acceptance

- `origin/pre` is an ancestor of the final head and PR #599 has no conflicts.
- `bun run lint:docs`, `node scripts/check-docs.mjs`, and `git diff --check` pass.
- Report the matching steps in OPS and R2-CUTOVER and each conflict resolution.
- Run the full offline static verification with the pinned Node and Bun versions.
- GitHub `static` and `production-build` pass for the resulting pull request head.
- The workspace has no tracked or untracked changes at handoff.
- Deliver the head and evidence through GSC_0063 for independent review.
