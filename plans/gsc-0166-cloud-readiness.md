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
- Plain offline `bun test` succeeds with all package dependencies installed,
  including after a local fixture build; existing assertions remain intact.
- Full web coverage, pipeline tests, lint, all typechecks, fixture validation,
  graph validation, and production/pre builds and host validation pass on the
  exact PR head. `cf:dry-run` is skipped by owner order; Actions stays disabled.
- PR contains `Closes #N`, commands/results, limitations, and independent review
  handoff. The current branch is clean and scratch output is removed except
  small referenced evidence and the cloud procedure.
