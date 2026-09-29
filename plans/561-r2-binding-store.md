# Issue 561: native R2 binding driver

## Goal

Add an `ObjectStore` that talks to R2 through the Worker `DATA` binding, and stop guarded puts and deletes from reaching `_meta/` via `.` or `..` path segments.

## Scope

- `web/lib/storage/r2-binding-store.ts` implements `ObjectStore` over an `R2Bucket`.
- Read drivers: `blob | r2_binding | r2_s3 | r2 | r2_then_blob`. Write drivers: `blob | r2_binding | r2_s3 | r2`. `r2` stays an alias of `r2_s3`.
- `r2_binding` uses the `DATA` binding. It does not read storage keys. `r2_binding` with no `DATA` binding throws. Writes still require `R2_BUCKET` for the bucket-identity check.
- The binding store is wrapped with the same bucket-identity guard as the S3 store. The identity marker is read at the bucket root.
- Guarded `put` / `del` on both stores reject path segments that are `.` or `..`, including a single percent-encoding (`%2e`, `%2e%2e`).
- `workers/gitstarclub-web/src/env.ts` adds optional `DATA`. `MEDIA` stays.
- Docs: `docs/R2-MIGRATION-P0.md`, `docs/CHANGELOG.md`.

## Out of scope

- `workers/gitstarclub-web/wrangler.jsonc` (binding wiring is I-5a).
- `scripts/cf-ci-gates.mjs`, `.github/workflows/*`, `.delivery.yml`, pipeline code.
- Hardcoded Blob read paths.
- Cloudflare, Vercel, or BigQuery writes, and any deploy.

## Etag convention

The binding store returns Cloudflare `httpEtag` (quoted). `ifMatch` is passed back as `onlyIf.etagMatches`. Callers round-trip the value from `get` / `head`.

## Acceptance

- Create-only `put` conflict throws `ObjectStorePreconditionFailedError`.
- `ifMatch` succeeds on the etag from `get` and fails on a mismatch.
- `get` / `head` of a missing key return null.
- Folded `list` returns folders. `list` paginates with `cursor`.
- `del` of 2500 keys uses 3 batches of at most 1000.
- The optional key prefix is applied.
- The guard refuses a write when the marker is missing or mismatched.
- `_meta/x` and `views/../_meta/x` are refused on both the binding store and the S3 store.
- `r2_binding` without `DATA` throws a clear error.
- `r2` still resolves to the S3 store.
- Unset drivers and `blob` are unchanged.
- AGENTS.md static verification passes.
