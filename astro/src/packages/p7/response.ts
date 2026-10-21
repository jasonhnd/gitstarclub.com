// Existing API responses vary on the legacy router selectors even though these
// endpoints do not render a client router. Keep the public header contract.
export const LEGACY_API_VARY = [
  "RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch", "Next-Url",
  "X-Vinext-Interception-Context", "X-Vinext-Interception-Id", "X-Vinext-Mounted-Slots",
  "X-Vinext-Rsc-Render-Mode", "X-Vinext-Rsc-State-Fingerprint",
].join(", ");

export function operationResponse(response: Response, request: Request, build: string): Response {
  const headers = new Headers(response.headers);
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!(path === "/api/lang" && ["GET", "HEAD"].includes(request.method))) headers.set("Vary", LEGACY_API_VARY);
  // The value identifies this build, as before; it naturally changes on migration.
  headers.set("X-Vinext-Build-Id", build.slice(0, 32));
  return new Response(response.body, { status: response.status, headers });
}
