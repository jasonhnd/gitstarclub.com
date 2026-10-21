---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-22
source_of_truth_for:
  - issue 727 preview aggregate history import
  - GSC_0150 implementation and deferred publication procedure
---

# Preview aggregate history repair

Issue #727 supplies the missing integration for the
[reviewed aggregate bundle](STAR-HISTORY-AGGREGATE.md). The collector alone is
not a publisher. This command repairs an existing published preview snapshot;
it does not rebuild a baseline or infer historical monthly net growth.

GSC_0150's first round implements and tests the command only. Review and merge
its PR into `pre`, then have the leader rework the card before remote execution.
The preview Worker must already include this commit's canonical contract and
refresh changes. Coordinate that separately authorized deployment with the
preview schedules/flags card. Do not run an older Worker against the new marker.
There is no deployment or refresh endpoint call in the importer.

## Source and scope

The local input is the original sealed GSC_0090 directory, with
`inputs/manifest.json` SHA-256
`b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49`.
The CLI pins this digest, checks every exported file, the 5,249-member inventory,
all 124 daily labels, nonnegative integer counts and complete/partial ISO-week
arithmetic. The source has 5,243 complete repositories, 650,132 daily rows and
89,131 complete-week rows. Six unavailable repositories remain unknown:

| Repository id | Retained source name |
| --- | --- |
| 18477927 | segment-boneyard/nightmare |
| 136780445 | kitao/pyxel |
| 206462776 | GrowingGit/GitHub-Chinese-Top-Charts |
| 304766583 | imarvinle/awesome-cs-books |
| 824301644 | cheahjs/free-llm-api-resources |
| 888887358 | Max-Eee/NeoPass |

Only source ids already present in both canonical metadata and the published
preview lookup are eligible. No discovery or coverage expansion occurs. A
repository already containing any unmarked daily observation in the gap is
conservatively skipped, preserving that source and avoiding a false full-gap
label. The report lists it as `existing_gap_daily_observations`. Already marked
repositories must still match the source daily values and are skipped as
`already_imported`; mismatched values fail closed.

Existing weekly observations always win. Missing W23–W39 values use complete
ISO Monday–Sunday sums. W22 needs observed May 25–29; W40 needs observed October
1–4. Only a full seven-day join enters a weekly shard. Otherwise the report
lists the exact missing days; partial sums never become whole-week values.
Measured daily zeros remain valid observations; unavailable data is never zero.

The private R2 backup from GSC_0105 intentionally excludes the original source
and export manifests because they contain local home paths. An archive-only
restore cannot satisfy the pinned original export manifest by itself. Preserve
that local manifest privately, or separately review a portable recovery bundle
before removing the retained local source. Do not synthesize or upload it to a
public bucket. This importer publishes only repaired data, the accepted literal
provenance and a report with ids, repository names, counts and skip reasons.

## Command after merge and leader rework

Use the checksum-verified Node/Bun toolchain from AGENTS.md. Supply existing
preview-scoped S3 credentials through the process environment; the command does
not load owner environment files or use ambient platform login. It requires
`R2_BUCKET_PRE=gitstarclub-data-pre` (or that exact `R2_BUCKET`), the S3 endpoint
or account id, and access/secret keys. It rejects every other bucket name and
requires `_meta/bucket-identity.json` to say that bucket and `deploy_env: pre`.
Do not print credentials or substitute production values.

From the repository root, with card-local `KANBAN_TMP` and `TMPDIR`:

```bash
bun --no-env-file web/scripts/import-star-history-aggregate.ts \
  --target pre --source "$AGGREGATE_SOURCE" \
  --generation bootstrap-aggregate-gap-20261022 \
  > "$KANBAN_TMP/aggregate-dry-run.json"
```

