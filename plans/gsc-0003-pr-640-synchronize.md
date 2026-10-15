# GSC_0003: synchronize and verify PR #640

## Goal

Resume issue #589 on the existing `test/589-pipeline-backfill-tests` branch and
PR #640. Merge freshly fetched `origin/pre` at
`5af183ac3f710981b4742651b53c93d377da2adf` into the starting PR head
`985bcd9cf897e6b2ba32ab729782ebeca8cc4c0e` with a normal merge commit, preserving
the offline regression tests and current upstream behavior.

## Scope

- Import the ten missing integration commits through a normal merge.
- Inspect the resulting diff against both `origin/pre` and the original PR head.
- Preserve the helper extraction in backfill steps 05 and 07, fixture-only
  pipeline tests, publication guards, leases, R2 status, and incoming algorithms.
- Retain the testing and operations documentation from both branches.
- Record the current scope and exact-head verification in the existing PR body
  and card handoff. Push only the existing feature branch.

## Out of scope

No behavior expansion, duplicate PR, rebase, force push, PR merge, protected-branch
push, branch deletion, production deploy, production cron or refresh, real storage
mutation, schedules, DNS, secrets, credential reads, or unrelated CI/config edits.
Do not wait for PR #599; if it lands before #640, the leader will require a new
synchronization and verification pass.

## Steps

1. Read the card and repository rules, SHA-verify the official Node 24.20.0 and
   Bun 1.3.14 archives and binary versions, and install both packages with frozen
   lockfiles in the assigned checkout. Commit this plan.
2. Merge the current integration branch, inspect the combined diff, and commit
   the completed merge. Make only issue-scoped corrections if verification
   identifies a regression.
3. Verify the final committed head with the complete AGENTS.md clean-environment
   static and fixture-build flow. Keep all temporary files in `/tmp/GSC_0003/`.
4. Push the existing branch normally, update PR #640 with exact-head evidence,
   poll the required checks in this turn, and hand off for different-model review.

## Acceptance

- The updated PR includes the fetched `origin/pre` and has no conflicts with it.
- Changes relative to integration remain within the original PR scope plus this
  synchronization plan; unrelated upstream code and configuration are preserved.
- The exact final commit passes runtime assertions, both dependency audits, the
  full pipeline suite, documentation lint, web lint, all three typechecks, view
  validation, and the full web coverage suite with the 80% thresholds.
- The exact final commit passes the local read-only fixture production build and
  the pre-only Cloudflare dry run; no live opt-ins or real environment files are
  supplied. GitHub `static` and `production-build` pass for the same PR head.
- The PR body retains `Closes #589` and includes commands, results, the tested
  commit, limitations, and any outstanding wait. The checkout is clean at handoff.

## Verification boundary

The execution rules prohibit creating another worktree. Use a fresh
`git archive HEAD` export under `/tmp/GSC_0003/` with only committed files, an
isolated temporary HOME, and `env -i` running `bash --noprofile --norc`. This is a
procedural difference from the detached-worktree mechanism in AGENTS.md and must
remain explicit in the PR and handoff. Preserve its isolation and pinned command
requirements; do not count old or interrupted tests as final evidence.

Fixture tests and dry-run builds do not establish live-bucket or deployed-site
acceptance. Independent different-model review remains required.
