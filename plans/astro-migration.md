# Astro page-layer migration

## Goal, scope, and authority

Owner order SB-20261021-10 (2026-10-21) replaces the whole page layer with
Astro. Gate 0 establishes feasibility without waiting for Product page specs.
Collection, aggregation, the R2 stores, data-pre, publication writers, and
`web/lib/contracts` JSON contracts remain unchanged. Data coverage stays locked.

This plan is a migration snapshot of the source inventory at
`29ef525384df2672844fdea04f6d9c32c094c043`. The maintained route inventory remains
[UIUX-ROUTE-INVENTORY.md](../docs/UIUX-ROUTE-INVENTORY.md). Rendering and cache
semantics come from [FRONTEND.md](../docs/FRONTEND.md) and
[VINEXT-HOST.md](../docs/VINEXT-HOST.md); citation requirements come from
[GEO.md](../docs/GEO.md), with endpoint contracts in [API.md](../docs/API.md).

Shared conventions for every migration card:

- `feat/astro-site` is created from `origin/pre` and normally pushed by Gate 0.
  Gate branches start there and PRs target it. Only the final switch PR targets
  `pre` from `feat/astro-site`. This explicit order overrides the usual feature
  PR base for this migration. Never target or push `main`, `pre`, or `preview`.
- `astro/` owns its package.json and bun.lock, Bun 1.4.2, and Node 24.
  Exact dependencies are pinned. `web/` stays untouched and independently
  buildable until the final switch; compare both hosts against the same fixture.
- Import the existing framework-independent contracts, locale/path helpers,
  redirect sanitizer, publication reader, and cache-policy constants directly
  from `web/lib`. Do not fork schemas. Framework-bound readers in `web/lib/data`
  need an Astro transport boundary with conformance tests before page migration;
  do not load React/Next request caches into Astro. Gate 0 exercises a narrow
  read-only, captured-publication JSON reader against those exact schemas.
  Before removing `web/`, move reused pure modules to a shared directory with
  unchanged contract tests in the same final PR.
- Cloudflare Workers hosting uses pinned `cf` only. No Wrangler invocation,
  legacy packaging script, deployment, remote cron/refresh, binding mutation,
  schedule, DNS, secret, or R2-object change is authorized. If a required build
  dependency hard-requires Wrangler, stop and report a needs_human block with
  evidence and options; do not patch around it. GitHub Actions stays disabled.
- Each card has one issue, one branch, one PR, English repository text, a
  markdown plan, step commits, and an independent review. No executor merges.

Out of scope for Gate 0: product redesign, complete page bodies, new public
pages, new data fields, production activation, operational workflow migration,
and changes to existing CI, typed Worker configuration, or deploy scripts.

## Current source inventory

There are 33 page.tsx files: 17 English files and 16 localized files. These
represent 16 shared route templates across seven locales, plus the English-only
cockpit spike; dynamic parameters expand them further. Do not multiply 33 by 7.
English has no locale prefix; the six other locales are `ja`, `zh`, `zh-TW`,
`ko`, `es`, and `fr`. `/en/*` redirects permanently to prefixless English.
Repository file parameters `(en)/[locale]/[owner]` mean owner/name in the URL.

| Page/mechanism | Canonical English paths | Existing rendering/data behavior | Gate | Product spec |
| --- | --- | --- | --- | --- |
| Home and pulse | `/`, `/pulse` | Shared `_localized/pulse.tsx`; hot snapshot, lookup and recent weekly ranks; home adds WebSite structured data | 2 | Required for body/layout |
| Rankings index | `/rankings` | Repo and org all-time lists, lookup joins, core publication invalidation | 2 | Required |
| Ranking details | `/rankings/{year}`, `/rankings/{year}/{month}`, `/rankings/{year}/W{week}` | Two route templates; available current periods prebuilt, history on demand; ranks, heatmap and live overlays | 3 | Required |
| Categories | `/categories`, `/categories/{dimension}`, `/categories/{dimension}/{slug}`, `/categories/{dimension}/{slug}/page/{page}` | Registry/dimensions and priority details prebuilt; remaining details/pagination on demand; page 1 redirects | 3 | Required |
| Repository | `/{owner}/{name}` | Empty static params; entity, daily lookup/aliases, canonical rename redirect, categories and meta | 4 | Required |
| Organizations | `/o`, `/o/page/{page}`, `/o/{login}` | Lookup/pagination plus entity/member/curve detail; detail static params empty | 4 | Required |
| Compare | `/compare?repos=...` | Static server shell and curated comparisons; selected repos remain client URL state, tracked repos only | 5 | Required; no new pair routes |
| About/privacy | `/about`, `/privacy` | Localized static copy; about reads meta/export links, privacy excluded from sitemap | 2 | Required; preserve existing wording |
| Cockpit | `/cockpit` | English-only pre spike, posed frames, no storage reads, noindex and absent from navigation/sitemap | 5 | Required: retain or retire |
| Missing/error pages | Both route groups' not-found, layouts and templates | Locale-aware shell, server body, client retry/navigation boundary | 1/5 | Required for presentation |

