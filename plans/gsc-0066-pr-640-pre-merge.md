# PR #640 integration conflict resolution

## Goal

Merge the latest `origin/pre` into PR #640 with a merge commit, retaining the
offline backfill regression coverage from #589 and local workerd R2 rehearsal
documentation from #586 / PR #639.

## Scope

Resolve conflicts in `docs/OPS.md`, `docs/TESTING.md`, and, if necessary,
`docs/CHANGELOG.md`. Keep both additions without duplication or contradictory
instructions. Record this plan and update the existing PR verification record.
Import upstream changes through the merge without editing test code.

## Out of scope

No rebase, force push, PR merge, protected-branch push, branch deletion,
deployment, Cloudflare or Vercel API calls, credential or environment-file reads,
or changes to CI, Worker configuration, deployment scripts, or test code.

## Steps

1. Read the card and repository rules, verify pinned tools, and install frozen
   dependencies in the new card checkout.
2. Commit this plan, merge `origin/pre`, reconcile the documentation, and commit
   the resolved merge.
3. Verify the resulting commit in a clean temporary export with a clean
   environment, no live opt-ins, Node 24.20.0, and Bun 1.3.14. Use a temporary
   export rather than an additional worktree to honor the card execution rule.
4. Push only to the existing PR feature branch, update verification for the new
   head, and hand off to independent review once the required checks pass.

## Acceptance

- PR #640 has no conflicts with the current `pre`.
- `bun run lint:docs` and the complete pipeline suite pass.
- Run the CI static commands, including the full web suite, on the new commit.
- GitHub `static` and `production-build` checks pass for the updated PR head.
- The PR verification record names the new head and describes the conflict
  resolution and any verification limitations.
- The card checkout has an empty `git status --short` at handoff; logs and
  temporary verification files remain under `/tmp/GSC_0066/` or system temp.
