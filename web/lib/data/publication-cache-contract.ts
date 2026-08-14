/** Shared by the read side and Workflow publisher without importing next/cache into data reads. */
export const PUBLISHED_VIEWS_CACHE_TAG = "published-views-pointer";

/** One global Data Cache key/tag for bootstrap/latest.json, including confirmed 404s. */
export const BOOTSTRAP_POINTER_CACHE_TAG = "bootstrap-publication-pointer";
export const BOOTSTRAP_POINTER_CACHE_KEY = "bootstrap-publication-pointer";

/** Confirmed 404s may stay cached this long; a publish invalidates the tag immediately. */
export const BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS = 300;
export const BOOTSTRAP_POINTER_NEGATIVE_TTL_MS = BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS * 1000;

/** In-process pointer memos can remain stale for at most this long after a remote publish. */
export const PUBLICATION_VISIBILITY_SLA_MS = 60_000;

/** On-demand ISR for crawler-driven long-tail routes. Publication does not mass-invalidate these. */
export const LONG_TAIL_REVALIDATE_SECONDS = 604_800;
