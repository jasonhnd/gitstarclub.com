import { resolve, sep } from "node:path";

const root = resolve(process.env.VISUAL_FIXTURE_ROOT!);
Bun.serve({
  hostname: "127.0.0.1",
  port: 4010,
  async fetch(request) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const pathname = new URL(request.url).pathname;
    if (pathname === "/_health") return Response.json({ ok: true });
    const path = resolve(root, "." + decodeURIComponent(pathname));
    if (path.startsWith(root + sep) && pathname.endsWith(".json")) {
      const file = Bun.file(path);
      if (await file.exists()) {
        return new Response(request.method === "HEAD" ? null : file, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }
    return Response.json({ error: "View absent from the bounded local fixture." }, { status: 404 });
  },
});
console.log("Read-only visual fixture listening on http://127.0.0.1:4010");
