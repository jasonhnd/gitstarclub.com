---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-22
source_of_truth_for:
  - issue 727 preview aggregate history import
  - GSC_0150 implementation and deferred publication procedure
  - issue 733 preview Worker transport and follow-up operator runbook
---

# Preview aggregate history repair

Issue #727 supplies the missing integration for the
[reviewed aggregate bundle](STAR-HISTORY-AGGREGATE.md). The collector alone is
not a publisher. This command repairs an existing published preview snapshot;
it does not rebuild a baseline or infer historical monthly net growth.

Issues #727 and #733 implement and test the command and Worker transport only. Review and merge
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

## Worker transport and safety boundary

Issue #733 adds `POST /preview/aggregate-history-import` to the Worker shell.
Every method is routed to that shell; production and any mode/bucket mismatch
return 404 before authentication, body parsing or DATA access. On preview,
`CRON_SECRET` authenticates requests and the actual bound DATA bucket's
`_meta/bucket-identity.json` must name `gitstarclub-data-pre` / `pre` on every
call. No new binding, configuration, secret or scheduler is introduced.

Use `--worker-url https://pre.gitstarclub.com` and `--secret-file` with the
existing private preview cron-secret file. `--checkpoint` is required with
`--execute`. Without `--worker-url`, the original explicit S3 transport remains
available, but it needs existing preview credentials; do not create, request or
rotate any for this operation. The Worker transport needs no S3 keys and never
uses an ambient provider login for data writes.

The machine runs the original pinned input validation and snapshot repair.
Only JSON snapshot/output objects and public generation manifest descriptors
are transferred, never the private export manifest, raw source inventory or
local paths. Each request and each object has a SHA-256 checksum. A request is
at most 8 MiB; staging is at most 16 objects / 4 MiB of decoded data. An oversized
object fails closed rather than being partially published. The machine reads
at most eight snapshot objects concurrently; each origin read and each
256-item listing is a separate Worker invocation.

The Worker uses the existing bootstrap lease and immutable publication helpers.
Every immutable write is create-only; lease/progress changes use conditional
writes. Completed chunks receive durable receipts under
`ops/aggregate-import/<generation>/<fencing-token>/`. The same location holds
manifest-bound verification cursors. Each verification invocation reads at
most 32 objects. A hard-capped fake DATA counter covers 5,669 repositories and
5,000 owners, including the recovery generation and final commit. Observed
maxima are staging 73, verification 41 and commit 26 physical subrequests, below
the test cap of 128. See Cloudflare's [binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

Completed verification proofs are scoped to the lease token and immutable
manifest digest. Only those proofs can replace the commit helper's otherwise
unbounded verification pass. The normal helper constructs the publication
pointer; the Worker adapter checks both source pointers again, renews the lease
and switches with ETag compare-and-set or create-only. Clients cannot upload a
pointer, directly write canonical paths, overwrite generation objects or delete
objects. No export staging area needs remote cleanup. Small audit/checkpoint
objects remain; unreachable failed generations follow the existing recovery
policy and must not be deleted manually.

## Follow-up operator runbook

**Do not execute on the implementation card.** After review and merge, the
leader opens a deployment/execution card. These commands are for that card's
fresh detached checkout of the exact current `origin/pre`, after the complete
AGENTS bootstrap/static job and both local fixture builds passed. Keep one
verification/deployment clone at a time. Keep GitHub Actions disabled. Use the
owner-approved shared toolchain cache, shared Bun install cache and the
follow-up card's `KANBAN_TMP`; never copy owner environment files.

From the detached repository root, in Bash (the variables below persist through
the remaining blocks):

