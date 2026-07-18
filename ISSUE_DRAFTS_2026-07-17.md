# GitStarClub audit issue drafts — 2026-07-17

Status: published to `jasonhnd/gitstarclub.com` on 2026-07-17 as issues #289 through #309.

Published mapping: draft 1 → #289, draft 2 → #290, continuing sequentially through draft 21 → #309. The published titles, bodies, labels, and open states were verified against this file after creation.

Repository state at review time:

- Open issues before publication: 0
- Open issues after publication: 21
- Closed issues: 143
- Audited commit: `c8dba52da1af34f53dbb22eb37dacd1cfe3ec11b`
- Drafts below: 21 issues covering all confirmed audit findings

Only existing repository labels are suggested. Because the repository has no `P0` label, P0 is recorded in the title and the suggested label remains `bug`.

---

## 1. P0 data: Align `canonical/v2/meta.json` with every producer and consumer

**Suggested labels:** `bug`

### Summary

The managed refresh cannot reliably read canonical metadata produced by its own bootstrap and fold writers. `CanonicalMeta` is strict and rejects `generated_at`, while both writers persist that field.

### Related history

Follow-up to closed #7 and #14. Those issues tightened contracts but did not cover a writer producing a field rejected by the reader.

### Verified evidence

- `web/lib/contracts/canonical.ts:19-26` defines a strict schema without `generated_at`.
- `web/lib/workflows/steps/fold.ts:45-52` writes `generated_at`.
- `pipeline/backfill/07-export-v2.mjs:98-103` also writes `generated_at`.
- `web/lib/workflows/steps/fold.ts:25-26` and `web/lib/workflows/recompute/io.ts:43-45` parse the object with `CanonicalMeta`.
- The public production object contains `generated_at`; the shipped parser fails with `unrecognized_keys`.
- The published base pointer is still on the 2026-06-21 generation, and the 2026-07-12 managed refresh recorded a failure.

### Implementation requirements

- Define one authoritative metadata contract for bootstrap, fold, recompute, tests, and documentation.
- Either validate and retain `generated_at`, or stop every writer from emitting it.
- Preserve compatibility with the currently published object during rollout.
- Add a preflight that parses production-shaped metadata before a managed refresh starts.

### Tests

- Bootstrap writer → `CanonicalMeta.parse` round trip.
- Fold writer → `CanonicalMeta.parse` round trip.
- Fixture matching the current production object.
- Backward-compatible rollout fixture if migration is staged.

### Acceptance criteria

- Every supported writer produces metadata accepted by every reader.
- Existing production metadata remains readable during rollout.
- A managed refresh reaches recompute without a metadata schema error.

---

## 2. P0 data: Make same-day live-refresh retries idempotent and partial-result safe

**Suggested labels:** `bug`

### Summary

Running the live refresh more than once on the same UTC day can erase or undercount that day's star delta. A partial GitHub response can also remove stored values for repositories absent from the response.

### Related history

Regression/follow-up to closed #13 and #16; neither covered same-day retry arithmetic.

### Verified evidence

- `web/lib/cron/live-refresh.ts:53-82` removes today's stored entries before recomputing them.
- The new delta is calculated against the already-updated `current_stars` value.
- Example: 100→110 writes `+10`; a retry at 110 removes `+10` and writes zero. A later value of 112 writes `+2`, not `+12`.
- `web/lib/cron/live-refresh.test.ts:52-68` covers unavailable lookup and dry-run only.

### Implementation requirements

- Persist or reconstruct a stable per-repository start-of-day baseline.
- Define today's delta as `latest count - start-of-day count`.
- Preserve existing today values for repositories missing from a partial result.
- Fail closed on incomplete GitHub batches unless partial publication is explicitly supported.

### Tests

- Identical same-day retry.
- Same-day additional growth and star loss.
- Partial result map and duplicate scheduler delivery.
- Weekly reuse and month-boundary retry.

### Acceptance criteria

- Repeating identical input produces byte-equivalent daily state.
- Later same-day runs retain the full delta from the start-of-day baseline.
- Missing repositories do not lose their previously stored daily values.

---

## 3. P0 ops: Do not advertise `dry=1` for a mutating managed refresh

**Suggested labels:** `bug`, `documentation`

### Summary

The operations runbook presents `?dry=1` as a safe managed-workflow invocation, but the endpoint ignores that parameter and always starts the real mutating refresh.

### Related history

The unsafe command appears in the incident guidance of closed #280.

### Verified evidence

- `docs/OPS.md:285-291` instructs operators to add `?dry=1`.
- `docs/API.md:127-140` documents no workflow-start query parameter and describes a real start side effect.
- `web/app/api/workflows/refresh/start/route.ts:11-14` ignores the query string and calls the real workflow starter.
- `web/lib/workflows/start.ts:64-137` performs the normal managed refresh path.

### Implementation requirements

