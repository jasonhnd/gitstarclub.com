# Issue 769: Astro publication invalidation

## Goal

Finish the authenticated publication callback within its 30-second caller budget
and prevent cached Astro HTML from crossing publication boundaries.

## Scope

1. Diagnose the callback call graph, storage operation count, and warm-tail policy.
2. Namespace every Astro HTML entry by publication identity, keeping the existing
   within-publication freshness periods and explicit path invalidation hook.
3. Keep shared pointer-tag invalidation but skip framework page invalidation in
   the Astro callback, since the new publication namespace makes it unnecessary.
4. Add callback-budget and publication/rollback regressions; update host docs.

## Out of scope

Deployments, remote operational requests, Cloudflare writes, production changes,
shared web-host cache policy, configuration, and workflow changes.

## Acceptance

- Diagnosis marks code-verified facts and incident inferences separately.
- Full core path set is covered by a bounded callback regression.
- Repository, organization, category and core HTML switch after publication and
  rollback, including when older entries remain in both cache layers.
- Complete Astro tests pass; run the repository static checks when feasible.
- Stay in this repository and on the current branch. The owner's explicit ban on
  repository copies overrides the detached verification clone instructions.

## Results

- Runtime fix: `1402db7`; final complete Astro tests: `1a6cab6` (336 passed,
  zero failed, 31.55 seconds). The callback regression completes in about
  1.8 seconds under a five-second bound with simulated 200 ms KV puts.
- All 56 core paths and all seven locales' repository, organization and category
  HTML switch after publication and rollback while old cache entries remain.
- Astro typecheck and graph validation pass. Both Astro host modes build and
  validate locally. The built preview Worker passes its three cache/locale/
  publication tests. These builds used `5242c5f`, with identical runtime code.
- Both web modes build and validate locally (234 routes and 467 artifacts per
  mode), using `1a6cab6`.
- Pipeline suite: 205 passed, zero failed.
- Full web suite: 2,172 passed, 49 skipped, zero failed; function coverage 89.48%,
  line coverage 91.72%. Web lint, all three typechecks, graph validation and view
  fixture validation pass. Full static remains blocked by existing high-severity
  undici/zod advisories in both web and pipeline dependency audits.
- Documentation metadata validation passes. Documentation consistency still
  reports four existing unresolved performance-script references in
  `plans/760-astro-preview-deploy-guard.md` and
  `plans/astro-accept-1-baseline.md`; this card adds none.
- The initial static command stopped at the audit. Independent remaining checks
  were run separately without treating those failures as a green static job.
- Verification used checksum-verified Node v24.20.0 and Bun 1.4.2, a clean
  environment without live-test opt-ins, and scratch/logs under `.kanban-work/769/`.
  The owner's no-copy instruction superseded the detached-clone procedure.

## Delivery limitation

The current branch is `ib/gsc-769`, based on the incident's `b13f13a` from
`feat/astro-site`. The card changes nine files relative to that baseline, but
comparison with the mandated `pre` target includes the broader migration (246
files). Opening that pull request would exceed this card's scope. The hard rule
in `.grok/rules/pre-only.md` prohibits targeting the feature branch, and the
owner prohibits switching or creating another local branch. Preserve the small
committed change for review rather than opening a pull request with unrelated
migration changes. No pull request was opened or merged.

A normal push of the current branch also failed because HTTPS Git credentials
are unavailable (`could not read Username`). No credentials were requested or
printed. No branch switch, repository copy, deployment, live operational request,
Cloudflare write, or production change occurred.
