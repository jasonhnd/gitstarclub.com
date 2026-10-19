# GSC_0075: vinext host migration

## Goal

Move the existing web application to vinext on Cloudflare Workers with typed configuration and cf-only delivery. Based on origin/pre ec92c925 (Next 16.4.2, React 19.3.1, accepted cache design and cold-start publication fix).

## Scope

1. Record the issue, install the verified Node 24.20.0 / Bun 1.4.2 toolchain, and capture the baseline.
2. Pin vinext/Vite/cf, port the complete production/pre host contract, replace platform context, and remove the legacy adapter/toolchain.
3. Implement bounded hybrid core snapshots and writable long-tail cache with authoritative existing-JSON publication fencing, including rollback and concurrent render protection.
4. Port build identity, local artifact validation, delivery guards and tests; keep schedules paused and Actions disabled.
5. Update current documentation and preserve historical evidence.
6. Run the complete offline static gate, explicit production/pre builds and local runtime/browser checks on the exact head; attach English/Japanese home/ranking/repository screenshots.
7. Push only this feature branch and open one PR against pre with Closes #683; hand off to an independent reviewer.

## Out of scope and prohibited operations

No new product pages or expanded data coverage. No runtime database or Durable Object. No deployment, remote cache warming, cron/refresh call, Cloudflare resource mutation, production access, branch deletion, force push, protected-branch push or PR merge. Never run the legacy platform CLI, its adapter commands or old platform build scripts. Temporary files, clean checkouts, caches and build output stay under this checkout's .kanban-work/GSC_0075 directory.

## Acceptance

- Full exact-head offline web suite, coverage and static block pass in a fresh detached checkout, with immutable lockfiles.
- Both Vite modes build; complete bindings/vars, queue retries, same-mode self-reference and paused schedules are validated locally.
- Lock graph contains no legacy CLI package; executable commands use only cf for Cloudflare.
- Local runtime proves literal core snapshots, on-demand tail HTML/RSC, cache isolation/expiry/publication/rollback/failure races, valid OG PNG, all locales and language API, self-hosted fonts, unchanged CSP, production indexing and preview noindex, and build identity.
- PR records commands/results, before/after screenshots, limitations and any remaining external acceptance. Executor does not merge or perform final acceptance.

Issue: https://github.com/jasonhnd/gitstarclub.com/issues/683.
