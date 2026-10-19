// @ts-nocheck -- Bun fixtures exercise the real local tool without credentials.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { assembleRepos, exportGapTable, snapshotReader, verifiedBackup, whitelistIds } from "../scripts/preview-gap-rehearsal.mjs";

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "gsc-rehearsal-"));
  directories.push(directory);
  mkdirSync(join(directory, "pipeline-data/star_daily_gross"), { recursive: true });
  writeFileSync(join(directory, "whitelist-ids.json"), JSON.stringify([{ repo_id: "1" }, { repo_id: "2" }]));
  return directory;
}
const table = "gitstarclub.gitstarclub.star_daily_gross_gap_260530_260930_20261019";
const fields = [["repo_id", "INTEGER"], ["day", "DATE"], ["gross_adds", "INTEGER"]].map(([name, type]) => ({ name, type }));
const meta = { schema: { fields }, numRows: "3", lastModifiedTime: "1" };
const row = (id, day, adds) => ({ f: [id, day, adds].map((v) => ({ v: String(v) })) });
function fakeApi(pages, overrideMeta = meta) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      const target = new URL(url);
      calls.push(target);
      expect(target.origin).toBe("https://bigquery.googleapis.com");
      expect(options.method).toBe("GET");
      expect(options.headers.Authorization).toBe("Bearer offline-token");
      return Response.json(target.pathname.endsWith("/data") ? pages.shift() : overrideMeta);
    },
  };
}

test("tabledata pagination exports every row to typed local Parquet using only GETs", async () => {
  const out = fixture();
  const api = fakeApi([
    { totalRows: "3", rows: [row(1, "2026-05-30", 1), row(2, "2026-06-01", 2)], pageToken: "next/+" },
    { totalRows: "3", rows: [row(1, "2026-09-30", 4)] },
  ]);
  const summary = await exportGapTable({ table, out, token: "offline-token", fetcher: api.fetcher });
  expect(summary).toMatchObject({ rows: 3, pages: 2, status: "REHEARSAL ONLY; NOT PUBLISHABLE" });
  expect(api.calls).toHaveLength(4);
  expect(api.calls[2].searchParams.get("pageToken")).toBe("next/+");
  const db = await DuckDBInstance.create();
  const con = await db.connect();
  try {
    const reader = await con.runAndReadAll(`SELECT count(*) n, sum(gross_adds) adds, min(day)::VARCHAR lo, max(day)::VARCHAR hi FROM read_parquet('${join(out, "pipeline-data/star_daily_gross/gap-260530-260930.parquet")}')`);
    expect(reader.getRowObjects()).toEqual([{ n: 3n, adds: 7n, lo: "2026-05-30", hi: "2026-09-30" }]);
  } finally { con.closeSync(); db.closeSync(); }
});

test("truncated, duplicated, repeated-token and out-of-scope exports never produce Parquet", async () => {
  const cases = [
    [[{ totalRows: "3", rows: [row(1, "2026-05-30", 1)] }], "truncated"],
    [[{ totalRows: "3", rows: [row(1, "2026-05-30", 1), row(1, "2026-05-30", 1)] }], "duplicate gap key"],
    [[{ totalRows: "3", rows: [row(999, "2026-05-30", 1)] }], "outside the fixed whitelist"],
    [[{ totalRows: "3", rows: [row(1, "2026-10-01", 1)] }], "outside approved interval"],
    [[{ totalRows: "3", rows: [row(1, "2026-05-30", 1)], pageToken: "same" }, { totalRows: "3", rows: [row(2, "2026-05-30", 1)], pageToken: "same" }], "repeated BigQuery page token"],
  ];
  for (const [pages, error] of cases) {
    const out = fixture();
    const api = fakeApi(pages);
    await expect(exportGapTable({ table, out, token: "offline-token", fetcher: api.fetcher })).rejects.toThrow(error);
    expect(existsSync(join(out, "pipeline-data/star_daily_gross/gap-260530-260930.parquet"))).toBe(false);
  }
  const api = fakeApi([]);
  await expect(exportGapTable({ table: "gitstarclub.gitstarclub.star_daily_gross", out: fixture(), token: "offline-token", fetcher: api.fetcher })).rejects.toThrow("dated gap table");
  expect(api.calls).toHaveLength(0);
});

