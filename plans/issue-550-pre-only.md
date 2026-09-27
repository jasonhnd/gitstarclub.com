# Issue 550: Align pre-only branch rules with AGENTS.md

## Goal

Make `.grok/rules/pre-only.md` match the Branches section of `AGENTS.md`.
Remove the stale sentence that says not to hotfix production because Vercel
cron runs on `main`.

## Scope

1. `.grok/rules/pre-only.md`: restate the Branches section. `pre` is the
   integration branch. Promotion is a separate pull request from `pre` to
   `main`, merged with a merge commit, and only when the owner explicitly
   says "push main", "push to main", or "promote to main". Never push
   directly to `pre` or `main`. Required checks stay `static` and
   `production-build`. Feature pull requests into `pre` are squash-merged
   by the reviewer or owner, never by the executor.
2. Keep the hard stops that do not contradict that section: rebase only
   onto `pre`, do not call production cron (`gitstarclub.com/api/cron/*`)
   to ship a code change, and day-to-day merge means merge to `pre`.
3. `docs/CHANGELOG.md`: one Unreleased entry.
4. This plan.

## Out of scope

- `AGENTS.md`. It already says `.grok/rules/pre-only.md` must stay
  consistent with it, so no cross-reference edit is required.
- `.delivery.yml`, CI workflows, `web/vercel.json`, Worker config, and
  deploy scripts.
- Pushing `main`, `pre`, or `preview`; merging; force-push; deleting
  branches or files.
- Wrangler writes, Cloudflare schedule, DNS, route, or secret changes,
  Blob writes, and production endpoints.

## Acceptance

- No statement in `.grok/rules/pre-only.md` contradicts `AGENTS.md`.
- `bun run lint:docs` passes.

## Note

Issue #550 says production has no Vercel cron. `web/vercel.json` still
declares `crons`, and several docs still call that file the production
schedule. This change does not assert that Vercel cron is gone. It deletes
the reason "because Vercel cron runs on `main`" and uses the `AGENTS.md`
rule: do not hotfix production by calling production cron. Land on `pre`
and wait.