- Immediately remove the unsafe example or reject `dry=1` with a clear non-success response.
- If managed dry-run is required, define which reads, writes, alerts, pointer changes, GC, revalidation, and IndexNow actions are suppressed.
- Keep daily/weekly cron dry-run behavior distinct and explicitly documented.

### Tests

- Route test proving `dry=1` performs zero persistent writes.
- Tests for omitted, invalid, and explicitly supported query parameters.
- Runbook command verification against the route contract.

### Acceptance criteria

- No documented dry-run command can mutate production state.
- The API contract and OPS runbook describe identical behavior.
- A real managed refresh still requires an explicit mutating request.

---

## 4. P0 security: Prevent cross-origin redirects from `/api/lang`

**Suggested labels:** `bug`, `security`, `needs-running-site`

### Summary

The language-switch endpoint accepts backslash-based network paths that become cross-origin URLs after WHATWG URL normalization, creating an open redirect on the production domain.

### Related history

Follow-up to closed #13, #96, and #277. Earlier redirect tests covered `//host`, not backslash normalization.

### Verified evidence

- `web/lib/route-utils.ts:7-8` accepts a value beginning with `/` unless it begins with `//`.
- `web/app/api/lang/route.ts:12-15` passes the value to `new URL(..., requestUrl)`.
- Production reproduction on 2026-07-17:

```text
GET /api/lang?lang=en&next=/%5C%5Cexample.com/path
307 Location: https://example.com/path
```

### Implementation requirements

- Resolve the candidate against the request origin and require an exact origin match.
- Reject raw/encoded backslashes, control characters, user-info, and scheme-relative forms.
- Preserve valid internal paths, query strings, hashes, and locale normalization.
- Fall back to `/` for every rejected value.

### Tests

- Raw/encoded backslashes, mixed separators, CR/LF, absolute URLs, and `//host`.
- Valid internal paths with query and hash.
- Route test asserting the final `Location` origin.
- Deployed smoke check for the known exploit payload.

### Acceptance criteria

- No `next` value can redirect outside the request origin.
- Valid internal navigation remains unchanged.
- The production exploit returns an internal location.

---

## 5. P1 data: Publish live overlays atomically and expose truthful freshness

**Suggested labels:** `bug`, `P1`

### Summary

A live refresh overwrites several related Blob objects independently and concurrently. Readers can observe a mixed generation, while `hot-snapshot.json` claims global freshness even when major sections are copied unchanged.

### Related history

Concrete follow-up to the concurrency and partial-publication risks in closed #16 and the freshness gates in #286.

### Verified evidence

- `web/lib/cron/handlers.ts:17-28` has no live-refresh lease or idempotency claim.
- `web/lib/cron/live-refresh.ts:150-168` overwrites related objects with `Promise.all`.
- `web/lib/cron/live-refresh.ts:111-121` sets a new `generated_at` while copying `year_spine`, `on_this_day`, and `current_year`.
- The production snapshot was generated on 2026-07-17 while its `on_this_day` entries still represented 2026-05-30.

### Implementation requirements

- Write each refresh to an immutable live generation and switch one pointer after validation.
- Add a date/job idempotency key and lease or fencing protection.
- Make month rollover and pending-period publication retry-safe.
- Recompute freshness-dependent sections or attach an explicit `as_of` to each carried section.
- Revalidate paths and submit IndexNow only after the generation commits.

### Tests

- Fault injection at every object write.
- Two concurrent refreshes and retry after partial failure.
- Reader observes either the old or new complete generation, never a mixture.
- Stale base snapshot with fresh current-month data.

### Acceptance criteria

- One atomic pointer identifies a complete live generation.
- Failed refreshes leave readers on the previous complete generation.
- No section is presented as newer than its source data.

---

## 6. P1 data: Make managed publication idempotent, rollback-safe, and promptly visible

**Suggested labels:** `bug`, `P1`

### Summary

A partial publish followed by retry can replace the true rollback target with the current run. Pointer-read failures are treated as first publication, and successful publish/rollback changes can remain hidden by long-lived caches.

### Related history

Specific follow-up to the rollback and stale-pointer risks in closed #16.

### Verified evidence

- `web/lib/workflows/steps/publish.ts:15-22` converts every pointer-read error to `prevVersion = null`.
- `web/lib/workflows/steps/publish.ts:27-32` writes `views/latest.json` and `latest-success.json` separately.
- If the first write succeeds and the second fails, retry can emit `prev_version === version`.
- `web/lib/data/source.ts:24-26` caches pointers for one hour and some base reads for 24 hours.
- Publish does not explicitly invalidate those caches.

### Implementation requirements

- Treat only a confirmed 404 as an absent pointer; surface all other read failures.
- Persist a publish intent containing the original previous version.
- Preserve the original `prev_version` when retrying an already-current run.
- Make pointer and recovery-state writes idempotent.
- Invalidate the relevant cache tags/paths after publish and rollback.
- Define and document a measurable visibility SLA.

