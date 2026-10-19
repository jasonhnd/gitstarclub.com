# Issue 646: replay-safe rank and rest recompute hops

## Goal

Rank and rest recompute hops must be safe to deliver again. A replay of an earlier
window must not change published `prev_rank`. A rest retry must not skip category
shards. A corrupt carry or partial must not look like a missing object.

## Scope

- `web/lib/workflows/steps/recompute-rank.ts`: compare the window offset with the
  carry `nextPeriod` before streaming rows or writing rank views.
- `web/lib/workflows/steps/recompute-rest.ts`: write the partial and the category
  shard first, and mark the bucket done in the carry last.
- `web/lib/workflows/recompute/carry-codec.ts` (new): strict codecs for the rank
  carry, rest carry, and rest partial. `readRankCarry` in `io.ts` uses it.
- `web/lib/workflows/steps/recompute-replay.test.ts` (new).
- This plan, `docs/CHANGELOG.md`, and the matching row in `docs/TESTING.md`.

## Out of scope

Storage driver selection, packed-window validation, cursor validation, alias
pagination, GC, CI workflows, `.delivery.yml`, Worker wrangler config, deploys,
production or preview cron, and live refresh.

## Behavior

- Rank window with offset below the carry `nextPeriod`: already ranked. Return the
  result the original delivery returned (next cursor, `files: 0`); write nothing.
- Rank window equal to `nextPeriod` (or offset 0 with no carry): recompute from
  that input. The carry advances only after every view of the window is written.
- Rank window above `nextPeriod`: throw before any rank view is written.
- Rest bucket: partial, then category shard, then carry with `doneBuckets`.
  A failure at any earlier write leaves the bucket undone, so a retry redoes all
  three. A finished bucket returns `files: 0` without folding again.
- Carry and partial reads return null only for an absent object. A present but
  malformed rank carry, rest carry, or rest partial throws `<path>: invalid ...
  — <field reason>`. A missing rest partial still throws `missing rest partial`.

## Acceptance

`recompute-replay.test.ts` covers duplicate delivery, a response lost after the
carry write, out-of-order windows, and a failure before and after each write, for
repo and org rank hops and for rest ingest. The AGENTS.md static job, fixture
production build, and `cf:dry-run` pass in a fresh detached worktree.
