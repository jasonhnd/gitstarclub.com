# Cloud executor readiness (GSC_0166)

## Goal

Explain the fresh-cloud failures at the exact `origin/pre` and
`origin/feat/astro-site` commits, make ordinary offline tests reliable, and
provide a short cloud execution procedure.

## Scope

1. Reproduce the cloud commands and documented gates in one disposable detached
   shared clone at a time. Block external application traffic during tests;
   package/toolchain downloads and the requested GitHub delivery are allowed.
2. Classify both sitemap timeouts, both Worker shell failures, the missing
   pipeline dependency, and the Astro scratch/dependency errors.
3. Fix confirmed code or test isolation problems without weakening assertions.
   Document changed testing behavior and add meaningful regression coverage.
4. Run the complete AGENTS static gate and fixture builds on the exact committed
   head. Create one issue and one pull request into `pre` for independent review.
5. Leave an untracked, one-page cloud procedure in the card scratch directory and
   include its content and all findings in the handoff.

## Out of scope and prohibitions

No live application requests, production/preview mutations, secrets, deploys,
Wrangler commands, CI/workflow/config changes, Actions enablement, data expansion,
branch deletion, force push, or merge. Do not push integration/release branches.
Use Node 24.20.0 and Bun 1.4.2. Preserve the shared Bun cache and checksum-verified
shared toolchain per the owner's disk policy; keep other artifacts card-local.

## Acceptance

- Every reported failure has evidence and a clear classification; any unavoidable
  reproduction differences (external network blocked) are recorded.
- The four reported tests behave correctly in plain Bun runs, including after
  a fixture build. Record unrelated bare-run discovery/mock failures and retain
  the documented isolated `lib/` gate; existing assertions remain intact.
- Run full web coverage, pipeline tests, lint, all typechecks, fixture validation,
  graph validation, production/pre builds, and host validation on the exact PR
  head. Record any unchanged baseline failure under the external-network ban
  explicitly; never weaken the font or host assertions. `cf:dry-run` is skipped
  by owner order; Actions stays disabled.
- PR contains `Closes #N`, commands/results, limitations, and independent review
  handoff. The current branch is clean and scratch output is removed except
  small referenced evidence and the cloud procedure.

## Confirmed findings

Issue #741 tracks this change. The two sitemap hooks use Bun's five-second
outer timeout despite a 30-second request budget, and live SEO was enabled by
default. A synthetic six-second sitemap reproduces both timeouts without a
network request. Explicit opt-in and aligned outer timeouts fix that test setup.

Both shell HTTP failures appear after a build writes the generated commit
module. The runtime correctly prefers that baked identity to the synthetic
`abc123` binding; tests must assert that precedence. Security-header assertions
remain unchanged. Missing pipeline/web dependencies and missing Astro scratch
configuration are installation/invocation problems rather than product defects.

Bare Bun discovery also collects Playwright files and permits module mocks to
leak between files. The supported full-suite entry remains `bun run test:cov`.
Under the card's external-network ban, a separate pre-existing limitation is
that an empty Google font cache produces remote stylesheet links; the unchanged
host validator correctly refuses that artifact even when the Vite build exits
successfully. Record this limitation separately from the four reported tests;
no font-delivery, deploy-script, or host-config change belongs to this fix.

The original Astro baseline also passed all 205 pipeline command tests but failed
its final synchronous fixture-disposal hook after 8.1 seconds on the shared disk.
Give that cleanup hook 30 seconds without changing any command assertion; the
exact-head full gate will verify it with the other test fixes.