### Tests

- Failure before and after each publish write.
- Retry when the pointer already targets the run.
- Transient pointer-read failure.
- Publish and rollback with warmed caches.

### Acceptance criteria

- `prev_version` never points to the version being published.
- A transient read error cannot destroy rollback metadata.
- Publish and rollback become visible within the documented SLA.

---

## 7. P1 workflow: Fence ownership and bypass caches for mutable canonical state

**Suggested labels:** `bug`, `P1`

### Summary

Lease acquisition is atomic, but the lease has no renewal or fencing. An expired run can keep writing after takeover. The same workflow reads mutable canonical paths through `force-cache`, allowing later steps to receive pre-write content.

### Related history

Successor to closed #122, which fixed acquisition CAS only, and a concrete follow-up to #16.

### Verified evidence

- `web/lib/workflows/lease.ts:5-7,109-159` uses a fixed 12-hour lease with no heartbeat or fencing token.
- `web/lib/workflows/steps/publish.ts:12-31` does not validate current ownership before publishing.
- `web/lib/workflows/checkpoint.ts:34-41` ignores a failed release result.
- `web/lib/data/source.ts:71-104` uses one `?v=<runId>` URL with `cache: "force-cache"`.
- Fold, rename, metadata, and recompute read and overwrite the same paths in one run.

### Implementation requirements

- Add a monotonically changing fencing token and renew ownership at bounded intervals.
- Require the current token before every canonical mutation and pointer publication.
- Make a superseded run fail closed and surface release failures.
- Use `no-store` or direct Blob reads for mutable canonical/ops paths.
- Retain aggressive caching only for immutable versioned views.

### Tests

- Lease expiry/takeover followed by an old-run write and publish attempt.
- Heartbeat and release failure.
- Read-after-write of the same canonical path with a simulated cache.
- Immutable versioned views remain cacheable.

### Acceptance criteria

- A superseded run cannot mutate canonical state or publish.
- Later steps observe writes made earlier in the same run.
- Ownership failures are visible and actionable.

---

## 8. P1 data: Fail closed on incomplete canonical and derived generations

**Suggested labels:** `bug`, `P1`

### Summary

Missing canonical shards are silently merged as empty data, and validation records missing or schema-invalid anchoring shards without failing publication. A dataset can lose most repositories and still pass a fixed minimum threshold.

### Related history

Regression/follow-up to closed #14 and #15; #286 added broad consistency gates but not complete shard validation.

### Verified evidence

- `web/lib/workflows/recompute/io.ts:23-33` ignores absent bucket shards.
- `web/lib/workflows/steps/validate.ts:165-190` records canonical invariant counts without adding failures.
- The canonical contract permits absent `d`, while recompute relies on a historical anchoring factor.
- `web/lib/workflows/steps/validate.ts:37` uses a fixed minimum of 1,000 instead of comparing with the prior generation.

### Implementation requirements

- Produce and verify a manifest of expected shards, counts, and checksums.
- Fail on any required missing or invalid shard.
- Compare IDs/counts with the prior published generation and approved add/drop diff.
- Require a finite historical `d`; model newcomers explicitly when no prior anchor applies.
- Persist diagnostics without switching the publish pointer.

### Tests

- Missing and schema-invalid shards.
- Dataset reduced from about 5,300 repositories to just over 1,000.
- Missing, `NaN`, and infinite `d`.
- Legitimate additions, drops, and newcomer without pre-seam history.

### Acceptance criteria

- No incomplete generation can be published.
- Validation identifies the exact missing or unexpected IDs/shards.
- Expected membership changes pass without weakening completeness checks.

---

## 9. P1 data: Advance the whitelist baseline only after successful publication

**Suggested labels:** `bug`, `P1`

### Summary

The whitelist step updates the global baseline before validation or publication. A later failure causes retries and future runs to treat unshipped newcomers as already tracked, losing the newcomer diff and `tracked_since`.

### Verified evidence

- `web/lib/workflows/steps/whitelist.ts:21-27` reads `canonical/v2/whitelist/latest.json` as the baseline.
- `web/lib/workflows/steps/whitelist.ts:51-52` writes the run snapshot and immediately advances that pointer.
- Whitelist is the first workflow step, before validation and publish.
- Retrying the run can compare against its own snapshot and produce an empty `added` set.

### Implementation requirements

- Keep each run's whitelist snapshot immutable.
- Resolve baseline from the last successfully published run.
- Advance the published whitelist pointer only as part of successful publication.
- Preserve the original diff across same-run retries.
- Define recovery after failure in whitelist or metadata.

### Tests

- Failure immediately after whitelist.
- Same-run retry and a new run after a failed predecessor.
- Successful publish followed by the next run.
- Newcomer `tracked_since` remains the original discovery date.

### Acceptance criteria

