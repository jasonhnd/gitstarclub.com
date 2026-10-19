import { resolve } from "node:path";

let version = "run-a";
const counts = new Map<string, number>();
const root = resolve("scripts/fixtures/views");
const server = Bun.serve({
  hostname: "127.0.0.1", port: 4074,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__control" && request.method === "POST") {
      const next = (await request.json()).version;
      if (!["run-a", "run-b"].includes(next)) return new Response("Invalid fixture version", { status: 400 });
      version = next;
      return Response.json({ version });
    }
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    if (url.pathname === "/__stats") return Response.json({ version, counts: Object.fromEntries(counts) });
    counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
    if (url.pathname === "/_health") return Response.json({ ok: true });
    if (url.pathname === "/views/latest.json") return Response.json({
      version, published_at: version === "run-a" ? "2026-10-18T00:00:00Z" : "2026-10-19T00:00:00Z",
    });
    const match = url.pathname.match(/^\/views\/(run-a|run-b)\/(.+)$/);
    const file = resolve(root, match?.[2] ?? url.pathname.slice(1));
    if (!file.startsWith(root + "/")) return new Response(null, { status: 400 });
    const source = Bun.file(file);
    if (!await source.exists()) return new Response(null, { status: 404 });
    const body = await source.json();
    if (match?.[1] === "run-b" && match[2] === "entity/repo/1.json") {
      body.current_stars = 200;
      body.description = "Published fixture repository";
    }
    if (match?.[1] === "run-b" && match[2] === "lookup/repos.json") body["1"].current_stars = 200;
    if (match?.[1] === "run-b" && match[2] === "meta.json") body.generated_at = "2026-10-19T00:00:00.000Z";
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  },
});
console.log(`Local precomputed-JSON proof fixture: ${server.url.origin}`);
