# Handover — gitstarclub.com leader (2026-10-02)

Leader shift change. Previous handover: branch `docs/handover-2026-09-30`. Storage migration source of truth: `docs/R2-CUTOVER.md`. Incident background: #543.

## What is being worked on now

1. **Vercel Blob -> Cloudflare R2 migration.** Stage 0 and stage 1 code are done and in `pre`. Buckets `gitstarclub-data-pre` / `gitstarclub-data-prod` exist; custom domains `data-pre.gitstarclub.com` / `data.gitstarclub.com` are bound and serve `_meta/bucket-identity.json` (verified 2026-09-30). Review fixes are merged into `pre`: #581 (unquoted ETag for workerd), #583 (initial-commit lease), #630 (stage-4 gates/tools prep), #639 (offline workerd R2 rehearsal: `cd web && bun --no-env-file scripts/r2-local-rehearsal.ts`, nine checks pass), #642 (30 s R2 IO deadline). **Next step = stage 2 real-bucket rehearsal**, blocked on the owner's R2 token (decision d1002-115208-1). Production still reads Blob version `refresh-2026-09-13...` via `VIEWS_VERSION_FALLBACK`. Do not run a production refresh; do not delete the Blob store.
2. **Security fixes, all merged into `pre`, not in production:** Next 16.3.8 + OpenNext 1.20.7 (#591, #619), `/api/lang` open redirect (#621, confirmed live on production), secret-safe error sanitizer (#622, follow-up #638), public parameter validation (#629), Worker shell timing-safe secret + headers (#627), deployment identity (#616). Production hotfix awaits owner decision d1002-011527-1. If hotfixed, update the stage 4/6 rollback version in `docs/R2-CUTOVER.md` (now `14b84f73...`, which runs Next 16.3.5).
3. **Code-health / docs / dependency cards.** About 30 PRs were merged into `pre` on 2026-10-01/02 (owner: "merge everything into pre").

## Open Kanban cards (project gitstarclub.com)

- GSC_0063 — resolve PR #599 (docs set B, also carries #574 runbook; #580 was closed in its favour) conflicts with `pre`. Blocked.
- GSC_0066 — resolve PR #640 (#589 pipeline tests) docs conflicts with `pre`. Blocked.
- GSC_0041 — #594 React 19.3 / Zod / three (blocked; needs a fresh start from current `pre`, which now has #641). Then GSC_0042 (#595 drop @vercel/analytics) -> GSC_0043 (#596 Bun 1.4.2), chained on `web/bun.lock`.
- GSC_0035 — read-only health audit of `web/lib/workflows`, awaiting acceptance; split its findings into executor cards that avoid files in flight.

## Waiting on the owner (registered with `roles decide`)

- d1002-115208-1 (blocking): permanent R2 token scoped to the two data buckets (Object Read & Write), owner fills `pipeline/.env` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID=00f850e853e4c7f9627233d51a6e30a1`, `GITHUB_TOKEN`). Agents must not read it.
- d1002-011527-1 (blocking): production security hotfix (recommend A: main-only hotfix of the security commits).
- d1001-135216-1: `/cockpit` prototype is live on production (noindex); recommend removing it from production.

## How merging works now (lessons)

- Ruleset requires the PR branch to be up to date with `pre`; repo auto-merge is off. Merge serially: sync, wait for `static` + `production-build` on the new head SHA, squash.
- Almost every PR edits the top of `docs/CHANGELOG.md`, so each merge re-conflicts the others. Union-resolve CHANGELOG-only conflicts; send any code/doc conflict back to an executor card.
- Two PRs can each pass alone and fail together (e.g. #636 HTML baseline vs #637 Korean copy, #641 Miniflare vs #639 harness). Always wait for checks on the synced head.
- Register every owner question with `roles decide add` (with card numbers). Questions asked only in chat were invisible to the owner for a day.
- The owner rejected several long merge tool calls mid-run; keep each step short and report after each merge.

## Housekeeping

- Main checkout is shared with Kanban merges and may sit on a feature branch; do not assume it is on `pre`.
- Ops archive outside the repo: `../gitstarclub-ops-archive/` (GSC_0018/0019/0031/0036/0037 reports).
- Open dependabot PRs #422-#507 are stale (superseded by the dependency cards); close them when convenient.
