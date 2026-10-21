# P2 repository pages

The English and six localized entries render the existing repository body as
server HTML. The old English source's `[locale]/[owner]` parameters mean
owner/name, as clarified by the P0 plan; no single-owner page is introduced.
Generic repository entries delegate recognized non-repository URLs to P0's
shell fallback until their concrete package entries land.
Dictionaries, schemas, normalization, route resolution, metadata facts, Star,
StarCurve and provenance calculations are imported from `web/` unchanged.
P2 uses the shared `withPublishedReaders` transport and the unchanged web readers
against the request's captured publication. Category
assignment fan-out stays disabled, matching the current Cloudflare host.

The page body and both SVG curves ship no hydration script. The share control
and milestone snippet copy controls use one small custom-element island with
the existing markup, clipboard feedback and X share behavior. The shared shell
retains P0's search/theme islands and native language menu.

Repository social images reuse the integrated P1 image build bridge and the
existing pinned renderer; no second renderer plugin or alias is registered.
The bridge and other shared imports must move before `web/` is eventually
removed. P2 reuses P1's shared Layout image input and simulator Wasm loading.
P2's remaining shared additions register its style sources, add a browser
pathname getter for the imported localized 404 copy, and preserve curve
response semantics in the host.

The effective curve response uses `private, no-store`, matching the old Worker
which overrides the route module cache header. Every curve request requires a
readable publication, including invalid IDs and method-only responses. The
curve route retains the old Vary contract and omits page-only indexing and
publication headers. The shared host preserves P7 operation-response wrapping
and publication-failure behavior only for `/api/`; curve responses keep their
own existing headers and error bytes. No lock or data contract changes.

Run with the checksum-verified Node 24.20.0/Bun 1.4.2 and card-local
`TMPDIR=KANBAN_TMP`:

```bash
cd astro
bun run verify:local
bun tests/p2/routes.ts
bun tests/p2/browser.ts
bun tests/p2/compare-local.ts --screenshots
```

The last command requires the prescribed detached verification clone. It uses
the common strict full-page comparator for three synthetic fixture repositories
(empty history, monthly history and provenance-bearing daily history), all
seven locales and both desktop/mobile viewports. It writes the report and image
pairs under KANBAN_TMP. Inspect and delete the screenshots after recording the
findings; never commit or upload them. Tests do not expand published coverage.
