# Issue #662 — arm preview cold-start config

- **baseline**: `pre`
- **Issue**: https://github.com/jasonhnd/gitstarclub.com/issues/662

## Goal

Let the preview Worker `gitstarclub-web-pre` run one real cold-start refresh into the empty bucket `gitstarclub-data-pre`.

## Scope

- `workers/gitstarclub-web/wrangler.jsonc`, `env.pre` only: add `WORKFLOW_COLD_START="1"` and `PREFLIGHT_RELAX_EMPTY_SHARDS="1"`; remove `WORKFLOW_FIXTURE`.
- `scripts/cf-ci-gates.mjs` and its test: `env.pre` may carry the two flags only as `"1"`; the top-level (production) block may carry neither; `WORKFLOW_FIXTURE` is forbidden in both blocks.
- Docs: `docs/OPS.md`, `docs/R2-CUTOVER.md`, `docs/CHANGELOG.md`, `docs/TESTING.md`.

## Findings

- `WORKFLOW_FIXTURE` is read only in `workers/gitstarclub-web/src/shell.ts` (consume, `/start`, scheduled `refresh`) and declared in `src/env.ts`. Its tests (`web/lib/workers-host/*.test.ts`) pass it in a test env object, so fixture mode stays available in tests with no wrangler var. No CI workflow, `.delivery.yml`, e2e spec, or non-archive doc depends on it.
- `_meta/bucket-identity.json` already exists in `gitstarclub-data-pre` (`{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}`), so guarded R2 writes are not blocked by a missing marker.
- Cold start arms only while `DEPLOY_ENV=pre` and `views/latest.json` is absent, so it disarms after the first publish. The flags can stay in `env.pre`.

## Out of scope

- Preview cron schedule (`triggers.crons` stays `[]`, `PREVIEW_CRONS_PAUSED` unchanged).
- Production wrangler block (byte-identical).
- Deploy, any cron or refresh call, Cloudflare or R2 changes.
- `MIN_TRACKED_STARS` (stays `10000`) and any data coverage change.

## Acceptance

- `node scripts/assert-cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs` pass; production carrying either flag or `WORKFLOW_FIXTURE` fails the gate.
- Full AGENTS.md verification passes on the exact head.
