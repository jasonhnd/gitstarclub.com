# PR 629: merge origin/pre after issue 631

## Goal

Make pull request 629 mergeable with current `origin/pre`. Keep the shared rank
selection introduced by issue 631, and keep the getter signatures that issue
631 retained. Place the issue 602 storage-fragment checks into that later code
so only a validated owner, repository name, login, repository id, or ranking
period is interpolated into a storage path. Ranking share images and page
behavior from pull request 629 stay as they are.

## Scope

- Merge `origin/pre` into `fix/602-param-validation` with a merge commit.
- Resolve `web/lib/data/entity.ts` and `web/lib/data/rank.ts`.
- Adjust tests only where a removed export or a non-canonical period string
  would fail after that resolution.
- Record the new head in the pull request body after the static job.

## Out of scope

No new product behavior. No push to `pre` or `main`, no merge of the pull
request, no force-push, no branch or file deletion, no deploy, and no edits to
CI, `.delivery.yml`, or wrangler config. Do not read credentials or env files.

## Resolution

- `web/lib/data/entity.ts`: issue 631 removed unused `getOrgEntity`. Leave it
  removed. Guard the remaining repo and org readers with `isGithubRepoId` and
  `githubLogin` before `readView`.
- `web/lib/data/rank.ts`: keep `readSelectedRank`, `selectRankPayload`, and the
  `getRank` / `getRankDaily` wrappers from issue 631. Reject a period, dim, or
  metric that fails `isRankingPeriod` or the dim/metric allowlist before
  `readView`, `readAuthoritativeView`, or `isLiveOverlayPeriod`.
  `getRankBaseAuthoritative` still throws on invalid input. `getAllTime` reads
  only `repo` and `org`.
- `web/lib/data/lookup.ts` and `docs/CHANGELOG.md` do not conflict.
- `web/lib/data/data-access-policy.test.ts` uses one non-week period for every
  non-week window. Year and all-time rows need canonical periods (`2026` and
  `all`) so the selection matrix still runs. `web/lib/public-params.test.ts`
  must call `getOrgEntityDaily` instead of the removed `getOrgEntity`.

## Acceptance

- A merge of `origin/pre` into this branch reports no remaining conflicts.
- `public-params`, `data-access-policy`, and rank tests pass.
- The AGENTS.md static job passes in a fresh detached worktree.
- The pull request body names the new head and the verification result.
