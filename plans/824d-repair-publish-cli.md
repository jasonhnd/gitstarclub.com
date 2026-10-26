# Card 824-D: guarded Mac repair publisher

## Goal
Wire the existing staging, recovery/commit, and target guards into one Mac command for issue #824.

## Scope
- Share the pinned cf runner boundary, preserving raw bytes and child delegation.
- Guard target, print rollback, snapshot verified builder bytes, then lease, seal recovery, stage, verify, commit, release.
- Implement guarded rollback and a write-free dry run using the same publication path.
- Prove ordering, refusal, resumption, rollback, and error reporting with a directory-backed fake cf.
- Document exact Mac commands and maintenance-window requirements in OPS.

## Out of scope
Real bucket access, credentials, deployment, scheduler changes, branch changes, pushes, and merges.

## Acceptance
The fake-bucket end-to-end scenarios pass; the full pipeline and web coverage suites pass. Run static checks and both local build modes from a detached shared clone inside this repository, with all generated artifacts inside `.kanban-work/824d`. No real cf process is invoked by tests. Keep commits small.
