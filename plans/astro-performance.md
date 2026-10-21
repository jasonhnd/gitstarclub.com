# Astro performance follow-up

## Goal

Keep Astro client JavaScript and first contentful paint at or below the retained
web host before cutover. Pages remain server HTML by default; only the existing
interactive islands hydrate.

## Scope

- Enable production minification for client and server builds, retain standard
  tree shaking, and resolve React to one copy across shared web imports/islands.
- Add a reproducible same-fixture, cold-browser comparison for home, rankings,
  a published ranking period, a repository, compare, pulse and about in English
  and Japanese. Count decoded and individually gzipped JavaScript bytes,
  island instances and script requests, and median FCP/LCP over at least five
  runs. Fail the per-page gzip budget when Astro exceeds web.
- Document the measurement method, limits, exceptions and migration PR targets.
- Open one feature PR into `feat/astro-site` from the merged F1 baseline
  `9efbbef7089ad668ec3b763241b49a5c201a48cc`. This brief explicitly overrides
  the general pre-only rule for migration package/F1/performance PRs.

## Out of scope

No merge, deployment, Wrangler/legacy packaging, Actions enablement, production
or preview cron/refresh, resource/configuration mutations, data coverage growth,
shared-branch rebase, protected-branch push, or web removal. Keep all data,
locale, appearance, CSP and interaction contracts. Do not change CI, delivery,
typed Worker config or deploy scripts. Use the owner-authorized shared toolchain
and HOME Bun cache; other artifacts stay in the current card directory.

## Steps and acceptance

1. Install frozen dependencies with checksum-verified Node 24.20.0 / Bun 1.4.2;
   commit this plan before implementation.
2. Enable minification/deduplication and add tested performance collection and
   budget tooling; commit the completed implementation and matching docs.
3. In one fresh detached exact-head clone under this card, run the full AGENTS
   static/build block, `astro verify:local`, all P1-P7 package runners (P5 28/28
   unproxied and P7 68/68), and `crawl:local` with zero internal 404s. Skip all
   forbidden platform commands, including `cf:dry-run`, by owner order.
4. Run the performance tool on that exact head, record its table and all gate
   results in the PR, and explain any performance exception with A/B/C options.
   FCP noise is assessed with paired runs and an explicit tolerance, never a
   single sample. Independent review performs final acceptance.
5. Push only the card branch, open the PR, remove generated copies/artifacts,
   confirm clean Git status, and hand off files, verification, risks and final
   card-directory size to the review role.
