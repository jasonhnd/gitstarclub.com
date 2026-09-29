---
owner: operations / storage
status: active
last_reviewed: 2026-09-29
source_of_truth_for:
  - Cloudflare R2 P0 storage adapter
  - Blob/R2 dual-read and write-driver switches
  - bucket-identity R2 write guard
---

# R2 migration P0 (Blob adapter)

> Cloudflare migrate **P0** only: injectable object-store drivers for Vercel Blob and
> R2 (S3 API). This does **not** cut DNS, does **not** orange-cloud apex/www, and
> does **not** make R2 the production read primary.

## Scope

This document owns the P0 storage port added in `web/lib/storage/`:

- Drivers: `vercel-blob` (default) and `r2-s3`
- Dual-read: `blob` | `r2` | `r2_then_blob`
- Writes stay on Vercel Blob unless `STORAGE_WRITE_DRIVER=r2` **and** the bucket identity marker matches `DEPLOY_ENV`
- Rollback: unset the driver switches (or set them back to `blob`)

Out of scope: ISR / Preview bypass rewrites, Workers hosting of the
full Next app, DNS, paid R2/Workers plan purchases, emptying production Blob.
Workflow SDK removal and non-production CF Cron/Queue are P1; see
[CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md).

Prepared Cloudflare resources (documentation only; this PR still reads Vercel Blob
by default):

- account_id: `00f850e853e4c7f9627233d51a6e30a1`
- R2 bucket: `gitstarclub-assets`
- Worker shell: `gitstarclub-web` with binding `MEDIA` → that bucket (not used by this Node adapter)
- Object key prefix: unset (`R2_PREFIX` defaults to empty). Writes are gated by `_meta/bucket-identity.json`, not by a prefix.

## Default behavior (no regression)

Unset drivers mean:

- `STORAGE_READ_DRIVER` / `READ_DRIVER` = `blob`
- `STORAGE_WRITE_DRIVER` / `WRITE_DRIVER` = `blob`
- Public page reads still use `BLOB_BASE_URL`
- Cron / Workflow CAS still uses `BLOB_READ_WRITE_TOKEN`

Existing Vercel Blob behavior is the production path. The Blob **driver** now
calls the Blob HTTP API with runtime `fetch` (`web/lib/storage/vercel-blob-fetch-client.ts`)
instead of importing `@vercel/blob` on the request path, so Cloudflare Workers
do not hit `ALPNProtocols`. R2 writes were already fetch-signed. See
[CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) for CF cron full-sync dependence.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_READ_DRIVER` | `blob` | `blob` \| `r2` \| `r2_then_blob` |
| `READ_DRIVER` | (alias) | Same as `STORAGE_READ_DRIVER` |
| `STORAGE_WRITE_DRIVER` | `blob` | `blob` \| `r2` |
| `WRITE_DRIVER` | (alias) | Same as `STORAGE_WRITE_DRIVER` |
| `R2_ACCOUNT_ID` | unset | Used to build `https://<account>.r2.cloudflarestorage.com` |
| `R2_S3_ENDPOINT` | from account id | Explicit S3 endpoint override |
| `AWS_ENDPOINT_URL` | (alias) | Same as `R2_S3_ENDPOINT` |
| `R2_ACCESS_KEY_ID` / `AWS_ACCESS_KEY_ID` | unset | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY` | unset | R2 S3 secret |
| `R2_BUCKET` / `AWS_S3_BUCKET` | unset | Bucket name (`gitstarclub-assets`) |
| `R2_REGION` / `AWS_REGION` | `auto` | SigV4 region |
| `R2_PREFIX` | empty | Optional object key prefix. Unset is the bucket root. It is not a write allowlist. |
| `DEPLOY_ENV` | unset | `production` \| `pre` \| `local`. R2 writes require `production` or `pre`, matching the bucket identity marker. |
| `R2_PUBLIC_BASE_URL` | unset | Public URL base for `r2` / `r2_then_blob` page reads |

CI must not set production `BLOB_READ_WRITE_TOKEN` as an R2 write credential. The
R2 driver tests mock `fetch` and never open the real bucket.

## Write guard

`STORAGE_WRITE_DRIVER=blob` (the default) does not read the marker. Blob writes are unchanged.

`STORAGE_WRITE_DRIVER=r2` is rejected when:

- `DEPLOY_ENV` is unset (on Cloudflare this is `HOSTING_TARGET=cf` with no `DEPLOY_ENV`), or
- `DEPLOY_ENV` is not `production` or `pre`, or
- `VERCEL_ENV=production` and `DEPLOY_ENV` is not `production`, or
- the `put` or `del` key is under `_meta/` (the caller path, or the key after `R2_PREFIX`), or
- `_meta/bucket-identity.json` at the bucket root is missing, unreadable, or its `deploy_env` / `bucket` does not match `DEPLOY_ENV` and the configured bucket name.

The marker JSON is exactly one of:

```json
{"bucket":"<R2_BUCKET>","deploy_env":"pre"}
{"bucket":"<R2_BUCKET>","deploy_env":"production"}
```

A passing check is cached for the isolate. The cache key is the S3 endpoint the store uses after extras, the bucket name, and `DEPLOY_ENV`. It is not an endpoint re-read from env. Cloudflare Workers never set `VERCEL_ENV`. When `VERCEL_ENV=production`, `DEPLOY_ENV` must also be `production`.

An operator places `_meta/bucket-identity.json` out of band, once per bucket, before any application write. Application code never `put`s or deletes a key under `_meta/`. Example for the preview bucket (operators only; CI does not run this):

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
- The Worker `MEDIA` binding is used by the P3 host (`workers/gitstarclub-web`);
  this adapter still talks S3 from Node when `STORAGE_READ_DRIVER` selects R2.
  See [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md). Production reads stay Blob.
