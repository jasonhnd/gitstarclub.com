// Rate-limit and retry immutable creates shared by 06 and 07. The wrapper
// forwards createMutable so --initial-commit can publish the first pointer
// with If-None-Match instead of an overwrite.

const DEFAULT_MAX_PER_SEC = 60;
const DEFAULT_RETRIES = 4;

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
  const maxPerSec = options.maxPerSec ?? DEFAULT_MAX_PER_SEC;
  const retries = options.retries ?? DEFAULT_RETRIES;
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
        if (tryNumber > retries) throw error;
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
