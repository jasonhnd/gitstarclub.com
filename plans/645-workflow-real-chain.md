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
