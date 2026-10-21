import { describe, expect, test } from "bun:test";
import {
  classifyWorkerRequest,
  isPublicationIndependentRequest,
  isWorkerShellRequest,
  normalizeWorkerPathname,
} from "./shell-routes";

describe("worker host routing", () => {
  test("keeps the homepage and rankings on the Next app", () => {
    expect(classifyWorkerRequest("/", "GET")).toBe("next");
    expect(classifyWorkerRequest("/rankings", "GET")).toBe("next");
    expect(classifyWorkerRequest("/pulse", "GET")).toBe("next");
    expect(classifyWorkerRequest("/api/cron/daily", "GET")).toBe("next");
    expect(classifyWorkerRequest("/search-index", "GET")).toBe("next");
    expect(isWorkerShellRequest("/", "POST")).toBe(false);
  });

  test("keeps P1–P2 shell routes off the Next app", () => {
    expect(classifyWorkerRequest("/preview/health", "GET")).toBe("shell");
    expect(classifyWorkerRequest("/preview/identity", "GET")).toBe("shell");
    expect(classifyWorkerRequest("/.well-known/deployment", "GET")).toBe("shell");
    expect(classifyWorkerRequest("/start", "GET")).toBe("shell");
    expect(classifyWorkerRequest("/start", "POST")).toBe("shell");
    expect(classifyWorkerRequest("/enqueue", "POST")).toBe("shell");
    expect(classifyWorkerRequest("/preview/invalidate", "POST")).toBe("shell");
  });

  test("does not treat unauthenticated-looking shell verbs as Next misses", () => {
    expect(classifyWorkerRequest("/preview/health", "POST")).toBe("next");
    expect(classifyWorkerRequest("/enqueue", "GET")).toBe("next");
    expect(normalizeWorkerPathname("/preview/health/")).toBe("/preview/health");
  });

  test("only explicit non-data handlers bypass publication reads", () => {
    for (const [path, method] of [
      ["/api/lang", "GET"],
      ["/api/lang/", "HEAD"],
      ["/api/workflows/refresh/revalidate/", "post"],
    ]) expect(isPublicationIndependentRequest(path, method)).toBe(true);

    for (const [path, method] of [
      ["/api/lang/extra", "GET"],
      ["/api/lang", "POST"],
      ["/api/workflows/refresh/revalidate", "GET"],
      ["/api/cron/daily", "GET"],
      ["/api/cron/weekly", "GET"],
      ["/api/workflows/refresh/start", "GET"],
      ["/api/workflows/refresh/step", "POST"],
      ["/api/workflows/refresh/rollback", "POST"],
      ["/search-index", "GET"],
      ["/repo-curve", "GET"],
      ["/rankings", "HEAD"],
    ]) expect(isPublicationIndependentRequest(path, method)).toBe(false);
  });
});
