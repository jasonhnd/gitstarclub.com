# Astro site host

The integrated host supplies the shared shell and seven migrated packages in
[the migration plan](../plans/astro-migration.md). The Product specification is
`astro-migration-spec.md` v1 (2026-10-21). `web/` remains unchanged. All migrated page bodies have concrete entries; unknown and deferred cockpit
URLs return 404. See [ASTRO-HOST.md](../docs/ASTRO-HOST.md) for explicit modes,
resource preservation and deployment boundaries. No deployment or merge is authorized.

## Local commands

Use the root AGENTS.md checksum-verified Node v24.20.0 and Bun 1.4.2. Set
`TMPDIR` and `KANBAN_TMP` to the same absolute current-card directory. Keep HOME
and leave BUN_INSTALL_CACHE_DIR unset so Bun uses its shared install cache.

```bash
cd astro
bun run verify:local
```

This installs frozen web/Astro dependencies, checks the dependency graph and
Astro/TypeScript sources, runs every unit test, builds the actual pre Worker, then
runs Worker/browser-tool tests. The fixture accepts GET/HEAD only and contains
only the existing checked-in web fixtures. No owner env file, real bucket,
write credential, live cron, remote refresh or runtime database is used.
Generated Astro types/build output, local simulator state, logs and browser
profiles go under KANBAN_TMP. The generated links are locally excluded in Git.

For reproducible web-vs-Astro comparison, use the fresh detached clone required
by AGENTS.md (one clone at a time), then install root/web/pipeline/Astro frozen
dependencies there. Run the full AGENTS block separately as the release gate.

```bash
cd "$KANBAN_TMP/verify/astro"
bun run compare:local -- --screenshots
```

This builds both hosts with one read-only fixture, starts their loopback
servers, checks seven locale privacy URLs at desktop/mobile sizes in shell
mode, and shuts all processes down. It intentionally compares header/footer text; P6 now verifies the complete
Privacy/About bodies through its own package runner. Title, all named/property meta,
canonical/hreflang and JSON-LD are still checked. Reports and screenshot pairs
are under KANBAN_TMP; record results before deleting artifacts. The Cloudflare
portable-output validator rejects a symlinked web build directory, which is
why this command runs from the detached clone rather than linking web output.

Later packages use the same strict comparison tool with their own JSON array
of paths. Whole-page visible text is the default. Only local origins are allowed.

```bash
bun run fixture
bun run preview:local
bun run compare -- --web http://127.0.0.1:4176 --astro http://127.0.0.1:4177 --paths tests/p1/paths.json
```

The first two commands are optional standalone servers and print their actual
origins; run them in separate terminals and stop them after use. `compare:local`
manages servers itself. The comparison exits nonzero on differences, preserves
data dates/numbers, and canonicalizes JSON-LD object key order only. Its negative
browser test proves body, metadata and structured-fact regressions are detected.

## Shared interfaces

- `src/lib/i18n.ts` and `contracts.ts` re-export the existing seven dictionaries,
  locale helpers and schemas. They are imports, not copies. No package edits them.
- `Layout.astro` provides localized chrome/footer, existing design CSS/local
  packaged fonts, theme/search islands and native language menus. Body content
  stays server-rendered. The existing search and theme components are reused;
  the navigation bridge uses ordinary document navigation. Language links keep
  `/api/lang?lang=...&next=...` and the original redirect sanitizer semantics.
- `Astro.locals.data.base(path, schema)` reads a logical published base view
  through the existing R2BindingObjectStore and captured publication.
  `data.raw(key, schema)` reads an explicit published object. No write method is
  exposed. Conformance tests compare managed/bootstrap/flat reads with the
  existing web reader. Full live-history joins stay in the existing data layer;
  coordinate any shared transport extension through P0 ownership, not per page.
- The Worker is the only HTML cache boundary. It reuses the existing bounded
  Cache API/KV store. Core output is publication-fenced; warm tails retain the
  seven-day plus one-day stale policy. Pages do not implement caching themselves.
- P7 authenticates operational requests and awaits
  `Astro.locals.invalidatePaths(["/example/repo", "/ja/example/repo"])` for
  explicit tail invalidation. Core publication changes invalidate by identity.
  Mutations are delegated once, never replayed after a pointer switch, including
  the legacy daily/weekly cron and refresh-start GET/HEAD handlers.
  The revalidate POST callback and language redirect do not depend on pointers.
- `/.well-known/deployment` reports the baked commit and local deployment
  origin without reading DATA. Production output is indexable; pre is noindex. Final integration retains
  the original shell, Queue and scheduled handlers and adds the default social
  card and export aliases. Removing web remains a post-cutover task.

Astro 7.4.1 is stable. The official cf adapter 15.0.0-beta.3 and Vite plugin
2.0.0-beta.v.3 are prereleases; cf 1.0.0-beta.18 matches the existing host and
supports Node v24.20.0. `validate:graph` rejects Wrangler anywhere in the lockfile.
No dependency is patched or aliased to bypass Wrangler. Local simulation does
not certify multi-region cache consistency, service limits or production load.

## Local performance budget

From the fresh detached verification clone, after frozen installs:

```bash
cd "$KANBAN_TMP/verify/astro"
bun run perf:local -- --runs 5
```

This builds both production hosts on the same synthetic P5 fixture, including
published July 2026 rankings and a populated `react/react` repository. It measures
seven page types in English and Japanese (14 paths). The official web preview
and built Astro Worker receive identical data. All requests stay local; remote
avatars are blocked equally. Server caches are prewarmed; every sample gets a
fresh browser context and disabled HTTP cache. Host order alternates per run.
The desktop viewport is 1440 x 1000. Capture waits for network idle, fonts, and
one second for existing islands. At least five runs per page/host are mandatory.

`perf-local.json` retains each run and its sorted script inventory;
`perf-local.md` contains the PR table. First contentful paint (FCP) and largest
contentful paint (LCP) use browser performance entries, reported as medians.
JavaScript totals include unique requested script/module URLs (including dynamic
imports) and executable inline scripts from the initial HTML. They exclude
JSON-LD, serialized island props and other non-executable data. Bytes are UTF-8
decoded sizes and the sum of individually gzipped scripts at level 9, independent
of either local server's transfer compression. Island script count means distinct
Astro component entry URLs; repeated theme toggles share one script. Web has a
monolithic hydrated root, so its island column is n/a; both hosts also report
all executable script entries. Initial load is measured without user gestures.

The command exits nonzero for any page whose Astro gzip **or decoded** JS exceeds
web, or whose median FCP exceeds web by more than max(20ms, 10% of web median).
This explicit local noise allowance covers roughly one display frame plus timer
variation; it is a diagnostic threshold, not a production performance guarantee.
LCP is reported for review. Missing paint/content, failed scripts, unhydrated
islands, JS errors or unstable script inventories fail collection. No network,
CPU throttling, production load or multi-region latency claim is made.

Client and server environments explicitly enable Oxc production minification
because Astro's server default disables it. Standard tree shaking remains enabled;
React/React DOM are deduplicated across shared web imports and islands. Each build
writes `bundles-{environment}.json` in KANBAN_TMP, records effective minification,
module identities and chunk bytes, and rejects duplicate client React copies or
React development modules. There is no minification exception. Existing search,
theme, share/snippet and comparison islands remain; page bodies otherwise render
as server HTML. No new hydration boundary is introduced.
