# GSC_0074: vinext hybrid cache proof

## Goal

Prove locally that vinext 1.2.1, @vinext/cloudflare 1.1.1, and Vite 8 can
serve a bounded core from build-time snapshots while generating and caching
the long tail on demand for seven days, without a runtime database.

## Scope

1. Read GSC_0065 and the existing publication, locale, and edge-cache contracts.
2. Bootstrap the prescribed Node/Bun versions and install dependencies.
3. Create an isolated prototype branch from origin/pre inside this card's
   temporary directory. Pin the Cloudflare Vite v2 beta and cf CLI; prove the
   prototype dependency graph contains no Wrangler package.
4. Build web/ with Vite and exercise the local preview or workerd runtime.
   Measure core snapshot serving, cold/warm/expiry, publication and rollback
   invalidation, and locale negotiation before cache lookup.
5. Commit the design, measurements, prototype branch/SHA, reproduction
   commands, limitations, and full migration checklist in
   docs/analysis/VINEXT-CACHE-DESIGN.md. Open one documentation PR against pre.
6. Run the full repository static gate and fixture production build in a fresh
   detached checkout of the exact documentation head; report every result.

## Out of scope and prohibited actions

No deployment, remote refresh, production/preview cron call, resource mutation,
schedule, DNS, route, secret, or data-coverage change. Do not execute Wrangler,
OpenNext's CLI, or the existing cf build/preview/dry-run scripts. Do not modify
CI workflows, .delivery.yml, or the Worker Wrangler configuration. Do not use
the Response Store or its SQLite Durable Object unless Cache API/KV are proven
insufficient; stop and report that result instead. Do not merge, force-push, or
push pre/main/preview. Prototype code gets no PR. All temporary data stays in
.kanban-work/GSC_0074/ and is excluded locally.

## Acceptance

- A committed, reproducible local prototype uses the exact requested versions,
  with a Wrangler-free prototype lock graph.
- Evidence distinguishes literal build-time core snapshots from runtime
  warming, and verifies on-demand long-tail caching with a seven-day policy.
- Tests cover freshness boundaries, tag/path invalidation on publication and
  rollback, HTML/RSC separation, and English-home then Japanese-home negotiation.
- The design resolves the PR #652 outer-cache contract and states distributed
  consistency limits rather than extrapolating local results to production.
- The report names the prototype branch and head and lists remaining migration
  work, including the GSC_0065 removal inventory.
- The complete offline static gate and fixture production build run on the
  exact documentation head. The Cloudflare dry run is skipped by owner order;
  GitHub Actions remains disabled. Results are recorded in the PR and handoff.

## Evidence and delivery

Issue: [#674](https://github.com/jasonhnd/gitstarclub.com/issues/674).
The completed local proof and migration checklist are recorded in
[VINEXT-CACHE-DESIGN.md](../docs/analysis/VINEXT-CACHE-DESIGN.md).
The documentation PR and kanban handoff record the exact tested documentation
head, full offline gate results, and remaining review work. Prototype code stays
on spike/GSC_0074-vinext-cache and has no PR.
