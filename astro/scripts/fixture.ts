import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../web/scripts/fixtures/views/", import.meta.url));
export function fixtureRecords(version = "fixture-v1", publishedAt = "2026-07-17T00:00:00.000Z"): Map<string, string> {
  const records = new Map<string, string>();
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const key = relative(root, path).replaceAll("\\", "/");
        let body = readFileSync(path, "utf8");
        if (key === "meta.json") body = JSON.stringify({ ...JSON.parse(body), generated_at: publishedAt });
        records.set(key, body);
        records.set(`views/${version}/${key}`, body);
      }
    }
  }
  walk(root);
  records.set("views/latest.json", JSON.stringify({ version, run_id: version, published_at: publishedAt, prev_version: null, schema_ver: 1 }));
  return records;
}

/** HTTP is strictly read-only. Test setup alone can seed the local simulator. */
export function startFixture(records = fixtureRecords(), port = 0) {
  return Bun.serve({
    hostname: "127.0.0.1", port,
    fetch(request) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      const path = new URL(request.url).pathname.slice(1);
      const body = path === "_health" ? '{"ok":true}' : records.get(path);
      const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: `"${createHash("sha256").update(body ?? "absent").digest("hex")}"` };
      return new Response(request.method === "HEAD" ? null : body ?? '{"error":"Fixture view absent"}', { status: body === undefined ? 404 : 200, headers });
    },
  });
}

if (import.meta.main) {
  const server = startFixture(undefined, Number(process.env.GSC_FIXTURE_PORT ?? 4010));
  console.log(`Read-only Astro/web fixture: ${server.url.origin}`);
}
