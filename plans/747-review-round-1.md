# Issue 747: review round 1

## Goal

Address the independent review of commit `775ff03` while preserving strict
production validation and the narrow preview history exceptions.

## Scope

1. Merge the latest `origin/pre` into the current branch and combine the OPS
   paragraph for canonical monthly completeness and publication history gates.
2. Preserve confirmed HTTP absence separately from a successful JSON `null`
   throughout canonical reads. Share marker loading between canonical
   completeness and publication validation.
3. Add regressions through the actual HTTP reader for 404, successful `null`,
   malformed data, HTTP 403, and timeout failures, including sealed fallback.
4. Commit each completed step and run the full offline static job plus both
   local build modes against the completed commit.

## Out of scope

No branch switches, repository copies, pull request merges, deployment, live
data writes, fake history, broad cold-start flags, or CI/configuration changes.
Production, weekly history, and recent-daily history stay strict.

## Acceptance

- Only a confirmed 404 permits canonical fallback or missing-heatmap handling.
- A present malformed overlay marker cannot select a sealed marker.
- A present `null` prior-year heatmap fails schema validation.
- Both marker consumers agree and share one loading path.
- Regression tests exercise mocked HTTP responses without replacing
  `readAuthoritativeView`.
- The complete web coverage suite, static checks, and local production/pre
  builds and artifact validation pass, or concrete blockers are documented.
- Verification stays in the current `~/w` checkout, following the owner's
  explicit no-copy/no-checkout rule. All caches and logs stay under
  `.kanban-work/747-r1/`, with clean process environments and no owner
  environment files loaded.
