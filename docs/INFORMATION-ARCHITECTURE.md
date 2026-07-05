---
owner: information-architecture
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - UX navigation narrative
  - information architecture rationale
---

# GitStarClub Information Architecture

## Scope

This document is the **UX navigation narrative — a reader's map** of how the site hangs together. It is **not** the canonical route table: the authoritative route ↔ file ↔ render-layer listing lives in [FRONTEND.md](./FRONTEND.md) §1.1. Read this to understand how a visitor moves through the site; read FRONTEND to extend it.

## Two User Questions

The site is organized around two user questions:

1. **Pulse**: what is moving now?
2. **Rankings**: who is largest, and who won a historical slice?

English canonical URLs are unprefixed, and every non-default locale has a
prefixed URL that maps to the same canonical path. Repository URLs still mirror
GitHub in English:

- GitHub: `https://github.com/facebook/react`
- GitStarClub: `/facebook/react`
- GitStarClub Japanese: `/ja/facebook/react`

The default language is English. The language control shows the current language
as a compact trigger and places the other supported languages in a dropdown:
English, Japanese, Simplified Chinese, Traditional Chinese, Korean, Spanish, and
French. Each option is a normal link to the matching locale URL, so navigation
returns server-rendered localized HTML. The `gsc_lang` cookie remains only as a
preference signal for middleware and `/api/lang` compatibility redirects; it is
not an in-page rendering state.

## Primary Navigation

- **Pulse**: `/pulse`
- **Rankings**: `/rankings`
- **Categories**: `/categories` — browse by language / ecosystem / domain (shown at `md+` widths)
- **Compare**: `/compare` — multi-repo star-history overlay (URL-as-state)
- **About**: `/about`

The home page (`/`) is also the Pulse experience. It is no longer a separate chronicle landing page.

## Search

A global SearchBox in the chrome top bar is the "go directly by name" discovery
entry, covering the full tracked set (5,300+ repositories) and complementing "browse by
time" (year / month / week). It is an instant client combobox that jumps straight
to `/{owner}/{repo}` (no `/search?q=` results page). Component / lazy-load /
MiniSearch detail: see [FRONTEND.md](./FRONTEND.md) §6.1 (SearchBox); product
framing: [PRODUCT.md](./PRODUCT.md) discovery entry.

## Pulse

Pulse is the entry experience and shows:

- This week: current ISO week movers when the view exists; otherwise the latest
  available weekly movers, with the actual week shown as a badge.
- This month: current-month movers from `hot-snapshot.json`.
- This year: current-year movers from `hot-snapshot.json`.
- All-time giants: largest projects, used as a bridge into Rankings.
- On this day: historical milestone callbacks.

## Rankings

Rankings owns both all-time and historical rankings:

- `/rankings`: all-time repo/org rankings plus history entry points.
- `/rankings/[year]`: yearly movers and month links.
- `/rankings/[year]/[month]`: monthly rankings, daily heatmap, growth, and newcomers.
- `/rankings/[year]/W[week]`: weekly movers.

Ranking definitions (flow/stock, growth, newcomers) live in [RANKING.md](./RANKING.md);
route ↔ file ↔ render layer in [FRONTEND.md](./FRONTEND.md) §1.1.

## Compare

`/compare` overlays the star curves of any tracked repos (≥10,000 stars) on a single chart. The selected repos live in the URL (`/compare?repos=facebook/react,vuejs/vue`), so links are shareable and the page itself is fully static (`force-static`); the client-side `CompareClient` reads the search index, fetches a lean per-repo curve from `/repo-curve?id=`, and renders the overlay with a toggle between absolute calendar and "align to 10k" modes (capped at 5 repos). Three entry points feed it: the nav link, a per-repo "Add to compare" button, and a per-result `+` toggle on the global SearchBox with a "Compare N →" CTA.

## Repository Pages

Repository details use GitHub-style canonical paths:

- `/{owner}/{repo}`: repository star history and GitHub metadata side panel.
- `/o/{login}`: organization / owner aggregate page.

Reserved top-level paths belong to GitStarClub and cannot be interpreted as
repository owners: the page segments `pulse`, `rankings`, `categories`,
`compare`, `about`, `o`, `-`; the route handlers `api`, `search-index`,
`repo-curve`; and the root metadata routes `sitemap.xml`, `robots.txt`, and
`manifest.webmanifest` (`sitemap.ts` / `robots.ts` / `manifest.ts`).

Repository pages read GitHub metadata from precomputed JSON views. They do not
scrape GitHub HTML and do not call GitHub at request time. Optional fields such
as homepage, license, and latest release can be added to the offline metadata
pipeline and will render when present.

Legacy language-prefixed and `/r/` URLs are not canonical.

## Freshness

The live-refresh cron revalidates the hot paths — home, `/pulse`, `/rankings`,
and the current year / month / week under `/rankings`. Both the **daily** and
**weekly** crons run the same incremental live refresh (`refreshLiveViews`); the
weekly pass mainly guarantees weekly and monthly views never go stale even
without a full historical recompute. Full-history recompute runs separately on a
Vercel Workflow, not on these crons. Cron cadence and what each write touches:
see [FRONTEND.md](./FRONTEND.md) §2.4.

The sitemap uses the canonical history paths under `/rankings`.

The current weekly ranking is written by the live-refresh cron as
`live/rank/week/<current>/repo/flow.json`. If that live override is absent, Pulse
still falls back to the latest available base weekly view instead of showing an
empty panel.
