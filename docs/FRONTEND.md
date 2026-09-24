---
owner: frontend
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - rendering strategy
  - component catalog
  - data access layer
  - i18n implementation
---

# gitstarclub Frontend Design (Next.js 16 Web Application)

> **Frontend implementation source of truth** — lands [REQUIREMENTS](./REQUIREMENTS.md) (what to do), [ARCHITECTURE](./ARCHITECTURE.md) (page layering / ISR / cadence), [DATA-CONTRACTS](./DATA-CONTRACTS.md) (consumed JSON view schema), [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) (M3E token / components / motion) onto this `web/` **Next.js 16 App Router** application's **rendering config / data consumption / components / i18n**. The route and source-file inventory is maintained only in [UIUX-ROUTE-INVENTORY.md](./UIUX-ROUTE-INVENTORY.md).
> SEO metadata / sitemap / canonical details are in [SEO.md](./SEO.md); Route Handler and public JSON endpoint contracts are in [API.md](./API.md); Blob layout / environment variables / deployment topology are in [OPS.md](./OPS.md).
> Technical facts are based on **Next.js 16.3.5 · React 19.2.4 · TypeScript 6 · Tailwind 4 · Zod 4 · package manager bun 1.3.14** (see `web/package.json` and the root `package.json`).

---

## Scope

This document describes the `web/` application's (Next.js 16 App Router) **route tree, component catalog, data access layer, i18n architecture, and rendering strategy**, for engineers who need to extend or maintain the frontend.

Out of scope for this document: JSON view schema and contract semantics are in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md); Route Handler / public JSON endpoint method, auth, params, response, cache, and status codes are in [API.md](./API.md); M3E token / palette / motion curves and other design-system details are in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md); SEO metadata and sitemap details are in [SEO.md](./SEO.md); Blob layout and deployment topology are in [OPS.md](./OPS.md).

## Requirement Traceability

