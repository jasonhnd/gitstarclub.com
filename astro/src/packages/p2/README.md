# P2 repository pages

The English and six localized entries render the existing repository body as
server HTML. The old English source's `[locale]/[owner]` parameters mean
owner/name, as clarified by the P0 plan; no single-owner page is introduced.
Dictionaries, schemas, normalization, route resolution, metadata facts, Star,
StarCurve and provenance calculations are imported from `web/` unchanged.
P2's read-only adapter consumes P0's captured base publication. Category
assignment fan-out stays disabled, matching the current Cloudflare host.

The page body and both SVG curves ship no hydration script. The share control
and milestone snippet copy controls use one small custom-element island with
the existing markup, clipboard feedback and X share behavior. The shared shell
retains P0's search/theme islands and native language menu.

Repository social images reuse the old pinned image renderer and only its
image/wasm build plugins. The compatibility bridge is import-only and must move
with the other shared imports before `web/` is eventually removed. Shared
configuration changes are additive: register that image bridge and P2 style
sources, load emitted image wasm in the local simulator, accept a
page-specific social-image URL, and preserve explicit non-HTML cache headers
while keeping HTML private. Invalid curve inputs and method-only responses
remain independent of publication pointers. The browser navigation bridge adds
`usePathname` so the existing localized 404 copy can be imported without copying
translations. No dependency lock or data contract changes.

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
