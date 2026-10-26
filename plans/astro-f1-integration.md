# Astro F1 final integration

## Goal

Make the integrated Astro page layer a locally verified, deployable replacement
for the existing Worker without changing the data pipeline or public URLs.
This card branches from `origin/feat/astro-site` at `c09e49c` and opens one PR
back to `feat/astro-site`, the explicit migration exception to pre-only policy.
Independent review and the owner retain acceptance, merge and deployment.

## Scope

1. Reuse the existing authenticated shell, scheduled dispatch and Queue consumer;
   preserve DATA, MEDIA, JOBS, WORKER_SELF_REFERENCE and GSC_CACHE contracts.
2. Add explicit production/pre builds, artifact validation and an owner-run,
   pinned-cf pre deployment command. Production is indexable; pre is noindex.
3. Remove the P5 comparison gateway, exercise P2/P6 directly, provide the shared
   default social card and explicitly return 404 for deferred cockpit routes.
4. Inventory all remaining web imports and document the post-cutover relocation.
   Update frontend and host documentation to the integrated Astro source host.
5. Run all local gates on the exact final commit from one detached shared clone.

## Out of scope and prohibitions

Do not remove `web/`, expand coverage, change publication/storage contracts,
secrets, schedules, DNS or routes, deploy, merge, enable Actions, invoke Wrangler
or the forbidden cf packaging aliases, or push protected/integration branches.
The old cockpit implementation stays in `web/`; it is unavailable on Astro.
CI and `.delivery.yml` remain unchanged unless implementation proves necessary.
All temporary output stays in this card's directory; only verified toolchain
archives use the owner-authorized shared cache. Bun uses its shared HOME cache.

## Acceptance

- Full AGENTS bootstrap/static/fixture production and pre builds on exact HEAD,
  with owner-ordered cf:dry-run omission; full web coverage suite passes.
- Astro `verify:local`, `bun audit`, both explicit builds/host validation, and
  root `lint:design` pass without platform deployment commands.
- P1 worker and 70 comparisons; P2 routes/browser and 42 comparisons plus 14
  HTTP GET/HEAD checks; P3 routes and 56 comparisons; P4 comparisons; P5 28 direct,
  unproxied comparisons and interaction checks; P6 50 comparisons; P7 built
  Worker and 68 HTTP parity cases pass.
- Whole-site fixture link crawl reports zero internal 404s. Both modes preserve
  local fonts and CSP `script-src 'self' 'unsafe-inline'`; default card is PNG.
- PR records commands/results, remaining risks, the exact tested commit and
  deferred deployment/performance/live-refresh acceptance. Clean Git status and
  small card scratch directory at handoff to the review role.

## Operational replay regression

Final integration exposed that HTTP GET does not imply a read-only operation:
daily/weekly refresh and refresh start can publish or enqueue work. The old
Worker dispatched these bypassed handlers once. F1 explicitly keeps that
behavior for GET and implicit HEAD. Twelve host regressions first failed:
success could become 503 after a post-write pointer outage, and a publication
change replayed the handler twice. The fix preserves the initial publication
capture and original response while retaining read-only GET/HEAD race fences.
All exact-head gates and package runners are rerun after this correction.
