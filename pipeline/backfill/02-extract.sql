-- Backfill step 2 — BigQuery: per-repo daily GROSS star adds from GH Archive.
-- WatchEvent = a star (since 2012-08); GH Archive has no unstar event → gross only.
-- repo.id is stable across renames. Output feeds DuckDB (step 04). See docs/PIPELINE.md §1.
--
-- Do not run this file unchanged. It is a template. Rendering it is local and
-- does not call BigQuery:
--   node backfill/02-extract.mjs --cutoff-suffix 260531 --destination gitstarclub.star_daily_gross_260531
--
-- Parameters:
--   @@CUTOFF_SUFFIX@@       6-digit YYMMDD table suffix, for example 260531
--   @@DESTINATION_TABLE@@   dated table, for example gitstarclub.star_daily_gross_260531
-- The renderer refuses the unsuffixed table gitstarclub.star_daily_gross so a
-- rerun cannot overwrite the May extract.
--
-- COST: scans only type / repo.id / created_at over 2015→cutoff. Measured dry-run ≈ 303 GB.
-- ALWAYS dry-run first, with a byte cap, and review the billed bytes before a real run:
--   bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql
-- Then the same command without --dry_run. (If piping the file errors on an illegal
-- char, the file must be UTF-8 without BOM.)
--
-- Prereq — load the whitelist ids once (from step 01's data/whitelist.json):
--   jq -r '.[].id' data/whitelist.json > data/whitelist_ids.csv
--   bq mk --dataset "$GCP_PROJECT_ID:gitstarclub"
--   bq load --replace --source_format=CSV \
--     "$GCP_PROJECT_ID:gitstarclub.whitelist" data/whitelist_ids.csv repo_id:INTEGER

CREATE OR REPLACE TABLE `@@DESTINATION_TABLE@@` AS
SELECT
  e.repo.id          AS repo_id,
  DATE(e.created_at) AS day,          -- UTC day boundary (matches GH Archive)
  COUNT(*)           AS gross_adds
FROM `githubarchive.day.20*` AS e     -- day.20* (NOT day.*) — prefix-wildcard skips the views (day.yesterday, …)
JOIN `gitstarclub.whitelist` AS w
  ON e.repo.id = w.repo_id
WHERE e._TABLE_SUFFIX BETWEEN '150101' AND '@@CUTOFF_SUFFIX@@'  -- suffix is after the day.20 prefix → [2015-01 .. cutoff]
  AND e.type = 'WatchEvent'
GROUP BY repo_id, day;

-- Export for local DuckDB (step 04). Replace the table with the rendered destination:
--   bq extract --destination_format=PARQUET \
--     gitstarclub.star_daily_gross_<suffix> gs://YOUR_BUCKET/star_daily_gross/*.parquet
--   gsutil cp 'gs://YOUR_BUCKET/star_daily_gross/*.parquet' data/star_daily_gross/