- Failed runs never advance the published baseline.
- Same-run retries preserve identical add/drop sets.
- A newcomer cannot be silently lost after an aborted workflow.

---

## 10. P1 data: Define one repository tracking contract from discovery to read models

**Suggested labels:** `bug`, `P1`

### Summary

Repository membership, authoritative star counts, active polling, and newcomer provenance disagree across GitHub Search, GraphQL, canonical shards, and derived views.

### Related history

Follow-up to closed #16, #21, and #127. Those tickets did not establish an end-to-end lifecycle contract.

### Verified evidence

- `web/lib/github.ts:122-126` and `pipeline/lib/github.mjs:69-71` stop discovery at 600,000 stars.
- `web/lib/workflows/steps/metadata.ts:49-78` copies Search's `stargazers_count` into `current_stars`; GraphQL is queried only for newcomers or missing language metadata.
- The active data documentation calls GraphQL the authoritative precise current count.
- Dropped repositories remain in derived lookup and `web/lib/cron/live-refresh.ts:48-54` polls the full lookup.
- Canonical rows store `tracked_since`, but `web/lib/workflows/recompute/entities.ts:41-68` and the entity contract omit it.

### Implementation requirements

- Remove the fixed upper-star discovery ceiling.
- Use Search for membership discovery and an explicitly documented source for displayed/ranked current counts.
- Represent active tracking separately from historical retention.
- Retain dropped entities historically but exclude them from recurring polling; define re-entry behavior.
- Propagate `tracked_since` through entity contracts and derived views.

### Tests

- Repositories at 599,999, 600,000, 600,001, and above one million stars.
- Search and GraphQL return different counts.
- Newcomer, drop, and re-entry lifecycle.
- Dropped repository is retained but not polled.
- `tracked_since` survives canonical-to-entity round trip.

### Acceptance criteria

- Discovery has no silent upper-star exclusion.
- Current totals and rankings use the documented authority.
- Only active members are polled.
- Newcomer provenance reaches reader-facing data.

---

## 11. P1 ops: Preserve per-pipeline health and verify alert delivery

**Suggested labels:** `bug`, `P1`

### Summary

Alert delivery treats HTTP 4xx/5xx as success, cron success does not clear failure state, and all pipelines overwrite one scalar health object. Documentation also claims Sentry and immediate alerting that are not implemented.

### Related history

Regression/follow-up to closed #7, #280, and #286.

### Verified evidence

- `web/lib/observability/alert.ts:38-74` awaits webhook `fetch` but never checks `response.ok`.
- `web/lib/observability/alert.ts:81-97` overwrites one `ops/workflows/health.json` record.
- `web/lib/cron/handlers.ts:40-44` records cron health only on failure.
- `docs/OPS.md:297,311-319` claims Sentry and immediate alerts; no Sentry dependency or configuration exists.

### Implementation requirements

- Treat non-2xx webhook responses as delivery failures and record safe diagnostics.
- Add bounded retry/backoff or an explicit failed-delivery state.
- Store health per pipeline, or atomically maintain a keyed health map.
- Record success and failure for daily, weekly, and managed refreshes.
- Preserve `last_success`, `last_failure`, freshness, and correlation IDs.
- Update OPS to describe the actually deployed alert path.

### Tests

- Webhook 2xx, 4xx, 5xx, timeout, and network failure.
- Failure followed by success.
- Interleaved and concurrent updates from every pipeline.
- One pipeline remains failed while another succeeds.

### Acceptance criteria

- Each pipeline's latest success and failure remain independently visible.
- Non-2xx responses are never reported as successful delivery.
- An unrelated run cannot erase an active failure signal.
- Operational documentation matches the deployed mechanism.

---

## 12. P1 ops: Make bootstrap publication and Blob deletion recoverable by default

**Suggested labels:** `bug`, `P1`

### Summary

Manual bootstrap scripts overwrite production objects incrementally, while the prefix-deletion tool begins deleting after only a weak string check. Interrupted or mistargeted operations can expose a mixed generation or permanently remove active data.

### Verified evidence

- `pipeline/backfill/06-upload.mjs:92-117` uploads the flat view set directly to production paths.
- `pipeline/backfill/07-export-v2.mjs:153-200` overwrites canonical shards without a staging generation or commit pointer.
- `web/scripts/blob-del-prefix.ts:7-13` accepts any prefix at least eight characters long containing `/`.
- `web/scripts/blob-del-prefix.ts:35-46` deletes during listing with no preview, protected-prefix check, active-version check, or execute flag.
- `docs/VERCEL-DATA-OPERATIONS.md:454-464` presents the utility as general residue cleanup.

### Implementation requirements

- Stage bootstrap output under an immutable generation and validate it before one commit/pointer switch.
- Support retry/resume and rollback after interruption.
- Make deletion dry-run by default and display exact object count and bytes.
- Require an explicit execute confirmation.
- Hard-block canonical, ops, current, latest, active, and rollback-target prefixes.
- Share protection logic with automated GC where practical.

