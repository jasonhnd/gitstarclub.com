# Issue #676: guarded preview cold-start first publication

- Issue: https://github.com/jasonhnd/gitstarclub.com/issues/676
- Card: GSC_0057
- Base: `pre` at `d9d0e9d70a26e05fd4b1eb7efdee9b8d817efd4b`

## Goal

Let the first explicitly armed preview refresh publish an honest dataset with
no historical series, then prove the pointer switch and published run status
using the real workflow handlers in memory.

## Decision and evidence

Choose brief case (b): missing history is legitimate for the first cold start.

- `docs/OPS.md` (Preview cold-start first run), issue #519's plan, and PR #665
  explicitly describe a rehearsal dataset without GH Archive history. Cold-start
  canonical metadata uses the bootstrap day as its seam; missing series read as
  empty instead of fabricating historical activity.
- The brief's planned 20 raw `star_daily` parquet files cover 2026-05 through
  2026-09. They cannot supply the prior calendar year, 2025. They are a future
  private-bucket copy, not proof of canonical history available to this refresh.
  This task neither reads nor changes that bucket or expands coverage (lock-002).
- `web/lib/workflows/recompute/heatmap.ts` creates year heatmaps only from years
  present in canonical site-daily rows. Current-year history alone cannot meet
  `validateVersion`'s unconditional prior-year check.
- The current `full-chain-cold-start.test.ts` removes canonical history, runs all
  real handlers up to validate, and records exactly the empty sampled curve and
  missing 2025 heatmap failures. Changing the fixture to invent older history
  would conceal this supported first-start case.
- Reuse `isUniverseColdStartActive`: it requires `WORKFLOW_COLD_START=1`,
  `DEPLOY_ENV=pre`, and an absent authoritative `views/latest.json` pointer.
  Production and subsequent refreshes never qualify. The full empty-bucket
  refresh also uses the existing `PREFLIGHT_RELAX_EMPTY_SHARDS=1` preflight flag.

## Scope and steps

1. Bootstrap the checksum-verified pinned toolchain, install web and pipeline
   dependencies, open the English issue, and commit this plan.
2. Replace the pinned cold-start failure with first-publication assertions;
   capture their failure on the unchanged pre implementation as old-code proof.
   Add regression coverage for ordinary validation and the guard boundaries.
3. Relax only an empty sampled repository curve and an absent prior-year
   heatmap under the existing cold-start guard. Keep missing entities, malformed
   heatmaps, and every other publication gate strict. Log each actual exception
   and persist dedicated validation invariants. Commit code and tests.
4. Reconcile `docs/TESTING.md`, document the exact exception in `docs/OPS.md`,
   and add `docs/CHANGELOG.md` release notes. Commit documentation.
5. Verify the exact head in a fresh detached checkout under this card's temporary
   directory. Push only this card branch, open one PR against `pre` with
   `Closes #676` and complete verification results, and hand off for independent
   review without merging.

## Out of scope and forbidden operations

Allowed paths are `web/lib/workflows/**`, `docs/TESTING.md`,
`docs/CHANGELOG.md`, `docs/OPS.md`, and `plans/`. No data-coverage expansion,
new pages, configuration/CI/deploy-script edits, R2 changes, cron/refresh calls,
merge, protected-branch push, force push, shared-branch rebase, or branch deletion.
All temporary files and caches stay in `.kanban-work/GSC_0057/`, excluded through
the local Git exclude file.

## Acceptance and verification

- The new publish assertion fails on the unchanged pre implementation, then
  passes after the fix. The empty-history chain reaches publish, markPublished,
  and GC; `views/latest.json` has the new run and no previous version; manifest
  and lease both say published.
- Normal refresh, production, disabled cold start, and an existing pointer keep
  rejecting both historical failures. Missing/corrupt non-exempt artifacts and
  malformed heatmaps still block publication. Each actual exception is logged
  and recorded in validation diagnostics.
- Full AGENTS.md bootstrap and static block pass with Node v24.20.0 / Bun 1.4.2,
  including dependency audits, pipeline tests, docs/web lint, all three
  typechecks, view validation, and the full web coverage suite. The local
  read-only fixture production `bun run build` also passes on the exact head.
- Owner order of 2026-10-19 overrides the original gate: never run Wrangler,
  `cf:dry-run`, `cf:build*`, `cf:preview`, or OpenNext Cloudflare commands.
  Omit that subshell and record the omission in the PR. Actions remains OFF.
- The PR records the exact tested SHA, commands, results, old-code proof, and
  remaining limits. Independent review owns final acceptance and merge.
