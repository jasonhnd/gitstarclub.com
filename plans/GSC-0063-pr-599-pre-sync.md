# PR #599 integration synchronization

> Historical GSC_0063 record. The 2026-10-13 resume is GSC_0002, governed by the updated [issue #576 plan](./576-docs-set-b.md). Its accepted copied-store cutover supersedes the old bootstrap-only/no-fallback stage-4 assumptions below. Prior test results prove only their named commits.

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

## Initial merge decisions

- CHANGELOG: retain both the current-host entry and the publication-lease entry.
- OPS: retain the cutover and rollback checklist, use the prepared #578 gate,
  build, and read-tool facts, retain built-commit identity and error sanitization,
  and keep Worker alert setup rather than the superseded Vercel setup.
- R2-CUTOVER: retain bootstrap-based acceptance and first-publish recovery,
  relocate built-commit identity into that acceptance, retain the prepared #578
  contract and build checks, and require both R2 tools before Blob retirement.
- TESTING: retain the incoming Worker-entry test row and the archived phase links.
- Automatically merged API, PIPELINE, and SEO changes retain redirect protection,
  publication locking, and built-commit identity respectively.
- The initial documentation checks pass: 41 tests, zero failures; the direct
  documentation check and whitespace check also pass.

## Local rehearsal merge

The integration branch advanced to #639 during execution. Its CHANGELOG conflict
retains both entries. Its R2-CUTOVER conflict places the incoming offline local
workerd rehearsal before the existing real-bucket commands. OPS and TESTING
retain the same prerequisite. No rehearsal procedure or harness was edited.

## Final integration synchronization

The previously pushed head `a890790` passed GitHub `static` and
`production-build` in run `36950926355`. Before handoff, `origin/pre` advanced to
`dca7296`, including #642, #632, and #635. This additional merge has no conflicts.
It preserves #642's 30-second request/body deadline and its existing plan
without adding new operating content. Incoming code remains unedited.

## 2026-10-13 resumed synchronization (GSC_0002)

- Existing feature head `19c708c`; freshly fetched integration baseline `5af183a`. Use a normal merge and preserve all incoming application code. Only R2-CUTOVER has a text conflict; CHANGELOG auto-merges.
- Reconcile automatically merged OPS as well: stage-4 config PR #648 implements issue #647, and PR #649 records the October 4 acceptance. Preserve that history while recording October 13 public production `daee5fc` and preview `5af183a` separately from unknown provider UUID/bindings.
- Production views/bootstrap pointers return 404 and the copied frozen metadata returns 200. Keep the exact frozen fallback in Worker/build shell; the gate allows absent or that exact value, rather than unconditional removal. The original empty-bucket stages 2/3 remain unaccepted, and their cleanup is not a current production procedure. Stages 5/6 remain unaccepted.
- Preserve complete historical Blob rollback configuration, but require separate operator authorization and checks of retained-version availability and security suitability. Current docs use accepted R2 status and archive links; owner HANDOVER and incoming code/config stay untouched.
- Run full pinned, SHA-verified, clean exact-commit static/coverage and fixture production/pre dry-run builds; no inherited env, credentials, live opt-ins, or extra worktree. Use a detached temporary local clone under `/tmp/GSC_0002/`. Exact-head GitHub checks and independent review remain merge prerequisites; current results belong in PR #599 and the GSC_0002 handoff.