### Tests

- Upload failures at multiple points and resume after interruption.
- Validation failure leaves production unchanged.
- Delete preview performs no deletion.
- Protected/active prefixes are rejected.
- Explicit throwaway-generation deletion succeeds.

### Acceptance criteria

- Interrupted bootstrap cannot expose a mixed generation.
- Every bootstrap has a recoverable previous state.
- The deletion tool cannot remove protected or active data through a broad prefix.

---

## 13. P1 routing: Handle dotted repository names and localized 404s correctly

**Suggested labels:** `bug`, `P1`

### Summary

Locale routing mistakes repository slugs containing dots for public files, so they bypass language preference. Localized missing pages also fall back to the framework's English-only 404.

### Related history

Routing regression after closed #96; localized 404 is a new follow-up to the completed i18n rollout.

### Verified evidence

- `web/middleware.ts:5,40-52` treats every final path segment containing a dot as a public file.
- The current production search index contains 159 dotted repository names.
- With `gsc_lang=ja`, `/facebook/react` redirects to `/ja/facebook/react`, while `/mrdoob/three.js` stays on an English page.
- No localized `not-found.tsx` exists; `/ja/...missing...` returns HTTP 404 with “This page could not be found.”
- Next.js 16.2 also reports that the `middleware` convention should migrate to `proxy`.

### Implementation requirements

- Replace the generic extension heuristic with explicit static/framework exclusions.
- Ensure dotted owner/name routes participate in locale routing.
- Add locale-aware 404 rendering for all seven locales with correct `lang`, shared chrome, and noindex behavior.
- Migrate the routing boundary to `proxy.ts` while changing this logic.

### Tests

- `three.js`, `pdf.js`, multi-dot repositories, real assets, APIs, and metadata files.
- Browser test using a locale cookie and dotted repository slug.
- Localized/default 404 status, copy, language, and robots behavior.
- Production build with no middleware deprecation warning.

### Acceptance criteria

- Dotted repositories behave like every other repository route.
- Actual static assets remain excluded.
- Every localized 404 retains HTTP 404 and displays locale-appropriate content.

---

## 14. P1 API: Make all free-text truncation Unicode-safe

**Suggested labels:** `bug`, `P1`

### Summary

Several response and persistence paths truncate JavaScript strings by UTF-16 code unit. Cutting between a surrogate pair produces invalid Unicode in otherwise valid JSON.

### Related history

New interoperability regression after closed #283 fixed the separate `/search-index` HTTP 500 incident.

### Verified evidence

- `web/lib/search-index-response.ts:13-20` truncates descriptions with `.slice(0, 96)`.
- `web/lib/workflows/recompute/entities.ts:112-129` uses `.slice(0, 200)`.
- `web/lib/contracts/common.ts:49-52` uses `.slice(0, max)`.
- Production `/search-index` contains an unpaired high surrogate in `gorilla/mux`.
- Browser `JSON.parse` accepts the response, but `jq` rejects the entire payload as an invalid surrogate pair.

### Implementation requirements

- Add one shared truncation/sanitization helper that never splits surrogate pairs.
- Define whether limits are code points or grapheme clusters and use that contract consistently.
- Replace all free-text `.slice` caps in response, recompute, and contract normalization.
- Replace or normalize pre-existing malformed surrogate input.

### Tests

- Emoji across 96/200/4096 boundaries.
- Supplementary-plane characters, combining marks, and ZWJ sequences.
- Pre-existing malformed surrogate input.
- Serialize and validate with a strict Unicode-aware JSON parser.

### Acceptance criteria

- Generated and served JSON contains no unpaired surrogate.
- Existing length limits remain enforced.
- Production `/search-index` passes strict JSON parsing.

---

## 15. P1 privacy: Reconcile optional GA4, CSP, and the privacy promise

**Suggested labels:** `bug`, `P1`, `needs-running-site`

### Summary

Production emits GA4 when configured, but the CSP blocks the loader and telemetry. The privacy page simultaneously promises that no third-party tracking scripts exist.

### Related history

Cross-issue regression involving closed #19, #115, and #240.

### Verified evidence

- `web/app/_shell/RootShell.tsx:23-24,93-94` conditionally renders Google Analytics.
- `web/lib/csp.ts:15-20` permits scripts and connections only from `'self'`.
- Production HTML contains the GA loader, and browser console evidence confirms CSP blocks it.
- `web/lib/i18n/dictionaries/en.ts:348-356` and translated privacy copy state there are no third-party tracking scripts and only a language cookie is used.

### Implementation requirements

Choose and implement one coherent mode:

1. Remove GA configuration/dependencies and retain the current CSP/privacy promise; or
2. Support GA with exact-domain CSP rules, truthful disclosures in every locale, and any required consent behavior.