There are 18 route.ts files, four OG image modules, and two metadata modules:

| Endpoint inventory | Contract to preserve | Gate |
| --- | --- | --- |
| `/api/lang` | GET/HEAD; 307; gsc_lang cookie for one year, Path=/, SameSite=Lax, Secure in production; sanitize before/after stripping locale; no publication dependency | 0 |
| `/search-index`, `/repo-curve?id=...` | Existing method/status/input validation; read-only published JSON; s-maxage=3600, stale-while-revalidate=86400 | 1/5 |
| `/sitemap.xml`, `/sitemap-{en,ja,zh,zh-TW,ko,es,fr}.xml` | Index plus seven handlers; hreflang and canonical path set, data-driven category eligibility, no privacy/cockpit/compare-query URLs | 1/6 |
| `/.well-known/deployment` | Public build identity, no-store, shell intercept; no storage reads | 6 |
| `/api/cron/daily`, `/api/cron/weekly` | Existing authenticated publication operations; preserve data layer and schedules, never call live to test | 6 |
| `/api/workflows/refresh/{start,step,rollback,revalidate}` | Existing auth, leases, conditional publication, tag/path invalidation; revalidate POST is publication-independent | 6 |
| `/opengraph-image`, `/{owner}/{name}/opengraph-image`, `/rankings/{year}/opengraph-image`, `/rankings/{year}/{period}/opengraph-image` | Four existing 1200x630 image modules; no localized image files. Preserve fallback/status behavior; current unsuffixed URL 404 issue is a baseline discrepancy, not a silent migration change | 5 |
| `/robots.txt`, `/manifest.webmanifest` | Environment-specific indexing and existing PWA icons/metadata | 1/6 |
| Public assets | llms.txt, sw.js, fonts, icons, favicon, og.png and verification file; no RSS/Atom route exists | 1/6 |
| Worker shell outside web/app | `/preview/{identity,health,invalidate}`, `/start`, `/enqueue`, scheduled and queue handlers; private `/_vinext/static-cache/*` denied | 6 |

Sitemaps/navigation retain `resolveAvailableRankPeriods`, including its current
range-enumeration rules and fallback only when resolver output is absent. Do
not replace availability with calendar math or invent RSS/pair pages.

Client inventory (source directives checked, not just the older three-exception
summary in FRONTEND): `SearchBox` and its search-panel/hooks/worker, language
switcher, theme toggle and anti-flash script, `RegisterSW`, `ShareButton`,
`SnippetActions`, `CompareClient`/`CompareCurve`, English `CockpitClient`, and
`_localized/not-found-client`. `i18n/client.tsx` supplies their dictionary context.
Server charts, stars, ranking lists, semantic tables, breadcrumbs, capsules,
FAQ, structured data, and data-as-of blocks remain server HTML. Preserve amber
`#F2A900` and the Star component design; do not introduce hand-written star glyphs.
Astro islands must be limited to these existing needs, with explicit hydration
triggers, worker loading, keyboard access, and reduced-motion behavior.

## Gates and local acceptance

Card estimates are planning bounds; later page specs can split cards without
changing the gate's acceptance. Product-required gates wait for Product input;
Gate 0 and contract harness work do not.

| Gate | Pages/mechanisms | Estimated cards | Runnable local acceptance |
| --- | --- | ---: | --- |
| 0: feasibility | Plan, isolated SSR scaffold, locale redirect parity, long-tail cache, publication fencing | 1 | `cd astro && bun run validate:graph && bun run typecheck && bun test && bun run build && bun run test:worker`; full AGENTS static/fixture builds on exact head |
| 1: shared foundation | Shell, design tokens/local fonts, pure reader boundary, metadata/JSON-LD, errors, security, asset/PWA policy, parity harness | 3-4 | Both hosts build; full unit suites; read the same fixture contracts; compare normalized text/meta/JSON-LD and redirects in all locales on representative paths; assert no unapproved client scripts |
| 2: bounded core | Home, pulse, rankings index, about/privacy | 3-4 | Full suites/builds; seven-locale page matrix with deterministic clocks and identical data; dated capsules/FAQ/schema match visible facts; core snapshot/publication race regressions |
| 3: archives/categories | Year/month/week rankings, all category levels and pagination | 4-5 | Matrix includes current/historical/missing periods, absent data and page-1 redirects; seven-locale parity of text/meta/JSON-LD/pagination/sitemap sets; publication/rollback tests |
| 4: entities | Repo rename/not-found, org index/pagination/detail, SVG charts/milestones | 3-4 | Known/renamed/missing repo and org cases x seven locales; cold MISS then HIT; warm tail survives ordinary publication; explicit invalidation, freshness, stale regeneration and expiry tests |
| 5: interaction/media | Search, compare, share/snippets, cockpit decision, OG images, browser polish | 3-4 | Local Playwright Chromium interaction/accessibility tests; seven-locale query-state/keyboard/error coverage; verify PNG size/type and fallbacks; before/after screenshots and owner visual sign-off |
| 6: switch and cleanup | Worker shell/operations integration, snapshots, build/deploy scripts, validate:host equivalent, indexing, docs; relocate shared imports then remove web/ last | 3-4 | Exact-head full suites, production/pre builds and host-artifact validation; complete route/status/header/HTML/meta/JSON-LD matrix; simulated operational auth/publication contracts with no live calls; same local performance budget; reviewer and owner acceptance |

