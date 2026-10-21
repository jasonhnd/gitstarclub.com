# Compare and pulse

P5 preserves the `web/app/_localized/compare.tsx` and `pulse.tsx` markup,
classes, deterministic copy and JSON-LD. Dictionaries, SEO/capsule helpers,
Star, ranking tables and chart calculations remain imports from `web/`.
`CompareBody` and `PulseBody` are server-only React presentation components;
Astro hydrates only `CompareClient`, using the existing CompareCurve.
The comparison island keeps URL selection through history.replaceState and
popstate, preserves scroll and lazily loads the existing search engine.
Search, theme and language behavior in the shared P0 shell is unchanged.

The data loader calls the existing published readers. The shared additive
`src/lib/published-readers.ts` adapter and its exact Vite alias preserve their
base/bootstrap selection, live generation history, schema validation and
folded-period discovery. Reads stay scoped to the captured publication and
native DATA facade. The adapter never changes global fetch or process.env,
never writes storage, and keeps original timeout/cancellation behavior.
Publication identity separates the existing history memo keys. Pulse invokes
the existing availability resolver with its exported Cloudflare lookback limits.
The shared stylesheet adds source discovery for the imported web presentation
components so Tailwind emits their original utilities. No design values change.

`/search-index` belongs to P6; `/repo-curve` belongs to P2. Until those packages
land, a local comparison gateway can delegate these two endpoints to the
unchanged web fixture host. This dependency must be explicit in reports.
No API endpoint or production data change belongs to P5.

Package tests and all-locale comparison paths live in `tests/p5/`.
Use the checksum-verified toolchain and card-local TMPDIR/KANBAN_TMP from
AGENTS.md. Run full web checks and `astro` verify:local from one fresh detached
clone of the exact head. Do not deploy or run Wrangler. Record local parity and
visual results, then delete screenshots as required by the Product brief.
