# Astro P4: organizations

## Goal and scope

Port `/o`, `/o/page/{page}` and `/o/{login}` to Astro in all seven existing
locales without changing URLs, content, metadata, appearance or data coverage.
Use `feat/astro-site` as the base and PR target under the explicit migration
brief. Keep `web/` available and unchanged as the comparison baseline.

P4 owns `astro/src/packages/p4/`, root/localized `o/` page entries,
`astro/tests/p4/`, and this plan. Reuse existing dictionaries, contracts,
organization helpers and static React components. The sole shared-file exception
is two additive source-scan declarations in `astro/src/styles/globals.css`,
needed to compile unchanged shared and P4 component utilities together. No
shared component, design token or configuration is refactored. Read published base views
through P0's request-local facade and retain its sole HTML cache boundary.

## Steps

1. Record this plan and install frozen root/web/pipeline/Astro dependencies
   using the checksum-verified Node 24.20.0 and Bun 1.4.2 toolchain.
2. Add localized organization index, pagination and detail pages, retaining
   validation, redirects, empty states, structured data and existing controls.
3. Add package tests, a deterministic multi-page fixture and full-page parity
   paths. Compare the unchanged web build and actual Astro Worker locally.
4. Run the complete AGENTS bootstrap/static/build gates and Astro verification
   from one fresh detached clone of the exact committed head; record results.
5. Push only this card branch, open one issue/PR, clean temporary artifacts and
   hand off for independent review. Commit every completed implementation step.

## Out of scope and prohibited operations

No data-layer, pipeline, dictionary, shared-shell or unrelated package refactor.
No cockpit migration, coverage expansion, dependency churn, deployment, Actions,
Wrangler, legacy packaging, remote cron/refresh, remote resource writes,
protected-branch push, force push, rebase, branch deletion or PR merge.

## Acceptance

All three route forms return 200 for valid fixture data across seven locales.
Malformed/missing owners and invalid/out-of-range pages retain 404 behavior;
page one retains its localized 308 redirect. Compare three representative pages
across seven locales at desktop/mobile sizes using the strict parity tool:
status, visible text, title/meta, canonical/hreflang and JSON-LD must agree.
Review local screenshot pairs, describe results, then delete all screenshots.
Only existing interactive controls hydrate; directory and detail body content
remain server HTML. `lint:design` has zero errors. Astro tests/typecheck/build
and the full offline web/static/build gates pass on the exact head. Skip
`cf:dry-run` by owner order. Document commands/results and remaining uncertainty
in the PR; reviewer/owner performs final acceptance and merge.
