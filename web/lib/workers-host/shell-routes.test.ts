import { describe, expect, test } from "bun:test";
import {
  classifyWorkerRequest,
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
});
