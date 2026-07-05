// 🗄️ BOOTSTRAP-ONLY / ARCHIVE — NOT a recurring production path. For recurring ops the
// view matrix is now recomputed on Vercel by web/lib/workflows/recompute/* (pure JS, no
// DuckDB), parity-proven byte-identical to this script. This stays for cold-start / disaster
// rebuild only. See docs/VERCEL-DATA-OPERATIONS.md.
//
// Backfill step 5 — DuckDB precompute → all JSON service views (data/views/**).
// Reads canonical star_daily.parquet + repos.json (enriched by step 04) and emits
// the full matrix per docs/DATA-CONTRACTS.md §2:
//   · lookup/{repos,orgs}.json
//   · rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json + rank/all-time/{repo|org}/stock.json
//   · entity/repo/{id}.json, entity/org/{login}.json
//   · heatmap/{month|year}/{period}.json
//   · meta.json
// Stock history uses the anchoring algorithm (RANKING.md §3): all backfill is gross,
// so discount d = current_stars / total_gross and stock_est = round(cumgross × d);
// the curve's final point lands exactly on current_stars.
// NOTE: current_month.json + hot-snapshot.json are the daily-cron live tail (M4), not produced here.
// Prereq: steps 02–04 done (data/star_daily.parquet + data/repos.json with milestones).
// Run (from pipeline/):  node --max-old-space-size=4096 backfill/05-precompute.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { GROWTH_FLOOR_STARS } from "../../web/lib/constants.mjs";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const p = (rel) => `${dataDir}/${rel}`.replaceAll("\\", "/"); // DuckDB wants forward slashes
const VIEWS = p("views");
const SD = p("star_daily.parquet");
const GEN = new Date().toISOString();

const TOP_N = 100; // rank list length (pages truncate further)
const RECENT_DAYS = 90; // entity curve daily tail length
const MONTHLY_TABLE_MONTHS = 24; // entity monthly_table window

const WINDOWS = {
  week: "strftime(date,'%G-W%V')", // ISO year-week, e.g. 2024-W42
  month: "strftime(date,'%Y-%m')",
  year: "strftime(date,'%Y')",
};

const num = (v) => (typeof v === "bigint" ? Number(v) : v);

const madeDirs = new Set();
let fileCount = 0;
function writeJson(rel, obj) {
  const full = `${VIEWS}/${rel}`;
  const dir = full.slice(0, full.lastIndexOf("/"));
  if (!madeDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    madeDirs.add(dir);
  }
  writeFileSync(full, JSON.stringify(obj));
  fileCount++;
}

function groupBy(arr, keyOf) {
  const m = new Map();
  for (const x of arr) {
    const k = keyOf(x);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(x);
  }
  return m;
}

/** Consume rows (sorted by repo_id asc) for the current id; advances ptr.i. */
function drain(arr, ptr, id) {
  const out = [];
  while (ptr.i < arr.length && num(arr[ptr.i].repo_id) === id) out.push(arr[ptr.i++]);
  return out;
}

function addDays(ymd, days) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const db = await DuckDBInstance.create();
const con = await db.connect();
const query = async (sql) => (await con.runAndReadAll(sql)).getRowObjects();

// --- base tables: repo_meta + per-repo discount (anchor gross cumsum to current_stars) ---
await con.run(
  `CREATE TABLE repo_meta AS
   SELECT CAST(id AS BIGINT) repo_id, owner, owner_type, CAST(current_stars AS BIGINT) current_stars
   FROM read_json_auto('${p("repos.json")}', maximum_object_size=10000000, sample_size=-1)`,
);
await con.run(
  `CREATE TABLE disc AS
   SELECT m.repo_id, m.owner, m.owner_type, m.current_stars,
          CASE WHEN COALESCE(g.tot,0) > 0 THEN m.current_stars::DOUBLE / g.tot ELSE 0 END d
   FROM repo_meta m
   LEFT JOIN (SELECT repo_id, SUM(delta) tot FROM read_parquet('${SD}') GROUP BY 1) g
     ON g.repo_id = m.repo_id`,
);

const repos = JSON.parse(readFileSync(p("repos.json"), "utf8"));
const repoById = new Map(repos.map((r) => [r.id, r]));

const [{ hi: rawHi }] = await query(`SELECT CAST(MAX(date) AS VARCHAR) hi FROM read_parquet('${SD}')`);
const hi = String(rawHi);
const seamDate = addDays(hi, 1); // gross→net boundary: first day the daily cron will track as net
const recentCutoff = addDays(seamDate, -RECENT_DAYS);

