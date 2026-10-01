---
owner: operations / storage
status: superseded
last_reviewed: 2026-09-30
source_of_truth_for:
  - Cloudflare R2 P0 storage adapter
  - Blob/R2 dual-read and write-driver switches
  - bucket-identity R2 write guard
---

# R2 migration P0 (Blob adapter)

> **Superseded.** Current storage status, stages, and rollback are in [R2-CUTOVER.md](./R2-CUTOVER.md). The sections below are history. The JSON store does not use the MEDIA binding. MEDIA stays on the assets bucket `gitstarclub-assets` and is not `gitstarclub-data-pre` or `gitstarclub-data-prod`. Preview JSON uses the DATA binding.

> Cloudflare migrate **P0** only: injectable object-store drivers for Vercel Blob,
> the R2 S3 API, and the Worker R2 binding. This does **not** cut DNS, does **not**
> orange-cloud apex/www, and does **not** make R2 the production read primary.

## Scope

This document owns the P0 storage port added in `web/lib/storage/`:

- Drivers: `vercel-blob` (default), `r2-s3` (S3 API, outside the Worker), and `r2-binding` (Workers `DATA` binding, no storage keys)
- Read drivers: `blob` | `r2_binding` | `r2_s3` | `r2` | `r2_then_blob`. `r2` is an alias of `r2_s3`. `r2_then_blob` still reads S3, then Blob.
- Write drivers: `blob` | `r2_binding` | `r2_s3` | `r2`. `r2` is an alias of `r2_s3`.
- Writes stay on Vercel Blob unless the write driver is an R2 driver **and** the bucket identity marker matches `DEPLOY_ENV`
- Rollback: unset the driver switches (or set them back to `blob`)

Out of scope: ISR / Preview bypass rewrites, Workers hosting of the
full Next app, DNS, paid R2/Workers plan purchases, emptying production Blob.
Workflow SDK removal and non-production CF Cron/Queue are P1; see
[CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md).

Prepared Cloudflare resources in the original P0 note (historical; the account id below is not a secret, and it is not a write instruction):

- account_id: `00f850e853e4c7f9627233d51a6e30a1`
- The JSON store does not use the MEDIA binding. MEDIA remains the assets bucket `gitstarclub-assets`. It is not the data bucket. Preview `env.pre` binds DATA to `gitstarclub-data-pre`. The production top-level Worker does not bind DATA yet. See [R2-CUTOVER.md](./R2-CUTOVER.md).
- Object key prefix: unset (`R2_PREFIX` defaults to empty). Writes are gated by `_meta/bucket-identity.json`, not by a prefix.

## Default behavior (no regression)

Unset drivers mean:

- `STORAGE_READ_DRIVER` / `READ_DRIVER` = `blob`
- `STORAGE_WRITE_DRIVER` / `WRITE_DRIVER` = `blob`
- Public page reads still use `BLOB_BASE_URL` through `getPublicReadBases()` while the read driver is `blob`
- Cron / Workflow config checks still require `BLOB_BASE_URL` and `BLOB_READ_WRITE_TOKEN` while the write driver is `blob`

Existing Vercel Blob behavior is the production path. The Blob **driver** now
calls the Blob HTTP API with runtime `fetch` (`web/lib/storage/vercel-blob-fetch-client.ts`)
instead of importing `@vercel/blob` on the request path, so Cloudflare Workers
do not hit `ALPNProtocols`. R2 writes were already fetch-signed. See
[CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) for CF cron full-sync dependence.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_READ_DRIVER` | `blob` | `blob` \| `r2_binding` \| `r2_s3` \| `r2` \| `r2_then_blob`. `r2` is an alias of `r2_s3`. |
| `READ_DRIVER` | (alias) | Same as `STORAGE_READ_DRIVER` |
| `STORAGE_WRITE_DRIVER` | `blob` | `blob` \| `r2_binding` \| `r2_s3` \| `r2`. `r2` is an alias of `r2_s3`. |
| `WRITE_DRIVER` | (alias) | Same as `STORAGE_WRITE_DRIVER` |
| `R2_ACCOUNT_ID` | unset | Used to build `https://<account>.r2.cloudflarestorage.com` |
| `R2_S3_ENDPOINT` | from account id | Explicit S3 endpoint override |
| `AWS_ENDPOINT_URL` | (alias) | Same as `R2_S3_ENDPOINT` |
| `R2_ACCESS_KEY_ID` / `AWS_ACCESS_KEY_ID` | unset | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY` | unset | R2 S3 secret |
| `R2_BUCKET` / `AWS_S3_BUCKET` | unset | Bucket name. Required for every R2 write, including `r2_binding`, because the identity check compares this name to the marker. The binding itself is not named by this variable. |
| `R2_REGION` / `AWS_REGION` | `auto` | SigV4 region |
| `R2_PREFIX` | empty | Optional object key prefix. Unset is the bucket root. It is not a write allowlist. |
| `DEPLOY_ENV` | unset | `production` \| `pre` \| `local`. R2 writes require `production` or `pre`, matching the bucket identity marker. |
| `R2_PUBLIC_BASE_URL` | unset | Public URL base for `r2` / `r2_s3` / `r2_binding` / `r2_then_blob` page reads |

CI must not set production `BLOB_READ_WRITE_TOKEN` as an R2 write credential. The
R2 driver tests mock `fetch` and never open the real bucket.

## Driver-aware reads (I-3)

Bootstrap pointer reads, sync-run history, cron and workflow config checks, and the rankings period cache key use the configured driver. `requirePublicReadBase()` returns the primary `getPublicReadBases()` URL. `requireStorageWriteConfig()` checks the write driver without reading `_meta/bucket-identity.json` and without putting secret values in the error:

- `blob`: Blob base URL and `BLOB_READ_WRITE_TOKEN`, same messages as before
- `r2_binding`: DATA binding, `R2_BUCKET`, and `DEPLOY_ENV` of `production` or `pre`
- `r2` / `r2_s3`: S3 credentials, bucket, endpoint, and the same `DEPLOY_ENV` check

A missing Blob base still means empty sync-run history. Live release gates prefer `LIVE_PUBLIC_READ_BASE_URL`. Until stage 6 they still fall back to `RELEASE_GATE_BLOB_BASE`, then `BLOB_BASE_URL`, then the current public Blob URL.

## Write guard

`STORAGE_WRITE_DRIVER=blob` (the default) does not read the marker. Blob writes are unchanged. Unset drivers stay on Blob.

`r2_binding` uses the Worker `DATA` R2 binding (`getCloudflareContext()`). It does not read `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY`. Missing `DATA` throws `r2_binding requires the DATA R2 binding`. `r2` and `r2_s3` keep using the S3 client. `r2_then_blob` still falls back from that S3 client to Blob.

An R2 write driver (`r2`, `r2_s3`, or `r2_binding`) is rejected when:

- `DEPLOY_ENV` is unset (on Cloudflare this is `HOSTING_TARGET=cf` with no `DEPLOY_ENV`), or
- `DEPLOY_ENV` is not `production` or `pre`, or
- `VERCEL_ENV=production` and `DEPLOY_ENV` is not `production`, or
- the `put` or `del` path contains a `.` or `..` segment, including one percent-encoding (`%2e`, `%2e%2e`), or
- the `put` or `del` key is under `_meta/` (the caller path, or the key after `R2_PREFIX`), or
- `del` names that key as an `r2://` URL or a public URL (`del` resolves those to the object key first; `r2://` is a bucket-root key and does not add `R2_PREFIX`), or
- `R2_BUCKET` is unset, or
- `_meta/bucket-identity.json` at the bucket root is missing, unreadable, or its `deploy_env` / `bucket` does not match `DEPLOY_ENV` and `R2_BUCKET`.

