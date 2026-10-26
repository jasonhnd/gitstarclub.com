# Issue #800: About this data on category pages

## Goal

Show the existing About this data disclosure on every category page type and locale, using the current published metadata and the category page's title and canonical URL.

## Scope

- Add the disclosure after the category answer capsule and before the FAQ.
- Cover the category index, dimension, detail, and paginated detail pages through their shared rendering path.
- Verify English and Japanese render output includes the current totals layer and current metadata values.
- Capture the requested 1440px and 390px screenshots for one category page in English and Japanese.

## Out of scope

- Deployments, secrets, and unrelated pages.
- Changes to the disclosure component or its copy, except a necessary placement bug fix.

## Acceptance

- All category page types and locales render the block.
- The block receives `currentTotals`, current `meta`, the captured publication release ID, and the page's own title and absolute canonical URL.
- Route tests assert the block and passed data in English and Japanese.
- Build and requested test commands pass; four screenshots are reviewed and kept card-local.
