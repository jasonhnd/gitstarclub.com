# Unquoted R2 binding conditionals (#572)

## Goal

Conditional writes through the Worker R2 binding must pass etags workerd accepts. Callers still round-trip the quoted `httpEtag` on `ObjectStore`. The binding boundary strips one pair of quotes before `onlyIf.etagMatches`.

## Scope

- `web/lib/storage/r2-binding-store.ts`: unwrap a quoted `ifMatch` before `etagMatches`. `etagDoesNotMatch: "*"` stays. Returned etags stay quoted `httpEtag`.
- `web/lib/storage/r2-binding-store.test.ts`: the fake bucket follows workerd structured conditionals (reject quoted `etagMatches` and `etagDoesNotMatch`; `*` is a wildcard; a `W/` string is a strong literal, not a weak tag).
- `web/lib/workflows/rollback-route.test.ts`: the same fake rule, so a binding CAS is not compared as a quoted string.
- Docs that describe the binding `ifMatch` boundary: `docs/R2-MIGRATION-P0.md`, `docs/CHANGELOG.md`.

## Out of scope

- Blob, S3, and memory stores. Their `ifMatch` stays a quoted HTTP etag.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Deploys, Cloudflare or Vercel API calls, and real buckets.
- Header-form `onlyIf` (`If-Match` / `If-None-Match`). workerd parses weak tags only on that path. This store sends the structured conditional.

## Acceptance

- A quoted `httpEtag` from `get` succeeds as `ifMatch`, and the bucket sees the unquoted value.
- A quoted conditional passed straight to the fake throws `TypeError` and does not write.
- Both supplied etags are parsed before any match result. `{ etagMatches: "stale", etagDoesNotMatch: "<quoted>" }` on an existing key, and `{ etagMatches: "*", etagDoesNotMatch: "<quoted>" }` on a missing key, throw `TypeError` and do not write.
- `*` and `W/` follow workerd `UnwrappedConditional(const Conditional&)` / `buildSingleEtagArray` (see the report for line numbers).
- The new CAS test fails if the store passes the quoted etag through.
- `web/lib/storage/r2-binding-workerd.test.ts` runs the same CAS against local workerd through Miniflare. The binary is the `workerd` package wrangler already depends on, so the existing `bun test` job covers it. CI workflows are unchanged.
- Other storage drivers keep their external etag behavior.
- The static job in `AGENTS.md` passes in a fresh detached worktree of the pull request head. The pull request records that SHA, the commands, and the results.
- This issue does not edit `bun.lock`, CI workflows, `.delivery.yml`, or the Worker wrangler config. Dependency audit #584 is already merged as #591.
