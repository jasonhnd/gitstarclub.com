# About this data

<<<<<<< 201bdb62be8a963404cda5ee41aa3432985827ac
`AboutThisData.astro` is a server-rendered disclosure for use after a page summary and before its FAQ. It is not placed on any product page yet. Importing it includes a small Copy enhancement; the content does not hydrate React.
=======
`AboutThisData.astro` is a server-rendered disclosure for use after a page summary and before its FAQ. Repository pages render the shared `AboutThisDataContent` after the answer capsule and before repository history and the FAQ. Their Astro page entry loads the small Copy enhancement; the content does not hydrate React.
>>>>>>> ib/gsc-798

Pass `locale`, `dictionary`, `meta`, `releaseId`, `layer`, `pageTitle` and the absolute `canonicalUrl`. Read `meta` from the current request's published data and `releaseId` from that same request's captured `publication.views.version`. Metadata does not itself contain the release identifier. Do not fetch the latest publication again while rendering.

`layer` is one of `currentTotals`, `periodGains` or `historyCurve`. Each selects a translated layer label, method sentence and stable section of localized `/about`. The date comes from `meta.generated_at`, with `backfilled_at` as the bootstrap fallback. It is formatted in UTC and is the publication metadata date, not a promise of complete observations through that date. Coverage uses only `active_repo_count`, never historical membership or visible rows. Missing values are explicitly unavailable; zero is preserved.

Optionally pass `historyCoverage` from the page's published daily-history provenance (`start`, `end_inclusive`). Omit it when that history is not used. No example dates or counts are baked into the component.

The release link intentionally targets `/releases/<id>` before those pages exist. Citation text contains the exact page title and canonical URL, an ISO date and release identity. It remains focusable and selectable when scripts are disabled. Copy is shown only after its handler is attached, announces success through a status region, and selects the text with localized guidance if the clipboard API is missing or rejects access. Each instance owns its controls.

Locale copy lives in the existing `aboutData` dictionary section for all seven locales. Acceptance artifacts are generated from those dictionaries; no translated documentation is maintained separately.

Run the render tests as part of `cd astro && bun run test`. After `bun run build:pre`, run `bun tests/about-data/browser.ts` with card-local `KANBAN_TMP` and `TMPDIR`. That isolated fixture generates the seven-locale copy table and before/after English/Japanese screenshots at 1440 and 390 pixels, and verifies keyboard operation, clipboard success/failure, multiple instances, no-script behavior and accessibility. It adds no site route.
