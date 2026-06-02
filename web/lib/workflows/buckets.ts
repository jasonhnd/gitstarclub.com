// Shard bucketing for canonical/v2. N must stay consistent across every step and
// reader. See docs/VERCEL-DATA-OPERATIONS.md §4.2.
export const REPO_BUCKETS = 32;
export const repoBucket = (id: number): number => id % REPO_BUCKETS;
