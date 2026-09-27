# Issue 548: live smoke does not hit production unless RUN_LIVE_SMOKE=1

## Goal

`cd web && bun run test` makes no network request from `web/lib/integration/live-smoke.test.ts` unless the caller opts in, even when `web/.env.local` exists.

## Scope

1. `web/lib/integration/live-smoke-config.ts` (new helper): `resolveLiveSmokeConfig` checks `RUN_LIVE_SMOKE === "1"` first, then requires an http(s) `LIVE_SMOKE_SITE_URL`, then reads the Blob base. `web/.env.local` is read only after both checks pass. Blob base precedence is unchanged: `web/.env.local`, then `BLOB_BASE_URL`, then `NEXT_PUBLIC_BLOB_BASE_URL`.
2. `web/lib/integration/live-smoke.test.ts`: remove the hard-coded production `SITE`. The network suite uses the resolved site and Blob base and registers only when the gate is enabled. An offline `live-smoke gate [offline]` block always runs. It covers the gate, the env-file reader, and a fetch spy on the gate.
3. `AGENTS.md` verification commands and `docs/TESTING.md` current automation: describe the opt-in. Keep the fresh-worktree advice as an extra guard.
4. This plan and one Unreleased entry in `docs/CHANGELOG.md`.

## Out of scope

- Push to `main`, `pre`, or `preview`. Merge. Force-push. Deleting branches or files.
- Wrangler write commands, Cloudflare schedule, DNS, route, or secret changes.
- Blob writes and any request to the production site while verifying.
- CI workflows. CI sets neither `RUN_LIVE_SMOKE` nor `LIVE_SMOKE_SITE_URL`, so the suite stays skipped there.
- `web/lib/integration/seo.test.ts`, which still treats a missing `SEO_LIVE_BASE` as production.

## Acceptance

- With `web/.env.local` present and `RUN_LIVE_SMOKE` unset, `cd web && bun run test` makes no request from live smoke. Checked offline with a preload that records and blocks every non-loopback `fetch`.
- With `RUN_LIVE_SMOKE=1` and `LIVE_SMOKE_SITE_URL` set, the same network tests run against that origin. Checked against a loopback fixture, not production.
- The full suite and `bun run lint:docs` pass.