// --- materialize per-window repo/org metric tables (flow + anchored stock_est) ---
for (const [w, expr] of Object.entries(WINDOWS)) {
  await con.run(
    `CREATE TABLE rm_${w} AS
     WITH agg AS (
       SELECT s.repo_id, ${expr} period, SUM(s.delta) flow
       FROM read_parquet('${SD}') s GROUP BY 1, 2
     ),
     cum AS (
       SELECT repo_id, period, flow,
              SUM(flow) OVER (PARTITION BY repo_id ORDER BY period) cumgross
       FROM agg
     )
     SELECT c.repo_id, c.period, c.flow,
            CAST(round(c.cumgross * d.d) AS BIGINT) stock_est, d.owner, d.owner_type,
            ROW_NUMBER() OVER (PARTITION BY c.period ORDER BY c.flow DESC, c.cumgross DESC, c.repo_id) flow_rank
     FROM cum c JOIN disc d ON d.repo_id = c.repo_id`,
  );
  // org = sum of member repos. Forward-fill each member's stock across idle periods so the
  // org stock curve stays monotone and its endpoint sums to current_stars_sum (a repo idle in a
  // period still holds its accumulated stars). Flow stays per-period (0 when idle).
  await con.run(
    `CREATE TABLE om_${w} AS
     WITH periods AS (SELECT DISTINCT period FROM rm_${w}),
     span AS (SELECT repo_id, any_value(owner) o, any_value(owner_type) ot, MIN(period) first_p FROM rm_${w} GROUP BY repo_id),
     grid AS (SELECT s.repo_id, s.o, s.ot, pr.period FROM span s JOIN periods pr ON pr.period >= s.first_p),
     filled AS (
       SELECT g.o, g.ot, g.period, COALESCE(a.flow, 0) flow,
              last_value(a.stock_est IGNORE NULLS) OVER (PARTITION BY g.repo_id ORDER BY g.period) stock_est
       FROM grid g LEFT JOIN rm_${w} a ON a.repo_id = g.repo_id AND a.period = g.period
     )
     SELECT o login, any_value(ot) owner_type, period,
            SUM(flow) flow, SUM(stock_est) stock_est
     FROM filled GROUP BY o, period`,
  );
}

// --- rank matrix: {window}×{dim}×{metric}, top-N per period with prev_rank ---
async function exportRanks(w, dim, metric) {
  const table = dim === "repo" ? `rm_${w}` : `om_${w}`;
  const idExpr = dim === "repo" ? "repo_id" : "NULL";
  const loginExpr = dim === "repo" ? "NULL" : "login";
  const key = dim === "repo" ? "repo_id" : "login";
  const val = metric === "flow" ? "flow" : "stock_est";
  const other = metric === "flow" ? "stock_est" : "flow";
  const rs = await query(
    `WITH ranked AS (
       SELECT period, ${idExpr} id, ${loginExpr} login, ${val} val,
              ROW_NUMBER() OVER (PARTITION BY period ORDER BY ${val} DESC, ${other} DESC, ${key}) rank
       FROM ${table}
     ),
     pidx AS (SELECT period, ROW_NUMBER() OVER (ORDER BY period) pi FROM (SELECT DISTINCT period FROM ranked))
     SELECT r.period, r.id, r.login, CAST(r.val AS BIGINT) val, r.rank, prev.rank prev_rank
     FROM ranked r
     JOIN pidx pi ON pi.period = r.period
     LEFT JOIN pidx ppi ON ppi.pi = pi.pi - 1
     LEFT JOIN ranked prev ON prev.period = ppi.period
          AND prev.id IS NOT DISTINCT FROM r.id AND prev.login IS NOT DISTINCT FROM r.login
     WHERE r.rank <= ${TOP_N}
     ORDER BY r.period, r.rank`,
  );
  for (const [period, rows] of groupBy(rs, (r) => r.period)) {
    const items = rows.map((r) => {
      const item = { rank: num(r.rank), value: num(r.val), prev_rank: r.prev_rank == null ? null : num(r.prev_rank) };
      if (dim === "repo") item.id = num(r.id);
      else item.login = r.login;
      return item;
    });
    writeJson(`rank/${w}/${period}/${dim}/${metric}.json`, {
      meta: { window: w, period, dim, metric, generated_at: GEN },
      items,
    });
  }
}

