# UTC surviving-star gap collection

Issue #680 / card GSC_0080. Base: origin/pre at 38f3af6.

## Goal

Collect GitHub's surviving-star timestamps for the existing 5,249 whitelist
members, limited to UTC May 30 through September 30, 2026. This is a lower
bound on gross additions: removed stars cannot be observed.

## Scope

1. Install the archive-verified Node 24.20.0 and Bun 1.4.2 toolchain and both
   dependency sets; retain the existing card branch based on origin/pre.
2. Implement an offline-tested, read-only `gh api graphql` fetcher under
   `pipeline/scripts/`. Resolve stable ids across renames; reject private,
   missing, empty-but-nonzero, inconsistent and truncated history. Persist
   atomic per-page/per-repository checkpoints and honor primary/secondary limits.
3. Read the unchanged R2 whitelist and verify equality against the retained
   GSC_0045 ids. Pilot all 40 prior samples plus ten deterministic extra ids.
   Record counts, costs, elapsed time and a comparison with 342,659, then post
   the estimate promptly on the card. An inaccessible history is not zero.
4. Start the full fixed-whitelist collection in bounded resumable foreground
   chunks. All collection outputs go only to the owner-designated excluded
   `/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/`.
5. Document provenance, limitations, estimates, measured coverage and exact
   resume commands. Commit every completed step and open one PR against pre.
6. Run the full AGENTS static job, full web coverage and fixture production
   build in a fresh detached exact-head checkout inside this card's temporary
   directory. Report every result in the PR and handoff to independent review.

## Out of scope and prohibited actions

No data publication, rollup, discovery, whitelist expansion, GCP, paid API,
production or preview cron/refresh, R2/Blob writes, Wrangler/OpenNext commands,
CI enablement/config changes, protected-branch pushes, force-push or PR merges.
No data, credentials, toolchain files or generated artifacts enter Git.
Skip `cf:dry-run` by explicit owner order. All temporary files and dependency
caches use this checkout's `.kanban-work/GSC_0080/`; only durable collection
outputs use the expressly authorized leader directory.

## Acceptance

- Tests exercise UTC boundaries, descending pagination and stopping, stable
  identity/renames, missing/private repos, malformed/empty/truncated responses,
  atomic resume without double counts, and both classes of rate limits.
- A 50-repository pilot includes the exact 40 GSC_0045 samples; its report
  distinguishes measured costs and counts from conditional extrapolation.
- Every full-run member has either verified daily history, an explicit
  unavailable status, or an exact resumable pending position. Missing coverage
  cannot be reported as successful zero-valued extraction.
- The final exact-head local gates pass; the PR includes Closes #680, commands,
  results, metric limitations and any unfinished collection work. The executor
  does not merge or perform final acceptance.

## Progress

- Dependencies installed and archive/runtime checks passed.
- Issue #680 opened. Read-only R2 whitelist download succeeded.
- Initial three probes returned positive stock but empty GraphQL connections;
  the pilot must establish whether this prevents timestamp collection.
