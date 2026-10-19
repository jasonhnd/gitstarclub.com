// Local rehearsal only. Remote operations are GETs; this tool cannot query or upload.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const DEFAULT_TABLE = "gitstarclub.gitstarclub.star_daily_gross_gap_260530_260930_20261019";
const ORIGIN = "https://data.gitstarclub.com";
const FROZEN = "refresh-2026-09-13T06-00-16-398Z";
const GAP_NAME = "gap-260530-260930.parquet";
const STATUS = "REHEARSAL ONLY; NOT PUBLISHABLE";
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const json = (value) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? Number(v) : v, 2) + "\n";
const writeJson = (file, value) => writeFileSync(file, json(value));
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const sqlPath = (file) => file.replaceAll("\\", "/").replaceAll("'", "''");

export function whitelistIds(rows) {
  assert(Array.isArray(rows) && rows.length > 0, "whitelist must be a nonempty array");
  const ids = rows.map((row) => Number(row.repo_id));
  assert(ids.every((id) => Number.isSafeInteger(id) && id > 0), "invalid whitelist id");
  assert.equal(new Set(ids).size, ids.length, "duplicate whitelist id");
  return ids.sort((a, b) => a - b);
}

export function verifiedBackup(manifest, directory) {
  const [header, ...lines] = manifest.trim().split(/\r?\n/);
  assert.equal(header, "name\tbytes\tsha256\tcrc32c\tmd5", "unexpected manifest header");
  const names = new Set();
  return lines.map((line) => {
    const [name, bytes, digest] = line.split("\t");
    assert(/^star_daily_gross\/data-\d+\.parquet$/.test(name), "unsafe manifest path");
    assert(!names.has(name), "duplicate manifest path");
    names.add(name);
    const file = join(directory, basename(name));
    assert.equal(statSync(file).size, Number(bytes), `backup size mismatch: ${name}`);
    assert.equal(sha256(readFileSync(file)), digest, `backup SHA-256 mismatch: ${name}`);
    return { name: basename(name), bytes: Number(bytes), sha256: digest, file };
  });
}

export function prepareBackup(out, backupDir, manifestFile, whitelistFile) {
  const ids = whitelistIds(readJson(whitelistFile));
  assert.equal(ids.length, 5249, "this rehearsal must retain the original 5,249-member whitelist");
  const manifest = readFileSync(manifestFile, "utf8");
  const files = verifiedBackup(manifest, backupDir);
  assert.equal(files.length, 20, "expected the 20-file May backup");
  const grossDir = join(out, "pipeline-data/star_daily_gross");
  mkdirSync(grossDir, { recursive: true });
  for (const file of files) {
    const destination = join(grossDir, file.name);
    assert(!existsSync(destination), `output already exists: ${destination}`);
    copyFileSync(file.file, destination);
    assert.equal(sha256(readFileSync(destination)), file.sha256);
  }
  copyFileSync(manifestFile, join(out, "star_daily_gross.manifest.tsv"));
  writeJson(join(out, "whitelist-ids.json"), ids.map((repo_id) => ({ repo_id })));
  const summary = { status: STATUS, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), whitelist: ids.length };
  writeJson(join(out, "backup-verification.json"), summary);
  return summary;
}