async function exportAllTime() {
  const repoRows = await query(
    `SELECT repo_id id, current_stars val FROM disc ORDER BY current_stars DESC, repo_id LIMIT ${TOP_N}`,
  );
  writeJson("rank/all-time/repo/stock.json", {
    meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: GEN },
    items: repoRows.map((r, i) => ({ rank: i + 1, id: num(r.id), value: num(r.val), prev_rank: null })),
  });
  const orgRows = await query(
    `SELECT owner login, SUM(current_stars) val FROM disc GROUP BY owner ORDER BY val DESC, owner LIMIT ${TOP_N}`,
  );
  writeJson("rank/all-time/org/stock.json", {
    meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: GEN },
    items: orgRows.map((r, i) => ({ rank: i + 1, login: r.login, value: num(r.val), prev_rank: null })),
  });
}

// --- lookup join tables (from repos.json) ---
function exportLookups() {
  const repoLk = {};
  for (const r of repos) {
    repoLk[r.id] = {
      owner: r.owner,
      name: r.name,
      full_name: r.full_name,
      owner_type: r.owner_type,
      language: r.language ?? null,
      current_stars: r.current_stars,
    };
  }
  writeJson("lookup/repos.json", repoLk);

  const orgAgg = new Map();
  for (const r of repos) {
    let o = orgAgg.get(r.owner);
    if (!o) orgAgg.set(r.owner, (o = { login: r.owner, owner_type: r.owner_type, repo_count: 0, current_stars_sum: 0 }));
    o.repo_count++;
    o.current_stars_sum += r.current_stars;
  }
  const orgLk = {};
  for (const [login, o] of orgAgg) orgLk[login] = o;
  writeJson("lookup/orgs.json", orgLk);
  return orgAgg;
}

