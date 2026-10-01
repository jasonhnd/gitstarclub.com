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
- `*` and `W/` follow workerd `UnwrappedConditional(const Conditional&)` / `buildSingleEtagArray` (see the report for line numbers).
- The new CAS test fails if the store passes the quoted etag through.
- Other storage drivers keep their external etag behavior.
- The static job in `AGENTS.md` passes in a fresh detached worktree.
- `bun.lock` is not part of the diff.
