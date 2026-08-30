/** Next.js Data Cache refuses items over 2 MiB. Published ISR views stay under 1.50 MiB. */
export const MAX_DATA_CACHE_JSON_BYTES = Math.floor(1.5 * 1024 * 1024);

const DATA_CACHE_SIZE_EXEMPT = new Set(["search/index.json"]);

export function jsonByteLength(value: unknown): number {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.byteLength(payload, "utf8");
}

/** ISR-cached Blob views must stay below the Data Cache budget. `search/index.json` is exempt because that route uses skipNextDataCache. */
export function assertPublishedViewJsonSize(path: string, value: unknown): void {
  if (DATA_CACHE_SIZE_EXEMPT.has(path)) return;
  const bytes = jsonByteLength(value);
  if (bytes >= MAX_DATA_CACHE_JSON_BYTES) {
    throw new Error(
      `${path}: JSON is ${bytes} bytes (>= ${MAX_DATA_CACHE_JSON_BYTES} / 1.50 MiB Data Cache budget)`,
    );
  }
}
