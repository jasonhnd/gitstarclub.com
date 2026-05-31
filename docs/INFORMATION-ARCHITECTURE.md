# GitStarClub Information Architecture

## 2026-05-31 Update

The site now follows two user questions:

1. **Pulse**: what is moving now?
2. **Rankings**: who is largest, and who won a historical slice?

## Primary Navigation

- **Pulse**: `/[lang]/pulse`
- **Rankings**: `/[lang]/rankings`
- **About**: `/[lang]/about`

The locale home (`/[lang]`) is also the Pulse experience. It is no longer a separate chronicle landing page.

## Pulse

Pulse is the entry experience and shows:

- This week: current ISO week movers.
- This month: current-month movers from `hot-snapshot.json`.
- This year: current-year movers from `hot-snapshot.json`.
- All-time giants: largest projects, used as a bridge into Rankings.
- On this day: historical milestone callbacks.

`/[lang]/trending` is kept as a compatibility redirect to `/[lang]/pulse`.

## Rankings

Rankings owns both all-time and historical rankings:

- `/[lang]/rankings`: all-time repo/org rankings plus history entry points.
- `/[lang]/rankings/[year]`: yearly movers and month links.
- `/[lang]/rankings/[year]/[month]`: monthly rankings, daily heatmap, growth, and newcomers.
- `/[lang]/rankings/[year]/W[week]`: weekly movers.

Legacy history URLs redirect into Rankings:

- `/[lang]/[year]` -> `/[lang]/rankings/[year]`
- `/[lang]/[year]/[period]` -> `/[lang]/rankings/[year]/[period]`

## Freshness

Daily cron revalidates the new hot paths:

- locale home
- `/pulse`
- `/rankings`
- current year under `/rankings`
- current month under `/rankings`

The sitemap uses the new canonical history paths under `/rankings`.
