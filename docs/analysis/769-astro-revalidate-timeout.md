---
owner: architecture / operations
status: active
last_reviewed: 2026-10-25
source_of_truth_for:
  - Issue 769 Astro publication invalidation diagnosis
---

# Issue 769: Astro publication callback timeout

## DIAGNOSIS

### 1. Why the Astro callback can exceed 30 seconds

- **Verified (code, incident baseline b13f13a):**
  `web/lib/data/core-revalidate-paths.ts` (`corePublicationRevalidatePaths`) expands
  eight suffixes across seven locales into 56 unique paths. The suffixes are
  home, pulse, rankings, categories, about, organizations, compare and privacy.
- **Verified:** Both handlers await
  `web/lib/workflows/publication-cache.ts` (`invalidatePublishedViews`): clear the
  process-local pointer memo, invalidate two pointer tags, then invalidate all
  56 paths sequentially. With the deployed `GSC_CACHE` binding,
  `web/lib/cache-invalidation/resolve.ts` (`resolveCacheInvalidation`) selects
  `web/lib/workers-host/cache/invalidation.ts` (`WorkerCacheInvalidation`).
  Each tag/path writes one timestamp in each of the data and pages stores,
  sequentially: 4 pointer writes + 112 path writes = 116 KV puts.
- **Verified:** Astro's
  `astro/src/packages/p7/operations.ts` (`revalidate`) additionally awaits
  `locals.invalidatePaths` with all 56 paths, wired by `astro/src/worker.ts` to
  `astro/src/lib/cache.ts` (`invalidatePagePaths`). The shared
  `web/lib/workers-host/cache/store.ts` (`ArtifactStore.revalidateTag`) loops over
  tags sequentially, adding 56 Astro timestamp puts: **172 total**, versus
  **116** on web. These are timestamp writes, not HTML deletions. This call
  chain performs **zero KV gets, deletes, or list operations**, and no cache
  enumeration. Hashing each tag is also awaited.
- **Verified:** The store serializes repeated writes to the same key, waits to
  respect a 1001 ms per-key interval, and retries failures twice with 1100 ms
  and 2200 ms delays. This is not a one-second delay on every distinct path.
  `web/lib/workflows/publication-invalidation-request.ts` limits the entire
  authenticated callback to 30,000 ms.
- **Inferred from the reported incident:** Serial remote storage latency makes
  the extra Astro pass sufficient to cross the deadline. Ignoring hashing and
  retries, average puts between approximately 175 and 258 ms yield an Astro
  timeout while web remains below 30 s. The earlier successful web run was at
  another time, so it does not prove identical storage latency. No per-operation
  trace was supplied; the precise slow key, retries and runtime duration cannot
  be verified from source or the supplied error. No authenticated live request
  was made for this diagnosis.

### 2. Why the repository page retains the previous publication

- **Verified (baseline):** `astro/src/lib/host.ts` (`handleRequest`) classifies
  `/react/react` through `web/lib/workers-host/cache/policy.ts` (`isLongTail`).
  Its key ends in the literal `"tail"`, and its entry fence is also `"tail"`,
  rather than the captured publication identity. A warm hit does not compare
  the current publication with the cached response's `x-gsc-publication`.
  Its body and header can therefore retain the previous publication for seven
  days, followed by one day of stale-while-regenerating service.
- **Verified:** `/react/react` and its localized variants are absent from the
  core callback path set. Completing the old callback would not refresh them.
  `astro/tests/host.test.ts` and `astro/worker-checks/worker.test.ts` explicitly
  encoded the old warm-tail preservation behavior.
- **Verified:** The baseline `docs/ASTRO-HOST.md` section "Caching and
  publication" promises publication namespacing for **core HTML**, then says
  ordinary publication keeps warm tails. Repository HTML is therefore not
  publication-keyed, consistently with that narrower documented policy. That
  policy does not satisfy this issue's requirement that all HTML switch.
- **Inferred:** The reported old-publication HIT on `/react/react` follows this
  policy independently of the callback timeout. New core MISS responses are
  also consistent with the existing core publication namespace.

### 3. Smallest fix and verification

- **Verified (implemented in `astro/src/lib/host.ts`):** Every Astro HTML key
  and entry fence now contains the captured publication identity. Cache hits
  recheck that identity. Tail freshness durations apply inside one publication. A changed publish
  or rollback selects a different key without enumerating or deleting pages;
  old cache entries can expire through existing retention. A new publication
  will make previously warm tails cold on their next visit.
- **Verified (implemented in `astro/src/packages/p7/operations.ts`):** The Astro
  callback retains shared pointer memo/tag invalidation through an adapter
  that skips the web framework's 56 path tags. The additional Astro core-path
  invalidation pass is removed. Publication-keyed
  HTML already makes both path passes unnecessary. The authenticated callback
  then performs four KV puts, independent of the number of core or tail pages.
  Explicit `invalidatePaths` remains available for manual invalidation.
- **Inferred performance expectation:** Four serial puts have substantial margin
  inside 30 s at the incident's plausible latency. No finite local test can
  guarantee a remote service's latency; regression tests must state their
  modeled delay and bound, and preserve storage-error propagation.

- **Verified (local regression):** `astro/tests/p7/parity.test.ts` runs the real
  authenticated callback with synthetic credentials and a simulated 200 ms delay
  for each KV put. The complete 56-path core configuration completes in about
  1.8 seconds, under a five-second assertion, with exactly four unique writes.
  The old 172-write chain would need at least 34.4 seconds at this modeled
  latency. The test also refuses any Astro path-invalidation call. Existing
  unauthorized-response and awaited-invalidation/error-propagation tests pass.
- **Verified (local regression):** `astro/tests/host.test.ts` exercises all 56
  core paths and repository, organization and category pages in all seven
  locales. Each switches body and publication header on publish and rollback
  while prior entries remain in both persistent and regional cache layers.
  A publication change during cache lookup retries before serving old HTML.
  Same-publication stale regeneration and explicit path invalidation still pass.
- **Verified (local built Worker):** The preview build's
  `astro/worker-checks/worker.test.ts` passes all three tests, including a cold
  tail, warm hit and publication-switch miss against simulated local bindings.
  No live callback or Cloudflare service was used.
