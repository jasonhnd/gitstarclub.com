# Astro preview history sync (#757)

## Goal

Merge `origin/pre` at `e0767f4` into the current `ib/gsc-757` branch,
which is based on `feat/astro-site`, preserving Astro and preview history fixes.

## Scope

1. Merge pre and reconcile operations documentation, deployment gate assertions,
   subrequest budget tests, and shared workflow test helpers without losing either side.
2. Inspect Astro callers of shared readers and publication validation. Fix only
   regressions introduced by the merge.
3. Install frozen root, web, pipeline, and Astro dependencies. Run the full web
   coverage suite, Astro tests, and Worker tests with a 30000 ms timeout. Run
   static checks and Astro typechecking to verify shared-code compatibility.
4. Record verification results and commit completed steps on the current branch.

## Out of scope

No new features, dependency upgrades, deployments, platform CLI, production
requests, secrets, branch switches, repository copies, or pull request merges.
No visual changes.

## Acceptance

- The current branch contains `origin/pre`, including #745 through #748 fixes.
- All requested installs and tests pass; Astro shared-reader callers compile.
- Preserve both sides of every conflict and keep dependency lockfiles stable.
- Use a clean environment with placeholder data URLs and card-local caches and
  logs under `.kanban-work/757/`. Verify in place because the owner explicitly
  forbids copying the repository or switching branches; this overrides the
  generic detached-clone verification procedure.
