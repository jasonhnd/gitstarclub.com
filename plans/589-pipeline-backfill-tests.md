# Issue 589: offline backfill regression tests

## Goal

Cover steps 01 through 07 under the existing pipeline test command, with particular
attention to the R2 bootstrap's argument guards, write opt-in, initial publication,
and rollback failure paths. Start from `origin/pre` at `aa175a8`, which includes
issues 585 and 573.

## Scope

- Add tests to `pipeline/lib/*.test.mjs`, already included by `bun run test` and the
  existing CI static job.
- Extract pure transformation helpers from the backfill scripts only as needed,
  preserving their input, output, ordering, errors, and time behavior.
- Exercise the real command entry points with disposable local fixtures, denied
  network access, synthetic GitHub responses, and in-memory R2 responses.
- Update the testing documentation and this plan with verification evidence.

## Out of scope

No behavior changes, real buckets, BigQuery queries, provider APIs, credential
reads, deployments, CI changes, dependency changes, merges, or protected-branch
pushes. Only push the issue branch and open one PR against `pre`.

## Acceptance

1. Cover CLI parsing and guards, including Blob compatibility, R2 default dry run,
   both targets, `--execute`, `--stage-only`, `--initial-commit`, and rollback.
2. Cover pure metadata, milestone, grouping, date, bucket, and manifest helpers;
   test failures alongside successful output.
3. Prove the new tests execute through the unchanged pipeline test command.
4. Run the complete static job and full web coverage suite with the pinned
   toolchain, clean environment, and no live switches on a clean committed copy.
   Also run the local fixture production build and Cloudflare dry run.
5. Report added test count, covered functions, commands and results, and remaining
   limitations. Commit no lockfile churn. Open a PR with `Closes #589`.

## Existing behavior to preserve

Rollback to the current verified generation is an idempotent `already-rolled-back`
result with no pointer write. A current generation with a changed manifest digest
is refused. The issue's wording about refusing the current generation does not
match this behavior; the tests must not silently change it.

The execution contract prohibits another worktree. Verification therefore uses a
fresh detached Git checkout inside this card's directory, with only committed
files and no inherited environment files. This differs from the literal worktree
mechanism in `AGENTS.md` while preserving the clean-checkout verification boundary.

## Steps

1. Inspect the scripts and existing tests; install pinned dependencies; commit the
   plan.
2. Extract and test pure helpers, then add offline command and publication guards;
   commit each completed group.
3. Run the complete verification flow on the committed checkout, record results,
   and open the PR for independent review.
