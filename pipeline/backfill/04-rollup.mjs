// Backfill step 4 — DuckDB rollup. Reads the BigQuery gross export →
//   · canonical star_daily.parquet  (repo_id, date, delta)
//   · milestones (crossed_10k/50k/100k via gross cumsum) merged into repos.json
// Prereq: bun install (DuckDB) + step 02 parquet in data/star_daily_gross/ + step 03 repos.json.
// Run (from pipeline/):  node backfill/04-rollup.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const p = (rel) => `${dataDir}/${rel}`.replaceAll("\\", "/"); // DuckDB wants forward slashes
const GROSS = p("star_daily_gross/*.parquet");
const CANON = p("star_daily.parquet");

const db = await DuckDBInstance.create();
const con = await db.connect();

// 1. canonical fact table: gross_adds → delta (seam-前都是 gross；net 由 cron 之后 append)
await con.run(
  `COPY (SELECT repo_id, day AS date, gross_adds AS delta FROM read_parquet('${GROSS}'))
   TO '${CANON}' (FORMAT PARQUET)`,
);

// 2. milestones: first date where gross cumulative crosses each threshold (date cast to text)
const reader = await con.runAndReadAll(
  `WITH cum AS (
     SELECT repo_id, date,
            SUM(delta) OVER (PARTITION BY repo_id ORDER BY date) AS cumstars
     FROM read_parquet('${CANON}')
   )
   SELECT repo_id,
     CAST(MIN(date) FILTER (WHERE cumstars >= 10000)  AS VARCHAR) AS crossed_10k,
     CAST(MIN(date) FILTER (WHERE cumstars >= 50000)  AS VARCHAR) AS crossed_50k,
     CAST(MIN(date) FILTER (WHERE cumstars >= 100000) AS VARCHAR) AS crossed_100k
   FROM cum GROUP BY repo_id`,
);
const ms = new Map();
for (const r of reader.getRowObjects()) {
  ms.set(Number(r.repo_id), {
    crossed_10k: r.crossed_10k ?? null,
    crossed_50k: r.crossed_50k ?? null,
    crossed_100k: r.crossed_100k ?? null,
  });
}

// 3. merge milestones into repos.json
const repos = JSON.parse(readFileSync(p("repos.json"), "utf8"));
for (const repo of repos) {
  const m = ms.get(repo.id) ?? {};
  repo.crossed_10k = m.crossed_10k ?? null;
  repo.crossed_50k = m.crossed_50k ?? null;
  repo.crossed_100k = m.crossed_100k ?? null;
}
writeFileSync(p("repos.json"), JSON.stringify(repos));

console.log(`rollup: star_daily.parquet written; milestones for ${ms.size} repos merged into repos.json`);
const vue = repos.find((r) => r.full_name === "vuejs/vue");
if (vue) console.log(`  sanity vuejs/vue: 10k=${vue.crossed_10k} 50k=${vue.crossed_50k} 100k=${vue.crossed_100k} current=${vue.current_stars}`);
