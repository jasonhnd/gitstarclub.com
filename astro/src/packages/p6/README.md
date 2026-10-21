# P6 static pages and indexes

About and Privacy use the shared Astro layout and server-rendered React bodies.
They import existing dictionaries and presentational components without client
hydration. Only P0's shared search and theme controls load JavaScript. About
reads captured base metadata through the shared withPublishedReaders adapter
and preserves Dataset/FAQ structured data, data dates, citation links and
missing-data presentation.

Eight sitemap entries delegate to the unchanged web sitemap implementation.
That reader preserves category availability, last-modified dates, localized
alternates and `resolveAvailableRankPeriods`. Search delegates to the existing
published reader and response builder, including truncation, missing data and
retryable failures. The same Astro fetch-timeout alias used by P5 adapts their
transport to the captured request data through src/lib/published-readers.ts and
withPublishedReaders. A publication-specific virtual origin isolates reader
memoization and prevents network access to published objects. It leaves pointer,
overlay, history and schema selection in the existing readers; it never patches
global fetch. External fetches retain timeouts with Worker-compatible cache
options. Sitemap cache headers survive the shared host boundary; bypassed search
responses retain the existing private/no-store host policy. The
optional Cloudflare read policy is enabled explicitly by P6 for ranking
discovery, keeping its lookback limits identical to the current Worker without
changing P5 defaults. HEAD reads use the same facade and return no body. No P6
transport module or independent origin remains.
No publication, coverage or writer behavior changes.

Robots and manifest reuse the current metadata definitions and preserve their
text/JSON serialization. Privacy, robots and manifest have no published reads
to scope. P0 remains a noindex skeleton; production activation
and the shared default social card belong to final integration. Neither About
nor Privacy defines a page-level social image.

Run `bun tests/p6/compare-local.ts --screenshots` from `astro/` in the fresh
AGENTS verification clone. It builds both hosts, compares all 14 page URLs and
11 global endpoints at desktop/mobile sizes through the shared strict parity
tool, then checks endpoint bodies, content type, cache policy and HEAD. It also
compares body element bounds and computed layout styles on About, Japanese
About and Privacy at both sizes (0.5 CSS pixel tolerance). Explicit shared
component style sources preserve the hero grid, capsule and related links. Inspect
the generated screenshots and delete them after recording results. The route
list is `tests/p6/paths.json`; package unit tests run with `bun run test`.

For a transport-only conflict fix, run the comparison without --screenshots;
all strict page, endpoint and layout assertions still run.