Add a configuration invariant so an enabled integration cannot silently be blocked.

### Tests

- HTML/CSP assertions with GA ID unset, invalid, and valid.
- Browser test for CSP violations and outbound analytics requests.
- Privacy dictionary parity across all locales.
- Documentation/configuration consistency.

### Acceptance criteria

- Production never emits an analytics integration that CSP blocks.
- Privacy copy truthfully describes deployed behavior in every locale.
- Default and analytics-enabled modes are covered automatically.

---

## 16. P1 i18n: Remove remaining English-only UI and localized URL inconsistencies

**Suggested labels:** `bug`, `P1`

### Summary

Shared localized pages still contain English-only UI dictionaries, labels, empty states, and ARIA text. Some localized JSON-LD entries also point to English URLs, and compact-number formatting does not receive a locale.

### Related history

Current residual scope after closed #103, #104, #113, and #284; this does not reopen the completed About-page work.

### Verified evidence

- `web/app/_localized/org.tsx:30-48` defines English-only `ORG_UI`.
- `web/app/_localized/repo.tsx:30-48` defines English-only `REPO_ENTITY_UI`.
- `web/app/_localized/ranking-detail.tsx:52-77` defines English-only `DETAIL_UI`.
- `web/app/_explore/PeriodSwitcher.tsx:47` hardcodes “Ranking period.”
- Localized pages currently show phrases such as “Aggregate tracked stars,” “Citable repository profile,” and “Permanent archive.”
- `web/lib/format.ts:5-13` does not accept locale.
- Localized ItemList entries in ranking/category implementations inconsistently emit English paths.

### Implementation requirements

- Move all reader-visible UI, empty states, descriptions, and ARIA names into typed locale dictionaries.
- Pass localized labels into shared components without English fallback for a present locale.
- Make number/date formatting locale-aware.
- Apply one documented localized URL policy to JSON-LD and visible links.
- Add a static guard against new reader-visible constant dictionaries under `_localized`.

### Tests

- Render representative repo, org, ranking, category, and pulse routes in ja/zh/fr.
- Assert representative English-only phrases are absent.
- Enforce dictionary key parity.
- Assert localized JSON-LD URLs and empty/error states.

### Acceptance criteria

- Non-English routes contain no unintended English chrome.
- Accessible names and compact numbers follow the active locale.
- Structured-data URLs follow the documented locale policy.

---

## 17. P1 frontend: Make Search and Compare accessible, fresh, and recoverable

**Suggested labels:** `bug`, `P1`, `needs-running-site`

### Summary

The global SearchBox uses an invalid composite-widget structure. Search and curve fetches force browser cache despite server `max-age=0`, and Compare cannot recover from an initial search-index failure without a full page reload.

### Related history

Specific regression/follow-up to closed #128 and #129; existing browser checks do not open the search panel.

### Verified evidence

- `web/app/_explore/search-box/SearchPanel.tsx:108-193` places both a link and compare button inside each `role="option"`.
- `aria-selected` represents active keyboard position rather than actual selection.
- `web/app/_explore/search-box/useSearchEngine.ts:94`, `web/app/compare/CompareClient.tsx:84`, and `web/lib/compare/curve-fetch.ts:14` use `cache: "force-cache"`.
- The corresponding APIs publish browser `max-age=0` semantics.
- `web/app/compare/CompareClient.tsx:77-101,297-300` loads the index once and displays an error without a retry control.

### Implementation requirements

- Implement a valid combobox/listbox pattern, or use a dialog/list pattern when multiple actions are required.
- Align focus, active descendant, selection, and compare-toggle semantics.
- Use default/no-cache behavior for freshness-sensitive client fetches.
- Add explicit retry for the Compare index and bypass cache on user-initiated curve retry.
- Abort obsolete requests and prevent stale results from overwriting newer state.

### Tests

- Keyboard coverage for Arrow keys, Enter, Escape, Tab, and compare toggling.
- Playwright + Axe after opening and populating SearchBox.
- First-failure/second-success tests for index and curves.
- Cached malformed-response retry and stale-request race.

### Acceptance criteria

- Search exposes a valid accessibility tree and remains keyboard usable.
- Compare recovers without a full page refresh.
- Explicit retry performs real network revalidation.
- Interactive search/compare states are covered by browser release gates.

---

## 18. P2 docs: Reconcile active route, runtime, environment, and operations documentation

**Suggested labels:** `documentation`, `P2`

### Summary

Active documentation contains stale pre-route-group source paths, conflicting ownership claims, incorrect runtime behavior, and unsafe environment/credential guidance.

### Related history

Documentation regression/follow-up to closed #125, #138, #148, and #188.

### Verified evidence

