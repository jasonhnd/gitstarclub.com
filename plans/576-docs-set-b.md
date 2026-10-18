# Plan: docs set B for issue #576

## Goal

Make the current docs describe Cloudflare Workers hosting, public preview, and the accepted copied-store R2 production cutover. Keep superseded phase docs under `docs/archive/`. On the 2026-10-13 resume (GSC_0002), reconcile the historical #574 bootstrap recipe with the operator acceptance recorded in PR #649, retaining historical recovery and rollback without presenting them as current instructions.

## Scope

- Current docs: README, web/README, docs/README, OPS, DEVELOPMENT, ARCHITECTURE, REQUIREMENTS, ROADMAP, WORKFLOW, SEO, API, CODEBASE, GEO, DATA-CONTRACTS, geo/ai-log-reporting, R2-CUTOVER, AGENTS (the one hosting sentence that would otherwise stay false), CHANGELOG link targets plus one unreleased note.
- Move `docs/CF-MIGRATION-P1.md`, `docs/CF-MIGRATION-P2.md`, `docs/CF-MIGRATION-P3.md`, and `docs/R2-MIGRATION-P0.md` to `docs/archive/` with a one-line superseded banner. Update links and the docs index.
- Findings in scope: A01, A02, A03, A04, A05, A06, A08, A09, A10, A12, A14, A15, B01, B02, B08.
- Branch `docs/576-docs-set-b` starts at `d9d9897` (PR #580 / #574), because `origin/pre` at `2958fc2` does not contain that commit yet.
- Resume the existing PR #599 at `19c708c` and normally merge freshly fetched `origin/pre` (`5af183a` at resume). Resolve the R2-CUTOVER text conflict and the automatically merged OPS semantic conflict; incoming application code stays unchanged.
- Record dated public production/preview identities, pointer availability, and provider evidence limits in maintained docs. Distinguish issue #647 from config PR #648 and historical acceptance PR #649. Keep the frozen fallback while the production pointer is absent; the gate permits absence or exactly `refresh-2026-09-13T06-00-16-398Z`.

## Out of scope

- Code, tests, CI, `.delivery.yml`, and Worker wrangler values.
- Deploy, DNS, buckets, secrets, and env files.
- Findings owned by other cards (A07, A11, A13, B03–B07, C01).
- Rewriting `docs/VERCEL-DATA-OPERATIONS.md` or deleting it. Current docs stop treating it as the live host procedure.
- Merging, or pushing `main`, `pre`, or `preview`.
- New stage 2/3 acceptance, production refresh, stage 5 schedule enablement, or stage 6 Blob retirement. The unaccepted bootstrap recipe is historical and does not govern the accepted copied store.
- Editing the excluded owner `HANDOVER.md`, provider credentials, or environment files. The old rollback reference is retained as history; its present availability and security suitability are not assumed.

## Acceptance

- `bun run lint:docs` and `node scripts/check-docs.mjs` pass on Node v24.20.0 and Bun 1.3.14 with `--no-env-file`.
- R2-CUTOVER and OPS agree on the historical #574 recovery, accepted copied-store cutover, and stage 6 tool prerequisite.
- `git grep -n 'Vercel-first'` in current docs is empty. Remaining hits are listed and sit in archive, changelog history, or old plans.
- Preview is documented as public, `noindex,nofollow`, `Disallow: /`. `noindex` is not access control. The production trigger stays unverified.
- OPS and R2-CUTOVER agree on the accepted copied-store cutover, required frozen fallback, conditional removal, and separately authorized historical bootstrap recovery/rollback.
- Before merge, run the full static job (pipeline tests, docs lint, web lint, all three typechecks, view validation, and full web coverage), the local GET/HEAD fixture production build, and pre-only `cf:dry-run` on the exact synchronized head. Use SHA-256-verified Node v24.20.0 / Bun 1.3.14 under `env -i`, without real env files or live opt-ins. The October 15 review pass below requires the three documentation checks; full integration verification follows the separately scheduled dependency resynchronization.
- The October 15 owner rule replaces earlier temporary paths: new artifacts belong under `<workspace>/.kanban-work/GSC_0002/`, excluded through `.git/info/exclude`. Do not create new artifacts under `/tmp` or alter the owner's untracked environment files. The card prohibits another worktree.
- `git diff --check` passes; `origin/pre` is an ancestor; the final diff against it contains only the authorized documentation/plan changes. The existing PR body records the exact head, commands/results, limitations, and any CI wait. Exact-head `static` and `production-build` must pass before merge.
- Push only `docs/576-docs-set-b`, hand off through GSC_0002 with a clean `git status --short`, and await independent review and a separate batch merge.

## October 15 review rework (GSC_0006, round 0)

### Goal and scope

Address all six requested changes on the existing branch with normal commits, preserving incoming application/configuration code:

1. Rewrite the OPS incident #543 removal procedure and R2 stage 0 reference to require separate authorization, an authoritative production R2 views pointer returning 200, and a production build without the fallback that still prerenders real data. Change the Worker var and build shell together. Retain the existing gate and defer Blob-secret removal to stage 6.
2. Replace ROADMAP's current-production Blob views/storage claims with the accepted R2 contract.
3. Align the SEO production build shell with OPS/R2: explicit R2 driver/base, the exact frozen fallback while the pointer is absent, and no Blob shell vars.
4. Use `EDGE_CACHE_VERSION`, not `VIEWS_VERSION_FALLBACK`, for separately authorized cache-key rotation.
5. Repair CHANGELOG's archived P3 link and inspect its other migration-document links, which the docs checker does not cover.
6. Correct all four archive banners. Sweep the entire docs tree for additional current-production Blob or future-cutover claims; qualify historical text instead of erasing recovery history.

### Out of scope

`docs/DATA-EXPORTS.md`, `docs/VERCEL-DATA-OPERATIONS.md`, application code, dependencies/locks, CI, gates, Worker/deploy configuration, production actions, merges, rebase, force push, and new pre synchronization. GSC_0004 owns the inherited dependency audit remediation; GSC_0005 owns the queued Actions investigation.

### Acceptance and delivery

- All six findings and related current-production wording are addressed; historical Blob driver/default/rollback descriptions remain explicitly historical or driver-specific.
- Run `bun run lint:docs`, `node scripts/check-docs.mjs`, and `node scripts/assert-cf-ci-gates.mjs` on the exact final rework head with the pinned, SHA-verified toolchain and no real environment files/live opt-ins. Also run `git diff --check` and check repaired CHANGELOG links directly.
- The diff from reviewed head `699fc96` contains only authorized documentation and plan changes; the two excluded documents are unchanged.
- Update PR #599 with the final head, a finding-by-finding response, exact command results, and the explicitly older scope of prior full-suite/build evidence. Return through `kanban_complete` for independent review. Dependency resynchronization and passing final integration gates remain later merge conditions, not blockers for this documentation rework.

## Historical review notes

The notes below record the original October 1 review. Current storage status and the resumed acceptance above supersede their Blob-until-cutover wording and bootstrap-only cutover assumptions.

## Review round 1

- Remove the architecture cost table. Do not invent Cloudflare prices.
- Remove the standing Vercel Firewall roadmap item. The August sequence note that #380 left Firewall empty stays as history.
- Align the pipeline refresh roles, the frontend weekly-cron and build-cap sentences, and the TESTING P3 row with Workers. Keep production Blob until cutover and the unverified production caller.
- The Sunday failure runbook prints `0 6 * * SUN`, not weekday `0`.
- Do not edit dependencies, lockfiles, or CI. The failed `static` audit is a separate baseline fix.

## Review round 2

- Bing `msvalidate.01` is set in the shell that runs the Cloudflare production build, then checked in the generated HTML. A Vercel project variable does not change that output.
- The GEO report parser accepts Vercel-shaped logs as compatibility input only. Cloudflare aggregate measurement stays pending an input adapter and evidence. Do not claim the parser reads Worker logs.
- `POST /api/workflows/refresh/step` names the configured production consumer `gitstarclub-jobs` and the preview consumer `gitstarclub-jobs-pre`. The production scheduler and caller stay unverified.
- Runtime errors are Workers Observability on the Worker that served the request. Build and deploy errors are the GitHub `production-build` job or local `cf:build` / Wrangler output.
- The dependency fix is already on `pre` through #591. This card still does not edit dependencies or CI. Merging current `pre` brings that fix in. Required checks are not claimed until they run on the pushed head.
- PR #580 is still a separate open pull request. This branch does not merge it. A later squash of #580 can conflict again. Force-push stays forbidden.
