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

## Results

- Merged `e0767f4` with merge commit `270ca47`, preserving the complete Astro
  ancestry. The current branch remains `ib/gsc-757`.
- Kept Astro host assertions and the equivalent shared completed-metadata
  fixture in the budget test. Combined Astro request/route injection with pre's
  configurable workflow test clock. Retained both operations-document sections.
- Kept shared reader signatures unchanged. Fixed the Astro native transport so
  a present JSON null reaches shared schema validation as HTTP 200, while only
  a missing object returns HTTP 404. Preserved the previous 404 response body
  and HEAD behavior. Added a native-storage regression test and frontend docs.
- Added required document metadata to the newly imported issue 743 diagnosis.

Verification used checksum-verified Node v24.20.0 and Bun 1.4.2, a clean
in-place environment, synthetic data and local simulators. Final Astro source
was tested at `abc1503`. Web source and dependencies were unchanged during the
Astro-only follow-up; the full web run used the merged shared code.

| Check | Result |
| --- | --- |
| Root, web, pipeline and Astro frozen installs | All passed; no lockfile changes |
| Full web coverage suite | 2,172 passed, 49 skipped, 0 failed |
| Web coverage gate | 90.05% lines, 90.70% functions; passed |
| Astro tests | 175 passed, 0 failed |
| Astro Worker tests with 30000 ms timeout | 7 passed, 0 failed |
| Pipeline tests | 205 passed, 0 failed |
| Web lint and all three typechecks | Passed |
| Astro typecheck | Passed; zero errors and warnings, 14 hints |
| Web view fixture validation and both dependency graphs | Passed |
| Deployment configuration assertions | Passed; no platform CLI invoked |
| Web and Astro production/pre builds and matching local host validation | Passed |
| Pre ancestry, original Astro ancestry and whitespace checks | Passed |

The additional static job is not entirely green. Web and pipeline dependency
security audits report existing high-severity undici and Zod advisories in
unchanged locked dependencies (GHSA-xjj6-f33q-929c and GHSA-mrhx-c7xc-m3w5).
Dependency upgrades are explicitly out of scope. Documentation lint reports two
existing unresolved script references in `plans/astro-accept-1-baseline.md`.
That plan and its checker are unchanged from the starting commit; they remain
outside this merge repair. All explicitly requested acceptance commands pass.
No remote deployment or production request was made.
