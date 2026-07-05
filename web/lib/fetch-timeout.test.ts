import { describe, expect, test } from "bun:test";
import { FetchTimeoutError, fetchWithTimeout } from "./fetch-timeout.mjs";

describe("fetchWithTimeout", () => {
  test("aborts a stalled request and rejects with FetchTimeoutError", async () => {
    let signal: AbortSignal | undefined;

    await expect(
      fetchWithTimeout("https://api.example.com/slow", {
        timeoutMs: 5,
        fetcher: (_input: RequestInfo | URL, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          return new Promise<Response>(() => {});
        },
      }),
    ).rejects.toThrow("fetch timed out after 5ms");

    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(FetchTimeoutError);
  });

  test("returns HTTP responses without converting status failures into timeout errors", async () => {
    const res = await fetchWithTimeout("https://api.example.com/unavailable", {
      timeoutMs: 50,
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });

    expect(res.status).toBe(503);
  });
});
