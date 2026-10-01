// Rate-limit and retry immutable creates shared by 06 and 07. The wrapper
// forwards createMutable so --initial-commit can publish the first pointer
// with If-None-Match instead of an overwrite.

export const DEFAULT_MAX_PER_SEC = 60;
export const DEFAULT_RETRIES = 4;

/**
 * HTTP statuses worth another attempt. 400, 401, and 403 fail immediately.
 * A missing status is retryable only for the timeout and socket failures below.
 */
export const UPLOAD_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

const RETRYABLE_STATUS = new Set(UPLOAD_RETRYABLE_STATUSES);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * @param {unknown} error
 * @returns {number | null}
 */
export function uploadErrorStatus(error) {
  if (!error || typeof error !== "object") return null;
  const direct = /** @type {{ status?: unknown, statusCode?: unknown }} */ (error).status
    ?? /** @type {{ statusCode?: unknown }} */ (error).statusCode;
  if (typeof direct === "number" && Number.isInteger(direct) && direct >= 100 && direct <= 599) return direct;
  const message = /** @type {{ message?: unknown }} */ (error).message;
  if (typeof message !== "string") return null;
  const match = message.match(/->\s*(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * @param {unknown} error
 */
export function isRetryableUploadError(error) {
  const status = uploadErrorStatus(error);
  if (status != null) return RETRYABLE_STATUS.has(status);
  if (!error || typeof error !== "object") return false;
  const named = /** @type {{ name?: unknown, code?: unknown, message?: unknown }} */ (error);
  if (named.name === "FetchTimeoutError" || named.name === "TimeoutError") return true;
  if (typeof named.code === "string" && NETWORK_CODES.has(named.code)) return true;
  return typeof named.message === "string" && /fetch timed out|socket hang up|network error|fetch failed/i.test(named.message);
}

/**
 * @param {number} value
 */
function requireMaxPerSec(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`maxPerSec must be a finite number greater than 0, got ${value}`);
  }
  return value;
}

/**
 * @param {number} value
 */
function requireRetries(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`retries must be a finite nonnegative integer, got ${value}`);
  }
  return value;
}

/**
 * @param {{
 *   read: (path: string) => Promise<Buffer | null>,
 *   put: (path: string, body: Buffer, contentType?: string) => Promise<unknown>,
 *   create: (path: string, body: Buffer, contentType?: string) => Promise<boolean>,
 *   createMutable?: (path: string, body: Buffer, contentType?: string) => Promise<boolean>,
 * }} store
 * @param {{
 *   maxPerSec?: number,
 *   retries?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [options]
 */
export function withUploadRetry(store, options = {}) {
  const maxPerSec = requireMaxPerSec(options.maxPerSec ?? DEFAULT_MAX_PER_SEC);
  const retries = requireRetries(options.retries ?? DEFAULT_RETRIES);
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let nextStart = 0;

  async function gate() {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + 1000 / maxPerSec;
    if (wait > 0) await sleep(wait);
  }

  /**
   * @param {() => Promise<boolean>} run
   */
  async function attempt(run) {
    for (let tryNumber = 1; ; tryNumber++) {
      await gate();
      try {
        return await run();
      } catch (error) {
        if (!isRetryableUploadError(error) || tryNumber > retries) throw error;
        await sleep(500 * 2 ** (tryNumber - 1));
      }
    }
  }

  return {
    read: (path) => store.read(path),
    put: (path, body, contentType) => store.put(path, body, contentType),
    create: (path, body, contentType) => attempt(() => store.create(path, body, contentType)),
    /**
     * @param {string} path
     * @param {Buffer} body
     * @param {string} [contentType]
     */
    createMutable(path, body, contentType) {
      const createMutable = store.createMutable;
      if (typeof createMutable !== "function") {
        throw new Error("bootstrap store cannot create the first pointer without overwrite");
      }
      return attempt(() => createMutable(path, body, contentType));
    },
  };
}
