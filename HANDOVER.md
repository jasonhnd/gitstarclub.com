# Handover — gitstarclub.com leader (2026-10-04, STILL PAUSED)

Leader shift change. Previous handover: branch `docs/handover-2026-09-30`. Storage migration source of truth: `docs/R2-CUTOVER.md`. Incident background: #543.

## What is being worked on now

1. **Vercel Blob -> Cloudflare R2 migration.** Stage 0 and stage 1 code are done and in `pre`. Buckets `gitstarclub-data-pre` / `gitstarclub-data-prod` exist; custom domains `data-pre.gitstarclub.com` / `data.gitstarclub.com` are bound and serve `_meta/bucket-identity.json` (verified 2026-09-30). Review fixes are merged into `pre`: #581 (unquoted ETag for workerd), #583 (initial-commit lease), #630 (stage-4 gates/tools prep), #639 (offline workerd R2 rehearsal: `cd web && bun --no-env-file scripts/r2-local-rehearsal.ts`, nine checks pass), #642 (30 s R2 IO deadline). **Next step = stage 2 real-bucket rehearsal**, blocked on the owner's R2 token (decision d1002-115208-1). Production still reads Blob version `refresh-2026-09-13...` via `VIEWS_VERSION_FALLBACK`. Do not run a production refresh; do not delete the Blob store.
2. **Security fixes, all merged into `pre`, not in production:** Next 16.3.8 + OpenNext 1.20.7 (#591, #619), `/api/lang` open redirect (#621, confirmed live on production), secret-safe error sanitizer (#622, follow-up #638), public parameter validation (#629), Worker shell timing-safe secret + headers (#627), deployment identity (#616). Production hotfix awaits owner decision d1002-011527-1. If hotfixed, update the stage 4/6 rollback version in `docs/R2-CUTOVER.md` (now `14b84f73...`, which runs Next 16.3.5).
3. **Code-health / docs / dependency cards.** About 30 PRs were merged into `pre` on 2026-10-01/02 (owner: "merge everything into pre").

## PAUSED (2026-10-02 ~03:40Z, owner order via AFC leader)

The owner paused the gitstarclub project: no new cards, dispatch, acceptance, merges or pushes. Every open card was archived by this leader (kanban now shows only done 45 / archived 29). The AFC leader archives the other gitstarclub sessions and temp workspaces. Leader session 0f4b4e3f-9a5b-4c2d-b223-1b9efa68381b is kept and idle.

### Since the pause (2026-10-03/04)

- Still paused. No open cards (kanban: done/archived only). No pending decisions for gitstarclub (all three shelved, listed below). No heartbeats.
- Two quota "add work" broadcasts (10-03 Claude/SuperGrok/ChatGPT, 10-04 ChatGPT) were declined: the project stays paused until the owner explicitly says "resume gitstarclub".
- New rule 2026-10-04 (CLAUDE.md): work the owner did not ask for (audits, refactors, extra tests, using spare quota) must first be registered with `roles decide add` and approved before any card. On resume, the GSC_0035 follow-ups (S1-S8) were leader-initiated, so register them as one decision (A: S1+S4 high-risk first, then the rest; B: only S1+S4; C: none) before re-creating cards. PR-sync for #640/#599 and the dependency chain were already owner-approved ("merge everything into pre").
- Cursor profiles are no longer used by Paseo (10-03); spd_hp belongs to Grok Bot, not relevant here.
- Pitfalls: HANDOVER.md is git-excluded in the main checkout (committed copies live on local branches docs/handover-*); main checkout sits on feat/578-r2-stage4-ready, not pre; merges go through batch cards only; CHANGELOG conflicts recur on every merge.

### State at pause

- GSC_0035 (read-only workflows audit) was ACCEPTED. Full report: `../gitstarclub-ops-archive/GSC_0035-workflows-audit.md` (32 findings F01-F32, recommended cards S1-S8).
- Archived mid-flight (executors had just started; nothing pushed to origin for these as of the pause; their GitHub issues exist):
  - GSC_0069 S1 F01/F09 preview invalidation must not target production -> issue #643 (L4, high-risk)
  - GSC_0070 S2 F02/F03/F04 replay-safe rank/rest hops -> issue #646
  - GSC_0071 S3 F05/F06 cursor and packed-window validation (no issue seen yet)
  - GSC_0072 S4 F07/F08 paginate alias and version listings -> issue #644 (L4, high-risk)
  - GSC_0073 S5 F16/F17/F18 full refresh chain in-memory tests -> issue #645
  - GSC_0074 S6 F11/F12/F22 remove unused helpers, checkpoint timing (never started)
  - Not yet carded: S7 (retire cold-start, after R2 cutover is stable), S8 (split io.ts / packed-window.ts etc., after #572/#573/#578).
- Archived dependency chain: GSC_0041 (#594 React 19.3 / Zod 4.6 / three 0.186; #641 prerequisite is MERGED, restart from fresh pre) -> GSC_0042 (#595 drop @vercel/analytics) -> GSC_0043 (#596 Bun 1.4.2). Chained on `web/bun.lock`.
- Archived PR-sync cards: GSC_0063 (PR #599 docs set B + #574 runbook, head 19c708c, checks green but DIRTY vs pre) and GSC_0066 (PR #640 #589 pipeline tests, head 985bcd9, checks green but BEHIND pre). Both PRs stay open; nothing merged.

### Half-way PRs / branches (all open against pre, none merged at pause)

- #640 `test/589-pipeline-backfill-tests` 985bcd9 BEHIND (green checks).
- #599 `docs/576-docs-set-b` 19c708c DIRTY (needs re-sync; union-resolve CHANGELOG).
- Stale: #422 cockpit HUD, #429 next 16.3.3, #435/#436/#437/#506/#507 dependabot (superseded by GSC_0041-0043 work; close when convenient).
- Executor temp worktrees for GSC_0069-0073 may hold unpushed local commits; AFC leader is archiving those workspaces. Recover any local branch from `git worktree list` before deleting, if still present.
- Main checkout is on `feat/578-r2-stage4-ready` (clean, already merged content via #630); not `pre`.

### Owner decisions shelved during the pause

The AFC leader shelved all three gitstarclub decisions at the owner's request (the project is paused). Do not register new decisions while paused. On resume, re-register them with `roles decide add` (A/B/C plus a recommendation):
- d1002-115208-1 (was blocking): permanent R2 token scoped to the two data buckets; blocks the R2 stage 2 real-bucket rehearsal.
- d1002-011527-1 (was blocking): production security hotfix shipped on its own (recommend A: main-only hotfix of the security commits).
- d1001-135216-1: `/cockpit` demo page is live on production; recommend removing it.

### When the owner resumes, do first

1. `bin/kanban supervise --project gitstarclub.com` (if a new session), then re-register the three shelved decisions above.
2. Recreate the PR-sync cards for #640 and #599 (executor), then review diff + review verdict and create a batch card to merge them serially.
3. Re-create S1 (#643) and S4 (#644) first (L4, high-risk, needed before the R2 real-bucket rehearsal), then S2 (#646), S3, S5 (#645, after S1), S6. Brief text: see the GSC_0069-0074 card briefs (archived, `bin/kanban show GSC_0069`).
4. Re-create GSC_0041 from fresh pre, then 0042 -> 0043.
5. R2 stage 2 real-bucket rehearsal once the re-registered R2 token decision is answered.

Rules now in force (CLAUDE.md, 10-02): leader only dispatches/accepts/registers decisions/communicates; merges go through batch cards; CI waits are not blockers; reversible decisions are made directly and listed as "decided for you (reversible)".

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
