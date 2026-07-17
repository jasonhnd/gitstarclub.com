---
owner: API / route contracts
status: active
last_reviewed: 2026-07-17
source_of_truth_for:
  - endpoint contracts
  - route handler auth and cache behavior
  - public JSON and metadata endpoint behavior
---

# GitStarClub API reference

## Scope

This document is the endpoint contract index for the Next.js web app. It covers
App Router route handlers, Next metadata endpoints that are public contracts,
and the static public JSON export aliases.

Field-level data schemas still live in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)
and the Zod contracts under `web/lib/contracts/`. Operational schedules and
runbooks still live in [OPS.md](./OPS.md). SEO crawl policy still lives in
[SEO.md](./SEO.md).

## Shared conventions

- All endpoints in this document are `GET` endpoints. Request bodies are not
  part of any contract here.
- Non-`GET` requests are outside these app contracts; Next.js handles
  unsupported methods at the framework layer.
- Protected operations require `Authorization: Bearer <CRON_SECRET>`. Missing,
  malformed, mismatched, or unconfigured secrets return `401` with body
  `Unauthorized`.
- Public endpoints do not require cookies or bearer tokens unless this document
  says otherwise.
- Dates and periods are UTC. Calendar dates use `YYYY-MM-DD`; months use
  `YYYY-MM`; ISO weeks use `YYYY-Www`.
- Cache behavior below lists app-level route behavior. When an endpoint says
  "no explicit Cache-Control", the route code does not set that header itself.

## Endpoint index

| Endpoint | Source | Auth | Cache model | Response contract |
|---|---|---|---|---|
| `/api/cron/daily` | `web/app/api/cron/daily/route.ts` | Bearer `CRON_SECRET` | `force-dynamic`; no explicit `Cache-Control` | `LiveRefreshResult` plus route fields |
| `/api/cron/weekly` | `web/app/api/cron/weekly/route.ts` | Bearer `CRON_SECRET` | `force-dynamic`; no explicit `Cache-Control` | `LiveRefreshResult` plus route fields |
| `/api/workflows/refresh/start` | `web/app/api/workflows/refresh/start/route.ts` | Bearer `CRON_SECRET` | `force-dynamic`; no explicit `Cache-Control` | workflow enqueue result |
| `/api/workflows/refresh/revalidate` | `web/app/api/workflows/refresh/revalidate/route.ts` | Bearer `CRON_SECRET` | `force-dynamic`; internal callback | publication cache invalidation result |
| `/api/workflows/refresh/rollback` | `web/app/api/workflows/refresh/rollback/route.ts` | Bearer `CRON_SECRET` + `idempotency-key` | `force-dynamic`; no explicit `Cache-Control` | fenced pointer rollback result |
| `/api/lang` | `web/app/api/lang/route.ts` | Public | Redirect plus cookie mutation; no explicit `Cache-Control` | `307` redirect |
| `/search-index` | `web/app/search-index/route.ts` | Public | CDN `s-maxage=3600`; empty fallback `s-maxage=60` | `SearchIndex` / `SearchDoc` |
| `/repo-curve` | `web/app/repo-curve/route.ts` | Public | CDN `s-maxage=3600`; invalid/missing id `s-maxage=60` | `CompareCurve` or error JSON |
| `/sitemap.xml` | `web/app/sitemap.xml/route.ts` | Public | `revalidate=86400`; CDN `s-maxage=86400` | XML sitemap index |
| `/sitemap-{locale}.xml` | `web/app/sitemap-*.xml/route.ts` | Public | `revalidate=86400`; CDN `s-maxage=86400` | XML URL set |
| `/robots.txt` | `web/app/robots.ts` | Public | Next metadata route; env-driven at build/deploy time | `MetadataRoute.Robots` |
| `/manifest.webmanifest` | `web/app/manifest.ts` | Public | Next metadata route; static app manifest | `MetadataRoute.Manifest` |
| `/data/exports/v1/latest/*.json` | `web/public/data/exports/v1/*` + `next.config.ts` rewrite | Public | Static asset; `latest` rewrites to newest dated export at build time | data export JSON |

## Protected operations

### `GET /api/cron/daily`

Runs the daily live overlay refresh.