The marker JSON is exactly one of:

```json
{"bucket":"<R2_BUCKET>","deploy_env":"pre"}
{"bucket":"<R2_BUCKET>","deploy_env":"production"}
```

A passing check is cached for the isolate. The cache key is the S3 endpoint the store uses after extras (or the fixed sentinel `r2-binding` for the native driver), the bucket name, and `DEPLOY_ENV`. It is not an endpoint re-read from env. Cloudflare Workers never set `VERCEL_ENV`. When `VERCEL_ENV=production`, `DEPLOY_ENV` must also be `production`.

`new URL()` removes `.` and `..` after one percent-decode, so `views/../_meta/x` and `views/%2e%2e/_meta/x` would otherwise be written as `_meta/x`. The guard rejects those segments before the request is built. The binding store returns the quoted `httpEtag`. Pass that value back as `ifMatch`. The store removes one surrounding quote pair before `onlyIf.etagMatches`, because workerd rejects a quoted conditional ETag. Create-only puts still send `etagDoesNotMatch: "*"`. Blob and S3 `ifMatch` stay quoted HTTP validators.

An operator places `_meta/bucket-identity.json` out of band, once per bucket, before any application write. Application code never `put`s or deletes a key under `_meta/`. The shell example below is historical and names the assets bucket. Do not run it. Data-bucket markers belong on `gitstarclub-data-pre` and `gitstarclub-data-prod`. See [R2-CUTOVER.md](./R2-CUTOVER.md).

```bash
printf '%s\n' '{"bucket":"gitstarclub-assets","deploy_env":"pre"}' | wrangler r2 object put gitstarclub-assets/_meta/bucket-identity.json --pipe
```

Use `"deploy_env":"production"` only on the production bucket, and only where `DEPLOY_ENV=production`.

## Rollback

1. Set `STORAGE_READ_DRIVER=blob` and `STORAGE_WRITE_DRIVER=blob` (or unset both).
2. Leave `BLOB_BASE_URL` and `BLOB_READ_WRITE_TOKEN` as they are today.
3. Do not delete Vercel Blob objects as part of rollback.

That returns the site to the pre-P0 Blob-only path.

## Optional sync script

`web/scripts/sync-blob-to-r2.ts` copies Blob objects into the configured R2
prefix (`R2_PREFIX`, default empty). Default is dry-run. The plan refuses to
start unless `DEPLOY_ENV` is `production` or `pre`. `--execute` puts go through
the same bucket-identity guard:

```bash
bun scripts/sync-blob-to-r2.ts
bun scripts/sync-blob-to-r2.ts --prefix views/ --execute
```

`--execute` still refuses a missing `DEPLOY_ENV` and a bucket identity that does not match.

## What this PR does not claim

- Production read primary is still Vercel Blob.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- The JSON Worker does not use the MEDIA binding. MEDIA stays on the assets bucket `gitstarclub-assets` and is not the data store. `r2` and `r2_s3` still talk S3 from Node. `r2_binding` talks to DATA only. Preview `env.pre` binds DATA; this P0 text originally said wrangler did not. See [R2-CUTOVER.md](./R2-CUTOVER.md) and [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md). Production still reads Vercel Blob until cutover.