```bash
set -euo pipefail
: "${KANBAN_TMP:?Set this to the follow-up card directory}"
export TMPDIR="$KANBAN_TMP"
GSC_TOOLCHAIN_ROOT="/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/shared-tmp/gitstarclub-toolchain"
export PATH="$GSC_TOOLCHAIN_ROOT/node-v24.20.0/node-v24.20.0-darwin-arm64/bin:$GSC_TOOLCHAIN_ROOT/bun-1.4.2/bun-darwin-aarch64:/usr/bin:/bin"
GSC_EXPECTED_SHA="$(git rev-parse HEAD)"
test "$GSC_EXPECTED_SHA" = "$(git rev-parse origin/pre)"
test -z "$(git status --short)"
export AGGREGATE_SOURCE="/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history-agg"
export GSC_SECRET_FILE="/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/secrets/pre-cron-secret"
export GSC_IMPORT_GENERATION="bootstrap-aggregate-gap-$(date -u +%Y%m%dT%H%M%SZ)"
node --version
bun --version
```

Use the then-current exact merged pre, including this transport, rather than
the earlier deployed `6364666`. Recheck archive checksums with the AGENTS block
in the follow-up. Do not substitute an unverified cached binary.

Build from the **real preview data source**, with no inherited fixture override
or live-smoke variables, and inspect the complete generated config:

```bash
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$KANBAN_TMP" KANBAN_TMP="$KANBAN_TMP"   npm_config_cache="$KANBAN_TMP/npm-cache" XDG_CACHE_HOME="$KANBAN_TMP/cache"   bash --noprofile --norc -euo pipefail <<'SH'
cd web
bun run build:pre
bun run validate:host -- --mode pre
cat .cloudflare/output/v0/workers/default/worker.config.json
SH
```

Before deployment, record and check the generated Worker is
`gitstarclub-web-pre`, DATA is `gitstarclub-data-pre`, JOBS/self-reference are
preview, `DEPLOY_ENV=pre`, `SITE_INDEXABLE=0`, the three preview schedules are
unchanged, and fixture/Blob overrides and cold-start/relax flags are absent.
No production Worker/data/queue resource is allowed. The shared MEDIA bucket
and canonical metadata site URL are expected existing configuration.

Only the separately authorized follow-up may run the pinned deployment:

```bash
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$KANBAN_TMP"   bash --noprofile --norc -euo pipefail <<'SH'
cd web
bun run deploy:pre --skip-build
bun run validate:host -- --mode pre
SH
curl --fail --silent --show-error https://pre.gitstarclub.com/.well-known/deployment   > "$KANBAN_TMP/deployment-identity.json"
bun --no-env-file -e '
import { readFileSync } from "node:fs";
const identity = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (identity.commitSha !== process.argv[2]) throw new Error("Deployed SHA mismatch");
console.log(identity);
' "$KANBAN_TMP/deployment-identity.json" "$GSC_EXPECTED_SHA"
```

Record the pinned cf deployment/version acknowledgement and 100% allocation.
Retain secret **names only** if independently inspected. Do not print values or
run Wrangler/OpenNext/`cf:dry-run`. No schedule, DNS, route or secret change is
authorized by this runbook.

Check the origin lease and record old pointers, then prepare a read-only plan.
The preflight exits nonzero if a running unexpired lease exists; let its owner
finish, then rerun. It does not acquire, release or write anything.

```bash
bun --no-env-file web/scripts/inspect-preview-aggregate.ts   "$GSC_SECRET_FILE" "$GSC_IMPORT_GENERATION"   > "$KANBAN_TMP/aggregate-before.json"
bun --no-env-file web/scripts/import-star-history-aggregate.ts   --target pre --source "$AGGREGATE_SOURCE"   --generation "$GSC_IMPORT_GENERATION"   --worker-url https://pre.gitstarclub.com --secret-file "$GSC_SECRET_FILE"   > "$KANBAN_TMP/aggregate-dry-run.json"
```

Inspect the complete imported/skipped lists and edge joins before the execution
block. GSC_0154's earlier plan was 5,238 eligible, 441 skipped, 649,512 daily and
89,046 complete-week observations, with 10,476 incomplete edge joins. The current
preview may have advanced; report any difference and its reason. Do not expand
the sealed membership or substitute an unavailable repo's count with zero.