| Item | Contract |
|---|---|
| Auth | Required bearer `CRON_SECRET` |
| Query | `dry=1` performs a no-write dry run. `idempotency_key` optionally overrides the default `<job>:<UTC-day>` key for an intentional additional same-day publication. |
| Body | None |
| Success | `200 application/json` |
| Failure | `400` invalid idempotency key; `401 Unauthorized`; `409` another live writer owns the lease; `500 {"ok":false,"runId":"daily-...","error":"Internal server error"}` |
| Cache | `dynamic = "force-dynamic"`; no explicit `Cache-Control`; callers should not cache |
| Side effects | Non-dry runs acquire the fenced `live/latest.json` lease, write and validate one immutable `live/generations/<run_id>/**` generation, atomically flip the pointer, then revalidate/submit IndexNow and append `ops/sync-runs.json` |
| Max duration | `800` seconds |
| Type source | [`LiveRefreshResult`](../web/lib/cron/live-refresh.ts) |

Success response:

```json
{
  "ok": true,
  "status": "published",
  "idempotency_key": "daily:2026-07-05",
  "job": "daily",
  "dry": false,
  "day": "2026-07-05",
  "month": "2026-07",
  "week": "2026-W27",
  "polled": 5302,
  "day_total": 1234,
  "writes": [
    "live/generations/daily-.../current_month.json",
    "live/generations/daily-.../hot-snapshot.json",
    "live/generations/daily-.../rank/month/2026-07/repo/flow.json",
    "live/generations/daily-.../rank/month/2026-07/repo/stock.json",
    "live/generations/daily-.../rank/week/2026-W27/repo/flow.json",
    "live/generations/daily-.../heatmap/month/2026-07.json",
    "live/generations/daily-.../manifest.json",
    "live/latest.json"
  ],
  "all_time_repo_1": { "rank": 1, "id": 10270250, "value": 232000, "prev_rank": null },
  "current_week_flow_1": { "rank": 1, "id": 1296269, "value": 320, "prev_rank": null },
  "current_month_flow_1": { "rank": 1, "id": 1296269, "value": 1234, "prev_rank": null },
  "generation": "daily-2026-07-05T03-00-00-000Z",
  "previous_generation": "daily-2026-07-04T03-00-00-000Z",
  "published_at": "2026-07-05T03:02:00.000Z",
  "post_commit_errors": [],
  "log_error": null
}
```

Duplicate delivery with the same key returns `200 status=already-published`
after commit or `202 status=attached` while that run is active. A different key
returns `409 status=rejected` until the 15-minute lease expires. No
revalidation or IndexNow submission occurs before the pointer commit.

Operational example:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://gitstarclub.com/api/cron/daily?dry=1"
```

### `GET /api/cron/weekly`

Runs the weekly incremental live overlay refresh. The contract matches
`/api/cron/daily`, with `job: "weekly"` and an additional success field:

```json
{ "mode": "vercel-incremental-live-refresh" }
```

The weekly job may reuse the current day's `current_month.json` state when the
daily job has already updated it.

Operational example:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://gitstarclub.com/api/cron/weekly?dry=1"
```

### `GET /api/workflows/refresh/start`

Enqueues the managed refresh Vercel Workflow and returns immediately. The long
work continues in workflow steps.

| Item | Contract |
|---|---|
| Auth | Required bearer `CRON_SECRET` |
| Query | Optional `idempotency_key` (or legacy camel-case alias) and `trigger`; any `dry` parameter is rejected with `400` because managed refresh has no dry-run mode |
| Body | None |
| Success | `200 {"ok":true,"runId":"refresh-<timestamp>"}` |
| Failure | `400` for `dry` or unsupported query parameters; `401 Unauthorized`; `409` when another idempotency key owns the lease; `500 {"ok":false,"runId":"refresh-...","error":"Internal server error"}` |
| Cache | `dynamic = "force-dynamic"`; no explicit `Cache-Control`; callers should not cache |
| Side effects | First parses `canonical/v2/meta.json` read-only; only then acquires the workflow lease and calls `start(refreshWorkflow, [runId])`. If enqueue fails, sends an alert and logs the failure |

