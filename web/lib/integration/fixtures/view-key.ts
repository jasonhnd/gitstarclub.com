// Strip only the suite's version prefix; pointer and other-version keys stay intact.
export function viewKey(input: RequestInfo | URL, version: string): string {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const path = url.pathname.replace(/^\/+/, "");
  const prefix = `views/${version}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
