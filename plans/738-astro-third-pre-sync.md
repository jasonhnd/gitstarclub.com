# Astro third integration sync

## Goal

Resolve #738 by merging `pre` at `96b6189` into the Astro integration based on
`30b844e`, preserving PR #734's preview aggregate history import endpoint when
Astro replaces the web host.

## Scope

1. Reverify the pinned Node/Bun toolchain and install frozen dependencies.
2. Merge `origin/pre` with a merge commit on the card branch, without rebasing.
3. Route the aggregate importer through the shared Worker shell before Astro's
   publication/cache handling. Preserve the exact preview environment, bucket,
   POST, bearer and per-call bucket-marker guards, with production inert.
4. Extend built Astro host validation and web/Astro HTTP parity for the endpoint,
   add meaningful regression coverage and update the host documentation.
5. Verify one exact final commit in one fresh detached shared clone, open one
   PR targeting `feat/astro-site` (explicit card exception), and hand off for
   independent review. Commit after each completed step.

## Out of scope

No PR merge, deployment, protected-branch push, shared rebase, force-push,
Wrangler/OpenNext or forbidden packaging command, live operational request,
remote schedule/DNS/route/secret/R2 mutation, CI/delivery/configuration change,
new page or data coverage expansion. GitHub Actions stays disabled and
`cf:dry-run` is skipped by owner order. No visual changes or screenshots.

## Acceptance

- Complete AGENTS bootstrap/static/build checks, including the full web suite
  and fixture production/pre builds and matching validators, using Node
  v24.20.0 and Bun 1.4.2 with rechecked official archive checksums.
- Use the owner-authorized shared toolchain and HOME Bun cache; keep all other
  temporary files under this workspace's `.kanban-work/GSC_0163/`.
- Run Astro `verify:local`, high-level dependency audit, every P1-P7 runner,
  actual P7 Worker with 30000 ms timeout, HTTP parity and queue budget with
  120000 ms timeout. Both hosts must refuse production imports and match all
  preview guard responses without touching a live host.
- Run root production/pre builds and matching host validation, `crawl:local`
  with zero internal 404s/HTTP errors, and `perf:local` with all page budgets.
- Record exact-head commands/results and remaining limits in the PR and card
  handoff. Deliver a clean checkout, remove the single disposable clone and
  generated output, and report final card-directory size.
