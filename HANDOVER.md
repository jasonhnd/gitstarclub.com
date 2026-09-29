# Handover — gitstarclub.com leader (2026-09-30)

Written at a leader shift change. Source of truth for the storage migration is `docs/R2-CUTOVER.md`; incident background is #543.

## What is being worked on now

**Vercel Blob → Cloudflare R2 migration** (owner decisions 2026-09-29: leave Vercel entirely; preview rehearses with production-like config; production crons triggered by Cloudflare after cutover; delete Blob after two successful Sunday refreshes on R2).

- **Stage 0 (stop-bleed): done.** Preview Worker `gitstarclub-web-pre` no longer holds `BLOB_READ_WRITE_TOKEN` (deleted 2026-09-29; preview version 14d3d8a5). Production Worker `gitstarclub-web` (version 14b84f73) is unchanged. Blob `ops/sync-runs.json` still shows `generated_at` 2026-09-26T04:01:03.853Z — nothing has written Blob since.
- **Stage 1 (code): done, merged into `pre`, not deployed, not promoted.**
  - #557 → PR #558: `DEPLOY_ENV` + bucket-identity write guard.
  - #559 → PR #560: guard hardening.
  - #561 → PR #562: native R2 binding driver (`r2_binding`).
  - #563 → PR #564: reads and config checks follow storage drivers.
  - #565 → PR #566: pipeline R2 bootstrap (`--store r2 --target prod|pre`, dry run by default, `--initial-commit`).
  - #567 → PR #568: preview `env.pre` on bucket `gitstarclub-data-pre`, production-like config, CI gates.
  - #569 → PR #570: `docs/R2-CUTOVER.md` and storage docs.
- **Stage 2 prep (partly done).** Buckets `gitstarclub-data-pre` and `gitstarclub-data-prod` exist (ENAM, created 2026-09-29 15:48Z). Each has `_meta/bucket-identity.json` (`{"bucket":"<name>","deploy_env":"pre"|"production"}`). Public domains `data-pre.gitstarclub.com` / `data.gitstarclub.com` are **not bound yet**.

Production is live and still reads the Blob 2026-09-13 version through `VIEWS_VERSION_FALLBACK`. Production data is frozen at 9/13. **Do not run any production refresh, and do not delete the Vercel Blob store** until stage 6.

## Waiting on whom

**Owner (blocking stage 2):**
1. The Zone ID of gitstarclub.com. Needed for `wrangler r2 bucket domain add … --zone-id`. Do not call the Cloudflare API with wrangler's credentials to look it up.
2. A 7-day R2 API token scoped to the two data buckets (Object Read & Write).
3. `pipeline/.env` filled by the owner with `GITHUB_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Agents must not read it.
4. Owner-side action from decision d0927-220351-1: close Grok Bot in Cursor. Not yet confirmed. After it is confirmed, check GitHub for new Grok Bot activity.
5. Still open in the decision list: d0927-220351-5 (resubmit the sitemap). Suggest doing it after production refreshes again.

**Nobody else.** There are no open Kanban cards for this project (GSC_0009 to GSC_0016 are all accepted).

## Next steps (after the owner delivers 1–3)

1. Bind the two custom domains. Check `curl https://data-pre.gitstarclub.com/_meta/bucket-identity.json`.
2. Stage 2a: rebuild into the preview bucket, following `docs/R2-CUTOVER.md` and `docs/OPS.md`. Run BigQuery with `--maximum_bytes_billed=400000000000` into a dated table; then run 06/07 with `--store r2 --target pre`, dry run first, then `--execute --initial-commit`.
3. Deploy preview (`cf:build:pre`). Run `wrangler`/`cf:dry-run` first and confirm the binding `DATA → gitstarclub-data-pre`. If `web/.env.local` holds the production Blob URL, build with `BLOB_BASE_URL= NEXT_PUBLIC_BLOB_BASE_URL= bun run cf:build:pre`.
4. **Verify on real R2:** a binding `put` with `etagMatches` set to the quoted `httpEtag` succeeds. The fake bucket only tested this.
5. Stage 2b: re-enable preview crons in one PR (`wrangler.jsonc` env.pre crons + `PREVIEW_CRONS_PAUSED` in `scripts/cf-ci-gates.mjs`). The owner may trigger the full refresh manually to skip waiting for Sunday.
6. Stage 3 (production rebuild) → stage 4 (I-5b + cutover; delete `VIEWS_VERSION_FALLBACK` in the same deploy; rollback with `wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web`) → stage 5 (production crons) → stage 6 (retire Blob).

## Carry into I-5b (from the #568 review)

- Host checks in `scripts/cf-ci-gates.mjs` must be case-insensitive (add a test).
- Add bad-config tests for the driver, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, and cross-domain assertions.
- Add top-level `DEPLOY_ENV` / driver assertions.
- Stale comments: `wrangler.jsonc` "Same store as env.pre"; `web/lib/runtime-config.ts` "pre sets MIN_TRACKED_STARS=1000".
- `web/scripts/cf-opennext-build.ts`: the `::1` check never matches.

## Housekeeping

- `pre` is well ahead of `main`. Promotion needs the owner's explicit "promote to main".
- Old merged worktrees can be removed under `../gitstarclub-worktrees/` (hotfix-553-main, issue-549, issue-553, issue-557 … issue-567) and `../gsc-546`, `../gsc-548`, `../gsc-550`.
- The main checkout is on an old `main` (6823d6f) with an uncommitted `web/.gitignore` line (`/.swc`) and untracked ops notes (`CRON-PRE-OBSERVE-001.md`, `cron-pre-observe-001/`). Clean these before accepting parallel Kanban cards, because accept fails when the main directory is dirty (KBN_0049).
