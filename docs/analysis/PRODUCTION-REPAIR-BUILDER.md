---
owner: data
status: active
last_reviewed: 2026-10-26
source_of_truth_for:
  - issue 786 offline option B repair builder
  - issue 787 offline frozen-generation comparison
---

# Offline production repair builder

Issue #786 implements tasks 1 and 2 of #778. Issue #787 adds the offline
comparison in task 3. Mac rehearsal, sealing today's production canonical
backup, and all publication are separate cards. These tools read local files and write new local
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

## Offline comparison with the frozen generation

The comparison consumes the builder's output above. It verifies both sealed
phase manifests and every object's bytes and SHA-256 checksum before reading
the canonical shards. It uses the existing `buildModel` and `computeAllViews`
functions to recompute views entirely in memory. Its reference is the sealed
`base` phase: the builder's byte-for-byte copy of the frozen generation
`refresh-2026-09-13T06-00-16-398Z`. There is no metadata refresh, fold, default
storage adapter, remote fetch, or publication step.

On the Mac, from the repository root after the builder succeeds, run:

```bash
export REPAIR="$PWD/.kanban-work/786-real"
bun --no-env-file web/scripts/prod-repair-compare.ts \
  --built "$REPAIR/repaired" \
  --generation bootstrap-prod-repair-786 \
  --out "$REPAIR/comparison-787.json"
```

The report path must be new, its parent must exist, and it must be outside the
built input directory. The command never overwrites an existing report. Exit
codes are `0` for monthly equality, `1` for monthly differences (the complete
report is still written), and `2` for invalid arguments, incomplete or altered
sealed inputs, malformed input, or an I/O failure. Exit `2` is not a comparison
result. Fix the input or path problem before interpreting any prior report.

Inspect all differences even when the command exits `1`:

```bash
jq '{generation, phase_manifest_sha256, recompute, monthly_matches_frozen,
     monthly_difference_count, empty_monthly_families}' "$REPAIR/comparison-787.json"
jq '.monthly | to_entries[] | {family: .key, files: .value.files,
     matched_files: .value.matched_files, differences: .value.differences}' \
  "$REPAIR/comparison-787.json"
jq '.weekly | {survivor_sum_files, mixed_files, missing_files}' "$REPAIR/comparison-787.json"
jq '.weekly.files[]' "$REPAIR/comparison-787.json"
```

The monthly gate covers the union of frozen and recomputed file inventories:

- Every `rank/month/<month>/repo/*.json`, including flow, stock, growth, and
  newcomers. Rank order, IDs, values, previous ranks, and metadata must match.
- Every `entity/org/<login>.json` monthly curve, including period, flow, and
  stock for every point. Recent daily points, aggregate provenance, membership,
  and other entity metadata are outside this monthly comparison.
- Every `heatmap/month/<month>.json`, including dates, values, cell order, and
  scope/period metadata.

Only `meta.generated_at` in rank and heatmap objects is ignored. Numbers have
zero tolerance; a difference of one fails. Object key order is immaterial.
Array order is significant. Missing and additional files or points fail.
An entirely absent comparison family cannot pass. No differences are sampled
or truncated, including when arrays differ in length. Each record identifies
the file, a JSON Pointer (a slash-separated location inside the JSON), the
kind of difference, and each available side's value.

The four approved repository drops are **not filtered out** of the reference.
Their effects on monthly rank order, previous ranks, or organization curves
remain visible and cause exit `1`. This command must not turn a changed
monthly result into a pass by silently changing the comparison's membership.
The real-input result and any resolution belong to the later Mac cards;
this card runs only small synthetic fixtures.

The report lists all 68 week rank paths for W23 through W39: repository and
organization dimensions, each with flow and stock. It classifies the actual
recomputed output as `survivor_sum`, `mixed`, `existing_history`, `stock`,
`empty`, or `missing`. A flow file is `survivor_sum` only when real recompute
emits surviving-star provenance without mixed scope. A file whose top-ranked
rows combine imported and existing history is `mixed`. Classification uses
the emitted file, not just the week number. Stock files are never called
survivor sums; imported repository observations have unknown stock and are
omitted from those stock ranks. Weekly presence and every weekly difference
against the frozen reference are recorded separately and are informational:
they cannot fail or override the monthly gate. W22 and W40 are outside this
complete-week report.

## Publisher core (issue 824-A)

`web/scripts/publish-repair-generation.ts` exports `publishRepairGeneration` and
provides the matching command-line entry. It consumes the builder directory and
an explicit generation and bucket name. Both phase manifests and every listed
object's size and SHA-256 fingerprint must verify before the first cf command.
Verified bytes are retained in memory so subsequent local edits cannot change
the upload. Only listed generation objects and the two manifests are staged;
`repair-report.json` is not uploaded.

The following local dry-run performs no cf calls and writes nothing. Each output
line lists a key, size, and SHA-256; the last line contains summary counts.

```bash
bun --no-env-file web/scripts/publish-repair-generation.ts \
  --built "$PWD/.kanban-work/786-real/repaired" \
  --generation bootstrap-prod-repair-786 --bucket fake-bucket \
  --concurrency 4 --dry-run
```

The core sends `cf r2 objects list --bucket-name BUCKET --prefix KEY --per-page 1000`
and parses the pinned CLI's JSON array of object records. Every record must have
a string key within the requested full-key prefix. Only an exact key match counts
as present. Without an exact match, a page shorter than 1000 entries proves absence;
a full page is ambiguous and stops the run without uploading that key. The pinned
CLI omits pagination metadata, so the core cannot follow a cursor safely.
An existing key is read with
`cf r2 objects get` and skipped only when its size and SHA-256 match. Different
bytes, command errors, and invalid listings stop the run with a nonzero exit.
Absent keys are sent with `cf r2 objects put KEY --bucket-name BUCKET --file FILE`
using private temporary files containing the verified bytes. Each phase manifest
is uploaded only after all its objects complete. Parallelism defaults to four
and accepts integers from one through 32. On failure, outstanding commands drain
and no further work is scheduled. A rerun can reuse matching objects.

All commands pass through the exported `CfRunner` function argument; tests inject
a fake runner that records calls and stores bytes in memory. The default runner
uses only the repository-pinned cf package, with `CF_DELEGATION=1` in its child
environment to prevent delegation to another install. Local inputs are opened
with `O_NOFOLLOW` to reject a file replaced by a symbolic link. The opened file
must be regular and no larger than the documented 300 MB (300,000,000 bytes)
upload cap before it is read; the snapshot size is checked again after reading.
All these local checks finish before any cf call. No real bucket access is part
of this card's verification.

This is staging machinery, not the complete guarded publisher. cf has no atomic
conditional put; the existence check and upload require exclusion of concurrent
writers. Named TODO hooks reserve `recovery-generation`, `pointer-commit`,
`writer-lease`, and `target-guards` for later cards. None is implemented here,
and no pointer is written. Do not use this core against a real bucket before
those cards supply the required safeguards and publication authorization.
