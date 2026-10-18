# Preview gap rebuild through September 2026

Issue: #668. Execution card: GSC_0044.

## Goal

**Updated owner constraint:** the GH Archive gap is a pipeline rehearsal only,
not publishable data. Do not upload these artifacts. Assess the GitHub
`stargazers/history` alternative read-only with a handful of repositories;
do not extract the entire whitelist. Report its coverage, pagination, API
quota, date boundaries, and input mapping separately from the rehearsal.

Prepare a locally validated preview baseline using the May gross-star backup
and only the missing 2026-05-30 through 2026-09-30 interval. Follow section B2-gap
of `plans/prod-rollout-and-data-repair.md` on `docs/prod-rollout-plan` (PR #667)
and the GSC_0030 handoff. Production remains untouched.

## Scope and sequence

1. Install the pinned, archive-verified Node v24.20.0 and Bun 1.3.14 toolchain
   and repository dependencies. Copy the 20 backup Parquet files into
   `.kanban-work/GSC_0044/` and verify every manifest size and SHA-256.
2. Render the existing WatchEvent extract with suffixes 260530 through 260930
   and the existing `gitstarclub.gitstarclub.whitelist`. Dry-run immediately
   before execution; stop above 20,000,000,000 bytes. Create a new dated table
   without replacement. Record job identity, rows, repositories, bounds, and
   processed/billed bytes. The owner authorizes up to USD 1.
3. Export the gap locally, combine disjoint dates with the backup, and run
   steps 03 (if needed), 04, 05, and 07 locally. Keep data, logs, caches, and
   build output under this card's excluded directory. No whitelist discovery.
4. Prove the rebuilt fold watermark with the real fold implementation and
   local fixtures. Compare June through September site totals and sample
   repository flows with `refresh-2026-09-13T06-00-16-398Z`.
5. Document measured results, retained artifact paths, and the exact later
   preview staging/initial-commit commands. Run the complete AGENTS.md local
   gate in a fresh detached checkout of the final commit, then open one PR
   from `feat/preview-gap-rebuild` against `pre` for independent review.

## Out of scope

No R2 or Blob writes, production changes, deployments, cron/refresh calls,
Cloudflare configuration changes, CI/configuration edits, coverage expansion
(lock-002), replacement of the May table, mutation of original GCS objects,
protected-branch pushes, force-pushes, shared-branch rebases, or PR merges.
Any optional GCS gap export must use a new prefix without overwriting objects.
GitHub Actions stays off by owner decision.

## Acceptance

- All 20 original files pass SHA-256 verification; the union has unique
  `(repo_id, day)` keys, preserves the backup, and ends on 2026-09-30.
- The fresh dry run is below 20 GB; the dated table preserves the May query
  semantics and fixed whitelist. Extract statistics and billed bytes are
  recorded. Data artifacts are never committed.
- Both local view and canonical validators pass. The canonical watermark is
  month `2026-09`, week `2026-W40`, and seam date `2026-10-01`.
- A local fold at the October first-refresh boundary reads no pending data
  without cold-start relaxation. A W39 negative control demonstrates why W40
  matters. W40 contains September 28–30 only; October 1–4 are excluded from
  that weekly baseline.
- The report quantifies June–September changes against the frozen generation
  and explains gross WatchEvent flow versus the former net live deltas.
- Bootstrap, all static checks, the full web coverage suite, the fixture
  production build, and `cf:dry-run` pass on the exact PR head. Commands and
  results appear in the PR body and handoff. The working tree is clean.

## Progress

- Pinned toolchain archives verified; web and pipeline dependencies installed
  with `bun --no-env-file install --frozen-lockfile`.
- Backup verified: 20 files, 30,907,971 bytes, every size and SHA-256 matched.
- Existing BigQuery metadata: whitelist 5,249 rows; original May extract
  12,375,426 rows. Both are read-only inputs.
- Gap job completed below the cap: 90,797 rows, 4,914 repositories,
  10,581,180,416 billed bytes. The local union has 12,466,223 unique rows
  and exactly the original 5,249 ids.
- Local rollup, all 13,012 views, and all 128 required canonical shards
  validated. The exported-meta fold probe passes on October 1/19/31
  without pending or cold-start relaxation; W39 controls fail closed.
- GitHub history assessment used five repositories and 11 history GETs,
  including the initial sanity request. Estimated gap-only cost is 5,249
  REST requests, without executing that collection. Surviving-star semantics
  and non-guaranteed UTC boundaries prevent an automatic substitution.
- Measured results, metadata snapshot limitations, artifact hashes, and the
  gated future operator recipe are in
  [the rehearsal report](../docs/analysis/PREVIEW-GAP-REHEARSAL.md). Current
  artifacts are not publishable. Step 06 is required before a future remote
  step 07 commit because the commit verifies both phase manifests.
