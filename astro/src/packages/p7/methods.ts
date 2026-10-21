import type { APIRoute } from "astro";

const methods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

/** Preserve the original framework's implicit OPTIONS and unsupported verbs. */
export function optionsFor(method: "GET" | "POST"): APIRoute {
  return () => new Response(null, {
    status: 204, headers: { Allow: method === "GET" ? "GET, HEAD, OPTIONS" : "OPTIONS, POST" },
  });
}
export const unsupportedMethod: APIRoute = ({ request }) => new Response(null, {
  status: methods.has(request.method.toUpperCase()) ? 405 : 400,
});
