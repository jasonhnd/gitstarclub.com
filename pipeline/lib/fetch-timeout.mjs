export const GITHUB_FETCH_TIMEOUT_MS = 30000;

export class FetchTimeoutError extends Error {
  constructor(input, timeoutMs, label = "fetch") {
    const url = input instanceof Request ? input.url : String(input);
    super(`${label} timed out after ${timeoutMs}ms: ${url}`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

export function isFetchTimeoutError(error) {
  return error instanceof FetchTimeoutError || (error instanceof Error && error.name === "FetchTimeoutError");
}

export async function fetchWithTimeout(input, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(input, init);

  const timeoutError = new FetchTimeoutError(input, timeoutMs, options.label);
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;

  const onUpstreamAbort = () => {
    if (!controller.signal.aborted) controller.abort(upstreamSignal?.reason);
  };
  if (upstreamSignal) {
    if (upstreamSignal.aborted) onUpstreamAbort();
    else upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
  }
}
