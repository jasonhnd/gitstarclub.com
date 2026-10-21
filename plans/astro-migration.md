# Astro migration: P0 and parallel packages

## Agreement and acceptance

Follow Product's `astro-migration-spec.md` v1 (2026-10-21) and owner order
SB-20261021-10. Only the page layer changes. URLs, appearance, data coverage,
pipeline, R2 publication and JSON contracts stay unchanged. `web/` remains
buildable for comparison. English is prefixless; ja/zh/zh-TW/ko/es/fr use their
existing prefixes. Cockpit is deferred; preserve its old implementation.

`feat/astro-site` starts at `29ef525` from origin/pre. P0-P7 branches and PRs
target it; only the final integration PR targets `pre`. No protected-branch
push, merge, deployment, Actions, Wrangler, legacy packaging, remote resource
change or live refresh is authorized. Astro 7.4.1 builds with the official cf
adapter 15.0.0-beta.3 and Vite plugin 2.0.0-beta.v.3 without Wrangler. Beta pins
remain a release risk; stop with evidence and A/B/C options if that changes.

P0 owns the public shell/tokens, locale URLs/switching, deployment identity,
shared read/cache boundaries and local tools. It does not migrate product page
bodies or operational writers. Import dictionaries/contracts and existing R2
read code from `web/lib`; never copy or edit them. Keep CSP script-src
`'self' 'unsafe-inline'`. P0 acceptance: Astro checks/tests/Worker build pass;
comparison runs on shared-shell routes with one read-only fixture; complete
AGENTS verification passes on a fresh detached clone of the exact head. Skip
cf:dry-run by owner order. Independent review performs final acceptance.

## Directory and exclusive ownership

All new code lives in `astro/`, with its own exact-pinned package.json/bun.lock
(Node 24, Bun 1.4.2). P0 owns `src/layouts/`, `src/components/`, `src/styles/`,
`src/lib/`, `src/worker.ts`, configuration, shared tests and `scripts/`. Page
entry files wrap package components. Each package adds its own tests and path
list; do not edit other packages, P0 files, dictionaries or locks. Coordinate
shared changes through the leader. P0's catch-all shell is a fallback; concrete
routes take precedence, so it needs no edits when packages land.

| Package | Routes (plus six localized forms for pages) | Exclusive files under astro/ |
| --- | --- | --- |
| P1 home/rankings | `/`, `/rankings`, `/rankings/{year}`, `/rankings/{year}/{month or Wweek}` | `src/packages/p1/`; root/localized index and `rankings/**` page entries; `tests/p1/` |
| P2 repositories | `/{owner}/{name}`, `/repo-curve` | `src/packages/p2/`; `[owner]/[name].astro`, `[locale]/[owner]/[name].astro`, `repo-curve.ts`; `tests/p2/` |
| P3 categories | `/categories`, `/categories/{dimension}`, `/categories/{dimension}/{slug}`, `/categories/{dimension}/{slug}/page/{page}` | `src/packages/p3/`; root/localized `categories/**` entries; `tests/p3/` |
| P4 organizations | `/o`, `/o/page/{page}`, `/o/{login}` | `src/packages/p4/`; root/localized `o/**` entries; `tests/p4/` |
| P5 compare/pulse | `/compare`, `/pulse` | `src/packages/p5/`; root/localized compare/pulse entries; `tests/p5/` |
| P6 static/indexes | `/about`, `/privacy`, `/sitemap.xml`, seven `/sitemap-{locale}.xml`, `/search-index` | `src/packages/p6/`; matching root/localized pages and endpoint files; `tests/p6/` |
| P7 operations | `/api/cron/{daily,weekly}`, `/api/lang`, `/api/workflows/refresh/{start,step,revalidate,rollback}` | `src/packages/p7/`; `src/pages/api/**`; `tests/p7/`. Reuse P0's language helper; preserve existing auth/leases/publication exactly. |

Product's P2 owner notation does not create a new single-owner URL: existing
English `[locale]/[owner]` source parameters mean owner/name. P3 slug paths are
relative to categories/dimension. OG image handlers belong to their page package
(P1 rankings, P2 repository). Coordinate shared default OG, robots, manifest,
public assets and operational Worker shell during final integration.

