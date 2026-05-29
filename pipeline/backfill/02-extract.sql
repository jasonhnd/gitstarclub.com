-- Backfill step 2 — BigQuery: per-repo daily GROSS star adds from GH Archive.
-- WatchEvent = a star (since 2012-08); GH Archive has no unstar event → gross only.
-- repo.id is stable across renames. Output feeds DuckDB (step 04). See docs/PIPELINE.md §1.
--
-- ⚠️ COST: scans only type / repo.id / created_at over 2015→cutoff (~1.5TB ≈ ~$10).
-- ALWAYS dry-run first to confirm bytes/cost:
--   bq query --use_legacy_sql=false --dry_run < backfill/02-extract.sql
--
-- Prereq — load the whitelist ids once (from step 01's data/whitelist.json):
--   jq -r '.[].id' data/whitelist.json > data/whitelist_ids.csv
--   bq mk --dataset "$GCP_PROJECT_ID:gitstarclub"
--   bq load --replace --source_format=CSV \
--     "$GCP_PROJECT_ID:gitstarclub.whitelist" data/whitelist_ids.csv repo_id:INTEGER

CREATE OR REPLACE TABLE `gitstarclub.star_daily_gross` AS
SELECT
  e.repo.id          AS repo_id,
  DATE(e.created_at) AS day,          -- UTC day boundary (matches GH Archive)
  COUNT(*)           AS gross_adds
FROM `githubarchive.day.*` AS e
JOIN `gitstarclub.whitelist` AS w
  ON e.repo.id = w.repo_id
WHERE e._TABLE_SUFFIX BETWEEN '20150101' AND '20260531'  -- [2015-01 .. seam_date]; edit cutoff
  AND e.type = 'WatchEvent'
GROUP BY repo_id, day;

-- Export for local DuckDB (step 04):
--   bq extract --destination_format=PARQUET \
--     gitstarclub.star_daily_gross gs://YOUR_BUCKET/star_daily_gross/*.parquet
--   gsutil cp 'gs://YOUR_BUCKET/star_daily_gross/*.parquet' data/star_daily_gross/