// --- heatmaps: daily site totals → month files; monthly totals → year files ---
async function exportHeatmaps() {
  const daily = await query(`SELECT CAST(date AS VARCHAR) d, SUM(delta) tot FROM read_parquet('${SD}') GROUP BY date ORDER BY date`);
  const monthTotals = new Map();
  for (const [mo, rows] of groupBy(daily, (r) => r.d.slice(0, 7))) {
    const cells = rows.map((r) => [r.d, num(r.tot)]);
    writeJson(`heatmap/month/${mo}.json`, { meta: { scope: "month", period: mo, generated_at: GEN }, cells });
    monthTotals.set(mo, cells.reduce((s, c) => s + c[1], 0));
  }
  for (const [yr, entries] of groupBy([...monthTotals], ([mo]) => mo.slice(0, 4))) {
    const cells = entries.map(([mo, tot]) => [mo, tot]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    writeJson(`heatmap/year/${yr}.json`, { meta: { scope: "year", period: yr, generated_at: GEN }, cells });
  }
}

// --- entity/repo: anchored monthly curve + recent daily tail + monthly table + rank history ---
async function exportRepoEntities() {
  const monthly = await query(`SELECT repo_id, period, flow, stock_est, flow_rank FROM rm_month ORDER BY repo_id, period`);
  const daily = await query(
    `SELECT repo_id, CAST(date AS VARCHAR) d, delta FROM read_parquet('${SD}') WHERE date >= DATE '${recentCutoff}' ORDER BY repo_id, date`,
  );
  const ids = [...repoById.keys()].sort((a, b) => a - b);
  const mp = { i: 0 };
  const dp = { i: 0 };
  let anchorDrift = 0;
  for (const id of ids) {
    const mrows = drain(monthly, mp, id);
    const drows = drain(daily, dp, id);
    const meta = repoById.get(id);
    const last = mrows.at(-1);
    if (last) anchorDrift = Math.max(anchorDrift, Math.abs(num(last.stock_est) - meta.current_stars));
    writeJson(`entity/repo/${id}.json`, {
      id,
      full_name: meta.full_name,
      owner: meta.owner,
      owner_type: meta.owner_type,
      name: meta.name,
      description: meta.description ?? null,
      language: meta.language ?? null,
      topics: meta.topics ?? [],
      created_at: (meta.created_at ?? "").slice(0, 10),
      current_stars: meta.current_stars,
      is_archived: !!meta.is_archived,
      milestones: {
        crossed_10k: meta.crossed_10k ?? null,
        crossed_50k: meta.crossed_50k ?? null,
        crossed_100k: meta.crossed_100k ?? null,
      },
      curve: {
        monthly: mrows.map((r) => [r.period, num(r.flow), num(r.stock_est)]),
        recent_daily: drows.map((r) => [r.d, num(r.delta)]),
      },
      monthly_table: mrows.slice(-MONTHLY_TABLE_MONTHS).map((r) => ({ month: r.period, adds: num(r.flow), rank: num(r.flow_rank) })),
      rank_history: { month: mrows.map((r) => [r.period, num(r.flow_rank)]) },
    });
  }
  return { count: ids.length, anchorDrift };
}

// --- entity/org: aggregated curve over member repos ---
async function exportOrgEntities(orgAgg) {
  const monthly = await query(`SELECT login, period, flow, stock_est FROM om_month ORDER BY login, period`);
  const daily = await query(
    `SELECT d.owner login, CAST(s.date AS VARCHAR) d, SUM(s.delta) delta
     FROM read_parquet('${SD}') s JOIN disc d ON d.repo_id = s.repo_id
     WHERE s.date >= DATE '${recentCutoff}' GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const mByLogin = groupBy(monthly, (r) => r.login);
  const dByLogin = groupBy(daily, (r) => r.login);
  const membersByLogin = groupBy(repos, (r) => r.owner);
  let anchorDrift = 0;
  for (const [login, agg] of orgAgg) {
    const mrows = mByLogin.get(login) ?? [];
    const drows = dByLogin.get(login) ?? [];
    const last = mrows.at(-1);
    if (last) anchorDrift = Math.max(anchorDrift, Math.abs(num(last.stock_est) - agg.current_stars_sum));
    writeJson(`entity/org/${login}.json`, {
      login,
      owner_type: agg.owner_type,
      current_stars_sum: agg.current_stars_sum,
      repo_count: agg.repo_count,
      members: (membersByLogin.get(login) ?? []).map((r) => r.id),
      curve: {
        monthly: mrows.map((r) => [r.period, num(r.flow), num(r.stock_est)]),
        recent_daily: drows.map((r) => [r.d, num(r.delta)]),
      },
    });
  }
  return { count: orgAgg.size, anchorDrift };
}

// --- derived repo rankings: growth (rate) + new (first ≥10k), per RANKING §4 ---
// Growth = flow / 期初stock (prev period stock_est), floor 期初stock ≥ 20k. The floor also
// dedupes newcomers (their 期初 < 10k) so they never appear in growth.
async function exportGrowth(w) {
  const rs = await query(
    `WITH g AS (
       SELECT repo_id, period, flow, stock_est,
              LAG(stock_est) OVER (PARTITION BY repo_id ORDER BY period) AS base
       FROM rm_${w}
     ),
     r AS (
       SELECT period, repo_id, flow, base,
              ROW_NUMBER() OVER (PARTITION BY period ORDER BY flow::DOUBLE / base DESC, flow DESC, repo_id) rank
       FROM g WHERE base >= ${GROWTH_FLOOR_STARS} AND flow > 0
     )
     SELECT period, repo_id, flow, base, rank FROM r WHERE rank <= ${TOP_N} ORDER BY period, rank`,
  );
  for (const [period, rows] of groupBy(rs, (r) => r.period)) {
    const items = rows.map((r) => ({
      rank: num(r.rank),
      id: num(r.repo_id),
      value: num(r.flow),
      base: num(r.base),
      rate: Math.round((num(r.flow) / num(r.base)) * 1000) / 10,
      prev_rank: null,
    }));
    writeJson(`rank/${w}/${period}/repo/growth.json`, {
      meta: { window: w, period, dim: "repo", metric: "growth", generated_at: GEN },
      items,
    });
  }
}

// Newcomer = repo whose stock first crossed 10k in this period (from milestone crossed_10k).
function exportNewcomers(w) {
  const sliceLen = w === "month" ? 7 : 4;
  const byPeriod = groupBy(repos.filter((r) => r.crossed_10k), (r) => r.crossed_10k.slice(0, sliceLen));
  for (const [period, list] of byPeriod) {
    const items = [...list]
      .sort((a, b) => b.current_stars - a.current_stars)
      .slice(0, TOP_N)
      .map((r, i) => ({ rank: i + 1, id: r.id, value: r.current_stars, date: r.crossed_10k, prev_rank: null }));
    writeJson(`rank/${w}/${period}/repo/new.json`, {
      meta: { window: w, period, dim: "repo", metric: "new", generated_at: GEN },
      items,
    });
  }
}

// --- hot-snapshot: KB-level aggregate read by home/current/all-time pages (cron overwrites at M4) ---
async function exportHotSnapshot() {
  const maxMonth = hi.slice(0, 7);
  const maxYear = hi.slice(0, 4);
  const N = 20;
  const topRepo = async (table, period, metric) => {
    const tie = metric === "flow" ? "stock_est" : "flow";
    const rs = await query(
      `SELECT repo_id id, ${metric} v, ROW_NUMBER() OVER (ORDER BY ${metric} DESC, ${tie} DESC, repo_id) rank
       FROM ${table} WHERE period='${period}' ORDER BY rank LIMIT ${N}`,
    );
    return rs.map((r) => ({ rank: num(r.rank), id: num(r.id), value: num(r.v), prev_rank: null }));
  };
  const yearSpine = (await query(`SELECT strftime(date,'%Y') yr, SUM(delta) tot FROM read_parquet('${SD}') GROUP BY 1 ORDER BY 1`)).map(
    (r) => [r.yr, num(r.tot)],
  );
  const allRepo = (await query(`SELECT repo_id id, current_stars v, ROW_NUMBER() OVER (ORDER BY current_stars DESC, repo_id) rank FROM disc ORDER BY rank LIMIT ${N}`)).map(
    (r) => ({ rank: num(r.rank), id: num(r.id), value: num(r.v), prev_rank: null }),
  );
  const allOrg = (await query(`SELECT owner login, SUM(current_stars) v, ROW_NUMBER() OVER (ORDER BY SUM(current_stars) DESC, owner) rank FROM disc GROUP BY owner ORDER BY rank LIMIT ${N}`)).map(
    (r) => ({ rank: num(r.rank), login: r.login, value: num(r.v), prev_rank: null }),
  );
  const mmdd = GEN.slice(5, 10);
  const onThisDay = [];
  for (const r of repos)
    for (const [crossed, key] of [["10k", "crossed_10k"], ["50k", "crossed_50k"], ["100k", "crossed_100k"]])
      if (r[key] && r[key].slice(5, 10) === mmdd) onThisDay.push({ id: r.id, crossed, date: r[key] });

  writeJson("hot-snapshot.json", {
    generated_at: GEN,
    home: {
      year_spine: yearSpine,
      current_month_top: { flow: await topRepo("rm_month", maxMonth, "flow"), stock: await topRepo("rm_month", maxMonth, "stock_est") },
      on_this_day: onThisDay,
    },
    current_year: { flow: await topRepo("rm_year", maxYear, "flow"), stock: await topRepo("rm_year", maxYear, "stock_est") },
    current_month: { flow: await topRepo("rm_month", maxMonth, "flow"), stock: await topRepo("rm_month", maxMonth, "stock_est") },
    all_time: { repo: allRepo, org: allOrg },
  });
}

// --- run ---
const orgAgg = exportLookups();
for (const w of Object.keys(WINDOWS))
  for (const dim of ["repo", "org"]) for (const metric of ["flow", "stock"]) await exportRanks(w, dim, metric);
await exportAllTime();
for (const w of ["month", "year"]) {
  await exportGrowth(w);
  exportNewcomers(w);
}
await exportHeatmaps();
const repoStats = await exportRepoEntities();
const orgStats = await exportOrgEntities(orgAgg);
await exportHotSnapshot();
writeJson("meta.json", { seam_date: seamDate, backfilled_at: GEN, schema_ver: 1, generated_at: GEN });

// --- sanity ---
if (repoStats.count !== repos.length) throw new Error(`entity count ${repoStats.count} != ${repos.length}`);
if (repoStats.anchorDrift > 5) throw new Error(`repo stock anchor drift too high: ${repoStats.anchorDrift}`);
if (orgStats.anchorDrift > 5) throw new Error(`org stock anchor drift too high: ${orgStats.anchorDrift}`);
const at = JSON.parse(readFileSync(`${VIEWS}/rank/all-time/repo/stock.json`, "utf8"));
if (at.items[0].id !== 132750724) throw new Error(`all-time #1 unexpected: ${at.items[0].id}`);
const vue = JSON.parse(readFileSync(`${VIEWS}/entity/repo/11730342.json`, "utf8"));

console.log(`precompute: ${fileCount} files → ${VIEWS}`);
console.log(`  seam_date=${seamDate}  repos=${repoStats.count}  orgs=${orgStats.count}`);
console.log(`  anchor_drift: repo=${repoStats.anchorDrift} org=${orgStats.anchorDrift}`);
console.log(`  sanity all-time#1=${at.items[0].id} (=${at.items[0].value}★)  vue final stock_est=${vue.curve.monthly.at(-1)?.[2]} (current=${vue.current_stars})`);
process.exit(0);
