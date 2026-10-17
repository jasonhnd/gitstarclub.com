/** Compile-time / docs default. Runtime override is getMinTrackedStars(). */
export const DEFAULT_MIN_TRACKED_STARS = 10_000;
export const MIN_TRACKED_STARS = DEFAULT_MIN_TRACKED_STARS;
export const GROWTH_FLOOR_STARS = 20_000;

/**
 * Resolve the tracked-universe floor from an env string.
 * Unset / blank → 10_000. Non-integers fail closed so a typo cannot silently
 * shrink or explode Search + refresh.
 */
export function resolveMinTrackedStars(raw) {
  if (raw == null) return DEFAULT_MIN_TRACKED_STARS;
  const trimmed = String(raw).trim();
  if (trimmed === "") return DEFAULT_MIN_TRACKED_STARS;
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`MIN_TRACKED_STARS must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`MIN_TRACKED_STARS must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return n;
}

