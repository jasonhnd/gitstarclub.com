/// <reference types="bun" />

const port = Number(process.env.PORT ?? "4010");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid fixture server PORT: ${process.env.PORT ?? ""}`);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json(
        { error: "The CI build fixture is read-only." },
        { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/_health") {
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    // The production build must tolerate unavailable optional views and render its
    // checked-in route registry and empty states. No live Blob data is needed here.
    return Response.json(
      { error: "View intentionally absent from the bounded CI build fixture." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  },
});

console.log(`Read-only CI build fixture listening on ${server.url.origin}`);