`AGGREGATE_SOURCE` names the retained local `leader/star-history-agg` directory.
Choose a unique, recorded generation for the actual execution date. The default
is read-only: it checks `ops/workflows/active.json`, refuses a running unexpired
refresh, reads the current snapshot and checks that neither publication pointer
changed during preparation. A dry run does not acquire or modify the lease.
Inspect imported/skipped lists and counts before the authorized execution.

```bash
bun --no-env-file web/scripts/import-star-history-aggregate.ts \
  --target pre --source "$AGGREGATE_SOURCE" \
  --generation bootstrap-aggregate-gap-20261022 --execute \
  > "$KANBAN_TMP/aggregate-publication.json"
```

Execution takes the existing compare-and-set writer lease before its snapshot
and renews it during long reads/staging and before commit. It copies the active
immutable canonical generation plus its overlay, or flat canonical data for a
managed cold start, and the newest published base views. Only daily/weekly
shards, repository source markers, affected entity daily curves and affected
weekly ranks change. Monthly canonical bytes, entity monthly curves/tables,
monthly/yearly/all-time ranks, metadata and lookups are preserved. Absent
cold-start monthly shards become honest empty objects, with no observations
invented. No live overlay or pending month is folded.

Existing `stageBootstrapPhase` helpers create immutable canonical/base objects
and sealed manifests. `commitBootstrapGeneration` verifies their bytes and
switches the normal `bootstrap/latest.json` pointer under the shared lease.
No live canonical object is overwritten and no pointer is hand-edited. The
first bootstrap commit can retain a managed-refresh publication plus flat
canonical history as its verified recovery target. Later generation rollback
continues to use the prior immutable generation and its overlay.

If execution fails before commit, the old publication remains visible; staged
objects are unreachable. Retry the same generation only against the unchanged
source snapshot: immutable create conflicts fail closed. A successfully
published retry verifies both sealed manifests and returns `already-published`.
Do not delete remote staged objects or bypass an active lease. If the snapshot
advanced, record that fact and use a new generation after checking current
state. Use the normal lease-protected rollback tool in [OPS](../OPS.md).

## Provenance and stocks

`canonical/v2/repos/<bucket>.json` can carry `aggregate_history`, containing the
accepted `provenance` and exact imported ISO `weeks`. Metadata refresh keeps
this marker. Entity recompute propagates provenance to daily curves. Both full
and packed/streamed weekly recompute attach it to aggregate flow ranks, including
org contributions. Existing PR #690 labels consume that provenance. Monthly
and yearly data do not acquire an aggregate label.

Surviving-star additions do not reveal historical stocks. Imported weekly cells
never advance the frozen stock accumulator. Their internal stock is unknown;
repo stock ranks omit those cells, and org stock ranks omit a total with any
unknown member. Empty stock ranks contain no fabricated zero-star items. A
later ordinary weekly observation resumes the original stock accumulator.
Monthly stock and `d` remain unchanged.

## Evidence after publication

Record the merged/deployed commit, generation, old/new pointers, report counts
and complete imported/skipped lists in the handoff. The public report is the
generation's `views/aggregate-history-import.json`. Copy durable evidence into
the card/PR before deleting local logs.

For three eligible repositories, choose `facebook/react` plus two smaller
retained members from the actual report. Compare their 124 daily tuples and
W23–W39 sums with the source. Group displayed daily points by June–September
to cross-check monthly **aggregate daily sums**, and check the source label.
Compare the prior monthly curve/table byte-for-value and confirm current stars
remain unchanged and positive. A cold-start monthly net curve remains empty:
these aggregates cannot legitimately restore it. Record skipped samples and
choose eligible replacements. Do not call cron or refresh endpoints.

The first-round PR needs the complete isolated AGENTS static gate and both local
fixture Vite builds with matching artifact validation. GitHub Actions stays off.
No Wrangler/OpenNext command or `cf:dry-run` is permitted; the latter is skipped
by owner order. Remote import/page evidence waits for review, merge, matching
preview deployment and leader rework.