Estimated total: 20-26 cards including Gate 0. Final switch is the single
`feat/astro-site` -> `pre` PR. Removing `web/` is the last step, after all import
consumers, fixture/test utilities and scripts have moved with parity evidence.
Any authorized deployment uses `cf` separately after review; neither a passing
local build nor this plan authorizes it. Production promotion is separately ordered.

The Gate 1 parity harness must run two loopback hosts against one read-only
fixture, enumerate every route template with known/missing/alias/page/period
cases, and expand each shared page to all seven locales. Parse HTML and compare
visible text, title, description, canonical, robots, hreflang, OG/Twitter meta,
headings/links, and canonicalized JSON-LD including Dataset, FAQPage, sameAs and
dateModified. Normalize whitespace, local hostnames and build hashes only;
never normalize data dates, numbers, missing content or schema claims away.
Record approved Product differences explicitly; unapproved differences fail.
Compare sitemap URL sets and all endpoint status/content-type/cache headers.

Performance acceptance is measurable locally: no client JavaScript for body
content; an explicit island asset allowlist; compressed JS/CSS/HTML and Worker
bundle sizes recorded per route; no asset-size regression over the captured
baseline without an approved budget change. Run five warmed and five cold
requests per representative family/locale with the same fixture and clock;
report median/p95 and block unexplained >10% regression. Local Lighthouse mobile
runs on core/repo/org/category/compare require LCP <=2.5s, CLS <=0.1 and no
regression in interaction tests (target INP <=200ms; lab interaction latency is
a proxy, not field INP). These are future page-gate checks, not Gate 0 production
performance claims. Preserve bounded build params and read fan-out. No real
multi-region latency, load, cache durability or deployed service limits are
certified by fixtures.

## Gate 0 implementation and proof boundary

Astro 7.4.1 is the latest stable 7.x observed on 2026-10-21. The stable Cloudflare
adapter 14.4.1 requires Wrangler. The official cf migration adapter
15.0.0-beta.3 uses Cloudflare Vite plugin 2.0.0-beta.v.3 without that dependency.
Use that documented upstream path, pin versions, and fail graph validation if
Wrangler appears. No dependency patch, alias or skipped required import is allowed.
See the official [cf adapter migration guide](https://cloudflare-next.previews.docs.astro.build/en/guides/integrations-guide/cloudflare/#upgrading-to-v15-and-astro-740).

The skeleton renders only mechanism fixtures on existing URL shapes. It is not
a migrated product page, Product spec, or promise of completed content parity.
All output is noindex until the final explicit production mode is implemented.

Cache proof must distinguish current host policy: shared reads/writes bypass
cookies, authorization, range, non-GET and control/API requests; cache keys
separate origin, path, query, locale and build. Core entries are fenced by a
strong publication identity read from DATA (three pointers, including bytes,
timestamps, ETags and explicit absence). Core output is consumed and rechecked;
a concurrent publication retries once, then returns 503. Invalid pointers fail
closed. Cache failures degrade to rendering. Warm tail HTML deliberately keeps
its seven-day freshness plus one-day stale window across ordinary publication;
new renders capture the current publication. Rollback changes transition
identity. Manual invalidation is a separate mechanism with eventual-consistency
caveats; publication does not globally flush the tail. Keep CSP script-src
`'self' 'unsafe-inline'` and make `/api/lang` work during pointer outages.

Gate 0 acceptance: commit this plan; build the actual Cloudflare Worker; pass
automated helper and built-Worker tests with read-only fixture data; report each
mechanism as works / works with caveat / cannot (with options if blocked).
Run the complete offline AGENTS bootstrap/static block and local fixture builds
on a fresh detached shared clone of the exact final head, with no owner env
files or live opt-ins. Run no cf:dry-run (owner prohibition), no deployment and
no GitHub Actions. Put commands, results, tested SHA, release risks and remaining
work in the PR body and kanban handoff. Clear temporary artifacts after recording
evidence and leave git status clean. Final acceptance belongs to the reviewer.
