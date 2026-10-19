import { resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "fixtures/views");
const port = Number(process.argv[2] ?? "4075");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local fixture port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  async fetch(request) {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const path = new URL(request.url).pathname;
    if (path === "/_health") return Response.json({ ok: true });
    const filePath = resolve(root, "." + decodeURIComponent(path));
    if (filePath.startsWith(root + sep) && path.endsWith(".json")) {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(request.method === "HEAD" ? null : file, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Absent from existing bounded local fixtures" }, { status: 404 });
  },
});
console.log(`Read-only view fixture: ${server.url.origin}`);
