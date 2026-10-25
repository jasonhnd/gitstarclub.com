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

- Only a confirmed 404 permits authoritative canonical fallback or
  missing-heatmap handling.
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

## Implementation

- Merge commit `07f2481` integrates `origin/pre` at `4114e99` (PR #753), with
  one combined OPS paragraph for canonical completeness and publication gates.
- `a466d2c` carries successful JSON bodies separately from HTTP absence until
  schema validation and shares the marker loader between both validators.
  A present malformed overlay cannot select sealed data; `null` heatmaps fail
  their schema. The live-history adapter also rejects present `null` rather
  than interpreting it as permission to select an older generation.
- `a87be70` replaces the publication fixture's authoritative-reader stub with
  mocked HTTP responses and adds reader and publication regressions for 404,
  successful `null`, malformed objects, invalid JSON, 403, and timeout throws.
- `213f051` reconciles the second OPS publication paragraph and removes the
  unused import left by consolidating the loaders. Production, weekly history,
  recent-daily history, and required canonical files remain strict.

## Verification

The complete source was verified at
`213f051331c213327658f2f6d75cf032ac7a3667` on the unchanged
`ib/gsc-747-r1` branch. The final follow-up commit records only this report.
Verification used checksum-verified Node 24.20.0 and Bun 1.4.2 under clean
process environments, with no environment files or live-check opt-ins.
Logs and tool caches remain in `.kanban-work/747-r1/`. No repository copy,
branch switch, browser, deployment, live data mutation, or GitHub Actions run
was needed. The local read-only build fixture was stopped after verification.

Passed:

- `bun test lib/data/source.test.ts lib/workflows/steps/validate.test.ts
  lib/workflows/history-availability.test.ts
  lib/workflows/canonical-validation.test.ts --isolate`: 162 passed, zero failures.
- Full `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE="" bun run test:cov`:
  2,161 passed, 49 skipped, zero failures across 211 files; the enforced coverage
  gate reports 90.04% lines and 90.63% functions.
- Pipeline `bun run test`: 205 passed, zero failures.
- Web lint (14 existing warnings, zero errors), `typecheck`, `typecheck:tests`,
  `typecheck:scripts`, `validate:views` using `web/scripts/fixtures/views`, and
  `validate:graph`.
- Runtime assertions, Cloudflare CI configuration assertions, all 44
  documentation checker tests, and documentation references/environment
  inventory/maintained-facts checks.
- `bun run build:production` and `bun run build:pre`, each followed by matching
  `bun run validate:host -- --mode ...`: both validated 234 routes and 467
  artifacts, including fonts, indexing, and bindings. Both artifacts identify
  the tested source commit above.
- `git diff --check origin/pre...HEAD`; no dependency lockfile changes.

Existing blockers to a completely green static job:

- Web and pipeline `audit:deps` report high-severity advisories for unchanged
  `undici` and `zod` dependencies (GHSA-xjj6-f33q-929c and
  GHSA-mrhx-c7xc-m3w5).
- `bun run lint:docs` stops at missing metadata frontmatter in unchanged
  `docs/analysis/743-preview-empty-monthly.md`.

The prescribed combined static/build block was attempted and stopped at the
web audit. Remaining checks and both builds were then run separately, retaining
and reporting the failing gates. These blockers were already documented by
#746; the dependency manifests, lockfiles, and #743 diagnosis document are
identical to `origin/pre` and outside this rework's scope.
