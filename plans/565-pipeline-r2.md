# Issue 565: R2 bootstrap store, target guard, empty-bucket first commit

## Goal

Let the one-time bootstrap (`pipeline/backfill/06` and `07`) and the listed ops scripts write to a fresh R2 bucket. Blob mode stays the current path. Nothing here deploys, uploads, or edits Worker config.

## In scope

- `pipeline/lib/s3-sign.mjs` and `pipeline/lib/r2-bootstrap-store.mjs`: SigV4, binary `Buffer` reads, create-only `If-None-Match: *`, compare-and-set `If-Match`.
- `--store r2` requires `--target prod|pre`. Bucket comes from `R2_BUCKET_PROD` / `R2_BUCKET_PRE`, or from `R2_BUCKET` when that name matches the target. A single `R2_BUCKET` that disagrees with the named bucket is refused.
- Before any R2 write, read `_meta/bucket-identity.json`. `bucket` must equal the target bucket. `deploy_env` is `production` for `--target prod` and `pre` for `--target pre`. Never write or delete `_meta/`.
- R2 without `--execute` prints object count, bytes, and bucket, and performs no writes. `--dry-run`, `--no-upload`, and `--stage-only` keep their meaning. Blob still uploads unless `--dry-run` / `--no-upload`.
- `--initial-commit` (R2 only) publishes `previous_generation: null` when `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` are all absent. Any of those present is a mixed state and is refused. Blob still proves the legacy-flat layout.
- `02-extract.sql` takes a cutoff suffix and a destination table. The unsuffixed May table is refused. The runbook records `--maximum_bytes_billed=400000000000`.
- Listed `web/scripts/` go through `web/lib/storage` (`blob` or `r2_s3`), require `--target` for R2, and stay dry-run unless `--execute`.

## Out of scope

`workers/gitstarclub-web/wrangler.jsonc`, `scripts/cf-ci-gates.mjs`, `.github/workflows/*`, `.delivery.yml`, Worker runtime, `web/scripts/sync-blob-to-r2.ts`, real Cloudflare / Vercel / BigQuery / GCS writes, deploys, and pushes to `main` / `pre` / `preview`.

## Acceptance

Pipeline tests use an injected fetch. They cover a byte-identical parquet round trip, create-only conflict, stale `compareAndSet`, identity refusal before any write, zero write requests without `--execute`, empty-bucket `--initial-commit`, mixed-state refusal, `_meta/` refusal, and an unchanged Blob path. `06` / `07` `--help` documents the flags. `docs/OPS.md` has the R2 runbook.