- The audit found 59 outdated active source-path references covering 20 unique old paths, concentrated in `docs/CODEBASE.md`, `docs/FRONTEND.md`, and `docs/SEO.md`.
- `docs/README.md`, `docs/FRONTEND.md`, and `docs/UIUX-ROUTE-INVENTORY.md` conflict over route ownership.
- Actual pages live under `(en)`, `(localized)/[locale]`, `_localized`, and `_shell`.
- `README.md:97` says read-only production access needs `BLOB_READ_WRITE_TOKEN`; public reads need only `BLOB_BASE_URL`.
- `docs/OPS.md:109-112` points to a root `.env`, while `web/scripts/lib/env.ts:39-106` loads `web/.env.local`.
- Environment inventories omit active variables including Bing verification, IndexNow, and GA configuration.
- Active docs disagree about Preview Protection, OG generation, organization-page revalidation, pointer TTL/rollback timing, and the installed Next.js patch version.
- `docs/API.md` omits the public `/.well-known/deployment` route used by release tooling.

### Implementation requirements

- Designate one maintained route/source inventory and link to it from satellite docs.
- Update every active source reference to current route groups and shared implementations.
- Clearly mark historical reports so old paths are not treated as current instructions.
- Document least-privilege read versus write credentials.
- Make environment-file instructions match actual loader behavior and list every active variable.
- Reconcile Preview, OG, ISR, cache/rollback SLA, API inventory, and framework-version claims with code.
- Add a documentation check for current repository paths and generated/versioned facts where practical.

### Tests

- Extract and validate backticked repository paths, with an explicit historical allowlist.
- Fresh-clone read-only setup using no Blob write token.
- Environment-variable inventory check against source usage.
- Root Markdown/frontmatter validation in CI.

### Acceptance criteria

- Active docs contain no unresolved current-code paths.
- Exactly one document owns the route inventory.
- Read-only setup never requests a write credential.
- Environment and operational instructions match the deployed code.
- Every public/operational route is represented in the API index.

---

## 19. P1 data tooling: Make `validate-views` exhaustive and honest

**Suggested labels:** `bug`, `P1`

### Summary

The script described as a full view-contract validator silently skips unknown JSON files and still reports that all views conform.

### Verified evidence

- `web/scripts/validate-views.ts:38-52` recognizes only a subset of view families.
- `web/scripts/validate-views.ts:63-67` increments `skipped` and continues for unknown JSON.
- `web/scripts/validate-views.ts:80-87` still prints `all views conform to contracts`.
- `docs/TESTING.md:108-115` describes the command as full validation.
- The command is absent from package scripts and CI.

### Implementation requirements

- Maintain an explicit complete schema registry for every expected view family.
- Fail on unknown JSON by default; require a reasoned allowlist for intentional non-view artifacts.
- Report discovered, validated, allowlisted, skipped, and failed counts separately.
- Share the registry with Workflow validation where possible.
- Add a package command and invoke it against the read-only CI fixture/bootstrap tree.

### Tests

- Valid and invalid known files.
- Unknown and malformed JSON.
- Explicitly allowlisted artifact.
- Fixture containing every supported view family.

### Acceptance criteria

- Unknown files cannot produce a green “all conform” result.
- Every generated view family is validated or explicitly allowlisted.
- Exit status and summary truthfully describe coverage.
- The documented command is reproducible and CI-enforced.

---

## 20. P1 CI: Enforce the declared runtime and quality-gate contract

**Suggested labels:** `bug`, `P1`

### Summary

The repository declares Node 24, Bun 1.3.14, an 80% coverage hard line, pipeline coverage, and Markdown/frontmatter checks, but current CI does not enforce those contracts.

### Related history

Narrow follow-up to closed #13, #17, #142, and #145 rather than a new generic CI issue.

### Verified evidence

- `.node-version` and `web/package.json:6-9` require Node 24; `.github/workflows/ci.yml` installs Bun but does not install/assert Node 24.
- CI action logs only print whichever Node version exists on the runner.
- `docs/TESTING.md:75-79` calls at least 80% logical-code coverage a hard line.
- CI runs ordinary tests with no coverage threshold; the coverage command does not include pipeline code.
- Root `package.json` exposes `lint:md`, but the static job does not run it.
- Current measured coverage is only modestly above the declared line: 80.85% functions and 86.62% lines.

### Implementation requirements

- Install and assert Node 24 in every CI job.
- Pin/assert Bun from the package-manager declaration.
- Define the intended coverage scope, include pipeline where promised, and enforce thresholds.
- Run root Markdown/frontmatter validation in the static job.
- Report exact tested runtime versions and coverage in the job summary.
- Consider pinning third-party Actions by commit SHA as a separate supply-chain hardening step.

### Tests

- Controlled runtime mismatch is rejected.
- Controlled below-threshold coverage fails.
- Missing frontmatter or fence language fails.
- Normal CI remains deterministic with the read-only Blob fixture.

### Acceptance criteria

