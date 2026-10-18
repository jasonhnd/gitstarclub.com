# Issue 595: Remove Vercel-era leftovers

## Goal

Remove unused Vercel Analytics and dependency workarounds from the Cloudflare
application, and make all seven privacy translations describe the shipped site.
Base this branch on `origin/pre` at
`6e757ccd15c1a48967ee8c628758653313327f17`, after dependency PR #664 (#594) merged.

## Scope

- Remove `@vercel/analytics`, its shell integration, provider policy, obsolete
  policy tests, and the Analytics-specific build assertion.
- Update privacy body and metadata copy in en, ja, zh, zh-TW, ko, es, and fr;
  retain the existing language-cookie and local theme-preference explanation.
- Remove the unused `piscina` override and stale maintenance documentation.
- Remove the direct `find-up@7` compatibility pin if the full builds pass;
  preserve any transitive version required by ESLint.
- Regenerate the web lockfile deliberately, update maintained references, and
  retain regression coverage for privacy rendering and tracking-free responses.

## Out of scope

No replacement analytics, new pages, data-coverage expansion, Blob removal,
CI/workflow/delivery/Worker configuration changes, live service calls, deployment,
merges, protected-branch pushes, force-pushes, rebases, or branch deletion.
Historical archive and changelog entries remain historical.

## Steps

1. Verify the pinned toolchain, install frozen web/pipeline dependencies, record
   import searches and before screenshots, and commit this plan.
2. Remove Analytics code and update localized privacy copy, regression checks,
   and maintained documentation; commit the completed application cleanup.
3. Remove unused dependency declarations, regenerate and inspect the lockfile,
   verify import searches, and commit the dependency cleanup.
4. Run the complete AGENTS.md bootstrap/static/build gate on the exact committed
   head in a fresh detached checkout under `.kanban-work/GSC_0024/`. Capture after
   screenshots, publish all command results in one PR against `pre` with
   `Closes #595`, and hand off to the review role without merging.

## Acceptance

- No application imports of the removed packages or provider policy remain.
- No shipped privacy body or metadata names Vercel Analytics in any locale.
- No analytics script or beacon is requested on the privacy page; production
  CSP remains unchanged, including its required inline-script allowance.
- `@vercel/blob` and unrelated dependency versions remain unchanged; any
  remaining `find-up` entry belongs to the transitive ESLint dependency graph.
- Pinned Node v24.20.0/Bun 1.3.14 bootstrap, both dependency audits, pipeline
  tests, documentation lint, web lint, all three typechecks, view validation,
  full web coverage suite, local-fixture production build, and Cloudflare
  preview dry run pass. GitHub Actions stays disabled and is not awaited.
- The PR includes the tested commit, every command/result, before/after privacy
  screenshots, and any limitations. The delivery checkout is clean.
