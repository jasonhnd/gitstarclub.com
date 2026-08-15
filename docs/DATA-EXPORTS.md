---
owner: data exports
status: active
last_reviewed: 2026-08-16
source_of_truth_for:
  - public data export set
  - export regeneration commands
  - export license and attribution
  - post-publish export regenerate runbook
---

# GitStarClub data exports

GitStarClub publishes small, deterministic CSV and JSON extracts for reuse and citation. They are generated from existing precomputed Vercel Blob views and checked in as static assets under `web/public/data/exports/v1/`.

Exports are stored once, in dated directories such as `web/public/data/exports/v1/YYYY-MM-DD/`. The public `/data/exports/v1/latest/*` URLs are stable aliases rewritten by Next.js to the newest dated directory at build time; `latest/` is not a second copy of the CSV or JSON payloads.

There is **no runtime export endpoint**. Exports are static files only; regeneration is an operator job that lands through a PR.

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

## Product-gates export SLA

Live product-gates (`web/lib/integration/release-gates-live.ts`) fetch the **deployed** static manifest at `{site}/data/exports/v1/latest/manifest.json` and check `data_as_of` age.

| Gate id | What it reads | Max age | Constant |
|---|---|---|---|
| `export-manifest-age` | committed static `manifest.json` served by the site | **14 days** | `EXPORT_MAX_AGE_MS` |
| `base-pointer-age` | Blob `views/latest.json` `published_at` | **14 days** | `BASE_PUBLISH_MAX_AGE_MS` |

`data_as_of` moves only after a successful `views/latest.json` publish **and** a follow-up commit of a regenerated dated export directory. A weekly Workflow that cuts the Blob pointer does **not** refresh the static export files by itself. If exports lag more than 14 days behind the gate clock, product-gates fail closed — do not weaken the gate; regenerate and promote.

## Regeneration

### Local command

From `web/` (requires `BLOB_BASE_URL` or `NEXT_PUBLIC_BLOB_BASE_URL`, also loaded from `web/.env.local` when present):

```bash
bun run exports:generate
```

To regenerate a specific month:

```bash
bun run exports:generate --month 2026-08
```

The generator derives `data_as_of` and `export_date` from real Blob view `generated_at` metadata. It does not use deployment time or hard-coded freshness dates.

Regeneration writes the dated export directory and removes any stale `latest/` directory so the repository does not store byte-identical snapshots twice. The build-time rewrite keeps `/data/exports/v1/latest/*` download links working.

### After a successful weekly publish (operator runbook)

Run this after the managed refresh Workflow publishes a new `views/latest.json` (scheduled Sunday 06:00 UTC, or a manual trigger). Weekly checklist pointer: [OPS.md](./OPS.md) §Vercel Workflow runbook.

**Do not** push export files straight to `main`, overwrite production static assets outside git, or invent a runtime regenerate API. Production only changes through the normal `pre` → `main` promote path.

1. Confirm the publish landed:

```bash
# replace BLOB_BASE with the project public Blob base (see OPS env inventory)
curl -sS "$BLOB_BASE/views/latest.json" | jq '{version, run_id, published_at, prev_version}'
```

Expect a fresh `published_at` and a new `version` / `run_id` (for example `refresh-YYYY-MM-DD…`). If publish failed, stop — regenerate only from a successful base pointer.

2. On a clean branch from current `pre`, regenerate from the published Blob views:

```bash
git fetch origin pre
git checkout -B chore/exports-YYYY-MM-DD origin/pre   # use the export_date you expect
cd web
# BLOB_BASE_URL must point at the same public store the site reads
bun run exports:generate
# optional: pin the month when regenerating after a known period close
# bun run exports:generate --month 2026-08
```

3. Sanity-check the new dated directory (do not commit a second `latest/` tree):

```bash
ls public/data/exports/v1/
jq '{export_date, data_as_of, files: [.files[].name]}' \
  public/data/exports/v1/*/manifest.json | tail -n 20
# data_as_of should track the new base views; export_date is the dated directory name
test ! -d public/data/exports/v1/latest
```

4. Open a PR **into `pre`** with only the new dated files under `web/public/data/exports/v1/YYYY-MM-DD/`:

```bash
cd ..   # repo root
git add web/public/data/exports/v1/
git status   # expect only the new dated directory (and any intentional removal of stale latest/)
git commit -m "chore: regenerate data exports after YYYY-MM-DD refresh"
git push -u origin HEAD
gh pr create --base pre --title "chore: regenerate data exports after YYYY-MM-DD refresh" --body "$(cat <<'EOF'
## Summary
Regenerates static data exports after a successful `views/latest.json` publish.

- Generator: `cd web && bun run exports:generate`
- Product-gates: `export-manifest-age` requires `data_as_of` within 14 days
- No runtime export endpoint

## Verify
- [ ] `views/latest.json` published_at is the intended refresh
- [ ] New `web/public/data/exports/v1/YYYY-MM-DD/` present; no committed `latest/`
- [ ] Preview `/data/exports/v1/latest/manifest.json` serves the new `data_as_of`
EOF
)"
```

5. After the PR merges to `pre`, verify staging, then promote with the normal path (`pre` → `main`):

```bash
# staging (pre branch / pre.gitstarclub.com)
curl -sS "https://pre.gitstarclub.com/data/exports/v1/latest/manifest.json" \
  | jq '{export_date, data_as_of}'
# promote only after Preview is good — never silent production overwrite
gh pr create --base main --head pre --title "promote: pre → main (exports YYYY-MM-DD)" \
  --body "Promotes regenerated static exports after weekly views publish."
```

6. After production deploy, confirm the gate input is fresh:

```bash
curl -sS "https://www.gitstarclub.com/data/exports/v1/latest/manifest.json" \
  | jq '{export_date, data_as_of}'
```

Older dated directories under `web/public/data/exports/v1/` may remain for citation of exact URLs; only the newest directory is selected as `latest` at build time (`web/next.config.ts`). Removing old dates is optional cleanup, not required for the SLA.
