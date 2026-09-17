/**
 * Paths the P1–P2 Worker shell still owns after P3 hosts the Next app.
 * `/` is the Next homepage — start refresh only at `/start`.
 */
export const WORKER_SHELL_PUBLIC_GET_PATHS = [
  "/preview/identity",
  "/preview/health",
  "/.well-known/deployment",
] as const;

export type WorkerRequestClass = "shell" | "next";

export function normalizeWorkerPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname || "/";
}

export function classifyWorkerRequest(pathname: string, method: string): WorkerRequestClass {
  const path = normalizeWorkerPathname(pathname);
  const verb = method.toUpperCase();

  if ((WORKER_SHELL_PUBLIC_GET_PATHS as readonly string[]).includes(path) && verb === "GET") {
    return "shell";
  }
  if (path === "/start" && (verb === "GET" || verb === "POST")) {
    return "shell";
  }
  if (path === "/enqueue" && verb === "POST") {
    return "shell";
  }
  if (path === "/preview/invalidate" && verb === "POST") {
    return "shell";
  }
  return "next";
}

export function isWorkerShellRequest(pathname: string, method: string): boolean {
  return classifyWorkerRequest(pathname, method) === "shell";
}
