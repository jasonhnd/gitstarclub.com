import { afterEach, describe, expect, mock, test } from "bun:test";
import { FetchTimeoutError, fetchWithTimeout, isFetchTimeoutError } from "./fetch-timeout";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchWithTimeout", () => {
  test("aborts a stalled request with a distinguishable timeout error", async () => {
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchWithTimeout("https://example.com/stall", {}, { timeoutMs: 1, label: "test fetch" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FetchTimeoutError);
    expect(isFetchTimeoutError(caught)).toBe(true);
    expect((caught as FetchTimeoutError).message).toContain("test fetch timed out");
  });

  test("does not convert an upstream abort into a timeout", async () => {
    const upstream = new AbortController();
    const upstreamError = new Error("caller cancelled");
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        upstream.abort(upstreamError);
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchWithTimeout("https://example.com/cancel", { signal: upstream.signal }, { timeoutMs: 1000 }),
    ).rejects.toThrow("caller cancelled");
  });
});
