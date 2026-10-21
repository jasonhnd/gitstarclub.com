# Vite security patch for issue 693

## Goal

Restore the `pre` dependency audit gate by upgrading Vite from 8.3.0 to
8.3.3, the lowest patched stable release in the current 8.3 series for
[GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
The advisory and `npm view vite versions --json` confirm this release.

## Scope

- Update the exact Vite pin in `web/package.json` and regenerate
  `web/bun.lock` with Bun 1.4.2, retaining unrelated locked resolutions.
- Synchronize the exact Vite assertion in `web/scripts/check-host-graph.ts`.
  This minimal compatibility adjustment is required because the graph gate
  otherwise rejects every installed version except the vulnerable 8.3.0.
- Update current Vite references in `docs/VINEXT-HOST.md` and
  `docs/FRONTEND.md`; retain historical prototype versions in analysis.
- Keep vinext 1.2.1 and Cloudflare Vite plugin 2.0.0-beta.v.2 unchanged.
  Their published Vite peer ranges accept 8.3.3.
- Re-run both web and pipeline high-severity dependency audits.

## Out of scope

No audit ignores, application behavior changes, data expansion, pipeline
dependency changes, CI/configuration edits, deployment, Wrangler/OpenNext
invocation, live cron/refresh requests, infrastructure changes, merge,
force-push, or push to `pre`, `main`, or `preview`. GitHub Actions stays
disabled. `cf:dry-run` is skipped by owner order dated 2026-10-19.

## Steps

1. Read the card and repository rules, verify the official Node v24.20.0
   and Bun 1.4.2 archives, install both existing frozen lockfiles, inspect
   the advisory and published peer ranges, create issue 693, and commit
   this plan on the assigned branch from `origin/pre`.
2. Apply the exact dependency and validator updates, regenerate and inspect
   the web lockfile, update current documentation, and commit the change.
3. In one fresh detached shared clone of the exact final commit, run the
   complete AGENTS.md bootstrap and offline static/build checks below.
   Publish the commands and results in one PR into `pre` with `Closes #693`.
4. Delete the temporary verification clone and generated output after
   recording evidence, confirm a clean Git status, and hand off GSC_0111
   to independent review without merging.

## Acceptance

- The official toolchain archives pass SHA-256 checks and both binaries
  report the prescribed versions. Use the shared toolchain archive root
  and shared Bun cache per the card's disk-hygiene override; keep all other
  temporary artifacts in this workspace's `.kanban-work/GSC_0111/`.
- Fresh detached final-head verification passes frozen installs, runtime
  assertions, both audits, host graph validation, CI contract assertions,
  pipeline tests, docs lint, web lint, all three typechecks, fixture view
  validation, and the complete web coverage suite with its thresholds.
- The local read-only fixture supports both `bun run build` (production)
  and `bun run build:pre`, each followed by matching `validate:host`.
- Frozen verification changes neither tracked lockfile. No live suite or
  deployment runs. The PR records the tested SHA, every command/result,
  the skipped `cf:dry-run`, and any remaining uncertainty.
