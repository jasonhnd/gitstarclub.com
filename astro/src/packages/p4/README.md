# Organization pages (P4)

The concrete root/localized `o/` entries validate requests and load the existing
published organization, repository lookup, category registry and metadata
contracts through `Astro.locals.data.base`. P0 owns publication fencing and HTML
caching; these pages add no independent cache or data layer. Detail routes stay
on demand. Both hosts omit category assignment shards on Workers, preserving
member-language chips and the existing data scope.

`OrgIndexContent` and `OrgContent` preserve the current web page markup and
reuse its static table, pagination, chart, capsule, FAQ, breadcrumb and related
page components. Existing dictionaries and pure page helpers are imported.
Two additive `@source` entries in the shared stylesheet include the unchanged
shared components and P4 utilities in the single Tailwind compilation. They add
no design values. The shared layout supplies search/theme islands.
Directory bodies have no client JavaScript. Detail pages additionally hydrate
only the existing `ShareButton` (copy/share link) and `SnippetActions`
(copy text/embed). The body, SVG chart and structured data remain server HTML.
Native language links keep the P0 `/api/lang` behavior.

## Local verification

Use the pinned toolchain and card-local `TMPDIR=KANBAN_TMP`. Install frozen
root/web/pipeline/Astro dependencies before running the complete AGENTS gate.
The package comparison runs in the required fresh detached checkout, with no
owner environment files or live-data opt-ins:

```bash
cd astro
bun run verify:local
bun tests/p4/compare-local.ts --screenshots
```

The comparison uses P0's unchanged strict comparison script and one synthetic
read-only fixture for both hosts. It builds web in `pre` mode and the actual
Astro Worker, checks 49 localized status/redirect/error cases and allowed island
counts, then compares `/o`, `/o/page/2` and `/o/example` across seven locales at
1440px and 390px (42 comparisons). It checks status, full visible text,
title/meta, canonical/hreflang and JSON-LD, including dates and star totals.
The fixture has 103 owners, organization/developer cases, missing lookup
members, null language, history, negative recent movement and rank history;
it does not expand published coverage. Unit tests cover loaders and invalid
requests. Record local screenshot observations before deleting screenshots.
No deployment, remote write, Wrangler or merge is part of these commands.
