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