The authoritative catalog of requirement IDs is in [REQUIREMENTS.md §0](./REQUIREMENTS.md#0-requirement-ids--priority--traceability-matrix). This table maps these IDs to frontend routes, components, and data-read boundaries; the test mapping is in [TESTING.md](./TESTING.md#requirement-traceability).

| Requirement ID | Frontend implementation surface | Data/contract boundary | Primary verification |
|---|---|---|---|
| `REQ-CHRONICLE-001` | `(en)` / `(localized)`'s `rankings/**`, `[owner]/[name]`, `o/**`, `_localized/rankings.tsx` | `rank/**`, `entity/**`, `heatmap/**`, `lookup/**` | `P0-AC1`, `P0-AC3`; routing, SEO, recompute, fold tests |
| `REQ-PULSE-001` | `/`, `/pulse`, `_localized/pulse.tsx`, `pulse/PulseView.tsx`, cron-triggered `revalidatePath` | `hot-snapshot.json`, `current_month.json`, `live/*`, `ops/sync-runs.json` | `P0-AC2`, `P0-AC3`; live-refresh tests |
| `REQ-RANKING-001` | `/rankings`, `/rankings/[year]`, `/rankings/[year]/[period]`, `RankingList` | `rank/{week|month|year|all-time}/**` plus derived `growth`/`new` | `P0-AC4`; ranking, contract, recompute tests |
| `REQ-I18N-001` | `(en)` root, `(localized)/[locale]`, `LanguageSwitcher`, `pageMeta()`, sitemap routes | Data fields stay language-neutral; only chrome/meta dictionaries localize | `P0-AC3`; i18n routing/proxy, SEO, sitemap tests |
| `REQ-DATAOPS-001` | `api/cron/{daily,weekly}`, `api/workflows/refresh/start`, read-side version pointer handling | `views/latest.json`, `ops/workflows/**`, live artifacts | `P0-AC6`; workflow validate/start and cron tests |
| `REQ-PERF-001` | RSC content pages, server-rendered SVG/DOM charts, limited client islands | Budgeted JSON view reads; no request-path engine access | `P0-AC5`; performance runbook and planned budget gates |
| `REQ-SEARCH-001` | `SearchBox`, `/search-index`, MiniSearch worker protocol | `search/index.json` | search core, worker protocol, fetch/retry tests, Chromium keyboard + Axe E2E |
| `REQ-COMPARE-001` | `/compare`, `CompareClient`, `CompareCurve`, `/repo-curve` | entity repo curve projection via `/repo-curve?id=` | compare core, curve-fetch/retry tests, Chromium recovery E2E |
| `REQ-CATEGORY-001` | `categories/**`, `category-page-data.ts`, category ItemList JSON-LD | `categories/registry.json`, `lookup/categories.json`, `rank/category/**` | category recompute/rules and SEO tests |

---

## 0. Design Principles (read this first)

| # | Principle | Implementation constraint |
|---|---|---|
| 1 | **RSC by default, zero client JS first** | Content pages are all Server Components; charts are server-rendered SVG/DOM; motion is pure CSS. The only allowed client JS is in §4. |
| 2 | **build reads only JSON, zero engine at runtime, unaware of Workflow** | The page body and `generateMetadata` only `fetch` budgeted JSON views (Vercel Blob), and **never** load Parquet / DuckDB / native modules on the build / request path, and also **do not know** that Vercel Workflow exists — how the data is produced (bootstrap / cron / Workflow) is transparent to the page, and the page only reads the final JSON (see [ARCHITECTURE](./ARCHITECTURE.md), [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)). |
| 3 | **Page layering ↔ Next config in one-to-one correspondence** | Core pages are built at deploy; long-tail pages use on-demand ISR; mover/pulse get a daily `revalidatePath`; history is frozen. This is the core of this document, see §2. |
| 4 | **Token-driven, do not hard-code the palette** | Components use Tailwind utilities to reference the M3E runtime variables in `globals.css` (`bg-primary-container`, `text-on-surface-variant`…), and theme switching takes effect immediately (see [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §Integrating Tailwind 4). |
| 5 | **Data is language-neutral** | i18n translates only UI chrome / navigation / labels / meta; repo names, descriptions, languages, topics, and numbers keep the original text (see §7, [PRODUCT](./PRODUCT.md) i18n). |

---

## 1. Routing (App Router)

### 1.1 Routing and rendering boundaries

The complete matrix of pages, endpoints, metadata routes, source files, the sitemap, and data loaders is maintained only in
[UIUX-ROUTE-INVENTORY.md](./UIUX-ROUTE-INVENTORY.md). An endpoint's method,
auth, response, and cache contract are maintained by [API.md](./API.md). This document maintains only the cross-route
rendering strategy.

English canonical URLs have no prefix; ja/zh/zh-TW/ko/es/fr use a locale prefix and exchange, with
English, `hreflang` / `x-default`. Old `/trending` and old `/{year}` paths do not do
compatibility redirects; a still-tracked repo that is renamed is 308'd via the alias map to the current `full_name`.
All four `next/og` routes are generated at request/ISR time and use `revalidate=86400`; they are not
generated by the pipeline, nor stored in Blob.

### 1.2 i18n (locale URL + server rendering)

Requirement: English by default, and provide seven UI languages, en / ja / zh / zh-TW / ko / es / fr ([REQUIREMENTS](./REQUIREMENTS.md) §9, [PRODUCT](./PRODUCT.md) i18n, [SEO](./SEO.md) §10). English uses prefixless URLs; non-default locales use prefixed URLs. A repo URL still keeps the GitHub-style canonical path, adding a language segment only before a non-default locale: `/facebook/react`, `/ja/facebook/react`, `/fr/facebook/react`.

**Route file layout**:

```text
app/
  _shell/RootShell.tsx       # shared by the two root layouts: fonts/global CSS/theme init/body/Footer
  _localized/*.tsx           # route-locale shared page implementations
  (en)/
    layout.tsx               # English prefixless root layout, <html lang="en">
    page.tsx  pulse/page.tsx
    [locale]/[owner]/page.tsx # param names align with the localized tree; the URL is still /owner/name
    o/page.tsx  o/page/[page]/page.tsx  o/[login]/page.tsx
    rankings/page.tsx  rankings/[year]/page.tsx  rankings/[year]/[period]/page.tsx
    about/page.tsx  privacy/page.tsx  categories/**  compare/page.tsx
  (localized)/[locale]/
    layout.tsx               # non-default locale root layout, <html lang={toHreflang(locale)}>
    page.tsx  pulse/page.tsx
    [owner]/[name]/page.tsx  # /ja/facebook/react and other locale-prefixed repo URL
    o/**  rankings/**  categories/**  compare/page.tsx  about/page.tsx  privacy/page.tsx
  api/lang/route.ts          # compatibility entry: write gsc_lang, then redirect to the locale URL
  search-index/route.ts      # client search-index endpoint (contract in API.md)
  repo-curve/route.ts        # compare slim route (contract in API.md)
  robots.ts  sitemap.ts  manifest.ts  api/   # root-level special routes, no layout needed
```

Key points:

- **URL canonical is self-canonicalized per locale**: `/facebook/react` is the English URL; `/ja/facebook/react`, `/zh-TW/facebook/react`, and others are the canonical URLs of the corresponding locale; `/en/*` is not a canonical form, and `web/proxy.ts` permanently redirects to prefixless English.
- **Rendering mode is in §2.5** (route locale → server dictionary → localized HTML; the long tail is still on-demand ISR).
- **i18n implementation details are in §7** (handwritten dictionaries, route groups choose `<html lang>`, LanguageSwitcher navigates with `<a>`, and `gsc_lang` is only a proxy/API preference-redirect signal); data fields are not translated.

---

## 2. Page Layering ↔ Next.js 16 Config (core)

This is the section that lands [ARCHITECTURE](./ARCHITECTURE.md) "page layering and rebuild cadence" and [REQUIREMENTS](./REQUIREMENTS.md) §6 "freshness model (newspaper metaphor)" as **concrete Next segment config**.

### 2.1 Four-layer mental model (aligned with the freshness model)

| Layer | Page | Freshness (REQUIREMENTS §6) | Next mechanism |
|---|---|---|---|
| **Core** | `/` · `/pulse` · `/rankings` · current-year/current-month `/rankings/...` (a non-default locale is the corresponding prefixed URL) | Front page: replaced daily | Daily cron `revalidatePath`; core locale pages are prerendered static/ISR, chrome is localized on the server, and only leaf controls such as search/language/theme hydrate |
| **Long tail** | Historical year/month · **week** · repo · org (~16k+) · categories | Chronicle: frozen / marked as-of | **On-demand ISR**: `dynamicParams=true` + empty (or registry-derived) `generateStaticParams`, generated on first visit and persistently cached. `revalidate` splits per page (see the footnote below), and all of them also get cron `revalidatePath` targeted invalidation |
| **mover** | repo/org in the mover set + `/pulse` | Pulse: event-driven, refresh only "the small set that is moving" | Weekly/daily cron `revalidatePath` targeted invalidation for them → regenerated on the next visit |
| **History** | Past periods already folded into Parquet | Old newspaper: never reprinted | Pure static hits the CDN; unchanged data = no revalidate |

> Key point: **a long-tail page "becoming a page" is extremely cheap** (lazy generation, does not occupy build budget) — so week pages / org pages as standalone pages are not constrained by the 45min build cap ([ARCHITECTURE](./ARCHITECTURE.md) rendering layering).
>
> **Long-tail `revalidate` is not a one-size-fits-all `false`** (split per file; the code is authoritative):
> - **repo `/[owner]/[name]`** = `86400` (`page.tsx:22`) — generated on first visit + background regeneration every 1 day, plus the mover same-day `revalidatePath`.
> - **org index `/o` / `/o/page/[page]`** = `3600` — provides a crawlable owner directory layer, prerendered by the page count of `lookup/orgs.json`.
> - **org `/o/[login]`** = `86400` — generated on first visit + background regeneration every 1 day, plus mover targeted invalidation.
> - **category `/categories*`** = `86400` — a newly published registry category can appear within 1 day without a redeploy; category detail page 2+ self-canonicalizes via `/categories/[dimension]/[slug]/page/[page]`.
> - Historical year/month/week still use the `revalidate=false` segment in the §2.2 "core pages" mixed file (current year/current month prerendered, history on demand).

### 2.2 Segment-config cheat sheet (what to paste for each page type)

**Core pages (Pulse / Rankings / current year / current month)** — deploy builds concrete params:

```ts
// example: app/rankings/[year]/page.tsx (the current year takes the core path, history takes ISR — same file, mixed)
export const dynamicParams = true            // historical years not listed → generated on demand on first visit
export async function generateStaticParams() {
  // prerender only the "current year"; historical years are left to on-demand ISR
  const Y = new Date().getUTCFullYear()
  return [{ year: String(Y) }]               // locale is chosen by the (en) / (localized)/[locale] route groups; do not cross-generate here
}
export const revalidate = false              // no polling; the daily cron uses revalidatePath to refresh the current year
```

**Long-tail pages (repo / org / week / historical year-month)** — not built at deploy:

```ts
// example: app/o/[login]/page.tsx (repo / org detail-page pattern)
export const dynamicParams = true            // the default; empty list + this = all generated on demand
export async function generateStaticParams() {
  return []                                  // repo/org pages return [] → all on-demand ISR
}
export const revalidate = 86400              // daily ISR + cron targeted invalidation
// repo and org details both have empty static params; generated on demand on first visit, then daily ISR.
```

**All-time ranking / pulse (single page, fresh daily)**:

```ts
// example: app/pulse/page.tsx
export const revalidate = false              // does not rely on time polling
// after the Vercel cron atomically switches live/latest.json, revalidatePath('/pulse')
```

### 2.3 `next.config.ts`: required global switches

The layering model must be declared explicitly in `web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // key point: cacheComponents must stay "off" — turning it on disables dynamicParams,
  // and makes an empty generateStaticParams() error at build (conflicts with "long tail fully on demand").
  // see ARCHITECTURE page layering §config points / SEO §3.4. Off by default, do not turn it on by mistake.
};

export default nextConfig;
```

| Switch | Value | Reason |
|---|---|---|
| `cacheComponents` | **Off (unset/false)** | Turning it on disables `dynamicParams`, and an empty `generateStaticParams` errors at build ([ARCHITECTURE](./ARCHITECTURE.md) / [SEO](./SEO.md) §3.4). |
| `dynamicParams` (segment-level) | `true` | The long tail is generated on first visit; an unknown param calls `notFound()` (404, see [SEO](./SEO.md) §3.2). |
| `revalidate` (segment-level) | `false` | No time polling; data changes rely entirely on cron `revalidatePath` targeted invalidation. |
| repo rename redirect | Route layer (not next.config) | The repo page, based on `lookup/aliases.json`, sends `permanentRedirect` (308) for a renamed old slug to the current `full_name`; canonical always points at the current name ([SEO](./SEO.md) §7). |

### 2.4 How data changes reach pages (no deploy)

- **Daily cron** (`/api/cron/daily`, [API](./API.md) / [OPS](./OPS.md) §Cron): writes `current_month` (v2 = small index + 32 repo shards) / `hot-snapshot` / the current month/week rank / the current-month heatmap into the same immutable `live/generations/<run_id>/`, and after the manifest completes a fenced CAS switches `live/latest.json`, **then** `revalidatePath` on the core hot set. UTC Sunday daily is skipped, and weekly 04:00 exclusively owns the live write. Hot-set pages read only `hot-snapshot.json` and do not load `current_month` shards.
- **Weekly cron** (`/api/cron/weekly`, [API](./API.md)): likewise does a live refresh inside Vercel, so the week ranking and the month ranking do not gap even without a full historical recompute; a full historical refresh goes through Vercel Workflow shards separately, and does not do a 16k full build.
- **deploy**: triggered only by code/structure changes; it resets the ISR store, and the long tail is cold-generated once on first visit (see [ARCHITECTURE](./ARCHITECTURE.md)).

Each generation declares only the current-period files produced by that publish, and does not copy week/month files not yet folded before it. After a rank / month heatmap reader confirms 404 for the current generation object, it walks back boundedly along the manifest's `previous_generation`; only after the chain fully reaches `null` does it read migration-period flat `live/*`. `current_month` / `hot-snapshot` are mutable-semantics snapshots, always read only the pointer's current generation, and do not fall back along history into a stale snapshot.

> `app/api/cron/daily` and `app/api/cron/weekly` refresh the hot set through `revalidatePath` + `CRON_SECRET` authentication.

### 2.5 Rendering mode: route locale + server-localized HTML

Page BODY and chrome (top bar / footer / breadcrumb labels / section titles) are all decided by the route locale: English prefixless routes render English HTML, and non-default locale prefixed routes render HTML in the corresponding language. The `gsc_lang` cookie does not participate in page rendering, and is only a preference-redirect signal in `web/proxy.ts` and `/api/lang`. The whole route tree continues to hit static / ISR cache (core pages SSG, long tail on-demand ISR), and does not enter per-request SSR.

**Implementation points**:

- `web/app/(en)/layout.tsx`: English prefixless root layout, calls `RootShell lang="en"`.
- `web/app/(localized)/[locale]/layout.tsx`: validates the non-default locale, loads the corresponding dictionary, and calls `RootShell lang={toHreflang(locale)}`.
- `web/app/_shell/RootShell.tsx`: the HTML/body shell shared by both root layouts; keeps only the theme init script, and no longer needs `LANG_INIT_SCRIPT`.
- `web/app/_localized/*`: shared server page implementations; after receiving the route locale / dictionary / canonical path, they render localized chrome, metadata, JSON-LD, and deterministic copy.
- `Chrome.tsx` / `Footer.tsx` / `Breadcrumbs.tsx` are Server Components; `SearchBox`, `LanguageSwitcher`, and `ThemeToggle` are the minimal client islands in the top bar, and `LanguageSwitcher` only generates locale URL links.
- Each page (`page.tsx` / `pulse` / `rankings*` / `about` / repo / org / category): does not read the cookie; repo/org use `generateStaticParams() => []` to switch to on-demand ISR.
- `web/lib/i18n/server.ts`: **deprecated** — reading the cookie breaks static; kept only for non-page server contexts, do not call it in page/layout.

**Build route table** (`cd web && bun run build`):

| Route | Rendering layer |
|---|---|
| `/` · `/pulse` · `/rankings` · `/about` | `○` static |
| `/rankings/[year]` · `/rankings/[year]/[period]` | `●` SSG (current year/current month prerendered + the rest on demand) |
| `/[owner]/[name]` · `/o/[login]` | `●` SSG (`[]` + `dynamicParams` → all on-demand ISR) |

- SSR/static output is **fully indexable HTML** (the current route locale's chrome and body enter the initial HTML, and SEO §3a is unaffected), and the data is language-neutral.
- Tradeoff basis: about 95% of each page is language-neutral data, and only a few chrome strings need translation → route-locale server rendering + on-demand ISR together keep **static CDN carrying the load + a GitHub-style canonical path**; metadata, the sitemap, the body, the proxy, and language-switch navigation are already unified on the locale URL / hreflang architecture.

---

## 3. Data Consumption (how pages read JSON views)

### 3.1 Data sources

Pages all read real JSON views on Blob from `@/lib/data` (`fetch` + Zod parse + React `cache()`). All content pages (`rankings/**`/`[owner]/[name]`/`o/[login]`/`categories/**` and others) import `@/lib/data`; the home `page.tsx` and `pulse/page.tsx` read indirectly through the shared `PulseView` (so they do not import it directly).

### 3.2 Data access layer (`web/lib/`)

The Zod schemas of [DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 live in `web/lib/contracts/`, and readers live in `web/lib/data/`. The structure is grouped by artifact family, not one file per artifact:

```text
web/lib/
  contracts/        # Zod schema (single type source of truth), barrel = index.ts
    common.ts       # shared/enum/rank/heatmap/meta and other base schemas
    lookup.ts  entity.ts  live.ts  canonical.ts  categories.ts
    compare.ts  search.ts  workflow.ts
  data/             # readers (fetch Blob + schema.parse + React cache dedupe), barrel = index.ts
    source.ts       # readView: assemble the Blob direct URL + fetch + parse-once (dedupe ZodError by path+generation)
    lookup.ts  rank.ts  entity.ts  heatmap.ts  snapshot.ts  meta.ts
    search.ts  compare.ts  categories.ts  watermark.ts
  search/           # client search pure core (MiniSearch config + query; SearchBox lazy-loads into a Web Worker)
    core.ts
```

> rank/heatmap/meta schemas are collected into `common.ts`, and readers are split into files by rank/heatmap/snapshot/meta.

**Three essentials of a reader** ([DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 + [SEO](./SEO.md) §2):

```ts
import { cache } from "react";
import { RepoEntitySchema } from "@/lib/contracts/entity";

// React cache(): within the same request, generateMetadata and the page body share one read (deduped)
export const getRepoEntity = cache(async (id: number) => {
  const url = blobUrl(`entity/repo/${id}.json`);      // see OPS Blob layout
  const res = await fetch(url, { /* core pages may add next:{revalidate:false} */ });
  if (res.status === 404) return null;                 // unknown → the page calls notFound() (404)
  return RepoEntitySchema.parse(await res.json());     // the type is inferred from Zod, do not write a separate interface
});
```

- **At runtime only `fetch` + `parse`** — no aggregation, no engine ([ARCHITECTURE](./ARCHITECTURE.md) rendering strategy).
- **Unknown param → `notFound()`** (404, soft 200 forbidden, see [SEO](./SEO.md) §3.2). `[owner]/[name]/page.tsx` first looks up the id with `getRepoIdByFullName()`; if not found, it looks up `lookup/aliases.json` (`getAliasMap`), and on a rename-alias hit `permanentRedirect`s (308) to the current `full_name`; if still absent, `notFound()`, then `getRepoEntity(id)`, and if empty, `notFound()` again.
- **`categories/assignments`**: a new generation is an index + 32 repo-id shards. `getCategoryAssignments()` batch-reads shards with limited concurrency and then assembles them (CF Workers subrequest cap; `HOSTING_TARGET=cf` is tighter), then hands them to non-CF repo/org/ranking-detail. Vercel `/rankings` uses `getCategoryAssignmentsForRepos` to read only the shards needed by the leading rows, and does so after the core ranking views; Vercel ranking-detail / repo / org likewise narrow by this page's ids. On CF these pages, like `/rankings`, skip the assignment fan-out (language-category exits remain); the full `loadCategoryAssignments` is hard short-circuited on CF. ISR keeps `force-cache` / daily revalidate, and `no-store` is forbidden. An already-published v1 monolith remains readable (a single GET, no fan-out).
- **`bootstrap/latest.json`**: when a page read hits 403/429/5xx, it does bounded retry + jitter, and does not treat 403 as 404. On failure it uses the last-known-good pointer or the managed `views/latest.json`. A structured error is recorded only once within the same TTL.

### 3.3 Which views each page reads (page ↔ JSON contract mapping)

| Page | Primary reads | Notes |
|---|---|---|
| Home `/` | the live generation's `hot-snapshot.json` (`home`: `year_spine` / `current_month_top` / `on_this_day`) | Hot-set ISR reads only a KB-scale snapshot; per-section source-as-of is in `freshness` |
| Year page (current year) | the live generation's `hot-snapshot.json` (`current_year`) + base `heatmap/year/{Y}.json` | The current year uses the hot snapshot |
| Year ranking (historical) | `rank/year/{Y}/{repo,org}/{flow,stock}.json` + `heatmap/year/{Y}.json` | Frozen view |
| Month ranking (current month) | in-generation `rank/month/{period}/repo/{flow,stock}.json` + `heatmap/month/{period}.json`, falling back to base when missing | All live siblings are selected by the same pointer |
| Month ranking (historical) | `rank/month/{period}/{repo,org}/{flow,stock}.json` + `heatmap/month/{period}.json` | Three major rankings + daily heatmap |
| Week ranking | The current week prefers in-generation `rank/week/{period}/repo/flow.json`; historical weeks read base | Standalone page |
| repo page | `entity/repo/{id}.json` (`curve`/`milestones`/`monthly_table`/`rank_history`) | The mover refreshes the same day (curve includes `recent_daily`) |
| org page | `entity/org/{login}.json` (`members`/`curve`/`rank_history`) | Member aggregate curve |
| All-time ranking `/rankings` | `rank/all-time/{repo,org}/stock.json` (or `hot-snapshot.all_time`); Vercel also reads the leading-row assignment shards, and CF skips them | The repo ranking and the org ranking sit side by side; CF preview keeps only language-category exits |
| Pulse `/pulse` | the same live generation's `hot-snapshot.json` + the current week rank | Daily/weekly atomically switches the generation |
| All ranking pages | + `lookup/repos.json` / `lookup/orgs.json` | **lookup-join**, see §3.4 |

### 3.4 lookup-join pattern (rankings store only ids, and the build joins out display fields)

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §Global conventions + §2.1/2.2: ranking JSON **stores only `id`/`login` + numbers**, and does not embed names/languages. The build reads `lookup/*` and joins out display fields:

```ts
// rendering a month ranking: the rank file gives id+value, lookup gives owner/name/lang
const rank = await getRank("month", "2024-10", "repo", "flow"); // items: [{rank,id,value,prev_rank}]
const lookup = await getRepoLookup();                            // { [id]: {owner,name,full_name,language,...} }
const rows = rank.items.map(it => ({ ...it, ...lookup[String(it.id)] }));
```

Benefit ([DATA-CONTRACTS](./DATA-CONTRACTS.md)): ranking files stay small, and a repo rename only needs to update lookup (not every ranking). `joinRepoRank`/`joinOrgRank` in `web/lib/data/rank.ts` join `rank.items` (`{rank,id,value,prev_rank}`) with `lookup/*` into display fields and then feed `RankingList`.

### 3.5 Cache consistency

- **live generation pointer**: every live reader first resolves `live/latest.json` with a 60s revalidate + in-memory single-flight, then reads the immutable `live/generations/<generation>/<logical-path>`. Periodic files such as rank / month heatmap, after the current object is confirmed 404, walk back along at most 64 manifests that pass Zod validation, are acyclic, and match the generation id; if the manifest declares the object exists but the object is 404, or there is a manifest/transport/schema error or a cycle, it still fails closed. When the requested period is newer than the hop's `week`/`month`, walking stops and legacy may be used; if it exceeds 64 generations and has not reached `null`, it truncates to missing (the page falls back to base / an empty state, and does not 500). Only a complete chain to `previous_generation:null` enables the legacy flat migration edge. Under high-concurrency SSG, a public CDN that keeps returning 403 does not count as 404: a page read tries that historical object at most 2 times, and after a 60-second circuit break by Blob/key immediately stops the live chain and hands off to base / `notFound`, never selecting an older generation; the circuit break recovers automatically, and the required product gate still judges 403 as failure. `current_month` / `hot-snapshot` do not use the history chain. On a pointer error, use the already-validated current generation memo, otherwise fail closed, to avoid mixed generations.
- `meta.schema_ver`: the build checks version match at startup, and fails fast on mismatch ([DATA-CONTRACTS](./DATA-CONTRACTS.md) §3).
- **base view version pointer**: base `rank/*` / `entity/*` / `heatmap/*` are consumed by "first reading the `views/latest.json` pointer to resolve the version prefix, then reading the views under that prefix" ([VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md) §4.1/§7). The default data-cache TTL is 3600 seconds; 1-day ISR routes such as repo / categories / OG use the daily base read entry (86400 seconds), so a pointer fetch does not shorten the route TTL. The pointer fetch carries a shared tag, and publish / rollback invalidate it actively; every in-process memo, however long the data-cache TTL, is limited by the 60-second visibility SLA. This step is **encapsulated in `web/lib/data/`**, component argument shapes stay the same, and it is **transparent to pages**; the "live first, fall back to base" semantics are kept ([DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.11).

---

## 4. Zero Client JS Content Pages

### 4.1 Charts = server-rendered SVG / DOM

Content pages have **0 client JS** ([REQUIREMENTS](./REQUIREMENTS.md) §7, [ARCHITECTURE](./ARCHITECTURE.md) performance strategy, [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §zero client JS constraint). All charts emit markup on the server, and motion is pure CSS:

| Chart | Component (`web/app/_explore/`) | Form | Motion (CSS, reduced-motion pins the end state) |
|---|---|---|---|
| Star curve | `StarCurve.tsx` | Server SVG `<path>` (line + area gradient) + milestone gold dots + a mono year axis | `.curve-line` `stroke-dashoffset` draw + `.curve-area` fade-in |
| Calendar/month heatmap | `Heatmap.tsx` | DOM grid + `color-mix` intensity (cool gray→bright gold, not GitHub green) | `animate-rise` stagger |
| Year spine (home) | inline in `page.tsx` (`.spine-bar-y`) | DOM bars, height `--h=gained/max` | `grow-y` spring growth |
| Month spine (year ranking) | inline in `rankings/[year]/page.tsx` (`.spine-bar`) | DOM bars, width `--w` | `grow` spring growth |
| Ranking rows | `RankingList.tsx` | Ordered list + right-aligned mono metrics | `animate-rise` stagger |

> SVG/DOM charts are all RSC (no `"use client"`), which meets the constraint. The org aggregate curve reuses `StarCurve` (the `curve` shape of `entity/org` is the same as repo). Extracting `YearSpine` as a component for home/pulse reuse is an optional optimization.

### 4.2 Allowed client JS (three exceptions)

[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) specifies explicit exceptions: an anti-flicker inline script (theme + lang), the theme-toggle button, and PWA SW registration (`RegisterSW.tsx` + `manifest.ts`). These are all tiny and do not render body content.

| Client JS | File | Nature | DESIGN-SYSTEM exception |
|---|---|---|---|
| Anti-FOUC theme script | `layout.tsx`: `themeInit` const `:56`, inline `<script dangerouslySetInnerHTML>` `:67` | Before paint, read `localStorage.theme` and set `data-theme` + `theme-color` | ① |
| Theme toggle button | `components/ThemeToggle.tsx` (`"use client"`) | Writes `data-theme` + `localStorage` + syncs `meta[theme-color]`; icons show/hide via CSS | ② |
| Service Worker registration (PWA) | `_explore/RegisterSW.tsx` (`"use client"`) | Registers `/sw.js` (failure is silent) + `manifest.ts` | ③ (PWA standalone) |

- These are all tiny and do not render content-page body text → they do not break "zero client JS for body text, and crawlers get the full HTML" ([SEO](./SEO.md) §3a).
- `<html suppressHydrationWarning>` (`layout.tsx:65`) works with the theme script to avoid hydration warnings.

---

## 5. Motion

All pure CSS, zero JS ([DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §Motion), and the tokens already live in `web/app/globals.css`:

| Motion | Implementation (globals.css) | Notes |
|---|---|---|
| **Cross-document page transition** | `@view-transition { navigation: auto; }` (`globals.css:263`) | Pure CSS, zero JS; harmless degradation when the browser does not support it |
| Route fade-in | `template.tsx` remount + `.page-enter` (`globals.css:231`, `--animate-page` `:171`) | template remounts on every navigation, and the CSS animation naturally replays |
| Entrance rise | `--animate-rise` (`:168`) + `rise` keyframe (`:174`) + `animation-delay` stagger | Titles / ranking rows / heatmap cells |
| Spring | `--ease-spring` (CSS `linear()` precomputed keypoints, `globals.css:132`) | bar growth / hover lift / active rebound |
| emphasized easing | `--ease-emphasized` (`cubic-bezier(0.2,0,0,1)`, `globals.css:131`) | Theme/color transitions, fade-in |
| Curve drawing | `.curve-line` (`:250`) / `.curve-area` (`:256`) | `stroke-dashoffset` draw + area fade-in |
| Status pulse | `--animate-status` (`:170`) / `status-pulse` keyframe (`:190`) | the "rising" status dot on `/pulse` |

**reduced-motion fallback (mandatory, `globals.css:275`)**: globally turn off animation/transition, and pin the animation end state (`.spine-bar` directly `scaleX(var(--w))`, `.curve-line` `stroke-dashoffset:0`, `.curve-area` `opacity:1`), so layout and the end state stay correct with no motion. Entrance animations of new components **must** add the corresponding pinned end state in this block.

> Spring-curve keypoints are precomputed at build time ([DESIGN-SYSTEM](./DESIGN-SYSTEM.md) implementation checklist) — `globals.css` is currently a handwritten snapshot, to be replaced after the generator lands.

---

## 6. Component Architecture

### 6.1 Existing component inventory (`web/app`)

| Component | File | Type | Role |
|---|---|---|---|
| Top bar Top App Bar | `_explore/Chrome.tsx` | RSC + islands | sticky frosted-glass bar: logo (gold ★ + wordmark) + optional tag pill + search box (SearchBox) + navigation (Pulse / Rankings · Categories `md+` · Compare `sm+` · About `sm+`) + language/theme switch; the Chrome shell is server-rendered, and SearchBox/LanguageSwitcher/ThemeToggle hydrate |
| Site-wide search SearchBox | `_explore/SearchBox.tsx` | **Client island** | Navbar search box; on first focus it lazy-loads `/search-index` with browser revalidation semantics, description is truncated at the route layer, and MiniSearch index building and queries run inside a Web Worker (prefix/fuzzy 0.2/weighted by stars). Multi-action results use a named non-modal `dialog` + a plain `list`: ↑↓ move real focus, Enter opens the result, Esc closes and returns focus to the input, and Tab keeps the native link→compare-button order; compare selection is expressed only by the button `aria-pressed`. Failure retry uses cache reload, and aborts/discards old requests. Each result has a "+compare" checkbox + a bottom "compare N →" that goes to `/compare?repos=...` (a row click still goes to the repo) |
| Share ShareButton | `_explore/ShareButton.tsx` | **Client** | Copy link + X share intent; 7-language `share.*` chrome i18n; wired to repo / ranking month-week / year pages. Ranking pages also have a dynamic OG card (`rankings/[year]/[period]/opengraph-image.tsx` + `[year]/opengraph-image.tsx`, sharing `lib/og-card.tsx`) |
| Monthly narrative Narrative | `_explore/Narrative.tsx` | RSC | A 7-language narrative at the top of the month ranking; the server renders each locale's text once, and `html[lang]` CSS shows the current language. Copy is assembled at month-page **render time** by a deterministic template (`lib/narrative.ts`) from ranking data — **no AI / no artifact** |
| Ranking RankingList | `_explore/RankingList.tsx` | RSC | Ordered list, `variant: "gained"|"rate"|"crossed"`; a row = gold rank + mono repo name + language/count pill + right-aligned metric; the whole row is `<Link>`→the repo page; the overall ranking's two columns use a fixed row height and single-line truncation, so both sides are the same height when the count is the same |
| Heatmap Heatmap | `_explore/Heatmap.tsx` | RSC | DOM grid + `color-mix` intensity; an optional `href` wraps `<Link>`; `square`/`columns` control the calendar layout |
| Star curve StarCurve | `_explore/StarCurve.tsx` | RSC | Server SVG area chart + milestone gold dots + inflection marker dots (three-level color dots + `<title>` tooltip, zero JS) + `role="img"` + aria-label |
| Compare curve CompareCurve | `_explore/CompareCurve.tsx` | **Client** | Multiple overlaid polylines + a legend (color swatch+full_name+star count) + a shared y axis + **absolute↔align-to-10k toggle**; pure-core normalization is in `lib/compare/core.ts` |
| Breadcrumbs Breadcrumbs | `_explore/Breadcrumbs.tsx` | RSC | Default-language server rendering; Home→year→month / Home→owner→repo and others + `BreadcrumbList` JSON-LD ([SEO](./SEO.md)) |
| Structured data JsonLd | `_explore/JsonLd.tsx` | RSC | Injects `application/ld+json` (with `@/lib/jsonld`'s `CollectionPage` / `ItemList` / entity builder) |
| Footer Footer | `_explore/Footer.tsx` | RSC + island | Default-language server rendering; build timestamp + a LanguageSwitcher language island |
| Pulse view PulseView | `pulse/PulseView.tsx` | RSC | Shared body of the home page and `/pulse`: this-week/this-month/this-year pulse, an all-time-giants bridge, and "on this day in history". Optional `includeWebsiteLd` injects `WebSite` JSON-LD (home only) |
| Compare client CompareClient | `compare/CompareClient.tsx` | **Client** | In-page interaction layer of `/compare`: read URL `?repos=` → reuse the search index to map ids → concurrently fetch `/repo-curve` → render `CompareCurve`; a multi-select searcher (based on `lib/search/core`) + chip removal + URL `router.replace` sync. The index and curves revalidate by default; a first index failure can retry in place, and a single curve failure can retry with cache-bypass; every class of request aborts the old request and refuses to let a stale completion overwrite the new state |
| OG image rendering (site / repo / month+week / year) | `opengraph-image.tsx` × 4 | RSC (next/og) | Dynamically generates a 1200×630 PNG; `revalidate=86400`, sharing `lib/og-card.tsx` (graphite gray+gold, stars inline SVG) |
| Theme toggle ThemeToggle | `components/ThemeToggle.tsx` | **Client** | Interactive button (see §4.2) |
| Language switch LanguageSwitcher | `components/LanguageSwitcher.tsx` | **Client** | Generates locale URL `<a>` links from the current route locale and canonical path; after navigation the server returns HTML in the corresponding language (§7) |
| Page transition Template | `template.tsx` | RSC | Remount fade-in container |
| SW registration RegisterSW | `_explore/RegisterSW.tsx` | **Client** | PWA (see §4.2) |

> Breadcrumbs / footer / language switch are shared components; prev-next navigation / the spine are still inlined in each page.tsx (see §6.3).

### 6.2 server-by-default principle

- **The content body is always RSC**: rank lists, heatmaps, the repo body, the org body, the star curve (StarCurve), and other data-bearing charts and tables are all server-rendered, with zero client JS.
- **Client components are limited to interaction islands**: SearchBox / ShareButton / CompareCurve+CompareClient / ThemeToggle / LanguageSwitcher / RegisterSW. Chrome / Footer / Breadcrumbs / `<T>` are already server-side; Narrative is a Server Component and uses `html[lang]` CSS to switch among already-rendered locale texts. The full inventory and decision rules are in [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) "client JS exception list".
- Before adding a page, first confirm the chosen interaction cannot be done in pure CSS / on the server, then introduce a client component; at minimum do not let the content body (rank list / heatmap / star curve) become client.

### 6.3 Shared component catalog

| Component | Location | Use / reuse |
|---|---|---|
| `Breadcrumbs` | `_explore/` | Home→year→month / Home→owner→repo ([SEO](./SEO.md) §6.7) |
| `Footer` | `_explore/` | Footer navigation + the language-switch landing point |
| `layout-tokens.ts` | `_explore/` | Shared page horizontal gutter: `PAD_X = px-[clamp(1.25rem,5vw,2.5rem)]`, aligned to the [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) locked baseline |
| `LanguageSwitcher` | `components/` | Current language + a dropdown to switch to the other languages; en/ja/zh/zh-TW/ko/es/fr; each item is a plain link to the corresponding locale URL |
| `JsonLd` | `_explore/` | Injects JSON-LD such as `CollectionPage`, `ItemList`, and repo/org entities |
| `PrevNext` (`NavArrow`/`MonthArrow`) | inline | Prev/next month / prev/next year / prev/next week (year/month/week pages) — can be extracted as a component |
| `EntityCard` | inline | repo/org cards (pulse / rankings) — can be extracted as a component |
| `YearSpine` | inline | Home spine (home / pulse) — can be extracted as a component |

### 6.4 Component ↔ JSON contract mapping

| Component | Argument source (DATA-CONTRACTS) |
|---|---|
| `RankingList` | rows after `rank.items` (`{rank,id,value,prev_rank}`) **join** `lookup/*` (see §3.4); `prev_rank` drives ↑↓/enter-leave TOP |
| `StarCurve` | `entity/repo.curve.monthly` (`[period,adds,total_end]`) takes `total_end` as `total`; `milestones` reads only the frozen exact dates of `entity/repo.milestones.crossed_10k/50k/100k`, and thresholds such as 150k+ with no frozen field are not reverse-inferred from the curve; `inflections` come from `entity.inflections` (period→monthIndex mapping); the tail appends `curve.recent_daily` |
| `CompareCurve` | The client fetches concurrently from `/repo-curve?id=` ([DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.15); `points=[period,total]` draws the line, and `crossed_10k` is for "align to 10k" x-axis remapping; normalization/colors are in `lib/compare/core.ts` |
| `Heatmap` | `heatmap/{scope}/{period}.cells` (`[date|period, total]`); the current month merges `current_month.json.daily_totals` |
| Spine (YearSpine) | `hot-snapshot.home.year_spine` (`[year, total]`) |

> ⚠️ `entity/repo.curve.recent_daily` may be negative (unstar, [DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5); `StarCurve` takes `curve.monthly.total_end` (cumulative) as `total`, and still draws the axis/area under a monotonic-increase assumption — when the real curve's tail net segment falls back, rendering correctness needs to be confirmed; `max` should take the sequence's actual maximum.

---

## 7. i18n Implementation

### 7.1 Translation boundary ([PRODUCT](./PRODUCT.md) i18n / [SEO](./SEO.md) §10)

| Translated | Not translated (data is language-neutral) |
|---|---|
| UI chrome (top bar / buttons / labels), navigation, year labels, About body, **meta + OG copy**, breadcrumb names | repo names, owner/org login, descriptions, languages, topics, **all numbers** |

> This directly decides that the dictionary covers only "UI words", and does not touch any data field that comes from a JSON view.

### 7.2 Dictionaries (handwritten; the route locale is chosen on the server)

```text
web/lib/i18n/
  dictionaries/
    en.ts   ja.ts   zh.ts   zh-tw.ts   ko.ts   es.ts   fr.ts
  index.ts                       # getDictionary(locale) — lazy-load dictionaries
  client.tsx                     # server-safe fallback helper; pages should prefer the route dictionary
  client-runtime.tsx             # "use client" I18nProvider / useDict / useChrome (only a fallback for interaction tools, and does not wrap content pages)
  server.ts                      # ⚠️ deprecated: getPreferredDictionary reading the cookie breaks static; do not call it in page/layout
```

```ts
// web/lib/i18n/index.ts (illustrative)
const dicts = { en, ja, zh, "zh-TW": zhTw, ko, es, fr } as const;
export type Locale = keyof typeof dicts;
export const getDictionary = async (l: Locale) => (await dicts[l]()).default;
```

- `(en)/layout.tsx` and `(localized)/[locale]/layout.tsx` choose `<html lang>` and pass the route locale / dictionary into the shared shell; pages and chrome do not read the cookie.
- Chrome text nodes use the route dictionary; `Chrome`/`Footer`/`Breadcrumbs` receive the locale and dictionary and then server-render the current language. Pulse page copy goes through `nav.pulse` / `pulse.*`, so the old "trending" name does not keep confusing editorial meaning. **Data** (numbers/dates/repo names) is language-independent and is server-rendered into static / ISR HTML from the source data.
- When the client i18n resolver misses a key it first falls back to English `en[path]`, and returns the raw path only when English is also missing or the path points at an object node, so a partial dictionary gap is not exposed directly to the user.
- `LanguageSwitcher` shows the current route locale, and dropdown items are `<a>` links to the corresponding locale URL; it does not write a cookie, does not dispatch `gsc:localechange`, and does not translate the current page on the client. `/api/lang` remains as a compatibility entry: after writing `gsc_lang` it redirects to the locale URL.
- SEO title/description, JSON-LD, FAQ, breadcrumbs, and the deterministic narrative are chosen on the server with the route locale; canonical points at the current locale's own URL, and `hreflang` / `x-default` are emitted by `pageMeta()`.

### 7.3 canonical / hreflang (Metadata API)

Server-side multilingual URLs have landed: when calling `pageMeta()`, pass the locale, the language-prefixless canonical path, and the localized title / description; the helper generates the current locale canonical, `og:url`, `og:locale`, and the full `hreflang` matrix (including `x-default` -> English prefixless URL). Page body, metadata, the sitemap, and language-switch navigation all take the locale URL as authoritative.

```ts
return pageMeta({
  locale,
  path: "/rankings",
  title,
  description,
});
```

- `metadataBase` reads `NEXT_PUBLIC_SITE_URL` ([OPS](./OPS.md) environment variables / [SEO](./SEO.md) §2) to fit preview/production.

---

## 8. Concrete touchpoints with the existing app

> Land the above onto "which existing files to touch". **This document is a spec and does not write application code**.

1. **Data layer**: `web/lib/contracts/` (Zod) + `web/lib/data/` (fetch Blob + parse + `cache()`) is the only entry for pages to read JSON views.
2. **Segment config**: `rankings/[year]`/`[period]` prerender the current year/month + `dynamicParams`;repo/org `generateStaticParams() => []` switch to on-demand ISR; an unknown param calls `notFound()`.
3. **`web/proxy.ts` / `next.config.ts`**: proxy handles `/en/*` canonicalization and cookie/header preference redirects; `next.config.ts` does not do compatibility redirects for old path shapes.
4. **Pages**: the `(en)` and `(localized)/[locale]` route groups both call the `_localized/*` shared implementations, covering `pulse`/`rankings`/`rankings/[year]`/`[period]`/`[owner]/[name]`/`o/[login]`/`categories`/`compare`.
5. **i18n**: route-locale server rendering (mechanism in §7, rendering mode in §2.5).
6. **SEO companion pieces**: `app/sitemap.xml/route.ts`, `app/sitemap-*.xml/route.ts`, `app/robots.ts`, each page's `generateMetadata`, and JSON-LD.
7. **cron route**: `app/api/cron/{daily,weekly}` (`revalidatePath` + `CRON_SECRET`); the endpoint contract is in [API.md](./API.md).
8. **Shared components / token helper**: `Breadcrumbs`/`Footer`/`LanguageSwitcher`/`JsonLd` are extracted as shared components; page horizontal padding uniformly uses the locked baseline clamp value via `PAD_X` in `_explore/layout-tokens.ts`; `PrevNext`/`EntityCard`/`YearSpine` stay inline (§6.3).

---

## 9. Currently known openings

| # | Item | Current status |
|---|---|---|
| **D** | **StarCurve non-monotonic curve rendering** | `entity/repo.curve.recent_daily` may be negative (unstar,[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5);`StarCurve` takes the cumulative `curve.monthly.total_end` as `total`, and needs confirmation that y-axis/area rendering is correct when the curve tail falls back (`max` takes the sequence's actual maximum) |
| **I** | **`_explore/` naming** | Components live in `app/_explore/` (Next.js private folder convention), and the status quo is kept |

---

## 10. Invariant checklist (frontend layer)

**Routing**
- The week ranking `/rankings/[year]/W[week]` is standalone, shares `[period]` with the month ranking, and disambiguates by the `W` prefix
- org `/o/[login]`, repo `/[owner]/[name]`, overall ranking `/rankings`, pulse `/pulse`
- i18n URLs: English has no prefix; ja/zh/zh-TW/ko/es/fr use prefixed URLs; `/en/*` 308s to prefixless English; the full `hreflang` / `x-default` matrix is supported

**Layering ↔ config**
- `cacheComponents` stays off (the `next.config.ts` comment explains it)
- `rankings/[year]`/`[period]` use `generateStaticParams` to prerender the current year/current month + `dynamicParams`
- Data changes rely on cron `revalidatePath`; `app/api/cron/{daily,weekly}` authenticate with `CRON_SECRET`
- Rendering mode: route locale + server-localized HTML (§2.5) → the build route table stays `○` static / `●` SSG on-demand ISR

**Data consumption**
- `web/lib/contracts/` (Zod) + `web/lib/data/` (fetch+parse+`cache()`) is the only entry for pages to read JSON views
- Rankings use lookup-join (rank item + `lookup/*`); an unknown param → `notFound()`
- Daily view reads carry `?v=<date>` cache-bust; `meta.schema_ver` is checked at startup

**Zero client JS**
- Content-page **data body and chrome shell** are server-rendered (charts are server SVG/DOM); only explicit interaction islands may hydrate: SearchBox, ShareButton, ThemeToggle, LanguageSwitcher, RegisterSW, and `/compare`'s CompareClient/CompareCurve
- New entrance animations add a pinned end state in the `prefers-reduced-motion` block

**i18n**
- Handwritten dictionaries `web/lib/i18n/` (en/ja/zh/zh-TW/ko/es/fr); data fields are not translated
- Chrome is server-rendered by route locale: the page passes in the dictionary; `i18n/client-runtime.tsx` is only a fallback for real client tools; `i18n/server.ts` is deprecated
- Each page's `pageMeta()` takes a language-prefixless canonical path as input, and outputs the current locale canonical and the full `alternates.languages`
- `metadataBase` reads `NEXT_PUBLIC_SITE_URL`

---

## 11. Category Routes

Phase 2 category browsing is implemented in `web/app/categories/`.

Routes:

- `/categories` renders the registry-driven category index.
- `/categories/[dimension]` renders one dimension index, such as
  `/categories/language`.
- `/categories/[dimension]/[slug]` renders a category detail page. Deploy-time
  static params include only the finite priority-language set; every other
  public registry category is generated through on-demand ISR.
- `/categories/[dimension]/[slug]/page/[page]` renders page 2+ of large
  categories from precomputed category rank page artifacts + `lookup/repos.json`.
  Page 1 stays canonical at `/categories/[dimension]/[slug]`; page 2+ has empty
  deploy-time static params and is generated through on-demand ISR.

Data and rendering:

- `web/app/categories/category-page-data.ts` owns route helpers, fallback
  registry construction, public-category filtering, pagination path helpers,
  and static params.
- Category pages read `categories/registry.json`,
  `rank/category/<dimension>/<slug>/all-time/repo/stock.json`,
  `rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json`,
  and `lookup/repos.json` through `web/lib/data/categories.ts`.
- The `/categories` index groups public categories by registry dimension rather
  than hard-coding only languages.
- The category index, dimension pages, and detail pages use 86400-second ISR so a
  newly published registry can appear without a full redeploy while avoiding
  minute-by-minute background regeneration.
- The chrome nav exposes `/categories` through the localized `nav.categories`
  dictionary entry.
- Category index, dimension pages, and category detail pages emit server-rendered
  `ItemList` JSON-LD from the same rows that are visible in HTML. Detail page N
  offsets `position` by the pagination start rank.
- Category detail pages with more than one page expose a visible "Browse all"
  pagination anchor and related same-dimension category links.

## 12. SEO Link Surfaces

The SEO link graph is server-rendered and deterministic; it does not add client
JavaScript.

- Repo pages include a compact link hub after the summary area. It links to the
  owner org page, public category pages for the repo, and up to six related
  repositories chosen deterministically: same owner first, then same primary
  language, sorted by stars and `full_name`.
- Year, month, and week ranking detail pages keep their top slices but expose a
  "Complete ranking" anchor to the full server-rendered rank list on the same
  page.
- `/rankings`, ranking detail pages, category list pages, category detail pages,
  and `/o` owner index pages emit `ItemList` JSON-LD from the server rows.
- The footer links `/categories` and `/o` from every page so crawler entry points
  for category and owner directories are not limited to the top app bar.

## 13. Responsive Behavior

- `Chrome.tsx` is still a Server Component. Mobile primary navigation is a
  native `<details>/<summary>` disclosure, so it adds no new client JavaScript.
  Below `sm`, Pulse / Rankings / Categories / Compare / About are reachable from
  that disclosure with a 44px trigger. At `sm+`, desktop inline navigation keeps
  the existing breakpoints: Pulse and Rankings visible, Compare/About visible
  from `sm`, Categories visible from `md`.
- The mobile chrome row uses a compact four-column layout for SearchBox,
  language, theme, and menu controls. `LanguageSwitcher` keeps its full language
  label from `sm` and uses a 44px locale-code trigger below `sm`.
- `Heatmap.tsx` keeps the DOM grid and brand `color-mix` ramp, but caps columns
  responsively for readability: up to 8 columns on narrow 320px phones, up to 10
  columns from 375px, and the caller-provided column count again from `md`.
- `RankingList.tsx` constrains row, rank, owner, and metric widths on narrow
  screens so long repository names truncate inside the row instead of widening
  the page.
- Repo recent rows on `/[owner]/[name]` are single-column on narrow screens and
  return to the three-column month/rank/adds layout from `sm`.
- `manifest.ts` has a single static Web App Manifest `theme_color`; browser
  chrome follows light/dark through `layout.tsx` `viewport.themeColor` media
  entries and the runtime `ThemeToggle` meta update.
