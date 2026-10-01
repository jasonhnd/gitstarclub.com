import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const webRoot = join(import.meta.dir, "..", "..");
const fixtureRoot = join(webRoot, "scripts", "fixtures", "views");
const generation = "offline-20260717";
const generationRoot = `live/generations/${generation}/`;
const scripts = ["generate-data-exports.ts", "validate-live-views.ts"] as const;
type Tool = (typeof scripts)[number];

function fixtureJson(path: string): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, path), "utf8"));
}

function startFixture() {
  const rank = fixtureJson("rank/month/2026-07/repo/flow.json");
  const views: Record<string, unknown> = {
    "meta.json": fixtureJson("meta.json"),
    "lookup/repos.json": fixtureJson("lookup/repos.json"),
    "lookup/orgs.json": fixtureJson("lookup/orgs.json"),
    "entity/repo/1.json": fixtureJson("entity/repo/1.json"),
    "rank/month/2026-07/repo/flow.json": rank,
    [`${generationRoot}rank/month/2026-07/repo/flow.json`]: rank,
    [`${generationRoot}current_month.json`]: fixtureJson("current_month.json"),
    [`${generationRoot}hot-snapshot.json`]: fixtureJson("hot-snapshot.json"),
    "live/latest.json": {
      schema_ver: 1, generation, run_id: generation, idempotency_key: "offline",
      job: "daily", day: "2026-07-17", month: "2026-07", week: "2026-W29",
      published_at: "2026-07-17T00:00:00.000Z", previous_generation: null, lease: null,
    },
    "rank/all-time/repo/stock.json": {
      meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: "2026-07-17T00:00:00.000Z" },
      items: [{ rank: 1, id: 1, value: 100, prev_rank: null }],
    },
    "rank/all-time/org/stock.json": {
      meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: "2026-07-17T00:00:00.000Z" },
      items: [{ rank: 1, login: "example", value: 100, prev_rank: null }],
    },
  };
  const requests: Array<{ method: string; path: string; bust: string | null }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname, bust: url.searchParams.get("v") });
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
      const key = url.pathname.replace(/^\/data\//, "");
      if (!Object.hasOwn(views, key)) return new Response(null, { status: 404 });
      return Response.json(views[key]);
    },
  });
  return { server, requests, base: `${server.url.origin}/data` };
}

async function runTool(tool: Tool, env: Record<string, string>) {
  // The copied entry point writes exports only in this temporary web root.
  // No owner env file, data exports, or inherited credentials enter the child.
  const sandbox = mkdtempSync(join(tmpdir(), "gsc-r2-data-tools-"));
  try {
    mkdirSync(join(sandbox, "scripts"));
    copyFileSync(join(webRoot, "scripts", tool), join(sandbox, "scripts", tool));
    copyFileSync(join(webRoot, "tsconfig.json"), join(sandbox, "tsconfig.json"));
    symlinkSync(join(webRoot, "node_modules"), join(sandbox, "node_modules"), "dir");
    symlinkSync(join(webRoot, "lib"), join(sandbox, "lib"), "dir");
    symlinkSync(join(webRoot, "scripts", "lib"), join(sandbox, "scripts", "lib"), "dir");
    const child = Bun.spawn({
      cmd: [process.execPath, `scripts/${tool}`, ...(tool === "generate-data-exports.ts" ? ["--month", "2026-07"] : ["--bust", "offline"])],
      cwd: sandbox,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 20_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      const files: Record<string, string> = {};
      const dated = join(sandbox, "public", "data", "exports", "v1", "2026-07-17");
      for (const name of ["manifest.json", "top-rankings.json", "top-rankings.csv"]) {
        const path = join(dated, name);
        if (existsSync(path)) files[name] = readFileSync(path, "utf8");
      }
      return { stdout, stderr, exitCode, files };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

describe("read-only data tools without Blob variables", () => {
  test("exports CSV and JSON through R2 with no Blob environment", async () => {
    const fixture = startFixture();
    try {
      const env = { STORAGE_READ_DRIVER: "r2", R2_PUBLIC_BASE_URL: ` ${fixture.base}/ ` };
      expect(Object.keys(env).some((key) => key.includes("BLOB_"))).toBe(false);
      const result = await runTool("generate-data-exports.ts", env);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, export_date: "2026-07-17" });
      expect(JSON.parse(result.files["manifest.json"])).toMatchObject({ export_date: "2026-07-17", schema_version: 1 });
      expect(result.files["top-rankings.csv"]).toContain("example/repo");
      expect(JSON.parse(result.files["top-rankings.json"]).rows).toHaveLength(2);
      expect(fixture.requests.some((request) => request.path === "/data/lookup/repos.json")).toBe(true);
      expect(fixture.requests.every((request) => request.method === "GET")).toBe(true);
    } finally {
      fixture.server.stop(true);
    }
  }, 30_000);

  test("validates the published live generation through the R2 driver alias", async () => {
    const fixture = startFixture();
    try {
      const result = await runTool("validate-live-views.ts", { READ_DRIVER: "r2", R2_PUBLIC_BASE_URL: fixture.base });
      expect(result.exitCode, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({ ok: true, generation, legacy_layout: false, storage_read_driver: "r2", public_read_base: fixture.base });
      expect(summary.views).toHaveLength(2);
      expect(summary.views.every((view: { ok: boolean }) => view.ok)).toBe(true);
      expect(fixture.requests.map((request) => request.path).sort()).toEqual([
        `/data/${generationRoot}current_month.json`, `/data/${generationRoot}hot-snapshot.json`, "/data/live/latest.json",
      ].sort());
      expect(fixture.requests.every((request) => request.method === "GET" && request.bust === "offline")).toBe(true);
    } finally {
      fixture.server.stop(true);
    }
  }, 30_000);

  test("preserves the default Blob and NEXT_PUBLIC_BLOB_BASE_URL paths", async () => {
    const fixture = startFixture();
    try {
      for (const tool of scripts) {
        const cases: Record<string, string>[] = [
          { BLOB_BASE_URL: fixture.base },
          { NEXT_PUBLIC_BLOB_BASE_URL: fixture.base },
          { BLOB_BASE_URL: " ", NEXT_PUBLIC_BLOB_BASE_URL: fixture.base },
        ];
        for (const env of cases) {
          const result = await runTool(tool, env);
          expect(result.exitCode, `${tool}: ${result.stderr}`).toBe(0);
          expect(JSON.parse(result.stdout).ok).toBe(true);
        }
      }
    } finally {
      fixture.server.stop(true);
    }
  }, 30_000);

  test("rejects missing or invalid R2 configuration before any request, even with a Blob base", async () => {
    const fixture = startFixture();
    try {
      for (const tool of scripts) {
        const cases: Record<string, string>[] = [
          { STORAGE_READ_DRIVER: "r2", BLOB_BASE_URL: fixture.base },
          { STORAGE_READ_DRIVER: "r2", R2_PUBLIC_BASE_URL: "ftp://127.0.0.1/data", BLOB_BASE_URL: fixture.base },
        ];
        for (const env of cases) {
          const result = await runTool(tool, env);
          expect(result.exitCode).not.toBe(0);
          expect(`${result.stdout}\n${result.stderr}`).toMatch(/R2_PUBLIC_BASE_URL not set|must be an http\(s\) URL/);
        }
      }
      expect(fixture.requests).toHaveLength(0);
    } finally {
      fixture.server.stop(true);
    }
  }, 30_000);
});
