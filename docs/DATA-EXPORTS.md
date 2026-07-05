---
owner: data-exports
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - public data export set
  - export attribution
  - export regeneration
---

# GitStarClub data exports

GitStarClub publishes small, deterministic CSV and JSON extracts for reuse and citation. They are generated from existing precomputed Vercel Blob views and checked in as static assets under `web/public/data/exports/v1/`.

Exports are stored once, in dated directories such as `web/public/data/exports/v1/YYYY-MM-DD/`. The public `/data/exports/v1/latest/*` URLs are stable aliases rewritten by Next.js to the newest dated directory at build time; `latest/` is not a second copy of the CSV or JSON payloads.

## License and attribution

The exports use CC BY 4.0 and carry this attribution copy:

> Data from GH Archive, derived by GitStarClub.

CSV files repeat the license and attribution columns on every row. JSON files include the same license and attribution in the export metadata.

## Export set

The latest export set is available through stable alias URLs:

- `/data/exports/v1/latest/manifest.json`
- `/data/exports/v1/latest/top-rankings.csv`
- `/data/exports/v1/latest/top-rankings.json`
- `/data/exports/v1/latest/top-repo-milestones.csv`
- `/data/exports/v1/latest/top-repo-milestones.json`
- `/data/exports/v1/latest/top-org-aggregates.csv`
- `/data/exports/v1/latest/top-org-aggregates.json`

These aliases resolve to the newest dated directory, for example `/data/exports/v1/YYYY-MM-DD/manifest.json`. Each manifest also includes dated URLs for the same generated data.

## Source views

The generator reads only existing Blob views:

- `rank/month/{YYYY-MM}/repo/flow.json` for current-month repository growth.
- `rank/all-time/repo/stock.json` for all-time repository rankings and milestone row selection.
- `rank/all-time/org/stock.json` for organization aggregate rankings.
- `lookup/repos.json` and `lookup/orgs.json` for display joins.
- `entity/repo/{id}.json` for exact 10k, 50k, and 100k milestone fields.

There is no runtime database, runtime engine, runtime AI, or external paid service in the export path.

## Bounds

The export set is intentionally small:

- top rankings: 50 current-month rows plus 50 all-time rows
- repository milestones: at most the top 100 all-time repositories
- organization aggregates: top 50 organizations or user owners by aggregate stars

This is not a full data dump. The canonical product views remain the website pages and precomputed Blob JSON contracts documented in `docs/DATA-CONTRACTS.md`.

## Regeneration

From `web/`:

```bash
bun run exports:generate
```

To regenerate a specific month:

```bash
bun run exports:generate --month 2026-06
```

The generator derives `data_as_of` and `export_date` from real Blob view `generated_at` metadata. It does not use deployment time or hard-coded freshness dates.

Regeneration writes the dated export directory and removes any stale `latest/` directory so the repository does not store byte-identical snapshots twice. The build-time rewrite keeps `/data/exports/v1/latest/*` download links working.
