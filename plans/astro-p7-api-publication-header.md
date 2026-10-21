# P7 API publication header parity

## Goal

Restore the existing API response contract in PR #711 for issue #704 by keeping
`x-gsc-publication` on pages only. API GET/HEAD publication checks must remain.

## Scope

- Limit the host's publication response header to non-API paths.
- Cover protected API GET/HEAD requests, publication changes during streamed
  output, repeated publication races, and the built Worker's response headers.
- Document the distinction between internal publication checks and page headers.
- Update the existing PR #711 branch with normal pushes and exact-head results.
  Retain its migration integration base `feat/astro-site` under the owner order
  recorded in `plans/astro-migration.md`; the final integration PR targets `pre`.

## Out of scope

No endpoint logic, publication-check relaxation, page-header changes, data
coverage changes, UI changes, dependency/lock changes, CI/config/deploy changes,
Wrangler, live operational calls, resource changes, merges, protected-branch
pushes, force-pushes, rebases, or branch deletion. Independent review owns final
acceptance.

## Steps

1. Read the card/rules and existing PR, verify the pinned toolchain, install
   frozen dependencies in the new workspace, and commit this plan.
2. Add regression tests and reproduce the extra header; fix the host condition,
   update P7 documentation, run host tests, and commit the completed fix.
3. Verify the exact commit in one fresh detached shared clone under GSC_0132:
   the full AGENTS bootstrap/static/fixture production and pre builds, design
   lint, Astro local verification, host/P7 Worker tests, and built-HTTP parity.
4. Normally push the PR branch, update PR #711 with the exact head and every
   result, remove temporary dependencies/build output/logs, and hand off to the
   independent review role. Record the owner-ordered `cf:dry-run` skip.

## Acceptance

- API GET/HEAD responses omit `x-gsc-publication`; page responses retain it.
- API reads consume output and recheck publication, retry once on a change,
  and return 503 after repeated changes without touching the shared page cache.
- `cd astro && bun run verify:local`, `bun test tests/host.test.ts`, and
  `GSC_P7_WORKER_TEST=1 bun test tests/p7/worker.test.ts` pass.
- `cd astro && bun tests/p7/http-parity.ts` passes all 68 built-HTTP cases.
- The complete offline AGENTS static gate, full web coverage suite, production
  and pre fixture builds/host validation pass on the same exact commit.
- PR #711 records commands/results and limitations; Actions stays disabled,
  Git status is clean, and final card scratch size is reported in the handoff.
