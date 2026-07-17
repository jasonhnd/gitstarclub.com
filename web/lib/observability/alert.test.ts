// Unit tests for the dependency-free observability surface (alert.ts).
// All best-effort exports must NEVER throw: webhook + Blob failures are swallowed.
// We stub @/lib/data/write (putView) via mock.module, spy on console.error, and
// swap global.fetch per-case. Env + mocks are reset between tests.
import { test, expect, describe, mock, spyOn, beforeEach, afterEach } from "bun:test";

// --- Stub the Blob writer so recordHealth never touches @vercel/blob. -----------
// putView is reassigned per-test via this mutable ref; the module mock reads it lazily.
let putViewImpl: (path: string, data: unknown) => Promise<void> = async () => {};
mock.module("@/lib/data/write", () => ({
  putView: (path: string, data: unknown) => putViewImpl(path, data),
  createView: async () => true,
}));

// Import AFTER registering the module mock so alert.ts binds to the stub.
const { sendAlert, recordHealth } = await import("./alert");

const SUMMARY = {
  pipeline: "cron-daily",
  title: "managed refresh failed",
  run_id: "run-123",
  step: "fetchStarCounts",
  error: "boom",
} as const;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WEBHOOK = process.env.ALERT_WEBHOOK_URL;

let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  putViewImpl = async () => {};
  delete process.env.ALERT_WEBHOOK_URL;
});

afterEach(() => {
  errSpy.mockRestore();
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_WEBHOOK === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

describe("sendAlert", () => {
  test("always logs a greppable [ALERT] line", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendAlert(SUMMARY);

    expect(errSpy).toHaveBeenCalled();
    const firstArg = errSpy.mock.calls[0]?.[0] as string;
    expect(firstArg).toContain("[ALERT]");
    expect(firstArg).toContain("cron-daily");
  });

  test("does NOT fetch when ALERT_WEBHOOK_URL is unset", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // env deliberately left unset by beforeEach

    await expect(sendAlert(SUMMARY)).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("POSTs to ALERT_WEBHOOK_URL with a JSON body when set", async () => {
    const url = "https://hooks.example.com/alert";
    process.env.ALERT_WEBHOOK_URL = url;
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendAlert(SUMMARY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.pipeline).toBe("cron-daily");
    expect(body.text).toContain("[ALERT]");
    expect(body.text).toContain("managed refresh failed");
    expect(body.run_id).toBe("run-123");
    expect(body.step).toBe("fetchStarCounts");
    expect(body.error).toBe("boom");
    expect(typeof body.at).toBe("string");
  });

  test("a webhook that rejects does NOT propagate", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const fetchMock = mock(async () => {
      throw new Error("network down");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // sendAlert must still resolve (no throw) even though fetch rejected.
    await expect(sendAlert(SUMMARY)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // It logged the delivery failure (in addition to the primary [ALERT] line).
    const logged = (errSpy.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(logged.some((l) => l.includes("webhook delivery failed"))).toBe(true);
  });

  test("tolerates a summary with no optional fields (run_id/step/error)", async () => {
    await expect(
      sendAlert({ pipeline: "workflow-refresh", title: "bare" }),
    ).resolves.toBeUndefined();
    const firstArg = errSpy.mock.calls[0]?.[0] as string;
    expect(firstArg).toContain("workflow-refresh");
  });
});

describe("recordHealth", () => {
  test("writes health.json via putView on the happy path", async () => {
    const calls: Array<{ path: string; data: unknown }> = [];
    putViewImpl = async (path, data) => {
      calls.push({ path, data });
    };

    await expect(recordHealth("cron-weekly", "ok", { run_id: "r9" })).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("ops/workflows/health.json");
    const data = calls[0].data as Record<string, unknown>;
    expect(data.pipeline).toBe("cron-weekly");
    expect(data.status).toBe("ok");
    expect(data.run_id).toBe("r9");
    expect(data.error).toBeNull();
    expect(typeof data.at).toBe("string");
  });

  test("swallows a putView failure (does NOT propagate)", async () => {
    putViewImpl = async () => {
      throw new Error("blob write failed");
    };

    await expect(
      recordHealth("cron-daily", "failed", { error: "upstream 500" }),
    ).resolves.toBeUndefined();

    const logged = (errSpy.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(logged.some((l) => l.includes("health write failed"))).toBe(true);
  });
});
