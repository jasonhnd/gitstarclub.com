---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-19
source_of_truth_for:
  - GSC_0044 local rehearsal measurements
  - sampled GitHub star-history feasibility and limitations
---

# Preview gap rehearsal and GitHub history assessment

Issue #668, card GSC_0044, measured on 2026-10-18 UTC / October 19 JST.

**Rehearsal only. Do not upload or publish this generation.** The owner's
GSC_0045 follow-up reports 12,761 GH Archive events versus 342,659 GitHub
history stars on 40 repositories. This card independently samples five
repositories below. A replacement extraction and its metric/date contract
need a separate decision. No full-whitelist history fetch was performed.

## Local rehearsal

All artifacts are excluded from Git and live under
`.kanban-work/GSC_0044/`. The original 20 Parquet files, 30,907,971 bytes,
matched every size and SHA-256 in `star_daily_gross.manifest.tsv` before use.

The fresh dry run estimated 10,580,215,529 bytes, below the authorized
20,000,000,000-byte cap. The real job was
`gitstarclub:US.gsc_0044_gap_260530_260930_20261019`, using `CREATE TABLE`
without replacement and the unchanged `gitstarclub.gitstarclub.whitelist`.
It created
`gitstarclub.gitstarclub.star_daily_gross_gap_260530_260930_20261019`.
Processed bytes were 10,580,215,529; billed bytes were 10,581,180,416.
At the brief's USD 6.25/TiB rate that is USD 0.060147 before any free-tier
credit. Free-tier usage and the eventual invoice were not measured.
The result was read locally through two `tabledata.list` GET pages, then
converted to Parquet with DuckDB. No GCS export objects were created.

| Input | Rows | Repositories | First / last day | Adds |
| --- | ---: | ---: | --- | ---: |
| Verified backup | 12,375,426 | 5,249 | 2015-01-01 / 2026-05-29 | 120,374,597 |
| Gap | 90,797 | 4,914 | 2026-05-30 / 2026-09-30 | 305,260 |
| Union | 12,466,223 | 5,249 | 2015-01-01 / 2026-09-30 | 120,679,857 |

All inputs have zero null, non-positive, or duplicate `(repo_id, day)` rows.
Dates do not overlap. The union's repository id set equals the existing
5,249-row whitelist exactly; no search/discovery or coverage expansion ran.

Strict step 03 failed closed because GitHub could not resolve
`segment-boneyard/nightmare` (18477927); a REST read also returned 404.
For this local rehearsal, metadata was reused from 5,244 captured public
canonical repository records and five immutable entity records from
`refresh-2026-09-13T06-00-16-398Z`. Metadata dates span September 13–23;
these are not fresh October metadata. The five entity fallbacks are
99234994, 149111813, 206462776, 304766583, and 824301644. Existing frozen
historical status was retained: 5,241 active and eight inactive members.
Step 07 now preserves inactive status instead of reactivating those members.
The shared GitHub client's fail-closed behavior is unchanged.

Step 05 produced 13,012 JSON views, all validated, with zero repository or
organization stock-anchor drift. Step 07 produced 141 canonical JSON files;
all 128 required shards and 12 site-daily files passed validation. Export
ran with no inherited storage credentials. Nothing was staged remotely.
Canonical meta has seam `2026-10-01`, month watermark `2026-09`, and week
watermark `2026-W40`.

### Reproduce from step 01

