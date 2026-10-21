# Refresh subrequest budget and recovery

## Goal

Fix issue #721: complete the 5,669-repository refresh through bounded queue invocations and record terminal failures without reusing an exhausted invocation.

## Scope

- Count authoritative reads, object-store operations, lease operations, HTTP calls, and queue advancement in the in-memory workflow harness.
- Checkpoint validation, entity recomputation, ranking writes, and garbage collection wherever their operation counts grow beyond a conservative 1,000-subrequest budget.
- Preserve publication fencing and metadata borrowing, and document operational recovery in `docs/OPS.md`.
- Add regression tests for 5,669 repositories, replay, budget exhaustion, and borrowing completed metadata.

## Out of scope

Data coverage, public contracts, CI or deployment configuration, live endpoints, manual R2 changes, secrets, deployment, protected branch pushes, and merging are excluded. GitHub Actions stays disabled. No platform CLI is run.

## Steps

1. Install pinned dependencies, verify current Cloudflare documentation, and measure the existing workflow.
2. Implement durable bounded checkpoints and fresh-invocation failure recording; commit each completed change.
3. Run regressions and document measured per-invocation counts.
4. Run the full offline AGENTS.md bootstrap/static/fixture build gates in one fresh detached clone of the exact head, then remove the clone.
5. Push only the feature branch and open one pull request into `pre` with `Closes #721`, counts, commands, results, and remaining uncertainty; hand off to an independent reviewer.

## Acceptance

All generated entities and required ranks are still validated. A 5,669-repository fixture finishes through multiple invocations below the conservative budget. A limit error produces a terminal manifest, error artifact, and released lease from a fresh invocation. A new run reuses all completed metadata without GitHub refetches. Full web coverage, static checks, and local fixture builds pass on the exact delivered commit. No production or preview endpoint is contacted.