/** @param {{table: string, out: string, token: string, fetcher?: typeof fetch}} options */
export async function exportGapTable({ table, out, token, fetcher = fetch }) {
  assert(/^gitstarclub\.gitstarclub\.star_daily_gross_gap_260530_260930_\d{8}$/.test(table), "only a dated gap table in project gitstarclub is allowed");
  const ids = new Set(whitelistIds(readJson(join(out, "whitelist-ids.json"))));
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/gitstarclub/datasets/gitstarclub/tables/${table.split(".")[2]}`;
  const get = async (url) => {
    const response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    assert(response.ok, `BigQuery read failed: HTTP ${response.status}`);
    return response.json();
  };
  const before = await get(base);
  assert.deepEqual(before.schema.fields.map((f) => [f.name, f.type]), [["repo_id", "INTEGER"], ["day", "DATE"], ["gross_adds", "INTEGER"]]);
  const expected = Number(before.numRows);
  assert(Number.isSafeInteger(expected) && expected > 0, "invalid table row count");
  const jsonl = join(out, "gap.jsonl");
  writeFileSync(jsonl, "", { flag: "wx" });
  const tokens = new Set();
  const keys = new Set();
  let pageToken = "";
  let pages = 0;
  do {
    assert(!tokens.has(pageToken), "repeated BigQuery page token");
    tokens.add(pageToken);
    const url = new URL(`${base}/data`);
    url.searchParams.set("maxResults", "50000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await get(url);
    assert.equal(Number(page.totalRows), expected, "table row count changed during export");
    const rows = (page.rows ?? []).map((row) => {
      const values = row.f.map((field) => field.v);
      const fact = { repo_id: Number(values[0]), day: values[1], gross_adds: Number(values[2]) };
      assert(ids.has(fact.repo_id), "gap repository outside the fixed whitelist");
      assert(/^2026-\d{2}-\d{2}$/.test(fact.day) && fact.day >= "2026-05-30" && fact.day <= "2026-09-30", "gap day outside approved interval");
      assert(Number.isSafeInteger(fact.gross_adds) && fact.gross_adds > 0, "invalid gross adds");
      const key = `${fact.repo_id}/${fact.day}`;
      assert(!keys.has(key), "duplicate gap key");
      keys.add(key);
      return JSON.stringify(fact);
    });
    if (rows.length) appendFileSync(jsonl, rows.join("\n") + "\n");
    pages++;
    pageToken = page.pageToken ?? "";
  } while (pageToken);
  assert.equal(keys.size, expected, "truncated tabledata.list export");
  const after = await get(base);
  assert.equal(after.lastModifiedTime, before.lastModifiedTime, "table modified during export");
  assert.equal(after.numRows, before.numRows, "table row count changed during export");
  writeJson(join(out, "gap-table.json"), before);
  const parquet = join(out, "pipeline-data/star_daily_gross", GAP_NAME);
  assert(!existsSync(parquet), "gap Parquet output already exists");
  const db = await DuckDBInstance.create();
  const con = await db.connect();
  try {
    await con.run(`COPY (SELECT repo_id::BIGINT AS repo_id, day::DATE AS "day", gross_adds::BIGINT AS gross_adds FROM read_json_auto('${sqlPath(jsonl)}') ORDER BY repo_id, day) TO '${sqlPath(parquet)}' (FORMAT PARQUET)`);
  } finally { con.closeSync(); db.closeSync(); }
  const summary = { status: STATUS, table, rows: keys.size, pages, parquetSHA256: sha256(readFileSync(parquet)) };
  writeJson(join(out, "gap-export.json"), summary);
  return summary;
}

// Snapshot reads use curl so they match the original public-origin transport.
export function snapshotReader(out, cachedDirectory) {
  const directory = join(out, "snapshots");
  mkdirSync(directory, { recursive: true });
  const records = [];
  return {
    records,
    read(name, url, allowMissing = false) {
      const destination = join(directory, name);
      const cached = cachedDirectory ? join(cachedDirectory, name) : null;
      let source = "retained local snapshot";
      if (existsSync(`${destination}.status.json`)) {
        assert(allowMissing && readJson(`${destination}.status.json`).status === 404, `required snapshot unavailable: ${name}`);
        records.push({ name, url, status: 404, source });
        return null;
      }
      if (!existsSync(destination)) {
        if (cached && existsSync(cached)) copyFileSync(cached, destination);
        else {
          source = "public GET";
          const code = execFileSync("curl", ["--silent", "--show-error", "--location", "--retry", "2", "--max-time", "60", "--output", destination, "--write-out", "%{http_code}", url], { encoding: "utf8" }).trim();
          if (code === "404" && allowMissing) {
            writeJson(`${destination}.status.json`, { status: 404, url });
            records.push({ name, url, status: 404, source });
            return null;
          }
          assert.equal(code, "200", `snapshot GET failed: ${name}, HTTP ${code}`);
        }
      }
      const body = readFileSync(destination);
      const data = JSON.parse(body.toString("utf8"));
      // A prior explicit 404 is cached as an error body, never as a zero series.
      assert(!data.error && !data.message, `invalid snapshot: ${name}`);
      records.push({ name, url, source, status: 200, bytes: body.length, sha256: sha256(body) });
      return data;
    },
  };
}

export function assembleRepos(ids, canonical, lookup, frozenMeta, entityForId) {
  const fallbacks = [];
  const repos = ids.map((id) => {
    let repo = canonical[String(id)];
    if (repo) repo = { ...repo };
    else {
      const entity = entityForId(id);
      repo = Object.fromEntries(Object.entries(entity).filter(([key]) => !["curve", "monthly_table", "rank_history", "milestones", "inflections"].includes(key)));
      repo.node_id = Buffer.from(`010:Repository${id}`).toString("base64");
      repo.fetched_at = frozenMeta.generated_at;
      fallbacks.push({ id, full_name: repo.full_name, source: FROZEN });
    }
    assert.equal(repo.id, id, "snapshot repository id mismatch");
    assert(lookup[String(id)], "frozen lookup does not contain original member");
    assert(Number.isSafeInteger(repo.current_stars) && repo.current_stars >= 0, "invalid metadata stars");
    for (const key of ["node_id", "owner", "name", "full_name", "created_at", "fetched_at"]) assert(typeof repo[key] === "string" && repo[key].length, `missing metadata ${key}`);
    assert(["User", "Organization"].includes(repo.owner_type), "invalid owner type");
    assert(Array.isArray(repo.topics), "invalid topics");
    if (lookup[String(id)].active === false) repo.active = false;
    repo.tracked_since = null;
    return repo;
  });
  return { repos, fallbacks };
}

export function prepareMetadata(out, cachedDirectory) {
  const ids = whitelistIds(readJson(join(out, "whitelist-ids.json")));
  const snapshots = snapshotReader(out, cachedDirectory);
  const canonical = {};
  for (let bucket = 0; bucket < 32; bucket++) Object.assign(canonical, snapshots.read(`canonical-repos-${bucket}.json`, `${ORIGIN}/canonical/v2/repos/${bucket}.json`));
  const lookup = snapshots.read("lookup.json", `${ORIGIN}/views/${FROZEN}/lookup/repos.json`);
  const frozenMeta = snapshots.read("meta.json", `${ORIGIN}/views/${FROZEN}/meta.json`);
  const result = assembleRepos(ids, canonical, lookup, frozenMeta, (id) => snapshots.read(`entity-${id}.json`, `${ORIGIN}/views/${FROZEN}/entity/repo/${id}.json`));
  writeJson(join(out, "pipeline-data/repos.json"), result.repos);
  writeJson(join(out, "pipeline-data/whitelist.json"), result.repos.map((repo) => ({ id: repo.id, node_id: repo.node_id, full_name: repo.full_name })));
  const summary = {
    status: STATUS, mode: "historical snapshot assembly; strict step 03 is unchanged and has not passed",
    strictStep03Exception: "GitHub NOT_FOUND/REST 404 for segment-boneyard/nightmare (18477927); historical snapshot reuse is rehearsal-only",
    repositories: result.repos.length, fallbacks: result.fallbacks,
    inactive: result.repos.filter((repo) => repo.active === false).length,
    minFetchedAt: result.repos.map((repo) => repo.fetched_at).sort()[0],
    maxFetchedAt: result.repos.map((repo) => repo.fetched_at).sort().at(-1),
    snapshots: snapshots.records,
  };
  writeJson(join(out, "metadata-provenance.json"), summary);
  return summary;
}

export async function summarize(out, cachedDirectory) {
  const grossDir = sqlPath(join(out, "pipeline-data/star_daily_gross"));
  const ids = whitelistIds(readJson(join(out, "whitelist-ids.json")));
  const db = await DuckDBInstance.create();
  const con = await db.connect();
  const query = async (sql) => (await con.runAndReadAll(sql)).getRowObjects();
  try {
    const stats = async (file) => (await query(`SELECT count(*) AS "rows", count(DISTINCT repo_id) AS repos, min(day)::VARCHAR AS min_day, max(day)::VARCHAR AS max_day, sum(gross_adds) AS adds, count(*) FILTER (WHERE repo_id IS NULL OR day IS NULL OR gross_adds IS NULL OR gross_adds<=0) AS invalid, count(*)-count(DISTINCT (repo_id,day)) AS duplicate_keys FROM read_parquet('${file}')`))[0];
    const backup = await stats(`${grossDir}/data-*.parquet`);
    const gap = await stats(`${grossDir}/${GAP_NAME}`);
    const union = await stats(`${grossDir}/*.parquet`);
    for (const stat of [backup, gap, union]) assert(!Number(stat.invalid) && !Number(stat.duplicate_keys), "invalid or duplicate facts");
    assert.equal(backup.max_day, "2026-05-29");
    assert.equal(gap.min_day, "2026-05-30");
    assert.equal(gap.max_day, "2026-09-30");
    assert.equal(Number(union.rows), Number(backup.rows) + Number(gap.rows));
    const observed = (await query(`SELECT DISTINCT repo_id FROM read_parquet('${grossDir}/*.parquet') ORDER BY 1`)).map((row) => Number(row.repo_id));
    assert.deepEqual(observed, ids, "union ids differ from the fixed whitelist");
    const monthly = await query(`SELECT strftime(day,'%Y-%m') AS period, count(DISTINCT day) AS "days", sum(gross_adds) AS adds FROM read_parquet('${grossDir}/*.parquet') WHERE day>='2026-05-01' GROUP BY 1 ORDER BY 1`);
    const snapshots = snapshotReader(out, cachedDirectory);
    const sites = [];
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      const old = snapshots.read(`heatmap-${month}.json`, `${ORIGIN}/views/${FROZEN}/heatmap/month/${month}.json`, true);
      const current = monthly.find((row) => row.period === month);
      assert(current, `missing rehearsal month ${month}`);
      sites.push({ month, rehearsalGross: Number(current.adds), days: Number(current.days), frozenFlow: old ? old.cells.reduce((sum, row) => sum + row[1], 0) : null, frozenDays: old ? old.cells.length : null });
    }
    const examples = [28457823, 10270250, 132750724].map((id) => {
      const old = snapshots.read(`entity-${id}.json`, `${ORIGIN}/views/${FROZEN}/entity/repo/${id}.json`);
      const current = readJson(join(out, `pipeline-data/views/entity/repo/${id}.json`));
      return { id, name: current.full_name, months: sites.map(({ month }) => ({ month, rehearsalGross: current.curve.monthly.find((row) => row[0] === month)?.[1] ?? 0, frozenFlow: old.curve.monthly.find((row) => row[0] === month)?.[1] ?? null })) };
    });
    const summary = { status: STATUS, backup, gap, union, monthly, sites, examples, comparisonSnapshots: snapshots.records };
    writeJson(join(out, "rehearsal-summary.json"), summary);
    return summary;
  } finally { con.closeSync(); db.closeSync(); }
}

const HELP = `Read-only preview-gap rehearsal. See pipeline/scripts/README.md.
  node pipeline/scripts/preview-gap-rehearsal.mjs backup --out DIR --backup-dir DIR --backup-manifest FILE --whitelist-file FILE
  node pipeline/scripts/preview-gap-rehearsal.mjs export --out DIR [--table ${DEFAULT_TABLE}]
  node pipeline/scripts/preview-gap-rehearsal.mjs metadata --out DIR [--cached-snapshots DIR]
  node pipeline/scripts/preview-gap-rehearsal.mjs summary --out DIR [--cached-snapshots DIR]
Outputs must be under KANBAN_TMP. No query, search, R2, Blob, cron, or upload operation exists.
`;

export async function main(argv) {
  if (argv.length === 0 || argv.includes("--help")) { console.log(HELP); return; }
  const [command, ...args] = argv;
  assert(["backup", "export", "metadata", "summary"].includes(command), "unknown rehearsal command");
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    assert(["--out", "--backup-dir", "--backup-manifest", "--whitelist-file", "--cached-snapshots", "--table"].includes(args[i]), `unknown option ${args[i]}`);
    assert(args[i + 1] && !args[i + 1].startsWith("--"), `${args[i]} requires a value`);
    assert(!options.has(args[i]), `duplicate option ${args[i]}`);
    options.set(args[i], args[i + 1]);
  }
  assert(options.has("--out") && process.env.KANBAN_TMP, "--out and KANBAN_TMP are required");
  const out = resolve(options.get("--out"));
  const tmp = resolve(process.env.KANBAN_TMP);
  assert(out.startsWith(`${tmp}${sep}`), "outputs must be in a child of KANBAN_TMP");
  let result;
  if (command === "backup") {
    for (const option of ["--backup-dir", "--backup-manifest", "--whitelist-file"]) assert(options.has(option), `${option} is required`);
    result = prepareBackup(out, options.get("--backup-dir"), options.get("--backup-manifest"), options.get("--whitelist-file"));
  } else if (command === "export") {
    let token;
    try { token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", env: { ...process.env, CLOUDSDK_CORE_DISABLE_FILE_LOGGING: "true" }, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
    catch { throw new Error("gcloud could not provide an access token; no data was read"); }
    result = await exportGapTable({ table: options.get("--table") ?? DEFAULT_TABLE, out, token });
  } else if (command === "metadata") result = prepareMetadata(out, options.get("--cached-snapshots"));
  else result = await summarize(out, options.get("--cached-snapshots"));
  console.log(json(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