test("the source table cannot change during a local export", async () => {
  const out = fixture();
  let metadataReads = 0;
  const fetcher = async (url) => {
    if (new URL(url).pathname.endsWith("/data")) return Response.json({ totalRows: "3", rows: [row(1, "2026-05-30", 1), row(2, "2026-06-01", 2), row(1, "2026-09-30", 4)] });
    return Response.json({ ...meta, lastModifiedTime: String(++metadataReads) });
  };
  await expect(exportGapTable({ table, out, token: "offline-token", fetcher })).rejects.toThrow("table modified");
  expect(existsSync(join(out, "pipeline-data/star_daily_gross/gap-260530-260930.parquet"))).toBe(false);
});

test("backup checksum verification refuses changed bytes, duplicate paths and traversal", () => {
  const directory = fixture();
  const name = "data-000000000000.parquet";
  writeFileSync(join(directory, name), "fixture");
  const digest = createHash("sha256").update("fixture").digest("hex");
  const header = "name\tbytes\tsha256\tcrc32c\tmd5\n";
  const line = `star_daily_gross/${name}\t7\t${digest}\tunused\tunused\n`;
  expect(verifiedBackup(header + line, directory)[0].sha256).toBe(digest);
  expect(() => verifiedBackup(header + line + line, directory)).toThrow("duplicate manifest path");
  expect(() => verifiedBackup(header + line.replace("star_daily_gross/", "../"), directory)).toThrow("unsafe manifest path");
  writeFileSync(join(directory, name), "changed");
  expect(() => verifiedBackup(header + line, directory)).toThrow("SHA-256 mismatch");
  expect(() => whitelistIds([{ repo_id: 1 }, { repo_id: "1" }])).toThrow("duplicate");
  expect(() => whitelistIds([{ repo_id: null }])).toThrow("invalid whitelist");
});

function repository(id) {
  return { id, node_id: `node-${id}`, owner: "fixture", owner_type: "Organization", name: `repo-${id}`, full_name: `fixture/repo-${id}`, current_stars: 10000, created_at: "2020-01-01", fetched_at: "2026-09-23T00:00:00Z", active: true, topics: [] };
}
test("snapshot assembly preserves ids, inactive history and fallback provenance without fresh metadata", () => {
  const canonical = { "1": repository(1), "2": repository(2), "999": repository(999) };
  const entity = { ...repository(3), active: false, curve: { monthly: [] }, monthly_table: [] };
  const result = assembleRepos([1, 2, 3], canonical, { "1": {}, "2": { active: false }, "3": {} }, { generated_at: "2026-09-13T00:00:00Z" }, () => entity);
  expect(result.repos.map((repo) => repo.id)).toEqual([1, 2, 3]);
  expect(result.repos.map((repo) => repo.active)).toEqual([true, false, false]);
  expect(canonical["2"].active).toBe(true);
  expect(result.repos[2]).toMatchObject({ fetched_at: "2026-09-13T00:00:00Z", tracked_since: null });
  expect(Buffer.from(result.repos[2].node_id, "base64").toString()).toBe("010:Repository3");
  expect(result.repos[2].curve).toBeUndefined();
  expect(result.fallbacks.map((repo) => repo.id)).toEqual([3]);
  expect(() => assembleRepos([1], {}, { "1": {} }, {}, () => repository(2))).toThrow("id mismatch");
});

test("retained snapshots record hashes; cached explicit 404 remains unavailable on a retry", () => {
  const out = fixture();
  const cached = fixture();
  const body = JSON.stringify({ cells: [["2026-06-01", 7]] });
  writeFileSync(join(cached, "heatmap.json"), body);
  const reader = snapshotReader(out, cached);
  expect(reader.read("heatmap.json", "https://data.invalid/example").cells).toEqual([["2026-06-01", 7]]);
  expect(reader.records[0].sha256).toBe(createHash("sha256").update(body).digest("hex"));
  writeFileSync(join(out, "snapshots/missing.json.status.json"), JSON.stringify({ status: 404 }));
  expect(reader.read("missing.json", "https://data.invalid/missing", true)).toBeNull();
  expect(() => reader.read("missing.json", "https://data.invalid/missing")).toThrow("required snapshot unavailable");
  expect(readFileSync(join(out, "snapshots/heatmap.json"), "utf8")).toBe(body);
});
