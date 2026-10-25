# Issue 746: apply history availability to canonical completeness

## Goal

Allow the honest absence of monthly history in preview only when card A's
validated history-availability marker explicitly declares it unavailable.

## Scope

- Read the marker for the final windowed preflight family check and final
  canonical validation, using the existing preview guard and pure reader.
- Exempt only a zero monthly repository-key count; preserve required files,
  schemas, repository identity, anchoring factor `d`, orphan checks, and non-empty
  weekly and recent-daily families.
- Add regression tests for valid, absent, malformed, and production markers and
  update the completeness contract and preflight documentation.

## Out of scope

- Publication history gates, live calls, deployment, and platform configuration.
- Cold-start flags, manufactured monthly data, and aggregate-derived monthly net.
- Branch changes and repository copies; verification uses the current checkout
  under the owner's workspace rule, with caches/logs in `.kanban-work/746/`.

## Acceptance

- A valid preview marker permits zero monthly keys in both family checks.
- Missing or malformed markers retain existing failure messages; production
  remains strict, including conflicting preview/production signals.
- Every other completeness and integrity check remains enforced.
- Focused tests, the full offline web coverage suite, static checks, and local
  fixture builds pass using Node 24.20.0 and Bun 1.4.2 where available.

## Implementation and verification

Implementation commit: `c91ef14c9dbae820cc9f9a4b23d40837fcc863c4` on the
unchanged `ib/gsc-746` branch. Card A's reader is present in the base commit.
The marker is read authoritatively only for preview, at the final preflight
window and final full canonical validation; it is not included among required
canonical shards or used to create monthly data. Publication gates are unchanged.

Verification used checksum-verified Node 24.20.0 and Bun 1.4.2, a clean process
environment with no environment files, and logs/caches in `.kanban-work/746/`.
The owner's current-checkout rule overrides the detached-clone recommendation.
No live service calls or deployments were made; builds used a local read-only
fixture that was stopped after verification.

Passed:

- Requested `cd web && bun run test -- lib/workflows/canonical-validation.test.ts lib/workflows/steps/preflight.test.ts`:
  the package script includes the full web suite, so this ran 2,127 passing tests,
  49 skipped, zero failures across 211 files.
- Direct focused `bun test lib/workflows/canonical-validation.test.ts lib/workflows/steps/preflight.test.ts --isolate`:
  45 passing tests, zero failures.
- Full `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE="" bun run test:cov`
  on the implementation commit: 2,127 passed, 49 skipped, zero failures;
  the enforced coverage gate reports 90.04% lines and 90.63% functions.
- Pipeline full suite: 205 passed, zero failures.
- Web lint (existing warnings only), application/test/script typechecks,
  generated-view fixture validation, host dependency graph validation,
  runtime version assertion, and Cloudflare CI configuration assertions.
- The remaining documentation checks after the markdown gate: 44 tests passed,
  documentation references/environment inventory/maintained facts consistent.
- Local production and pre Vite builds and matching `validate:host` commands:
  each validated 234 routes and 467 artifacts, including fonts, indexing, and
  bindings, with the implementation commit recorded in both artifacts.
- `git diff --check`; no dependency lockfile changes.

Existing blockers to a completely green static job:

- Web and pipeline `audit:deps` report high-severity advisories for unchanged
  `undici` and `zod` dependencies (GHSA-xjj6-f33q-929c and
  GHSA-mrhx-c7xc-m3w5). Dependency upgrades are outside this issue.
- `bun run lint:docs` stops at missing metadata frontmatter in the pre-existing
  `docs/analysis/743-preview-empty-monthly.md`; that diagnosis document is
  unchanged from the base commit and outside this issue.

The combined static script was attempted, then the remaining checks were run
separately without bypassing or changing either failing repository gate.
