---
owner: operations / storage
status: active
last_reviewed: 2026-09-16
source_of_truth_for:
  - Cloudflare R2 P0 storage adapter
  - Blob/R2 dual-read and write-driver switches
  - non-production R2 write guard
---

# R2 migration P0 (Blob adapter)

> Cloudflare migrate **P0** only: injectable object-store drivers for Vercel Blob and
> R2 (S3 API). This does **not** cut DNS, does **not** orange-cloud apex/www, and
> does **not** make R2 the production read primary.

## Scope

This document owns the P0 storage port added in `web/lib/storage/`:

- Drivers: `vercel-blob` (default) and `r2-s3`
- Dual-read: `blob` | `r2` | `r2_then_blob`
- Writes stay on Vercel Blob unless `STORAGE_WRITE_DRIVER=r2` **and** the target is a non-production prefix
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
- Non-production object prefix: `migrate-dev/`

## Default behavior (no regression)

Unset drivers mean:

- `STORAGE_READ_DRIVER` / `READ_DRIVER` = `blob`
- `STORAGE_WRITE_DRIVER` / `WRITE_DRIVER` = `blob`
- Public page reads still use `BLOB_BASE_URL`
- Cron / Workflow CAS still uses `BLOB_READ_WRITE_TOKEN`

Existing Vercel Blob behavior is the production path.

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
| `R2_PREFIX` | `migrate-dev/` | Object key prefix. Writes only allow `migrate-dev/`, `migrate-test/`, `migrate-preview/` |
| `R2_PUBLIC_BASE_URL` | unset | Public URL base for `r2` / `r2_then_blob` page reads |

CI must not set production `BLOB_READ_WRITE_TOKEN` as an R2 write credential. The
R2 driver tests mock `fetch` and never open the real bucket.

## Write guard

`STORAGE_WRITE_DRIVER=r2` is rejected when:

- `VERCEL_ENV=production`, or
- `R2_PREFIX` is empty / store root, or
- `R2_PREFIX` is not `migrate-(dev|test|preview)/`

There is no P0 escape hatch to write the production key space.

## Rollback

1. Set `STORAGE_READ_DRIVER=blob` and `STORAGE_WRITE_DRIVER=blob` (or unset both).
2. Leave `BLOB_BASE_URL` and `BLOB_READ_WRITE_TOKEN` as they are today.
3. Do not delete Vercel Blob objects as part of rollback.

That returns the site to the pre-P0 Blob-only path.

## Optional sync script

`web/scripts/sync-blob-to-r2.ts` copies Blob objects into the non-production R2
prefix. Default is dry-run:

```bash
bun scripts/sync-blob-to-r2.ts
bun scripts/sync-blob-to-r2.ts --prefix views/ --execute
```

`--execute` still refuses `VERCEL_ENV=production` and non-`migrate-*` prefixes.

## What this PR does not claim

- Production read primary is still Vercel Blob.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- The Worker `MEDIA` binding is recorded for later P3 hosting work; this adapter
  talks S3 from the existing Vercel Node runtime.
