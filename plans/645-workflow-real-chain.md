# Real workflow chain and publication gate coverage

## Goal

Close audit findings F16, F17, and F18 from GSC_0035, rechecked at pre
`2b8f9fc`, by exercising production handlers with in-memory artifacts.

## Scope

Workflow tests and minimal test support, a production correction only when a
new failing test demonstrates a bug, this plan, CHANGELOG, and TESTING.

## Out of scope

Storage-driver selection, deployment, live refresh or GC, credentials, CI
configuration, protected-branch pushes, and merging.

## Steps

1. Install pinned dependencies and confirm the findings against latest pre.
2. Add failing missing-period artifact tests and real full-chain coverage.
3. Correct only demonstrated gate bugs; replace shadow-table rank assertions
   with behavior and production constants.
4. Recheck S1 publication invalidation; rebase if it has landed.
5. Run the complete offline static job and regression proofs on a clean commit
   export under the card temp directory, without creating another worktree
   (card rule).
6. Open one PR against pre closing #645 and hand it to cross-family review.
7. GSC_0020: merge fresh `pre` (normal merge, no rebase), rerun the full gate in
   a fresh detached checkout of the exact head, and record results in the PR.

## Acceptance

- Real execute, validation, default checkpoints, publish, and in-memory GC run.
- Rank hops prove actual successor and artifact paths, including carry state.
- Every full-graph step boundary has injected failure coverage.
- A missing period-rank artifact fails before the publication pointer changes.
- Node 24.20.0 / Bun 1.3.14 static checks and the full isolated web suite pass;
  line and function coverage both reach 80%.
- Demonstrated regressions fail before the fix and pass afterward.
- Diff includes only scoped tests/support, demonstrated production corrections,
  and required plan/documentation changes; final git status is clean.

## Rework (review round 1)

- Accept a valid empty period inventory (preview cold start); a missing or
  unreadable inventory still fails.
- Add `full-chain-cold-start.test.ts` (WORKFLOW_COLD_START=1, no pointer, no
  series shards), per-step write-failure injection, rank-hop and carry
  assertions, and a CHANGELOG entry.
- Regression proof: the new gate tests fail against `origin/pre`'s
  `validate.ts`; the cold-start tests fail against the first PR revision.
- Known, out of scope: an empty-history cold start still fails two older
  `validate` checks (empty top-repo curve, missing prior-year heatmap).

## GSC_0058: integrate the publication contract from #660

Goal: make the real-chain harness on PR #659 satisfy the required Cloudflare
publication invalidation origin after merging pre at `39f42af`.

Scope: test-only environment and request capture in workflow test support,
real-chain publication assertions, this plan, and the harness documentation in
TESTING. Production workflow behavior and the required `CF_CRON_ORIGIN` check
are out of scope, as are data-coverage changes, deployment, live endpoints,
Cloudflare configuration, CI configuration, rebases, force pushes, protected
branch pushes, and PR merges.

1. Fetch the existing PR branch at `44475e4`, bootstrap the pinned toolchain,
   install frozen dependencies, and reproduce the integration failure.
2. Configure a test-only `CF_CRON_ORIGIN`, capture the publication request, and
   assert its target, method, authorization, cache policy, and abort signal.
3. Keep the cold-start expectations passing and document the harness contract.
4. Run the full AGENTS bootstrap and static/build block in a fresh detached
   checkout of the exact new head under `.kanban-work/GSC_0058/`, with TMPDIR
   and all logs/caches there. Do not enable or wait for GitHub Actions.
5. Push normally to the existing PR branch, append exact-head results to PR
   #659, and hand off to the review role without merging.

Acceptance: the complete static job, full isolated web coverage suite, fixture
production build, and pre Worker dry run all exit zero on the reported head;
the cold-start tests pass; production files remain unchanged; PR #659 keeps
`Closes #645`; the handoff includes files, verification, risks, and the full
head SHA; the editing checkout is clean.

Implementation check: before the fix, the real-chain setup failed with the
required `CF_CRON_ORIGIN` error while all three cold-start tests passed. After
the test-only fix, the full-chain, cold-start, and publication-invalidation
request files passed together (53 tests, zero failures). Full exact-head gate
results are recorded in PR #659 and the GSC_0058 handoff.
