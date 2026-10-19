# Production rollout and data repair: raw-source retirement update

Status: current source/storage constraints as of 2026-10-19, following GSC_0071 and owner decision d1019-001344-1. This plan does not authorize a deploy, collection, rebuild, publication, or data expansion (lock-002).

## Scope and overlap

This update is based on `pre`. PR [#667](https://github.com/jasonhnd/gitstarclub.com/pull/667) was still open when this card started and proposes a larger rollout/data-repair plan at this same path plus an OPS raw-data section. Its GCS-primary, pending R2-copy/manifest, and pending source-decision descriptions predate GSC_0071. When reconciling the two PRs, retain #667's dated diagnosis and historical query-cost records while applying the current facts below. Do not restore GCS as an operational location or approve the withdrawn GH Archive gap fill.

## Only retained raw-data store

Raw data lives only in private R2 bucket `gitstarclub-raw` on the ZKSC.KK account, separate from public production and preview data. Its managed `r2.dev` domain is disabled and it has no custom domains.

| Key(s) | Objects | Bytes | Rows |
| --- | --- | --- | --- |
| `star_daily_gross/data-0000000000{00..19}.parquet` | 20 | 30,907,971 | 12,375,426 |
| `bigquery-export/whitelist/data-000000000000.parquet` | 1 | 50,868 | 5,249 |
| `bigquery-export/star_daily_gross_gap_260530_260930_20261019/data-000000000000.parquet` | 1 | 196,554 | 90,797 |

The original gross archive covers 2015-01-01 through 2026-05-29. The gap export covers 2026-05-30 through 2026-09-30 and is retained evidence, not an approved repair input. The former `gs://gitstarclub-backfill-746384388303/star_daily_gross/` path is historical. A local working directory is not a retained backup.

Use the read-only `cf` CLI, never Wrangler: `cf r2 objects list --bucket-name gitstarclub-raw --per-page 1000`, then `cf r2 objects get <key> --bucket-name gitstarclub-raw` into the active card's temporary directory, followed by `shasum -a 256 -c` against the [versioned manifest](../docs/raw-data.sha256). Require all 22 keys (31,155,393 bytes), exact byte sizes, matching checksums, and the private-domain settings. The complete procedure and hash provenance are in [OPS](../docs/OPS.md#raw-backfill-data).

## GCP retirement and recovery window

GSC_0071 requested deletion of GCP project `gitstarclub` at **2026-10-19T11:12:41Z**, then observed **`DELETE_REQUESTED`**. The calculated Google 30-day recovery deadline is **2026-11-18T11:12:41Z**. This records the deletion request, not a completed purge; any separately authorized recovery must happen well before the deadline. GCS and BigQuery are retired dependencies. Do not recreate the project, re-export tables, or run more queries under this plan.

## Source decision

BigQuery / GH Archive extraction is **retired as of 2026-10-19**. GSC_0045 measured 12,761 archive gross stars against 342,659 in GitHub's star-history proxy over a 40-repository 2026 sample: about 3.7%, commonly rounded to 4%. That stratified sample is not a population-weighted total. The proxy contains present-day surviving stars, lacks independent dated endpoint totals, and does not establish exact UTC boundaries or historical net. Keep the published frozen net series.

The replacement source is GitHub's own star history (`GET /repositories/{id}/stargazers/history`), per owner decision **d1019-001344-1**. A source decision does not approve a full-whitelist collection, preview/production write, or publication. PR #669's rehearsal is not publish approval. Separate validation and explicit authorization must precede any repair. No data coverage expansion is permitted (lock-002).

## Acceptance and handoff

- Current raw/storage references agree with OPS and its manifest. Retain historical extraction recipes with a retirement date.
- Run the exact-head AGENTS bootstrap, static checks, full web suite, and local-fixture production `bun run build` in a clean detached checkout under the active card's temporary directory. Run `bun run lint:docs` and `node scripts/check-docs.mjs` explicitly. Record commands and results in the PR.
- Skip `cf:dry-run` by owner order (2026-10-19); no Wrangler, Cloudflare build wrapper, OpenNext command, deploy, cron/refresh call, object write, or CI enablement.
- Deliver one PR into `pre` for independent review. The executor does not merge or perform final acceptance. Reconcile overlap with #667 before either PR restores older source/storage wording.
