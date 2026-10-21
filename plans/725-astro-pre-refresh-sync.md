# Astro integration refresh sync

## Goal

Resolve #725 by bringing `feat/astro-site` at `ffc8cd5` up to date with `pre`
at `d674f0b`, preserving the Astro host and the bounded refresh workflow.

## Scope

1. Install the pinned dependencies and record this plan on the card branch,
   based on `origin/feat/astro-site`.
2. Merge `origin/pre` with a merge commit, retaining both sides' intent. Verify
   PR #717/#722/#724 and the existing #690/#691/#694/#696 ancestry.
3. Align Astro's Worker entry and Queue consumer with the shared web runtime:
   paged validation, entity/rest recomputation, publish and garbage collection;
   work-offset checkpoints; and fresh failure-successor delivery. Add local
   regression coverage and update the host documentation.
4. Verify the exact final commit in one fresh shared detached clone, record all
   results in one PR targeting `feat/astro-site`, and hand off for independent
   review. This target is the explicit exception in the card brief.

## Out of scope

No PR merge, deployment, protected-branch push, rebase, force-push, platform CLI,
live cron/refresh requests, infrastructure/secrets/data mutations, CI workflow,
delivery or Worker configuration changes, or data-coverage expansion. GitHub
Actions stays disabled. Owner order excludes `cf:dry-run` and related commands.
No UI changes are planned.

## Acceptance

- Reverify Node 24.20.0 and Bun 1.4.2 archive checksums and versions using the
  existing shared toolchain; keep Bun's shared HOME cache and all generated
  verification output under this card's `KANBAN_TMP`.
- Complete the AGENTS static job, the full web coverage suite and read-only
  fixture production/pre web builds with matching host validation.
- Run Astro `verify:local`, `bun audit --audit-level=high`, all P1-P7 package
  runners listed in PR #718/#720, including actual Worker tests with
  `--timeout 30000` and HTTP parity, plus `lint:design` and `perf:local`.
- Run explicit root Astro production/pre builds and matching host validation;
  `crawl:local` must report zero internal 404s and HTTP errors.
- Exercise the subrequest-budget scenario through the actual local Astro
  consumer path, or prove shared runtime tests cover that exact path.
- Commit each completed step. Deliver a clean source checkout and the exact
  tested head, remove the temporary clone and generated output, record the
  final card-directory size, and complete GSC_0151 for review.