Operational example:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://gitstarclub.com/api/workflows/refresh/start"
```

This endpoint is always mutating. It has no managed-workflow dry-run mode and
rejects `dry=1` (as well as `dry=0` or any other `dry` value) before acquiring a
lease or writing health state. Only `/api/cron/daily` and `/api/cron/weekly`
support `dry=1`.

### `POST /api/workflows/refresh/rollback`

Moves the published pointer to an explicit retained version. The route acquires
a fenced operation lease, persists immutable rollback intent, updates recovery
and published-whitelist pointers, and invalidates the pointer tag and rendered
routes. Reusing the same idempotency key and target replays the same operation.

| Item | Contract |
|---|---|
| Auth | Required bearer `CRON_SECRET` |
| Header | Required stable `idempotency-key` (or `x-idempotency-key`) |
| Body | `{"target_version":"<retained version>"}` |
| Success | `200 {"ok":true,"operationId":"rollback-...","version":"...","prev_version":"...","published_at":"..."}` |
| Failure | `400` invalid request; `401` auth; `409` another operation owns the lease; `500` rollback failed |
| Visibility | Active cache invalidation; all warm pointer memos converge within 60 seconds |

Operational example:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Idempotency-Key: rollback-incident-123" \
  -H "Content-Type: application/json" \
  --data '{"target_version":"refresh-2026-07-12T06-00-00-000Z"}' \
  "https://gitstarclub.com/api/workflows/refresh/rollback"
```

## Public app endpoints

### `GET /api/lang`

Compatibility entrypoint for setting the preferred UI language and redirecting
to the locale URL form.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | `lang` optional; valid values are `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, `fr`; invalid or missing values fall back to `en` |
| Query | `next` optional; accepted only when it starts with `/` and not `//`; unsafe values fall back to `/` |
| Body | None |
| Success | `307` redirect to the requested locale URL |
| Cache | No explicit `Cache-Control`; clients should treat it as a preference mutation, not a cacheable data endpoint |
| Cookie | Sets `gsc_lang=<locale>` for one year, `Path=/`, `SameSite=Lax`, and `Secure` in production |

Examples:

```http
GET /api/lang?lang=fr&next=/rankings
Location: /fr/rankings
Set-Cookie: gsc_lang=fr; ...
```

```http
GET /api/lang?lang=en&next=/fr/rankings
Location: /rankings
Set-Cookie: gsc_lang=en; ...
```

### `GET /search-index`

Public CDN-cached JSON endpoint for the client search box. The route reads the
versioned `search/index.json` view through the publish pointer and returns a
slimmed `SearchIndex`.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 application/json` |
| Failure | Structured `503` `{ "error": "search_index_unavailable", "retryable": true }` when Blob read or schema parse throws (`Cache-Control: no-store`) |
| Hit cache | `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` |
| Empty fallback cache | `Cache-Control: public, max-age=0, s-maxage=60` |
| Zod contract | [`SearchIndex` / `SearchDoc`](../web/lib/contracts/search.ts) |

Response shape:

```json
{
  "generated_at": "2026-06-02T00:00:00.000Z",
  "count": 5302,
  "repos": [
    {
      "id": 1296269,
      "full_name": "vuejs/vue",
      "owner": "vuejs",
      "language": "JavaScript",
      "current_stars": 207000,
      "description": "..."
    }
  ]
}
```

Route behavior:

- `description` is truncated to 96 characters by the route before returning.
- Before the first publish, when the view is absent, the route returns
  `{"generated_at":"","count":0,"repos":[]}` with the empty fallback cache.

### `GET /repo-curve`

Public CDN-cached JSON endpoint for `/compare`. The route reads
`entity/repo/<id>.json` through the publish pointer and projects the lean
comparison payload. It does not create or read a separate Blob artifact.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | `id` required; must be a positive integer GitHub repo id |
| Body | None |
| Success | `200 application/json` |
| Failure | `400 {"error":"invalid id"}`; `404 {"error":"not found"}`; framework `500` if the Blob read or schema parse throws |
| Hit cache | `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` |
| Error cache | `Cache-Control: public, max-age=0, s-maxage=60` |
| Zod contract | [`CompareCurve`](../web/lib/contracts/compare.ts) |

Response shape:

```json
{
  "id": 10270250,
  "full_name": "facebook/react",
  "current_stars": 232000,
  "crossed_10k": "2014-09-15",
  "points": [["2014-01", 9800], ["2014-02", 10400]]
}
```

`points` are `[period, total_end]` monthly points from the repo entity curve.
`crossed_10k` comes from `entity.milestones.crossed_10k` and may be `null`.

## Public metadata endpoints

### `GET /sitemap.xml`

Public XML sitemap index.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 application/xml` |
| Failure | Framework `500` if required Blob view reads fail unexpectedly |
| Cache | `revalidate = 86400`; `Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=86400` |
| Source data | `lookup/repos.json`, `lookup/orgs.json`, `lookup/categories.json`, `meta.json` |
| Source code | [`web/lib/sitemap-routes.ts`](../web/lib/sitemap-routes.ts), [`web/lib/sitemap.ts`](../web/lib/sitemap.ts) |

