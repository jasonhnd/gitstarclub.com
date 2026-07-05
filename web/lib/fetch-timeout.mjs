export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const BLOB_JSON_FETCH_TIMEOUT_MS = 5_000;
export const GITHUB_FETCH_TIMEOUT_MS = 30_000;

export class FetchTimeoutError extends Error {
  constructor(input, timeoutMs) {
    super(`fetch timed out after ${timeoutMs}ms: ${fetchInputLabel(input)}`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = fetchInputLabel(input);
  }
}

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit & { timeoutMs?: number, fetcher?: typeof fetch, next?: unknown }} [init]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(input, init = {}) {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    fetcher = globalThis.fetch,
    signal,
    ...fetchInit
  } = init;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`fetch timeout must be a positive finite number, got ${timeoutMs}`);
  }

  const controller = new AbortController();
  const timeoutError = new FetchTimeoutError(input, timeoutMs);
  let timeout = null;

  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(signal?.reason);
  };

  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(input, { ...fetchInit, signal: controller.signal }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (controller.signal.reason === timeoutError && isAbortError(error)) {
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function fetchInputLabel(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}
