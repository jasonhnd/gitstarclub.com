# Astro P5: compare and pulse

## Goal and scope

Port `/compare` and `/pulse`, including all six locale-prefixed forms, from
`web/app/_localized/` to the P0 Astro shell on `feat/astro-site`. Preserve the
existing content, metadata, structured data, appearance and comparison island.
Reuse dictionaries, contracts, presentational components and data readers from
`web/` without modifying that tree.

P5 owns `astro/src/packages/p5/`, compare/pulse page entries and
`astro/tests/p5/`. A minimal shared transport bridge and Vite alias may connect
the existing published readers to the captured read-only DATA facade. Document
any shared additions for the integration reviewer.

## Out of scope and prohibitions

No data coverage, contract, pipeline, operational behavior, design token or
other package changes. No deployment, Wrangler invocation, Actions enablement,
remote resource writes, live refresh, merge, force-push or protected-branch
push. This package's explicit integration target is `feat/astro-site`.

## Steps

1. Read the Product specification, P0 plan, route implementations and design
   constraints; install frozen dependencies using the verified toolchain.
2. Port server-rendered page bodies and the existing comparison interaction;
   connect existing readers to request-scoped native storage. Commit.
3. Add package tests, all-locale path samples and parity/browser verification.
   Fix differences while preserving existing behavior. Commit.
4. Verify the exact head in one fresh detached shared clone: complete AGENTS
   bootstrap/static/build blocks, Astro checks/tests/build, design lint and
   local old-versus-new comparison. Remove screenshots after inspection.
5. Open one issue and one PR, record commands/results/limitations, clean all
   temporary output and hand off to an independent reviewer. Do not merge.

## Acceptance

Both routes return HTTP 200 in seven locales. Strict full-page parity checks
status, visible text, title/meta/canonical/hreflang and JSON-LD for at least
three representative URL samples (including a selected comparison). Desktop
and mobile screenshots preserve layout; only font rendering may differ.
Pulse adds no hydrated page body; compare hydrates only its existing picker
and curve workbench. Design lint has zero errors. Full offline web coverage,
static checks, fixture builds, Astro checks/tests/build and browser behavior
pass on the exact delivered commit. `cf:dry-run` is skipped by owner order.
Screenshots and temporary full-repository clones are deleted after results
are recorded. The final checkout is clean and pushed only to its feature
branch; reviewer/owner acceptance remains pending.
