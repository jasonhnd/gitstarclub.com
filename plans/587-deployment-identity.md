# Issue 587: deployment identity follows the built commit

## Goal

`https://pre.gitstarclub.com/.well-known/deployment` reports `commitSha` `374288c` (the 2026-09-26 feature commit) while `pre` is far ahead. Make the reported identity the commit that `cf:build` baked. A runtime override may remain only when it names that same commit.

## Where the value comes from

Two readers share the same priority today:

- `web/lib/deployment-identity.ts` (`buildDeploymentIdentity`), used by `web/app/.well-known/deployment/route.ts`.
- Worker `previewIdentity`, which intercepts `/.well-known/deployment` on the Workers host.

Both use `VERCEL_GIT_COMMIT_SHA`, then `CF_PREVIEW_COMMIT_SHA`, then `cfBuildCommitSha`. `cf:build` writes the gitignored build-identity module beside `web/lib/cf-build-identity/index.ts` from HEAD before the OpenNext bundle, appending `-dirty` when tracked files are dirty. `CF_PREVIEW_COMMIT_SHA` is not in wrangler config. Operators pass it with `wrangler --var`, and a previous value can persist on the Worker. On 2026-10-01 the public preview body is `{"commitSha":"374288c","deploymentUrl":"https://pre.gitstarclub.com","target":"cf","host":"pre.gitstarclub.com"}`. That shape is the Worker shell. A stale `CF_PREVIEW_COMMIT_SHA` (or `VERCEL_GIT_COMMIT_SHA`) masks the baked SHA. This change does not call Cloudflare or redeploy, so the live host keeps reporting `374288c` until the next preview deploy of this code.

## Scope

1. Add `reportedCommitSha` in `web/lib/deployment-commit.ts`. When a baked SHA exists, return it. `VERCEL_GIT_COMMIT_SHA` and `CF_PREVIEW_COMMIT_SHA` are used only when no SHA was baked (Vercel, or a checkout that has not run `cf:build`). An override that equals the baked SHA reports that same value. A different override is ignored.
2. Use that function from `buildDeploymentIdentity` and `previewIdentity`.
3. Tests: a stale `374288c` override does not replace a baked SHA; an equal override still reports the baked SHA; with no baked SHA, Vercel still wins over the preview var. Pass an explicit built SHA so the regression does not depend on the gitignored module.
4. Document the check in `docs/R2-CUTOVER.md` stage 2 acceptance, and update the priority sentences in `docs/API.md`, `docs/OPS.md`, `docs/SEO.md`, `docs/UIUX-ROUTE-INVENTORY.md`, and `docs/CHANGELOG.md`.
5. This plan.

## Out of scope

- Push to `main` or `pre`. Merge. Force-push. Deleting branches or files outside this issue.
- Cloudflare or Vercel API calls, `wrangler deploy`, `wrangler versions upload`, live cron, or a real bucket.
- Reading pipeline or web env files, or other credentials.
- CI workflows, `.delivery.yml`, and Worker wrangler config values.
- Redeploying `pre.gitstarclub.com`. The public endpoint changes only after an operator deploys this build.

## Acceptance

- New tests fail if `previewIdentity` or `buildDeploymentIdentity` goes back to preferring `CF_PREVIEW_COMMIT_SHA` over the baked SHA. Prove it by restoring the old `||` chain, running the two identity test files, then restoring the fix.
- The AGENTS.md static job passes on a fresh detached worktree of the commit under test. Do not commit `bun.lock` churn.
- The pull request into `pre` says `Closes #587`.