## Two shared cache mechanisms and common tools

- **First visit then cache:** packages return server HTML through the P0 Worker
  boundary. Do not add a second page cache. Keys separate build, origin,
  path/query, representation and locale. Reuse the existing Cache API/KV store
  and bypass policy. Long-tail HTML stays fresh seven days, then stale for one
  day while regenerating. Cookie/auth/range/non-GET/API/control requests bypass
  shared page storage. Data stars reuse the existing Star component.
- **Publication refresh:** capture the three authoritative DATA pointers before
  reads; existing readers use that request's captured publication. Core keys
  include its identity (body/ETags/timestamps/absence). Consume output and
  recheck before serving/writing; retry once, then 503 on a race. Cache-bypassing
  GET/HEAD requests (including cookie/auth) follow the same buffered output
  check and retry rule without reading or writing shared page storage. Mutating
  requests execute once and are never replayed after a publication change. Ordinary
  publication preserves warm tail HTML under current policy. P7 must await
  explicit path invalidation when tails need refreshing; manual KV invalidation
  retains eventual-consistency limits. No runtime database or writer change.
- **Common tools:** `bun run verify:local` installs frozen dependencies, checks,
  tests, builds and exercises the actual Worker with local fixture data.
  `bun run compare -- --web <loopback> --astro <loopback> --paths <json>` checks
  status, visible text, title/meta/canonical/hreflang and JSON-LD. Whole-page
  comparison is default; `--scope shell` limits visible text to header/footer
  during P0. Package path files live under their own tests. Report differences;
  never mask data dates, numbers or schema facts. Shared dictionaries/contracts
  are import-only; no package needs to edit them.

Each package compares three representative pages across seven locales, captures
desktop/mobile screenshots, passes `lint:design` and full local verification,
and keeps body HTML free of client JS except existing interactive islands.
Sitemaps/navigation reuse `resolveAvailableRankPeriods`, not calendar math.
Final integration coordinates build/deploy scripts, host validation, static
metadata/assets, queue/scheduled shell behavior, full-route parity, performance
and JS-size evidence, and docs. Move shared imports with tests before removing
`web/`, and remove it only at the end. Preview deployment and test refresh/
rollback require separate authorization; main and production remain untouched.

## F1 integration

F1 branches from `c09e49c` and targets `feat/astro-site` (the migration-specific
exception to pre-only). Root `build:pre` / `build:production` and `validate:host`
now select Astro; `web/` still passes its separate full AGENTS gate. Astro reuses
the existing Queue/scheduled/shell handlers and all typed binding identities.
No schedules, routes, DNS, secrets, CI or delivery configuration change.
The pre deploy script uses only pinned cf and is not run by this card.
P5 comparison and interaction requests go directly to Astro's P2/P6 endpoints.
Production indexing and the shared default social PNG are enabled explicitly.
The source host is documented in `docs/ASTRO-HOST.md`; no live cutover is claimed.
Cockpit remains in `web/` and returns **404 on the Astro host**, including locale
forms. Unknown catch-all URLs no longer render the P0 demonstration shell.

## After cutover

Keep `web/lib` as the single shared library for the first cutover; do not copy
its readers, contracts, workflows or dictionaries. The exact direct imports,
shared views/components, seven dictionaries, stylesheet/public assets and
`web/node_modules` image-renderer paths are listed in
[astro-web-imports.md](astro-web-imports.md). It also separates verification-only
baseline imports and the shared operational shell outside `web/`.

After independent cutover acceptance, move that library to `shared/lib` in one
follow-up with import rewrites and the complete web/Astro regression suites.
Move reusable `_explore`, localized category/detail/ranking views and route-data
helpers to `shared/ui`, and move tokens/public assets to shared asset roots.
Promote the exact pinned image renderer, its existing Wasm/font packaging and
compatible build bridge into Astro-owned dependencies before removing the
`web/node_modules` paths. Move operational shell modules to a framework-neutral
shared host directory. Retain the old comparison host and deferred cockpit until
the owner separately approves their retirement. No relocation or deletion of
`web/` belongs to F1.
