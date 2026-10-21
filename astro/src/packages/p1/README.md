# P1 home and rankings

The Astro entries serve the existing English and six localized home, all-time,
year, month and ISO-week pages. Daily movement remains inside month pages;
there is no new daily route. Invalid/unpublished periods retain 404 behavior.
Ranking social-image endpoints reuse the existing deterministic card renderer.

The page-layer JSX in `pulse.tsx`, `rankings.tsx`, `ranking-detail.tsx` and
`ranking-ui.tsx` follows the corresponding `web/app/_localized/` views. It keeps
the original classes, semantic markup, row caps, captions, mobile cards,
provenance, answer capsules, FAQ and structured facts. Shared presentation
components, dictionaries, schemas, data readers and availability/navigation
resolvers are imported. These imports must be relocated with the other shared
imports before the final integration removes `web/`.

`page.ts` renders the body to static HTML inside the captured publication
scope. `published-fetch.ts` adapts only the existing readers' HTTP transport to
the native read-only DATA binding for the reserved `astro-data.invalid` origin.
The existing managed/bootstrap/live-history selection stays in the web readers.
It never replaces global fetch or mutates process environment. Ordinary HTTP
keeps its timeout behavior. The Worker remains the sole HTML cache boundary.

Home/all-time bodies add no browser code. Year/month/week pages load one small
native module only for the existing share-link, share-intent and snippet/embed
copy controls. It enhances the existing control HTML with two custom-element
islands; it does not hydrate the body. The shared search/theme islands are
unchanged. Metadata uses the existing helpers and optional shared Layout title
and image inputs. Tailwind also scans the reused server presentation components.

## Verification

Use the fresh detached clone, clean environment and pinned toolchain required by
root AGENTS.md; keep TMPDIR and KANBAN_TMP at the current card directory.

```bash
cd astro
bun run verify:local
bun tests/p1/worker.ts
bun tests/p1/compare-local.ts --screenshots
```

The Worker probe checks 35 populated page/locale combinations, missing/invalid
periods and three PNG social images. The comparison runner builds web in pre
mode and the actual Astro Worker against one read-only fixture, compares all 35
paths at desktop/mobile sizes, and optionally captures five English page pairs.
It records geometry and verifies page/snippet/embed clipboard actions plus the
share intent. The social destination is intercepted locally. Inspect screenshot
pairs, describe results, then delete all screenshots. Reports remain in
KANBAN_TMP until their results are recorded in the PR and handoff.

The P1 fixture populates only the checked-in synthetic `example/repo` and
`example` organization. Additional rank windows/provenance are local test data;
they do not change real data coverage or publish any object.