The committed [read-only tools](../../pipeline/scripts/README.md) replace
all temporary preparation/probe scripts. Run from the repository root after
the archive-verified [AGENTS bootstrap](../../AGENTS.md#bootstrap). Install
both dependency sets with the commands below. The PATH shown is for this
macOS arm64 workspace; use the corresponding AGENTS cache paths elsewhere.
Existing gcloud/BigQuery authentication and read access to the fixed table
are required. There is no Cloudflare credential requirement.

Use a new output directory each time. The round-1 run used `replay-round1`;
choose another name if that directory exists. All commands below are part of
the replay except the explicitly historical query record in step 02.

```bash
set -euo pipefail
export TMPDIR="$PWD/.kanban-work/GSC_0044"
export KANBAN_TMP="$TMPDIR"
mkdir -p "$KANBAN_TMP"
git_exclude="$(git rev-parse --git-path info/exclude)"
rg -qxF '.kanban-work/' "$git_exclude" || echo '.kanban-work/' >> "$git_exclude"
rg -qxF '/pipeline/data' "$git_exclude" || echo '/pipeline/data' >> "$git_exclude"
export PATH="$TMPDIR/gitstarclub-toolchain/node-v24.20.0/node-v24.20.0-darwin-arm64/bin:$TMPDIR/gitstarclub-toolchain/bun-1.3.14/bun-darwin-aarch64:$PATH"
export BUN_INSTALL_CACHE_DIR="$KANBAN_TMP/bun-cache"
export XDG_CACHE_HOME="$KANBAN_TMP/cache"
export XDG_CONFIG_HOME="$KANBAN_TMP/config"
export npm_config_cache="$KANBAN_TMP/npm-cache"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
node --version
bun --version
(cd web && bun --no-env-file install --frozen-lockfile)
(cd pipeline && bun --no-env-file install --frozen-lockfile)
export REPLAY="$KANBAN_TMP/replay-round1"
test ! -e "$REPLAY"
mkdir "$REPLAY"
```

**01 — retain the original whitelist and verify/copy the backup.** Do not run
step 01 discovery/search or reload the BigQuery whitelist. Read its existing
5,249 ids. The backup command verifies every source size/SHA-256 before any
copy, verifies the copied bytes again, and refuses existing outputs.

```bash
bq --project_id=gitstarclub --format=prettyjson head --max_rows=10000 gitstarclub:gitstarclub.whitelist > "$REPLAY/whitelist-source.json"
BACKUP_ROOT="/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/raw-backfill"
node pipeline/scripts/preview-gap-rehearsal.mjs backup \
  --out "$REPLAY" \
  --backup-dir "$BACKUP_ROOT/raw" \
  --backup-manifest "$BACKUP_ROOT/star_daily_gross.manifest.tsv" \
  --whitelist-file "$REPLAY/whitelist-source.json" > "$REPLAY/01-backup.log"
```

The round-1 replay used the already retained, identical verified copies at
`$KANBAN_TMP/raw-backup` and `$KANBAN_TMP/star_daily_gross.manifest.tsv` for
those two backup arguments. The original GCS objects remain read-only.

**02 — render the bounded query and reuse the preserved result.** Rendering
is local. The replay reads the original job record and the already-created
dated table; it performs no new query scan and creates no remote object.
The exporter reads metadata before/after, follows both `tabledata.list`
pages, checks the row count/keys/date bounds/id membership, and converts to
local `(repo_id BIGINT, day DATE, gross_adds BIGINT)` Parquet with DuckDB.

```bash
node pipeline/backfill/02-extract.mjs \
  --start-suffix 260530 --cutoff-suffix 260930 \
  --destination gitstarclub.star_daily_gross_gap_260530_260930_20261019 \
  --create-only > "$REPLAY/02-gap.sql"
bq --project_id=gitstarclub --location=US --format=prettyjson show --job=true gitstarclub:US.gsc_0044_gap_260530_260930_20261019 > "$REPLAY/02-original-job.json"
node pipeline/scripts/preview-gap-rehearsal.mjs export \
  --out "$REPLAY" \
  --table gitstarclub.gitstarclub.star_daily_gross_gap_260530_260930_20261019 > "$REPLAY/02-export.log"
```

Historical extraction command sequence, already completed on October 19;
**do not run it as part of replay**. The original fresh dry-run result was
10,580,215,529 bytes, below 20 GB, before the second command ran. The rendered
DDL is create-only, with no replacement of the May table or existing objects.

```bash
bq --project_id=gitstarclub --location=US query --use_legacy_sql=false --dry_run --maximum_bytes_billed=20000000000 < "$REPLAY/02-gap.sql"
bq --project_id=gitstarclub --location=US query --use_legacy_sql=false --maximum_bytes_billed=20000000000 --job_id=gsc_0044_gap_260530_260930_20261019 < "$REPLAY/02-gap.sql"
```

**03 — assemble historical snapshot metadata, a known strict-step exception.**
The original strict `03-metadata.mjs` failed with GraphQL `NOT_FOUND` for
repository 18477927 and an independent REST GET returned 404. A 404 does not
prove deletion or mean zero stars. Its historical whitelist membership and
snapshot status must remain. Its September 23 snapshot says `active: true`;
that stale value is retained only for rehearsal and is not a current access
claim. The eight historical inactive members are also retained. The shared
strict client is unchanged and the
strict step is **not recorded as passing**. This rehearsal reuses dated
canonical metadata, then frozen entity fallbacks for missing ids, instead
of silently omitting that member or weakening production metadata checks.

For a fresh replay, this command downloads the 32 public canonical repo
snapshots, frozen lookup/meta and necessary frozen entities, records URLs
and SHA-256 values, filters exactly the original ids, and writes both the
metadata and local step-01 whitelist files. It runs no GitHub search.

```bash
node pipeline/scripts/preview-gap-rehearsal.mjs metadata \
  --out "$REPLAY" > "$REPLAY/03-metadata.log"
```

For the exact retained round-1 inputs, the command run was the following
alternative; do not run both against the same output directory:

```bash
node pipeline/scripts/preview-gap-rehearsal.mjs metadata \
  --out "$REPLAY" --cached-snapshots "$KANBAN_TMP/frozen" > "$REPLAY/03-metadata.log"
```

A separate cold-download metadata run used 39 public GETs and reproduced
all 5,249 members, five fallbacks and eight inactive members; all 39 source
fingerprints matched the retained inputs. Public
canonical snapshots are mutable: future fresh downloads may have different
metadata and fallback membership. The source manifest identifies the inputs
used; exact historical byte reproduction requires retaining those snapshots.
The original cached five fallbacks and eight inactive ids are reported above.
No snapshot is fresh October metadata or approved replacement star history.

**04 — roll up the disjoint union locally.** The only link replaced here is
the excluded rehearsal symlink. Stop if a real pipeline data directory or a
pipeline environment file exists; do not move or delete owner data/secrets.
The clean environment below keeps inherited remote-write credentials out of
steps 04–07. The input maximum date, checked by `summary`, is September 30;
there is no later input to filter and no separate cutoff CLI option.

```bash
if [ -e pipeline/data ] && [ ! -L pipeline/data ]; then
  echo "pipeline data directory is not a rehearsal symlink" >&2
  exit 1
fi
ln -sfn "$REPLAY/pipeline-data" pipeline/data
test ! -f pipeline/.env
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" KANBAN_TMP="$KANBAN_TMP" \
  node pipeline/backfill/04-rollup.mjs > "$REPLAY/04-rollup.log" 2>&1
```

**05 — precompute the service views locally.** Generation timestamps vary;
fixed input counts, period sums and metadata anchors can be compared across
runs. The original and round-1 runs both have zero stock-anchor drift.

```bash
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" KANBAN_TMP="$KANBAN_TMP" \
  node --max-old-space-size=4096 pipeline/backfill/05-precompute.mjs > "$REPLAY/05-precompute.log" 2>&1
bun --no-env-file web/scripts/validate-views.ts "$REPLAY/pipeline-data/views" > "$REPLAY/validate-views.log" 2>&1
```

**06 — intentionally skipped.** This is the remote base upload step; the
rehearsal has no upload phase or R2 writes. The future operator sequence is
separate below and may use only reviewed replacement data.

**07 — stage canonical files in the local output directory only.** Reuse the
original generation timestamp for comparable canonical metadata. `--no-upload`
prevents remote staging/commit; `--stage-only` also keeps publication outside
this local command. The exporter runs the canonical validator itself.

```bash
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" KANBAN_TMP="$KANBAN_TMP" \
  node pipeline/backfill/07-export-v2.mjs \
  --generation bootstrap-20261018T151528Z --stage-only --no-upload > "$REPLAY/07-export-v2.log" 2>&1
bun --no-env-file web/scripts/validate-bootstrap-canonical.ts "$REPLAY/pipeline-data/v2/canonical/v2" > "$REPLAY/validate-canonical.log" 2>&1
bun --no-env-file web/scripts/probe-preview-gap-fold.ts "$REPLAY/pipeline-data/v2/canonical/v2" "$REPLAY/fold-proof.json" > "$REPLAY/fold-proof.log" 2>&1
node pipeline/scripts/preview-gap-rehearsal.mjs summary --out "$REPLAY" > "$REPLAY/summary.log" 2>&1
```

The round-1 comparison replay used the same final `summary` command with
`--cached-snapshots "$KANBAN_TMP/frozen"`. The comparison downloads only any
missing public frozen reference snapshots; explicit 404 is recorded as
unavailable, never zero. `rehearsal-summary.json` records backup/gap/union
statistics, unique keys, exact whitelist equality, monthly totals and the
three repository comparisons below. All outputs stay excluded from Git.

### Corrected fold evidence

The committed probe calls the real fold implementation with local injected
I/O (data reads/writes supplied by the test). Every shard read or canonical
mutation throws. With `relaxMissingFrozenPending: false`, the final persisted
JSON has these independent records:

| Date | Positive `pendingReads` | Positive folded months / weeks | W39 negative `pendingReads` | Negative result |
| --- | --- | --- | --- | --- |
| 2026-10-01 | `[]` | `[]` / `[]` | `["2026-09"]` | required September pending missing |
| 2026-10-19 | `[]` | `[]` / `[]` | `["2026-09"]` | required September pending missing |
| 2026-10-31 | `[]` | `[]` / `[]` | `["2026-09"]` | required September pending missing |

The earlier temporary probe shared an array between positive and negative
cases: its assertions passed before the negative case appended September,
but its saved positive evidence then incorrectly showed that read. That
artifact is superseded. The committed probe isolates and copies every case,
then rechecks positive evidence after all negative cases; a serialization
regression test also verifies there is no shared array. The original local
proof artifact was regenerated as well. The round-1 `replay-round1/fold-proof.json`
SHA-256 is `93d2f815f9880b40dc4cf88839f8ad6b7cfbbedfa59ca0846286ffa27118c273`.
It includes the absolute source path, so its hash varies with the workspace.

W40 has only September 28–30 (705 / 1,679 / 3,199 site adds); October 1–4
never join that baseline week. This proves the first October fold boundary,
not a whole managed refresh or a publishable dataset.

## Numbers against the frozen views

The reference is
`https://data.gitstarclub.com/views/refresh-2026-09-13T06-00-16-398Z/`.
Its later-period flows are net snapshot deltas; the rehearsal uses severely
incomplete gross WatchEvents. These are different metrics, not a correction
to the frozen numbers.

| Month | Frozen site total (days) | Rehearsal gross (days) | Difference |
| --- | ---: | ---: | ---: |
| 2026-06 | 2,189,425 (28) | 83,258 (30) | -2,106,167 (-96.20%) |
| 2026-07 | 2,545,194 (20) | 18,074 (31) | -2,527,120 (-99.29%) |
| 2026-08 | 2,445,113 (31) | 13,915 (31) | -2,431,198 (-99.43%) |
| 2026-09 | unavailable | 173,011 (30) | unavailable |

June–August total 115,247 in the rehearsal versus 7,179,732 frozen.
September's frozen heatmap and monthly rank both return 404; its live
pointer has a null generation. Missing September data is not treated as
zero. May gains 17,002 from the two added days, reaching 304,720.

Each cell below is **rehearsal gross / frozen flow**:

| Repository | June | July | August | September |
| --- | ---: | ---: | ---: | ---: |
| freeCodeCamp/freeCodeCamp | 156 / 4,657 | 22 / 2,593 | 7 / 1,510 | 199 / unavailable |
| react/react | 57 / 814 | 14 / 628 | 17 / 1,539 | 306 / unavailable |
| codecrafters-io/build-your-own-x | 419 / 11,005 | 86 / 12,802 | 72 / 11,014 | 645 / unavailable |

The rehearsal's September leaders are `mattpocock/skills` (4,153),
`affaan-m/ECC` (3,038), and `blader/humanizer` (1,748). All-time stock uses
the retained metadata snapshot and the pipeline's anchor, not a new
October GitHub measurement.

## Read-only GitHub history sample

Only five whitelisted repositories were sampled: first and last pages,
plus React page 2. This used ten version-pinned history GETs, plus an initial
React sanity GET: **11 history requests total**. No stargazer identities or
all-whitelist histories were fetched. Requests used the existing GitHub CLI
authentication without printing its token.

| Repository | Creation week reached | Last page | Gap adds: GH Archive / GitHub history |
| --- | --- | ---: | ---: |
| preservim/nerdtree | 2008-03-09 | 33 | 6 / 92 |
| react/react | 2013-05-19 | 24 | 400 / 6,511 |
| freeCodeCamp/freeCodeCamp | 2014-12-21 | 21 | 395 / 12,494 |
| codecrafters-io/build-your-own-x | 2018-05-06 | 15 | 1,465 / 47,081 |
| antirez/ds4 | 2026-05-03 | 1 | 228 / 10,499 |

The five gap totals are 2,494 versus 76,677 (3.25%). This is a source-count
ratio with the semantic caveats below, not a calibrated completeness rate.
All 124 gap day slots were present on each first page. Every sampled weekly
total equals its seven daily counts; weeks are descending and continuous.
React page 1 joins page 2 without a missing or duplicate week. Last-page
responses have no next link. Middle pages were not fetched, so lifetime
continuity was not exhaustively tested.

The numeric route `/repositories/{id}/stargazers/history` worked for all five.
The [documented route](https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10#get-repository-star-history)
uses owner/repository names. Pin `X-GitHub-Api-Version: 2026-03-10` and
`Accept: application/vnd.github+json`; keep the stable whitelist id as the
output key. Responses contain newest-first weekly aggregates, with Sunday
first in `days`. Page size defaults to and is capped at 30 weeks; page
number is capped at 100. Follow pagination links and validate coverage,
rather than assuming a star-count-based number of pages. No date-range
filter is documented.

### Requests and quota for the fixed whitelist

As of October 18, the 30-week first page spans March 29 through the current
week for the four older samples; the young sample reaches its creation
week. Therefore **about 5,249 GETs**, one per accessible repository, should
cover May 30–September 30. This is an estimate, not an all-repository access
check. Budget retries and unavailable/private/deleted members separately;
do not interpret a 403, 404, empty, malformed, or truncated response as zero.

The sample consumed one REST `core` unit per GET (used 74 through 83;
remaining 4,926 through 4,917; limit 5,000). At 5,000 requests/hour the gap
requires more than one fresh hourly allowance, sharing it with other token
users. One serial request/second implies about **87.5 minutes**, before
latency, retries, or reset waits. Watch the response rate headers and honor
`Retry-After`/reset on 403 or 429; avoid large parallel bursts. GitHub's
[rate-limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
also describes secondary limits; primary quota alone is not a throughput
guarantee. GraphQL metadata uses a separate primary allowance.

For context, using the captured creation dates and 30-week pages gives a
**full-lifetime estimate of 81,499 GETs**, 1–33 pages/repository (median 16).
That is 16.3 hourly allowances at 5,000/hour, or about 22.6 hours at one
request/second, excluding retries and other traffic. This calculation is
local only. The oldest captured creation date is 2008-03-10, consistent
with the oldest sampled page. The endpoint is not limited to the gap or
to recent 90-day history. Its returned weeks can predate 2015, but this
task's pipeline input remains restricted to the approved gap and id set.

### Meaning, date boundaries, and input mapping

GitHub's [endpoint announcement clarification](https://github.com/orgs/community/discussions/206104)
says the counts describe stars created on a date that **still exist at
query time**. Removed stars and their removal dates are absent. A later
read can revise older counts. This is surviving-star history, neither
all historical gross adds nor historical net daily changes. Preserve raw
responses, response dates, ETags, API version, and source labels. A switch
from the backup's gross history needs a reviewed metric decision.

GitHub explicitly does not guarantee UTC week/day boundaries. All sampled
week timestamps decoded to Sunday 00:00 UTC; that observation does not
override the documented limitation. The pipeline's GH Archive dates are
UTC dates. Without individual timestamps or a guaranteed upstream zone,
daily aggregates cannot be precisely rebucketed to UTC, especially at
May 29/30, September 30/October 1, and month boundaries.

For a separately approved conversion, expand each weekly record into seven
tuples `(whitelisted repo_id, nominal day, days[index])`, Sunday first;
sort ascending, keep only May 30–September 30, validate integer counts,
weekly sums, continuity and unique keys, and retain coverage checks before
dropping zero rows. Nominal day can be computed from `week + index * 86400`
only with the UTC caveat explicitly retained. Write `repo_id BIGINT`,
`day DATE`, `adds BIGINT`; the current step 04 wire format names the last
column `gross_adds`. Renaming a column is structurally sufficient for
DuckDB but does not turn surviving-star counts into gross adds. No such
replacement input was built or substituted during this task.

## Future preview operator commands, not executed

The current generation `bootstrap-20261018T151528Z` must never be uploaded.
The operator first needs approved replacement data, an approved date/metric
contract, a new generation, a bucket-scoped Cloudflare key, and an eligible
empty preview bucket with its owner-provisioned identity marker. No action
here provides that authorization or changes production.

After the pipeline data directory points to that reviewed replacement, use this sequence
from `pipeline/`. `APPROVED_REPLACEMENT_DATA_DIR` and `GEN` must be supplied
by that future handoff; they must not identify this rehearsal:

```bash
: "${APPROVED_REPLACEMENT_DATA_DIR:?approved replacement required}"
: "${GEN:?new approved generation required}"
test "$GEN" != bootstrap-20261018T151528Z
test "$(realpath data)" = "$(realpath "$APPROVED_REPLACEMENT_DATA_DIR")"
export R2_BUCKET_PRE=gitstarclub-data-pre
node backfill/06-upload.mjs --store r2 --target pre --generation "$GEN"
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN"
node backfill/06-upload.mjs --store r2 --target pre --generation "$GEN" --execute
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN" --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation "$GEN" --execute --initial-commit
```

Step 06 is necessary for the remote base phase: step 07's commit verifies
both phase manifests. Contrary to the earlier B2 draft's optional-06 note,
07 alone cannot publish a complete empty-bucket baseline. Initial commit
refuses existing `bootstrap/latest.json`, `views/latest.json`, or
`canonical/v2/meta.json`. Do not delete markers, hand-write pointers, or run
this recipe against production.

## Evidence and verification record

The original run's local evidence includes `extract-summary.json`, `data-statistics.json`,
`metadata-provenance.json`, `comparison-summary.json`, `fold-proof.json`,
`star-history-assessment.json`, `history-quota-estimate.json`,
`artifact-summary.json`, raw sample responses, and logs. Original output manifest
SHA-256: `e48a9df9c143a294734f470d800d38ec73d9643d788cfc072c0eb0b4da6989a2`.
Gap Parquet SHA-256:
`86a4e882c704c70633b972fe1bf5b9f91f4daf927cf382dc7a9c09ea8b8be3f0`.
Canonical meta SHA-256:
`0a03c1e58b0f48f6b6a69924393fdc82cdd23eff7ad6beb701f30902c905038f`.

Round 1 rebuilt the same 12,466,223 rows, date/id set and monthly/repository
sums in a new local directory using only committed tools. Gap Parquet and
canonical metadata have the same hashes shown above; view generation times
change. New evidence includes `backup-verification.json`, `gap-export.json`,
`metadata-provenance.json`, `rehearsal-summary.json`, corrected `fold-proof.json`,
and numbered per-step logs. Offline regression tests cover export pagination,
truncation/duplicate/source-change rejection, backup fingerprints, metadata
fallback/inactive membership, and serialized proof isolation.

These artifacts are temporary and are removed by card cleanup; the measured
summary above is the durable record. Original backup objects and the new
BigQuery table remain available without relying on that directory. The
exact final-head bootstrap, static/full-web coverage, fixture production
build, and pre-target `cf:dry-run` results are recorded in the PR body and
kanban handoff. GitHub Actions stays off. Independent review, replacement
source decisions, and preview credentials remain external follow-up work.
