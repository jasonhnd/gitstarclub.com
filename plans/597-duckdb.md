# Issue 597: pipeline DuckDB 1.5.6-r.1

## Goal

Bump the pipeline native DuckDB client from `@duckdb/node-api` 1.5.5-r.4 to the current npm stable release, and prove the installed binding still runs the SQL shapes used by the offline backfill.

## Baseline

Checked at the start of this work, 2026-10-01:

- `origin/pre` is `447d6fd38d6490bce61dc1760277f0d0e96db9b6` (`fix(security): bump next to 16.3.6 and clear high audit findings (#585) (#591)`). This branch starts there.
- npm `dist-tags.latest` for `@duckdb/node-api` is `1.5.6-r.1`. There is no newer stable patch. The issue target and the registry latest are the same version, so this change does not substitute a later patch.

The GSC_0031 review recorded 1.5.5-r.4 in `pipeline/bun.lock` and recommended this bump with a small offline fixture. It said not to run a real backfill or upload.

## Scope

- Pin `@duckdb/node-api` to `1.5.6-r.1` in `pipeline/package.json` and refresh `pipeline/bun.lock`. The native `@duckdb/node-bindings` packages move with that pin.
- Add one pipeline test that loads the native binding and runs a tiny on-disk fixture through `DuckDBInstance.create`, `connect`, `run`, `runAndReadAll`, and `getRowObjects`. The SQL covers the shapes in `pipeline/backfill/04-rollup.mjs`, `05-precompute.mjs`, and `07-export-v2.mjs`: parquet copy, `read_parquet`, `read_json_auto`, window `SUM`, `FILTER`, `strftime`, `CAST`, and `last_value ... IGNORE NULLS`.
- This plan.

## Out of scope

- `web/` dependencies, including Next, OpenNext, wrangler, React, and audit overrides.
- CI workflows, `.delivery.yml`, Worker wrangler config, and deploy scripts.
- Real backfill, upload, BigQuery, GCS, Cloudflare, or Vercel calls. No read of `pipeline/.env`, `web/.env.local`, or other credentials.
- Push to `main` or `pre`. Merge. Force-push. Deleting branches or files outside this issue.

## Acceptance

- `pipeline/` `bun install`, `bun run test`, and the repository script typecheck pass.
- The AGENTS.md static job passes on a fresh detached worktree of the commit under test.
- The pull request into `pre` contains `Closes #597`, what changed, the verification commands and results, and anything unfinished. This plan does not merge that pull request.
