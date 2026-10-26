---
owner: data
status: ready
last_reviewed: 2026-10-26
source_of_truth_for:
  - issue 786 offline option B repair builder
---

# Offline production repair builder

Issue #786 implements tasks 1 and 2 of #778. The comparison command, Mac
rehearsal, sealing today's production canonical backup, and all publication
are separate cards. This tool reads local files and writes a new local
directory. It does not read environment files, fetch data, use credentials,
invoke a platform CLI, or write any remote object.

## Retained local inputs

Use Bun 1.4.2 and the repository's pinned Node 24 toolchain, with dependencies
already installed in `web/` and `pipeline/`. Prepare the following layout under
the excluded `.kanban-work/786-real/inputs/` directory before running the tool:

| Local path | Retained source and requirements |
| --- | --- |
| `views/refresh-2026-09-13T06-00-16-398Z/` | Complete frozen view snapshot, including metadata, lookups, repository and organization entities, ranks, and heatmaps. |
| `canonical/v2/whitelist/refresh-2026-09-23T01-44-09-453Z.json` | Retained production whitelist snapshot; its `entries` contain the original `node_id` strings for 5,545 frozen IDs. |
| `github-rest/99234994.json`, `149111813.json`, `594330628.json` | Retained raw GitHub REST repository responses; each numeric `id` must agree with its filename, with the original nonempty `node_id`. No credential material. |
| `star_daily_gross/*.parquet` | The 22 checksum-verified gross archive parts. Columns are `repo_id`, `day`, `gross_adds`; no gap export or post-seam rows. |
| `star-history-agg/repos/<id>.json` | Checkpoints from the verified extraction of `backups/2026-10-20/star-history-agg.tar.gz`; the 10,568-file backup was verified separately. |

The original collector `inputs/manifest.json` is lost. This builder does not
recreate it or pretend to validate its old pinned hash. It revalidates the
backup checkpoints' identities, provenance, terminal status, all 124 daily
labels, nonnegative integer values, and totals. It computes complete ISO
Monday-to-Sunday weeks from those days and records SHA-256 checksums (content
fingerprints) for every consumed input. This is an additional local input
check, not a replacement claim about the prior backup verification. Raw API
pages and unrelated backup files are not consumed. Missing or unavailable
history is reported explicitly; it never becomes an invented zero series.

## Exact Mac commands

Run from the repository root after retaining and verifying the inputs above.
The output directory must not already exist. These commands do not acquire
inputs or authorize any remote write.

```bash
export REPAIR="$PWD/.kanban-work/786-real"
export FROZEN="refresh-2026-09-13T06-00-16-398Z"
bun --no-env-file web/scripts/prod-repair-build.ts \
  --frozen-views "$REPAIR/inputs/views/$FROZEN" \
  --whitelist "$REPAIR/inputs/canonical/v2/whitelist/refresh-2026-09-23T01-44-09-453Z.json" \
  --rest-repos "$REPAIR/inputs/github-rest" \
  --gross "$REPAIR/inputs/star_daily_gross" \
  --aggregate "$REPAIR/inputs/star-history-agg" \
  --out "$REPAIR/repaired" --generation bootstrap-prod-repair-786
jq '{repo_count, rows, dropped, node_id_sources, aggregate}' "$REPAIR/repaired/repair-report.json"
jq -e '.frozen_repo_count == 5552 and .repo_count == 5548 and (.dropped | length) == 4 and .monthly_matches_frozen' \
  "$REPAIR/repaired/repair-report.json"
```

The command exits nonzero on refusal. Inspect the error and retain the inputs;
do not substitute a synthesized identity or derive a monthly value from days.
Input checks finish before output creation. Existing output is never reused
or overwritten. An I/O failure during output writing can leave an incomplete
directory; success requires both manifests to verify and `repair-report.json`
to be written last. Use a new explicitly chosen output directory for a rerun.

## Output and checks

The output uses the existing `BOOTSTRAP_PHASES` layout:

```text
repaired/
  repair-report.json
  bootstrap/generations/bootstrap-prod-repair-786/
    manifests/base.json
    manifests/canonical.json
    views/...
    canonical/v2/meta.json
    canonical/v2/repos/0.json ... 31.json
    canonical/v2/repo-monthly/0.json ... 31.json
    canonical/v2/repo-weekly/0.json ... 31.json
    canonical/v2/repo-recent-daily/0.json ... 31.json
    canonical/v2/site-daily/<year>.json
```

The `base` phase is the byte-for-byte frozen view snapshot, including references
to dropped IDs. The `canonical` phase drops exactly the owner-approved frozen
members 206462776, 304766583, 824301644, and 1278830624, with reason
`github_rest_404_owner_approved`. It does not add IDs found only in an archive,
whitelist, or REST file. No `latest.json` pointer is produced.

Monthly flows are copied only from each kept entity's `curve.monthly`.
The frozen anchoring factor `d` is recovered as the last pre-seam stock divided
by cumulative pre-seam flow; post-seam-only and empty curves use zero. The real
recompute formula must reproduce every frozen monthly period, flow, and stock,
both before and after the aggregate merge. Any mismatch refuses the build.
Current production metadata and aggregate days never supply monthly values.

Pre-seam weekly rows come from local `day AS date, gross_adds AS delta`, summed
by ISO week. Duplicate keys, invalid counts, and archive dates on or after
2026-05-30 refuse the build. The frozen recent daily tail is retained. The
existing `mergeAggregateBucket` adds May 30 through September 30, complete
weeks W23 through W39, and exactly the same `aggregate_history.provenance` and
inserted-week list as the preview importer. Its edge-week rules are unchanged.
Site daily cells come only from frozen monthly heatmaps, including their gaps.
Fold watermarks and generation time remain those of the frozen snapshot;
aggregate weeks are additional history, not a claim that monthly folding moved.

The report records repository and monthly/weekly/daily/site-daily row counts,
dropped IDs and reasons, every kept ID's retained node ID and source path/hash,
aggregate imports, unavailable checkpoints, excluded memberships, partial edge
weeks, and the complete consumed-input inventory. Local paths stay in this
local report; it is not staged in either publication phase.

A retained legacy-format GitHub node ID is allowed when copied from the
authoritative whitelist or REST response. The tool has no identity encoding
fallback and does not use the older rehearsal metadata builder.
