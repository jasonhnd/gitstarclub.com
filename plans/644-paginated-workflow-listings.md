# Paginated workflow listings (#644, GSC_0072)

## Goal

Fix audit findings F07 and F08: scan every retained rename delta with bounded
reads, and enumerate every view version before retaining the newest four.
Preserve GC progress when a later version fails to delete.

## Baseline

Both findings remain present at `origin/pre`
`2b8f9fcb266d36dcc117c9c8b8c7dbbebc117299`. Alias collection uses one folded
listing and an unbounded `Promise.all`; version GC uses one folded listing and
returns empty progress after any failure.

## Scope

- `web/lib/workflows/steps/aliases.ts` and `gc.ts`, plus their in-memory tests.
- A shared folded-folder pagination helper under `web/lib/storage`, if needed.
- This plan, `docs/CHANGELOG.md`, and affected operations documentation.

## Out of scope

Storage-driver selection, workflow publication, lease implementation, CI,
deployment configuration, live GC/refresh/cron calls, credentials, protected
branch pushes, force pushes, and merges.

## Steps

1. Install pinned dependencies, confirm the findings on the latest `origin/pre`,
   open issue #644, and commit this plan.
2. Add and run failing in-memory regression tests before changing production
   code; commit the tests with their baseline failure counts recorded.
3. Share folder pagination with de-duplication and invalid-cursor protection,
   reuse `mapLimit` for rename reads, and preserve per-version GC results while
   retaining current, rollback, active, and newest-four protections. Commit.
4. Document the paging, concurrency, and partial-failure semantics. Commit.
5. Verify the committed revision in a fresh detached checkout under
   `/tmp/GSC_0072`, using the complete clean-environment AGENTS static and local
   fixture-build blocks. Open one PR against `pre` and hand off for review.

## Acceptance

- Regression tests fail on the baseline and pass after the fix: two pages,
  empty pages, duplicate folders, read failure, bounded reads, version
  protection, lost lease, partial deletion, and retry. All data stays in memory.
- The full static job passes with Node 24.20.0 and Bun 1.3.14: dependency audits,
  pipeline tests, docs lint, web lint, all three typechecks, fixture validation,
  and `test:cov` with line and function coverage at least 80%.
- Fixture-only production build and Cloudflare preview dry run pass; live
  switches are absent and `SEO_LIVE_BASE` is explicitly empty.
- Diff scope contains only the files above, lockfiles do not change, and
  `git status --short` is empty before handoff.

The card-level rule forbids creating another worktree. Verification therefore
uses a fresh local clone detached at the exact committed SHA, with no copied
untracked files or environment files; temporary logs and fixtures stay in
`/tmp/GSC_0072`.
