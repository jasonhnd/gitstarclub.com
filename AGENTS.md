# AGENTS

Cursor subagent definitions for this repository live in `.cursor/agents/`.

Branch and merge policy is owned by `.grok/rules/pre-only.md`. Required CI checks and the delivery pipeline are owned by `.delivery.yml`. This file restates those rules. `.grok/rules/pre-only.md` and `.delivery.yml` stay in place and must stay consistent with this file.

This repository currently has no root `WORKFLOW.md`. Follow pre-only plus `.delivery.yml`.

## Executable rules

1. Name each spawned agent `[role][project] task`.
2. In output for Jason, the first time a term appears, explain it in plain language.
3. Do not merge to `main` automatically. Merging to `pre` is allowed.
4. Write each task plan as markdown under `plans/`.
5. All repository text, commit messages, issues, and pull requests are English. The only exception is product locale copy for readers of the zh / zh-TW / ja site (dictionaries, localized pages, and tests that assert that copy).

## Branches

`pre` is the integration branch. Every feature branch and every pull request is based on `pre`. `main` is production.

Promotion is a separate pull request from `pre` to `main`. Merge that pull request with a merge commit so `Closes #N` keeps working. Open it only when the owner explicitly says "push main", "push to main", or "promote to main".

Never push directly to `pre` or `main`. The ruleset `release gates (pre/main)` requires a pull request, blocks a force-push, and blocks deleting those branches. Do not target `main`, cherry-pick onto `main`, merge into `main`, or push `main` unless the owner explicitly orders it. Do not hotfix production by calling production cron. Land on `pre` and wait.

Required status checks are `static` and `production-build` (the job names in `.github/workflows/ci.yml`; `.delivery.yml` lists the same two). `preview-e2e`, `product-gates`, `cf-preview`, and `cf-workers-host` are optional. Do not make them required.

Feature pull requests into `pre` are squash-merged by the reviewer or owner, never by the executor. Executable rule 3 still stands for that reviewer or owner: merging to `pre` is allowed, and merging to `main` is not automatic.

## Delivery

One issue, one branch, one pull request against `pre`.

The pull request body contains `Closes #N`, what changed, the verification commands that were run and their results, and anything unfinished or uncertain.

Commit after each completed step. Use a conventional commit subject: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, or `ci:`.

Write the task plan as markdown under `plans/` (executable rule 4). A plan states the goal, the scope, what is out of scope, and acceptance.

## Forbidden for executors

- Force-push.
- Delete branches, or delete files outside the issue scope.
- Merge any pull request.
- Push to `pre` or `main`.
- Live `wrangler deploy` or `wrangler versions upload`.
- Change Cloudflare schedules, DNS, routes, or secrets.
- Call production cron or refresh endpoints, including `gitstarclub.com/api/cron/*`.
- Edit CI workflows, `.delivery.yml`, the Worker wrangler config, or deploy scripts unless the issue explicitly asks.
- Commit incidental `bun.lock` churn from `bun install`.
- Commit secrets, tokens, or real environment values.

## Verification commands

Run these with Node 24 (`.node-version`) and Bun 1.3.14 (root `packageManager`). `node scripts/assert-runtime-versions.mjs` fails when either pin is wrong. Each block below was run on this contract branch on 2026-09-25 and passed. Durations are wall time on that run. Install and `audit:deps` need network. The test and build commands below do not: live SEO probes stay off when `SEO_LIVE_BASE` is empty, and the builds talk only to the local fixture.

A full `web/` suite is the verification bar. A single test file is not.

### Repository root

No network. On the passing run, all three finished in under a second (`lint:docs` about 0.4s).

```bash
node scripts/assert-runtime-versions.mjs
node scripts/assert-cf-ci-gates.mjs
bun run lint:docs
```

`assert-runtime-versions` prints `runtime contract satisfied` for Node 24.x and Bun 1.3.14. `assert-cf-ci-gates` checks the preview Worker name, an empty production cron list, and that automation does not live-deploy. `lint:docs` checks Markdown fences, docs contracts, the CJK gate, and the same CF gates.

### `web/`

```bash
bun install --frozen-lockfile
bun run audit:deps
bun run lint
bun run typecheck
bun run typecheck:tests
bun run typecheck:scripts
bun run validate:views -- scripts/fixtures/views
BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test
BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov
```

`BLOB_BASE_URL=https://blob.example.com` is a public placeholder, not a live store. Do not replace it with a real Blob URL. Empty `SEO_LIVE_BASE` keeps the deterministic gate off the network. `test:cov` is `bun test lib/ --coverage --isolate` plus `scripts/check-coverage-threshold.mjs` (line and function coverage at least 80%). Observed: install about 1s (658 packages); audit under 1s with no high advisory; lint about 6s (0 errors); typecheck about 5s, tests about 3s, scripts about 1s; view validation under 1s (`discovered 15; validated 15; failed 0`); `test` about 25s (1304 pass, 49 skip, 0 fail, 1353 tests, 162 files); `test:cov` about 25s with the same counts and coverage lines 86.36%, functions 86.10%.

