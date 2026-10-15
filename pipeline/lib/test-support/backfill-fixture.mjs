// @ts-nocheck -- Disposable offline subprocess fixtures, outside production code.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const root = fileURLToPath(new URL("../../..", import.meta.url));
export const GENERATION = "bootstrap-20260717T120000Z";
export const NEXT_GENERATION = "bootstrap-20260718T120000Z";
export const REPOSITORIES = [
  { id: 132750724, node_id: "node-top", owner: "acme", owner_type: "Organization", name: "top", current_stars: 100000, language: "TypeScript" },
  { id: 11730342, node_id: "node-vue", owner: "vuejs", owner_type: "Organization", name: "vue", current_stars: 60000, language: null },
  { id: 33, node_id: "node-idle", owner: "acme", owner_type: "Organization", name: "idle", current_stars: 10000, language: "JavaScript" },
].map((repo) => ({
  ...repo, full_name: `${repo.owner}/${repo.name}`, description: null, topics: ["offline-fixture"],
  created_at: "2020-01-01T00:00:00.000Z", is_archived: false, active: true, tracked_since: null,
  fetched_at: "2026-07-17T12:00:00.000Z",
}));

export function createBackfillFixture() {
  const directory = mkdtempSync(join(tmpdir(), "gsc-backfill-"));
  const pipeline = join(directory, "pipeline");
  const data = join(pipeline, "data");
  const web = join(directory, "web");
  mkdirSync(join(pipeline, "lib"), { recursive: true });
  mkdirSync(data);
  mkdirSync(web);
  cpSync(join(root, "pipeline/backfill"), join(pipeline, "backfill"), { recursive: true });
  // Copy named source modules, never the owner's data or environment files.
  for (const name of readdirSync(join(root, "pipeline/lib"))) {
    if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) {
      cpSync(join(root, "pipeline/lib", name), join(pipeline, "lib", name));
    }
  }
  symlinkSync(join(root, "pipeline/node_modules"), join(pipeline, "node_modules"), "dir");
  for (const name of ["lib", "scripts", "node_modules"]) {
    symlinkSync(join(root, "web", name), join(web, name), "dir");
  }
  cpSync(join(root, "web/tsconfig.json"), join(web, "tsconfig.json"));
  cpSync(join(root, "pipeline/lib/test-support/offline-fetch.mjs"), join(directory, "offline-fetch.mjs"));
  const configPath = join(directory, "config.json");
  const tracePath = join(directory, "trace.jsonl");
  const remotePath = join(directory, "remote.json");
  let config = { repositories: REPOSITORIES };
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(tracePath, "");
  writeFileSync(remotePath, "{}");

  return {
    directory, pipeline, data,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
    configure(overrides) {
      config = { ...config, ...overrides };
      writeFileSync(configPath, JSON.stringify(config));
    },
    writeData(path, value) {
      writeFileSync(join(data, path), JSON.stringify(value));
    },
    readData: (path) => JSON.parse(readFileSync(join(data, path), "utf8")),
    trace() {
      return readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
    clearTrace: () => writeFileSync(tracePath, ""),
    remote: () => JSON.parse(readFileSync(remotePath, "utf8")),
    readRemote(path) {
      const value = this.remote()[path];
      return value === undefined ? null : JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    },
    setRemote(path, value) {
      const objects = this.remote();
      objects[path] = Buffer.from(JSON.stringify(value)).toString("base64");
      writeFileSync(remotePath, JSON.stringify(objects));
    },
    seedR2(target = "pre") {
      this.configure({ r2: true });
      this.setRemote("_meta/bucket-identity.json", { bucket: `fixture-${target}`, deploy_env: target === "prod" ? "production" : "pre" });
      return {
        R2_BUCKET: `fixture-${target}`, R2_S3_ENDPOINT: "https://r2.invalid",
        R2_ACCESS_KEY_ID: "offline-fixture-access", R2_SECRET_ACCESS_KEY: "offline-fixture-secret",
      };
    },
    run(script, args = [], env = {}) {
      return spawnSync("node", ["--import", join(directory, "offline-fetch.mjs"), join(pipeline, "backfill", script), ...args], {
        cwd: pipeline, encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: process.env.PATH, HOME: directory, TMPDIR: directory, TZ: "Pacific/Auckland",
          BACKFILL_FIXTURE_CONFIG: configPath, BACKFILL_FIXTURE_TRACE: tracePath,
          BACKFILL_FIXTURE_REMOTE: remotePath, ...env,
        },
      });
    },
    async seedParquet() {
      const grossDir = join(data, "star_daily_gross");
      mkdirSync(grossDir);
      const db = await DuckDBInstance.create();
      const con = await db.connect();
      try {
        const path = join(grossDir, "part.parquet").replaceAll("'", "''");
        await con.run(`COPY (SELECT * FROM (VALUES
          (132750724, DATE '2024-02-28', 9000), (132750724, DATE '2024-02-29', 1000),
          (132750724, DATE '2025-12-31', 40000), (132750724, DATE '2026-01-01', 50000),
          (11730342, DATE '2024-02-28', 10000), (11730342, DATE '2024-03-01', 10000),
          (11730342, DATE '2025-12-31', 30000), (11730342, DATE '2026-01-01', 20000),
          (33, DATE '2024-03-01', 10000)
        ) AS facts(repo_id, day, gross_adds)) TO '${path}' (FORMAT PARQUET)`);
      } finally {
        con.closeSync();
        db.closeSync();
      }
      this.writeData("repos.json", REPOSITORIES);
    },
    seedViews() {
      cpSync(join(root, "web/scripts/fixtures/views"), join(data, "views"), { recursive: true });
    },
  };
}
