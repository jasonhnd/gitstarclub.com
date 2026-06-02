# GitStarClub Information Architecture

## 2026-06-01 Update

The site now follows two user questions:

1. **Pulse**: what is moving now?
2. **Rankings**: who is largest, and who won a historical slice?

Canonical URLs no longer carry the UI language. Language is an in-page preference
stored in a first-party cookie, so repository URLs can mirror GitHub:

- GitHub: `https://github.com/facebook/react`
- GitStarClub: `/facebook/react`

The default language is English. The language control shows the current language
as a compact trigger and places the other supported languages in a dropdown:
English, Japanese, Simplified Chinese, Traditional Chinese, Korean, Spanish, and
French. In the normal app shell, the client writes `gsc_lang` and refreshes the
current RSC view immediately without changing the URL. `/api/lang` remains as a
safe direct-access fallback endpoint.

## Primary Navigation

- **Pulse**: `/pulse`
- **Rankings**: `/rankings`
- **About**: `/about`

The home page (`/`) is also the Pulse experience. It is no longer a separate chronicle landing page.

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

## Repository Pages

Repository details use GitHub-style canonical paths:

- `/{owner}/{repo}`: repository star history and GitHub metadata side panel.
- `/o/{login}`: organization / owner aggregate page.

Reserved top-level paths (`pulse`, `rankings`, `about`, `o`, `api`, `-`) belong
to GitStarClub and cannot be interpreted as repository owners.

Repository pages read GitHub metadata from precomputed JSON views. They do not
scrape GitHub HTML and do not call GitHub at request time. Optional fields such
as homepage, license, and latest release can be added to the offline metadata
pipeline and will render when present.

Legacy language-prefixed and `/r/` URLs are not canonical.

## Freshness

Daily cron revalidates the new hot paths:

- home
- `/pulse`
- `/rankings`
- current year under `/rankings`
- current month under `/rankings`

The sitemap uses the new canonical history paths under `/rankings`.

The current weekly ranking is now written by Vercel cron as
`live/rank/week/<current>/repo/flow.json`. If that live override is absent,
Pulse still falls back to the latest available base weekly view instead of
showing an empty panel.
