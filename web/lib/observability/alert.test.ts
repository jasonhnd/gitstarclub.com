import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { sendAlert, type AlertFetcher } from "./alert";

const SUMMARY = {
  pipeline: "cron-daily",
  title: "managed refresh failed",
  run_id: "run-123",
  step: "fetchStarCounts",
  error: "boom",
} as const;

const ORIGINAL_WEBHOOK = process.env.ALERT_WEBHOOK_URL;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  delete process.env.ALERT_WEBHOOK_URL;
});

afterEach(() => {
  errSpy.mockRestore();
  if (ORIGINAL_WEBHOOK === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

describe("sendAlert", () => {
  test("always logs and reports disabled delivery when no webhook is configured", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));

    const result = await sendAlert(SUMMARY, { fetch: fetchMock as unknown as AlertFetcher });

    expect(result).toEqual({
      status: "disabled",
      attempts: 0,
      status_code: null,
      error: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("[ALERT] cron-daily failed");
  });

  test("reports a successful 2xx delivery and sends the correlation payload", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const fetchMock = mock(async () => new Response(null, { status: 204 }));

    const result = await sendAlert(SUMMARY, {
      fetch: fetchMock as unknown as AlertFetcher,
      now: new Date("2026-07-17T03:00:00.000Z"),
    });

    expect(result).toEqual({
      status: "delivered",
      attempts: 1,
      status_code: 204,
      error: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/alert");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toMatchObject({
      pipeline: "cron-daily",
      run_id: "run-123",
      step: "fetchStarCounts",
      error: "boom",
      at: "2026-07-17T03:00:00.000Z",
    });
  });

  test("treats a non-retryable 4xx response as failed delivery", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const fetchMock = mock(async () => new Response("unauthorized", { status: 401 }));

    const result = await sendAlert(SUMMARY, {
      fetch: fetchMock as unknown as AlertFetcher,
      sleep: async () => {},
    });

    expect(result).toEqual({
      status: "failed",
      attempts: 1,
      status_code: 401,
      error: "HTTP 401",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries 5xx responses with bounded backoff and never reports success", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const delays: number[] = [];
    const fetchMock = mock(async () => new Response(null, { status: 503 }));

    const result = await sendAlert(SUMMARY, {
      fetch: fetchMock as unknown as AlertFetcher,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    expect(result).toEqual({
      status: "failed",
      attempts: 3,
      status_code: 503,
      error: "HTTP 503",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 250]);
  });

  test("retries a timeout and returns an explicit failed-delivery state", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const fetchMock = mock(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const result = await sendAlert(SUMMARY, {
      fetch: fetchMock as unknown as AlertFetcher,
      sleep: async () => {},
      timeoutMs: 1,
      maxAttempts: 2,
    });

    expect(result).toEqual({
      status: "failed",
      attempts: 2,
      status_code: null,
      error: "timeout",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries network failures and redacts URLs from diagnostics", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/alert";
    const fetchMock = mock(async () => {
      throw new Error("request to https://hooks.example.com/alert?token=secret failed");
    });

    const result = await sendAlert(SUMMARY, {
      fetch: fetchMock as unknown as AlertFetcher,
      sleep: async () => {},
      maxAttempts: 2,
    });

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(2);
    expect(result.error).toContain("[redacted-url]");
    expect(result.error).not.toContain("hooks.example.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
