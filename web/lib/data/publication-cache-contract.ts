/** Shared by the read side and Workflow publisher without importing next/cache into data reads. */
export const PUBLISHED_VIEWS_CACHE_TAG = "published-views-pointer";

/** In-process pointer memos can remain stale for at most this long after a remote publish. */
export const PUBLICATION_VISIBILITY_SLA_MS = 60_000;
