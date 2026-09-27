# Issue 546: Cloudflare cron day 7 is Saturday

## Goal

Cloudflare Cron Triggers number days of the week 1 = Sunday through 7 = Saturday
(<https://developers.cloudflare.com/workers/configuration/cron-triggers/>). The
repository treated `7` as Sunday, so the preview weekly and refresh schedules
would fire on Saturday. Also keep preview schedules paused in the repository
while the shared-store incident (#543) is open.

## Scope

1. `cron-dispatch.ts` under `workers/gitstarclub-web/`: canonical weekly and refresh
   expressions use `SUN`. Dispatch accepts `SUN` (any case) and Cloudflare `1`
   as Sunday. `7` (Saturday on Cloudflare) and `0` (rejected by the Cloudflare
   API) are unknown expressions and fail the scheduled invocation.
   Tests in `web/lib/workers-host/cron-dispatch.test.ts` pin that.
2. `wrangler.jsonc` under `workers/gitstarclub-web/`: `env.pre` `triggers.crons` is `[]`
   with a comment that points to #543 and lists the intended expressions.
3. `scripts/cf-ci-gates.mjs`: `PREVIEW_CRONS_PAUSED` switches the gate between
   "must be `[]`" (now) and "must be the intended set". Any numeric weekday
   `0` or `7` in a wrangler cron is rejected. Tests cover both states.
4. `docs/OPS.md`, `docs/CF-MIGRATION-P1.md`, the `docs/TESTING.md` coverage row
   for #468, and one `docs/CHANGELOG.md` entry.

## Out of scope

- Any `wrangler` write command, Cloudflare schedule, DNS, route, or secret change.
- Blob writes and production endpoints.
- `web/lib/cron/handlers.ts`: it uses JS `getUTCDay() === 0` for Sunday, which is
  correct, so it does not change.
- `web/vercel.json`: Vercel uses Unix cron, where `0` is Sunday.
- The historical CHANGELOG entry "CF Cron Sunday DoW 0/7 alias" stays as
  written; the new CHANGELOG entry says it supersedes it.

## Acceptance

- `git grep -n -E "\* \* 7|Sunday=7|SUNDAY.*7"` finds only text that says 7 is Saturday.
- `env.pre` `triggers.crons` is `[]` and the gate enforces it.
- `node scripts/assert-cf-ci-gates.mjs`, `node --test scripts/cf-ci-gates.test.mjs`,
  `bun run lint:docs`, and the full `web/` suite pass.