Response shape:

```xml
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://gitstarclub.com/sitemap-en.xml</loc>
    <lastmod>2026-06-04T12:00:00.000Z</lastmod>
  </sitemap>
</sitemapindex>
```

### `GET /sitemap-{locale}.xml`

Public per-locale XML sitemap. Supported locale files are:

- `/sitemap-en.xml`
- `/sitemap-ja.xml`
- `/sitemap-zh.xml`
- `/sitemap-zh-TW.xml`
- `/sitemap-ko.xml`
- `/sitemap-es.xml`
- `/sitemap-fr.xml`

| Item | Contract |
|---|---|
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 application/xml` |
| Failure | Framework `500` if required Blob view reads fail unexpectedly |
| Cache | `revalidate = 86400`; `Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=86400` |
| Source data | Same as `/sitemap.xml` |
| Source code | [`web/lib/sitemap-routes.ts`](../web/lib/sitemap-routes.ts), [`web/lib/sitemap.ts`](../web/lib/sitemap.ts) |

Each URL entry includes `loc`, full `xhtml:link` hreflang alternates, `lastmod`,
`changefreq`, and `priority`. Path enumeration is generated by
`web/lib/sitemap.ts`.

### `GET /robots.txt`

Public robots metadata route.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 text/plain` generated by Next metadata routing |
| Cache | Next metadata route; no app-level cache header in `web/app/robots.ts` |
| Environment | `SITE_INDEXABLE` and `NEXT_PUBLIC_SITE_URL` |
| Source code | [`web/app/robots.ts`](../web/app/robots.ts) |

When `SITE_INDEXABLE !== "1"`, the response disallows all crawling:

```text
User-Agent: *
Disallow: /
```

When `SITE_INDEXABLE === "1"`, the response allows the site, disallows
`/api/`, and advertises `Sitemap: <NEXT_PUBLIC_SITE_URL>/sitemap.xml` plus
`Host: <NEXT_PUBLIC_SITE_URL>`. The route applies the same `/api/` disallow to
the explicit crawler user agents listed in `web/app/robots.ts` and to `*`.

### `GET /manifest.webmanifest`

Public web app manifest metadata route.

| Item | Contract |
|---|---|
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 application/manifest+json` generated by Next metadata routing |
| Cache | Next metadata route; static manifest object |
| Source | [`web/app/manifest.ts`](../web/app/manifest.ts) |

Response shape:

```json
{
  "name": "GitStarClub — A Chronicle of Open Source",
  "short_name": "GitStarClub",
  "description": "A browsable chronicle of open source — month by month, year by year.",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#fbfbfd",
  "theme_color": "#7f5700",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Static public JSON exports

These URLs are static files generated into `web/public/data/exports/v1/`.
`next.config.ts` rewrites `/data/exports/v1/latest/:path*` to the newest dated
export directory at build time.

| Endpoint | Response |
|---|---|
| `/data/exports/v1/latest/manifest.json` | [`ExportManifest`](../web/lib/data-exports.ts) |
| `/data/exports/v1/latest/top-rankings.json` | [`JsonExport<TopRankingExportRow>`](../web/lib/data-exports.ts) |
| `/data/exports/v1/latest/top-repo-milestones.json` | [`JsonExport<MilestoneExportRow>`](../web/lib/data-exports.ts) |
| `/data/exports/v1/latest/top-org-aggregates.json` | [`JsonExport<OrgAggregateExportRow>`](../web/lib/data-exports.ts) |

| Item | Contract |
|---|---|
| Method | `GET` |
| Auth | Public |
| Query | None |
| Body | None |
| Success | `200 application/json` when the checked-in export exists |
| Failure | `404` when an export was not generated or included in the deployment |
| Cache | Static asset behavior; no custom app-level `Cache-Control` is set for these files |

Field-level export definitions, row bounds, source views, license, attribution,
and regeneration commands live in [DATA-EXPORTS.md](./DATA-EXPORTS.md).