Restore `web/bun.lock` if `bun install` changes it. Do not commit that churn.

### `pipeline/`

```bash
bun install --frozen-lockfile
bun run audit:deps
bun run test
```

Observed: install about 41ms (35 packages); audit about 1s, exit 0; tests about 21ms (9 pass, 0 fail). Restore `pipeline/bun.lock` if the install changes it.

### Production build

This matches the `production-build` job: a GET/HEAD-only fixture, then `bun run build` in `web/`. Do not export a Blob write credential (`BLOB_READ_WRITE_TOKEN` must be unset). No real Blob URL.

```bash
cd web
export BLOB_BASE_URL=http://127.0.0.1:4010
bun scripts/ci-build-fixture-server.ts > /tmp/ci-build-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 20); do
  if curl --fail --silent "$BLOB_BASE_URL/_health" > /dev/null; then
    bun run build
    exit $?
  fi
  sleep 1
done
echo "fixture did not become ready" >&2
exit 1
```

The fixture listens on `127.0.0.1:4010`, returns 404 for views, and rejects any method other than GET or HEAD. The app build must tolerate those missing views. Observed: about 14s, Next.js 16.3.5, 248 static pages, exit 0. Localhost only.

### Cloudflare build

`cf:dry-run` is `cf:build:pre` and then `node ../scripts/cf-wrangler-dry-run.mjs`. That wrapper is `wrangler deploy --dry-run` for wrangler env `pre` only. It must not target the production Worker, and it must not drop `--dry-run`. Do not deploy. Do not run `wrangler versions upload`.

Needs `BLOB_BASE_URL`. The successful local run used the same fixture as the production build (`http://127.0.0.1:4010`). The public placeholder, when a command needs a Blob base and is not using that fixture, is `https://blob.example.com`. Never a real store URL. `cf:build:pre` sets `SITE_INDEXABLE=0` itself. The optional CI job also sets `HOSTING_TARGET=cf` and `NODE_OPTIONS=--max-old-space-size=8192`; this run set both.

```bash
cd web
export BLOB_BASE_URL=http://127.0.0.1:4010
export HOSTING_TARGET=cf
export NODE_OPTIONS=--max-old-space-size=8192
bun scripts/ci-build-fixture-server.ts > /tmp/ci-build-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 20); do
  if curl --fail --silent "$BLOB_BASE_URL/_health" > /dev/null; then
    bun run cf:dry-run
    exit $?
  fi
  sleep 1
done
echo "fixture did not become ready" >&2
exit 1
```

Observed: about 18s. `cf:build:pre` printed `cf:build pre indexing self-check passed`. Wrangler printed `--dry-run: exiting now`. Nothing was deployed.

`cf:build` must be given `--site-target=production` or `--site-target=pre`. Production output is indexable. Preview (`pre`) output is `noindex`.

## Repository constraints

Language. Repository text, code comments, commits, issues, and pull requests are English. The exception is product locale copy for readers of the site's non-English locales. Site locales are `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, and `fr`. That copy lives in `web/lib/i18n/dictionaries/*`, `web/lib/i18n/locales.ts`, `web/app/_localized/*`, and tests that assert it. `bun run lint:docs` rejects CJK anywhere else. Executable rule 5 stays as written; this paragraph is the full locale list the gate enforces.

Product. Pages are fully prerendered static HTML plus small client islands. All data comes from precomputed JSON. There is no runtime AI, no runtime database, and no live search. Output is deterministic. Content pages stay near-zero client JavaScript. Do not add pages unless the issue says so. Follow `docs/GEO.md`.

Reader-facing copy, in every language, does not mention Blob, rank JSON, lookup JSON, or server routes. Keep the signals that the page is precomputed, deterministic, and not live search or AI.

Design. The Material 3 accent is amber `#F2A900`. Data stars always use the `Star` component in `web/app/_explore/Star.tsx`. Do not hand-write a star glyph.

CSP. Production `script-src` stays `'self' 'unsafe-inline'` (`web/lib/csp.ts`). Do not "harden" it with nonces or hashes. Both break hydration on this prerendered site.

Language switcher. Links go through `/api/lang?lang=…&next=…` (`web/app/components/LanguageSwitcher.tsx`). Do not point them at localized paths directly.

Ranking periods. Navigation and sitemap periods come from `resolveAvailableRankPeriods` in `web/lib/data/rank-periods.ts` (data that exists), never from calendar math. Historical sitemap periods come from `meta.folded_through` (`web/lib/sitemap.ts`).

Tests. Bun `mock.module` is process-global. Never mock `@/lib/periods`. Never replace `globalThis.fetch` without restoring it. A change is verified only when the full `web/` suite passes, not when one file passes.

Indexing. Production builds are indexable. Preview (`pre`) builds are `noindex`. Pass `--site-target=production` or `--site-target=pre` to `cf:build`.

UI or visual changes need before and after screenshots in the pull request. The owner signs off before merge. Code or design changes update the relevant docs in the same pull request.

Legal and compliance wording is not defined for this repository. Do not invent any.

## Work autonomously

Work autonomously. Do not stop to ask questions; no one will answer.
