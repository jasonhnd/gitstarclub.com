# Issue 727: Preview aggregate history import

## Goal

Import the reviewed GSC_0090 surviving-star bundle for May 30 through September
30, 2026 into already tracked preview repositories, using the existing shared
writer lease and immutable generation publication. No reviewed importer exists
on the starting `pre` commit; this round implements it and does not publish.

## Scope and steps

1. Verify the pinned toolchain, install dependencies, inspect the collection,
   backup and publication contracts, and commit this plan.
2. Add a preview-only, read-only-by-default importer. Verify the exact sealed
   export, preserve existing observations, join only complete edge weeks, and
   stage the existing published snapshot with repaired daily/weekly data.
   Publish through the existing bootstrap lease and single-pointer commit.
3. Preserve aggregate provenance through normal refreshes. Survivor counts
   provide daily/weekly flow, not historical stock or monthly net growth.
   Preserve monthly artifacts, frozen anchor factors and membership.
4. Add regression tests and operator documentation; commit completed steps.
5. Run the full offline AGENTS gate in one fresh detached shared clone of the
   exact head, remove the clone, open one PR into `pre` closing #727, and hand
   off to independent review with `waitingOn: PR merge`.

## Out of scope and prohibited operations

No production bucket/Worker, monthly reconstruction, coverage expansion,
collection, remote publication in this round, cron/refresh calls, deployment,
Cloudflare configuration changes, CI changes, Wrangler/OpenNext, merging,
force-pushing or pushing `pre`, `main` or `preview`. Do not upload local manifests
or paths. Keep GitHub Actions off. Temporary artifacts stay under this card;
the owner-approved shared toolchain and Bun caches are the only cache exceptions.

## Acceptance

- The default command performs no writes and refuses an active preview lease.
- Execution accepts only `gitstarclub-data-pre` with its matching bucket marker.
  The normal fenced publication mechanism switches canonical and base views
  together; a stale owner cannot publish or overwrite live canonical objects.
- Import only fixed-whitelist members already present in the preview snapshot.
  Preserve existing observations, report skipped repositories/edge weeks and
  counts, and never turn unavailable data into zero.
- Daily/weekly labels use the accepted aggregate provenance. Subsequent refreshes
  retain those labels and never treat surviving-star additions as stock anchors.
- Monthly canonical data, monthly curves/tables/rankings, yearly rankings,
  membership and frozen anchor factors remain unchanged.
- Full pipeline and web suites, docs/lint/typechecks, fixture production/pre
  builds and artifact validation pass on the submitted head. `cf:dry-run` is
  skipped by owner order. PR and handoff retain actual command results.
- After review/merge and leader rework, execute against preview only, then
  compare three repository pages' June–September daily history against the
  aggregates and verify labels. Existing monthly net history stays untouched;
  the aggregate source cannot restore a cold-start monthly net curve.
