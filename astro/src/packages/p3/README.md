# P3 category pages

The eight thin Astro entries cover the category index, dimension, detail and
detail pagination routes in prefixless English and the six existing locale
prefixes. P0's layout supplies chrome, metadata and the existing search/theme
islands. Category bodies are static server-rendered React with no hydration.

## Import-only view reuse

`view-plugin.ts` is registered additively in `astro.config.mjs`. Its explicit
`astro-p3:categories` import loads the unchanged `web/app/_localized/categories`
server view, redirects its data/availability/navigation imports to `data.ts`,
removes its duplicate chrome and resolves its relative imports. The routing
helper receives the same navigation substitution under a private module query;
ordinary imports used by other packages are unchanged. No translated copy,
markup, metadata or structured data is copied or edited. Tests assert that the
entire original view body survives the adapter except its chrome elements.

`withCategoryData` supplies request-local readers backed by P0's native R2
facade. Metadata and body share a read memo within one captured publication.
There is no second HTML cache or module-global data cache. Availability retains
the original contiguous-page rule: stop at the first absent or empty published
rank page. Unknown/private categories, missing populated ranks and malformed
page numbers return 404; `/page/1` redirects permanently to its canonical base.
Zero-count public categories retain the original pending-data page.

The adapter is a temporary page-layer bridge while `web/` remains the migration
comparison baseline. Final integration must relocate these imported views and
translations before removing `web/`, as required by the shared migration plan.

## Local verification

Use the pinned toolchain, a fresh detached verification clone and the current
card's absolute `TMPDIR=KANBAN_TMP`, following root AGENTS.md and `astro/README`.

```bash
cd astro
bun run verify:local
bun tests/p3/routes.ts
bun tests/p3/compare-local.ts --screenshots
```

The route check covers seven dimensions, populated/empty details, pagination,
404s and 308s across all seven locales. The comparison builds both hosts with
the same read-only fixture and runs the shared strict full-page comparator for
four samples across all locales at desktop/mobile sizes (56 cases). The small
synthetic pagination fixture changes no published data or coverage. Compare the
screenshots locally, record findings and delete the images; never attach or
commit them. Root design lint and the full offline static/build block remain
separate delivery requirements. No deployment command is involved.
