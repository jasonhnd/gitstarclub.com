# GSC_0131: P6 shared published-read conflict

## Goal

Resolve PR #712 against the Astro integration branch while retaining one
publication-scoped read transport for P5 and P6. Continue issue #700 on its
existing branch and pull request.

## Scope

1. Install the checksum-verified Node 24.20.0 and Bun 1.4.2 dependencies.
2. Normally merge origin/feat/astro-site into the existing PR #712 branch.
3. Retain the shared fetch-timeout alias and migrate P6 pages and endpoints to
   withPublishedReaders. Add shared transport behavior only where needed,
   preserving P5 behavior and covering changes with unit tests.
4. Preserve sitemap cache handling alongside the P5/P7 host changes and update
   the relevant package documentation.
5. Verify the exact committed head in one fresh detached shared clone, update
   PR #712 with results, push normally, and hand off for independent review.

## Out of scope and prohibited actions

No PR merge, rebase, force-push, branch deletion, protected-branch push,
deployment, Wrangler command, live cron or refresh call, data coverage change,
remote object mutation, CI enablement, workflow change, delivery-policy change,
or Worker deployment configuration change. No UI redesign or screenshots.
Keep the existing PR integration base under the migration exception.

## Acceptance

- One shared publication-scoped transport; no obsolete P6 transport modules.
- Astro host tests and verify:local pass.
- Strict P6 comparisons pass 50/50, including endpoint and layout checks.
- P5 local comparisons still pass.
- The full AGENTS bootstrap/static checks and fixture builds pass on the exact
  head, with the owner-authorized shared toolchain/shared Bun cache exceptions.
- Record that cf:dry-run is skipped by owner order; GitHub Actions stays off.
- PR #712 records the new head, commands, results, and any uncertainty.
- Clean Git status and card-local temporary-file cleanup before handoff.