- Every job uses Node 24 and Bun 1.3.14.
- Coverage below the documented threshold fails CI.
- Markdown/frontmatter violations fail CI.
- `TESTING.md` describes the exact enforced scope.

---

## 21. P2 tooling: Make asset generation cross-platform and prevent deployed drift

**Suggested labels:** `bug`, `P2`

### Summary

The checked-in asset renderer only auto-detects Windows Chrome, and the build copies output into a legacy root `public/` directory rather than the deployed Next.js `web/public/` tree. The copies currently match only through manual maintenance.

### Verified evidence

- `render-assets.mjs:10-19` checks only Windows Chrome paths.
- The renderer depends on external Google Fonts and a fixed virtual-time delay.
- `build.mjs:33-39` copies generated images to root `public/`.
- The deployed app serves `web/public/`.
- `docs/SEO.md` requires `assets/og.png` and `web/public/og.png` to remain synchronized, but no script or CI gate enforces it.
- Current file hashes match; the defect is the missing reproducible synchronization path.

### Implementation requirements

- Use repository-managed Playwright Chromium, or deterministic browser discovery on macOS, Linux, and Windows.
- Define one canonical asset source and one command that updates every deployed target.
- Add a check mode for missing files, dimensions, and content drift.
- Remove timing-dependent external font loading where practical.
- Document regeneration and visual review.

### Tests

- Render/check on Linux CI and local macOS.
- Verify favicon 64×64, Apple icon 180×180, and OG image 1200×630.
- Deliberately change one deployed copy and prove the check fails.
- Repeated clean renders produce no unexpected diff.

### Acceptance criteria

- The render command works on supported developer and CI platforms.
- Generated assets reach `web/public/` through the documented command.
- CI detects source/deployed drift.
- Repeated renders are deterministic.

---

# Coverage map

| Confirmed audit finding | Draft issue |
|---|---:|
| Canonical meta writer/schema contradiction | 1 |
| Same-day retry erases or undercounts deltas | 2 |
| Partial GitHub results remove stored daily values | 2 |
| Managed `dry=1` still writes production | 3 |
| Language endpoint open redirect | 4 |
| Live multi-object publication is non-atomic | 5 |
| Live refresh lacks serialization/idempotency | 5 |
| Hot snapshot reports false freshness | 5 |
| Publish retry destroys rollback target | 6 |
| Pointer read errors become first publication | 6 |
| Cache TTL delays publish and rollback visibility | 6 |
| Lease has no renewal or fencing | 7 |
| Failed lease release is ignored | 7 |
| Mutable canonical reads use stale force-cache keys | 7 |
| Missing canonical shards merge as empty | 8 |
| Invalid shards and missing `d` do not fail validation | 8 |
| Fixed minimum permits mass data loss | 8 |
| Whitelist baseline advances before publish | 9 |
| Search count replaces documented GraphQL authority | 10 |
| Fixed 600,000-star discovery ceiling | 10 |
| Dropped repositories remain in recurring polling | 10 |
| `tracked_since` disappears from read models | 10 |
| Webhook ignores HTTP failure status | 11 |
| Health records overwrite other pipelines | 11 |
| OPS claims nonexistent Sentry behavior | 11 |
| Bootstrap uploads are non-atomic | 12 |
| Blob prefix deletion lacks safe guards | 12 |
| Dotted repositories bypass locale routing | 13 |
| Localized 404s fall back to English | 13 |
| Deprecated routing middleware boundary | 13 |
| UTF-16 slicing emits invalid Unicode | 14 |
| GA4 is blocked by CSP | 15 |
| GA4 contradicts privacy disclosures | 15 |
| Remaining hardcoded English UI/ARIA | 16 |
| Locale-insensitive formatting | 16 |
| Localized structured-data URL drift | 16 |
| SearchBox has invalid nested interaction semantics | 17 |
| Client force-cache can serve stale search/curve data | 17 |
| Compare initial-load failure has no retry | 17 |
| Active source paths and route ownership are stale | 18 |
| Read-only docs request a write credential | 18 |
| Environment-file and variable inventories are wrong | 18 |
| Preview, OG, ISR, API, version, and cache docs drift | 18 |
| `validate-views` silently skips artifacts | 19 |
| Node 24/Bun version contract is not enforced | 20 |
| Coverage hard line/pipeline scope is not enforced | 20 |
| Markdown/frontmatter validation is absent from CI | 20 |
| Asset renderer is Windows-specific | 21 |
| Generated/deployed assets can silently drift | 21 |

# Intentionally not drafted as bugs

- The previous `/search-index` HTTP 500, expired GitHub token, About localization, homepage ordering, and language-cookie incidents are closed and no longer reproduce.
- Local Node/Bun version, ten lint warnings, and skipped optional tests are observations, not independently proven repository bugs.
- `_not-found.html` localhost metadata was not proven to affect a public response.
- Pinning GitHub Actions by commit SHA is useful hardening, but not a currently demonstrated functional defect.