```bash
bun --no-env-file web/scripts/import-star-history-aggregate.ts   --target pre --source "$AGGREGATE_SOURCE"   --generation "$GSC_IMPORT_GENERATION"   --worker-url https://pre.gitstarclub.com --secret-file "$GSC_SECRET_FILE"   --checkpoint "$KANBAN_TMP/aggregate-checkpoint.json" --execute   > "$KANBAN_TMP/aggregate-publication.json"
bun --no-env-file web/scripts/verify-preview-aggregate.ts   "$AGGREGATE_SOURCE" "$GSC_SECRET_FILE" "$GSC_IMPORT_GENERATION"   > "$KANBAN_TMP/aggregate-verification.json"
bun --no-env-file web/scripts/inspect-preview-aggregate.ts   "$GSC_SECRET_FILE" "$GSC_IMPORT_GENERATION"   > "$KANBAN_TMP/aggregate-after.json"
```

The verification command checks the current generation and sealed recovery,
pinned source/report, 124 daily values for React plus two smaller eligible
repos, imported complete-week sums, preserved monthly history and positive
unchanged current stars. It records monthly **aggregate daily sums**, all skips,
the six unavailable repos and six ordinary EN/JA page GETs with HTTP/language/
noindex checks. Inspect those pages for the existing aggregate/gap labels;
HTML status checks alone do not verify labels. Confirm unavailable repos remain
unknown. Copy the before/after pointers, actual counts, complete skip list,
verification report and deployed SHA/version into durable handoff evidence.
No cron, `/start`, refresh call or daily proof is part of this runbook.

If the process dies, retain the exact generation and checkpoint and rerun the
execution block directly. An active same-generation token resumes; completed
chunks and verification cursors are reused. A released/expired session may
acquire a new fencing token, but no existing generation bytes can be replaced.
A takeover, changed snapshot or immutable conflict refuses publication. Review
the new pointers/lease and plan before selecting a new generation; do not
silently reset the checkpoint, remove remote objects or edit a pointer. A retry
after a successful publication verifies its sealed manifests and returns
`already-published`. If a response is lost after publication, inspect current
state before deciding whether anything needs retrying.

## Publication and recovery

Execution takes the existing compare-and-set writer lease before its snapshot
and renews it during long reads/staging and before commit. It copies the active
immutable canonical generation plus its overlay, or flat canonical data for a
managed cold start, and the newest published base views. Only daily/weekly
shards, repository source markers, affected entity daily curves and affected
weekly ranks change. Monthly canonical bytes, entity monthly curves/tables,
monthly/yearly/all-time ranks, metadata and lookups are preserved. Absent
cold-start monthly shards become honest empty objects, with no observations
invented. No live overlay or pending month is folded.
If a published monthly curve exists without its canonical source, the command
refuses the repair. Published daily observations are preserved even when the
corresponding cold-start canonical tail has not yet been materialized.

Existing `stageBootstrapPhase` helpers create immutable canonical/base objects
and sealed manifests. `commitBootstrapGeneration` verifies their bytes and
switches the normal `bootstrap/latest.json` pointer under the shared lease.
No live canonical object is overwritten and no pointer is hand-edited. The
first bootstrap commit seals the unchanged managed-refresh base and canonical
snapshot as a separate recovery generation. Any absent history shards in that
recovery snapshot are explicit empty objects; any already published daily tail
is retained as observed data. Both generations are prepared and
verified under the same lease; only the repaired generation becomes visible,
with the recovery generation recorded as `previous_generation`. Later rollback
uses that sealed snapshot or a prior immutable generation and its overlay.

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

The implementation PR needs the complete isolated AGENTS static gate and both local
fixture Vite builds with matching artifact validation. GitHub Actions stays off.
No Wrangler/OpenNext command or `cf:dry-run` is permitted; the latter is skipped
by owner order. Remote import/page evidence waits for review, merge, matching
preview deployment and leader rework.
