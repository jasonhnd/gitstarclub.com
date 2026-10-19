---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-19
source_of_truth_for:
  - GSC_0080 UTC star-history collection and access evidence
  - fixed-whitelist pilot cost estimates and resume commands
---

# UTC surviving-star gap collection

**October 19 follow-up:** owner decision d1019-214826-1 = A explicitly approves
a separate aggregate collector for approximate GitHub date labels. See
[aggregate daily/weekly inputs](STAR-HISTORY-AGGREGATE.md), issue #682 /
GSC_0090. It preserves published monthly net and does not change this report's
finding that exact UTC timestamp histories are unavailable. The tool below
still has no automatic fallback.

Issue #680 / card GSC_0080, owner decision d1019-001344-1 = A.
Read-only collection only; nothing here authorizes upload or publication.

The approved window is `[2026-05-30T00:00:00Z, 2026-10-01T00:00:00Z)`.
The fixed 5,249 ids come from the R2 archive at
`gitstarclub-raw/bigquery-export/whitelist/data-000000000000.parquet`.
No discovery or whitelist expansion is allowed. The implementation verifies
exact id-set equality against GSC_0045's retained whitelist before preparing
its manifest. Metadata names are advisory; GitHub stable repository ids are
the identity check, so renames do not change whitelist membership.

## Metric and access contract

The tool requests `stargazers(first:100, after:..., orderBy:{field:STARRED_AT,
direction:DESC})` through `gh api graphql`, the existing GitHub CLI login.
It does not retrieve, print or persist tokens or request user identities.
Initial pages are batched for at most 20 repositories (at most 2,000 edges)
per serial request; subsequent pages use one repository's own cursor. This
reduces first-page overhead without conflating repository checkpoints.
Each timestamp is normalized to UTC. Collection stops after encountering
`starredAt` before May 30 or validating complete connection exhaustion.
Newer October stars are traversed but not counted in the approved window.

These are query-time **surviving stars**, a lower bound on gross additions.
Removed stars and removal dates are invisible; this cannot reconstruct
historical net changes. The GitHub [history announcement clarification](https://github.com/orgs/community/discussions/206104)
confirms this limitation for its aggregate history source as well. Later
reads may revise past counts. A multi-page extraction is not a transactional
snapshot: a stock change during paging is rejected, but equal-count star
turnover is not detectable. Per-page evidence and request dates are retained.

The [GraphQL schema](https://docs.github.com/en/graphql/reference/repos)
exposes star counts separately from the stargazer connection. The tool refuses
to treat an empty connection with positive stock as zero additions. Private,
missing/inaccessible, forbidden, invalid, count-mismatched and changing
sources have separate statuses and null daily counts. A missing repository
cannot be diagnosed as deleted versus inaccessible from this response alone.
There is no automatic fallback to GH Archive or aggregate history, whose
UTC day boundaries remain unguaranteed in [PR #669's assessment](PREVIEW-GAP-REHEARSAL.md).

## Recovery and rate limits

Per-repository JSON is the authoritative checkpoint: cursor and counts advance
in one atomic rename after each page, and every repository has its own final
status. Raw identity-free page evidence is written before that checkpoint;
a crash between the two replays the uncommitted page without double-counting.
A process lock prevents concurrent collectors in the same output directory.
Completed repositories are skipped; unavailable ones require an explicit
`--retry-unavailable`. This starts that repository again from its newest page.
Retry rounds have persisted queues, so bounded retry chunks continue past
unavailable prefixes. When `retry_round_remaining` reaches zero, that round
has finished; another explicit retry starts a new round. Old page evidence
is retained under separate attempt directories rather than overwritten.
Never run two collectors or manually edit a checkpoint.

The serial client spaces request starts by at least one second, records actual
`rateLimit.cost`, and pauses before spending the final ten points. Both quota
resets and `Retry-After` persist across restarts. Secondary-limit retries wait
at least a minute and increase exponentially, with six total attempts.
Long waits are polled in at most one-minute slices; a chunk whose deadline
would be exceeded exits with its cooldown and progress retained. These rules
follow the [GitHub GraphQL rate-limit documentation](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
Hourly quota is shared with other uses of the existing login.

All collection outputs, including source fingerprints, per-page evidence,
checkpoints, summaries and estimates, live only under
`/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/`.
They survive card cleanup and are excluded from Git. Temporary toolchain,
logs and isolated verification output use this card's own `.kanban-work/GSC_0080/`.

## Whitelist provenance and pilot

The R2 object was read with the Cloudflare `cf` CLI, not Wrangler, on October
19. The Parquet SHA-256 is
`d5a484458cf73942126e7f0d1e10b7f7f30c497069b83eb0913b8e42eac648ec`.
It has exactly 5,249 unique positive ids; its id set equals the retained
`leader/gsc0045/whitelist.json` exactly. That JSON's SHA-256 is
`07f5a3b79bb26fe2d248686c1b064b405d1ddd0124f76746dc7e5bd75f2cb4de`.
The names and frozen-star bands come from `leader/gsc0045/repos.json`,
filtered to those ids (that older metadata file also contains other ids;
none of them enters this collection). Names and bands are not fresh metadata.
`manifest.json` fingerprints all five source inputs, including the original
40-member sample and its per-repository reference comparison.

The pilot includes all 40 GSC_0045 samples plus ten other fixed members
selected by sorting SHA-256(`GSC_0080:<repo id>`) and taking the first ten.
The original stratified sample is described in
[the repair plan](../../plans/prod-rollout-and-data-repair.md#b2-gh-archive-gap-fill-not-acceptable).
It is not a population-weighted random estimate for the whole site.

| Measurement | Result |
| --- | ---: |
| Complete stable-id inventory | 5,249 repositories / 53 requests |
| Public repositories | 5,243 |
| Not found or inaccessible | 6 |
| Public `stargazerCount` sum at inventory time | 142,281,103 |
| Pilot repositories | 50 |
| Pilot positive-stock, empty connections | 50 |
| Verified pilot UTC histories / repository-days | 0 / 0 |
| Pilot requests / measured GraphQL points | 3 / 3 |
| Pilot API time / wall time | 4.089 s / 4.147 s |
| Pilot quota/backoff wait / unmetered requests | 0 s / 0 |
| Prior 40-member surviving-star reference | 342,659 |
| Prior 40-member GH Archive count | 12,761 |
| Matched GraphQL total / difference | unavailable / unavailable |

Every pilot connection was empty despite positive `stargazerCount`; its
`totalCount` was zero and `hasNextPage` was false. There is no valid new total
to compare with 342,659. In particular, this is not a measured zero or a
100-percent decrease. Reference histories use aggregate nominal days and an
earlier query time, so even accessible timestamps would require date/cohort
caveats in any comparison. Raw pilot evidence remains excluded, along with
`pilot-summary.json`, `pilot-api.json` and `inventory.json`.

GitHub's [June 30 access-restriction announcement](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)
says star-list access is restricted to admins/collaborators and that empty or
403 responses can occur. It specifically discusses REST/UI access; attributing
the observed GraphQL emptiness to that policy is an inference, supported by
the reproducible responses, not a separate documented GraphQL guarantee.
The [September aggregate endpoint announcement](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/)
offers counts without identities, but does not resolve the UTC-boundary
limitation documented in PR #669. This tool does not silently substitute it.

## Request, point and duration estimates

The measured pilot cost is one primary GraphQL point per batched query.
`rateLimit.limit` reports 5,000 points/hour, shared with other login users.
The conservative observed request model adds one second to the pilot's mean
API latency: `4.089 / 3 + 1 = 2.363` seconds/request. Actual pacing only waits
when needed to keep request starts at least one second apart, so this model
deliberately overcounts that spacing when latency already exceeds one second.

Under the observed empty-response behavior, an entire public first-page
access sweep needs `ceil(5243 / 20) = 263` requests/points, about **0.173 hours
(10.4 minutes)** before retries/shared-quota waits. This estimates an access
check, not retrieval of 124 days. The inventory adds 53 requests; the pilot
is reused by the full run, rather than fetched again.

**A valid gap-extraction request/point/hour estimate is unavailable.** No
pilot timestamp identifies the May 30 stopping depth. For scale only, summing
`max(1, ceil(stargazerCount / 100))` over all public members gives a conditional
full-lifetime ceiling of **1,425,431 pages**, approximately **1,425,431 points**
if future individual-page queries also cost one point. That is **285.09 hourly
quota allowances**, or **935.64 hours** under the conservative latency model.
These are hypothetical static-stock bounds and projections, not an observed
gap ETA or a guarantee of throughput. Initial-page batching can lower this
ceiling, and reaching May 30 would normally stop far earlier. Other token
users, secondary limits, changing stocks and unavailable members add uncertainty.

`estimate.json` keeps inaccessible-pilot gap estimates null. For a future fully
accessible pilot, it can calculate a conditional ratio of pages to current
stock within each frozen-star band; unsampled bands use their lifetime ceiling.
That model has no calibrated confidence interval. It must not be described as
measured completeness or as an assurance that all stars can be fetched.

## Full local run and coverage

The pilot and full access sweep ran on October 19, using collector revision
`8c85184`. Later hardening preserves retry rounds/attempt evidence and keeps
uncovered aggregate totals null; the final-head offline gates cover that
delivered version. No successful live timestamp pagination could be exercised
with this login because every public connection was empty.

The single full foreground chunk finished without pausing, reusing the pilot's
50 checkpoints and visiting the remaining 5,199 members. Its log spans about
355 seconds (5.9 minutes), measured from log creation to final write. Last
repository evidence is dated `2026-10-19T11:58:21.948Z`.

| Coverage or cost | Final result |
| --- | ---: |
| Fixed members with checkpoint and raw first-page evidence | 5,249 / 5,249 |
| Positive-stock but empty histories | 5,243 |
| Not found or inaccessible | 6 |
| Pending members / partial cursors | 0 / 0 |
| Verified UTC repositories | 0 / 5,249 |
| Verified UTC repository-days | 0 / 650,876 |
| Gap surviving-star total | unavailable |
| Additional full-chunk requests / points | 260 / 260 |
| Additional full-chunk API time | 349.532 s |
| Inventory + pilot + full sweep requests / points | 316 / 316 |
| Combined fetcher API time / pacing wait | 512.973 s / 0.053 s |
| Unmetered requests / quota or secondary-limit retries | 0 / 0 |
| Last reported remaining quota / hourly limit | 4,618 / 5,000 |

These fetcher metrics exclude initial manual probes and issue/PR operations;
they do not measure other uses of the shared login. All public raw responses
were checked for positive stock, zero connection total, empty edges and false
`hasNextPage`. Every per-repository daily field is null. A zero coverage count
is not a zero-star measurement: summaries retain `complete: false` and a null
surviving-star total. Fetch exited 2, as intended for missing coverage.

The six unresolved members below are historical names from the retained
metadata, not proof of deletion or of current ownership:

| Stable id | Retained name |
| --- | --- |
| 18477927 | segment-boneyard/nightmare |
| 136780445 | kitao/pyxel |
| 206462776 | GrowingGit/GitHub-Chinese-Top-Charts |
| 304766583 | imarvinle/awesome-cs-books |
| 824301644 | cheahjs/free-llm-api-resources |
| 888887358 | Max-Eee/NeoPass |

The source window remains **unfilled**. No daily-count replacement file was
manufactured, no metric was relabeled as gross/net, and no historical status
or publication pointer changed. Restoring timestamp access, or an explicit
owner decision on a different source/date contract, is needed before valid
UTC replacement data can exist. Merely changing the page size or retrying the
same suppressed connection does not solve that upstream limitation.

Durable evidence includes `manifest.json`, `inventory.json`, `pilot-api.json`,
`pilot-summary.json`, `full-summary.json`, `estimate.json`, `api-state.json`,
all `repos/<id>.json` checkpoints, `pages/<id>/...` evidence, and foreground
logs. They are excluded and retained in the approved leader directory. The
final collector source copy and `collector-source.json` identify a runnable
revision independent of executor-workspace cleanup. Verification results for
the exact final head are recorded in the PR and card handoff. GitHub Actions
remains off; `cf:dry-run` and all other Wrangler/OpenNext commands are skipped
by the owner's explicit October 19 order.

## Run and resume

Run from this repository root after the archive-verified AGENTS bootstrap and
the frozen-lockfile web/pipeline installs. Keep `TMPDIR`, `KANBAN_TMP` and caches
inside this card's `.kanban-work/GSC_0080/`. These initial preparation commands
are already complete; resume the existing collection instead of replacing it.
The R2 command is a GET only, uses the existing `cf` login, and is unrelated to
Wrangler. No GCP or storage-write credential is used.

```bash
export KANBAN_TMP="$PWD/.kanban-work/GSC_0080"
export TMPDIR="$KANBAN_TMP/"
mkdir -p "$KANBAN_TMP"
export BUN_INSTALL_CACHE_DIR="$KANBAN_TMP/bun-cache"
export XDG_CACHE_HOME="$KANBAN_TMP/cache"
export npm_config_cache="$KANBAN_TMP/npm-cache"
export PATH="$KANBAN_TMP/gitstarclub-toolchain/node-v24.20.0/node-v24.20.0-darwin-arm64/bin:$KANBAN_TMP/gitstarclub-toolchain/bun-1.4.2/bun-darwin-aarch64:$PATH"
OUT=/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history
PRIOR=/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/gsc0045
if [ ! -f "$OUT/whitelist.parquet" ]; then
  mkdir -p "$OUT"
  : "${CLOUDFLARE_ACCOUNT_ID:?set the owner-provided read account id}"
  cf r2 objects get bigquery-export/whitelist/data-000000000000.parquet --bucket-name gitstarclub-raw > "$OUT/whitelist.parquet"
fi
node pipeline/scripts/star-history.mjs prepare --whitelist "$OUT/whitelist.parquet" --retained-whitelist "$PRIOR/whitelist.json" --metadata "$PRIOR/repos.json" --sample "$PRIOR/sample.json" --reference "$PRIOR/analysis.json"
node pipeline/scripts/star-history.mjs inventory --max-seconds 600
node pipeline/scripts/star-history.mjs fetch --pilot --max-seconds 600
node pipeline/scripts/star-history.mjs report
```

On this measured run, `fetch --pilot` exits 2 because no valid histories are
available; that is expected, not a passing extraction. Always inspect the
summary before proceeding. Initial full-run foreground chunks use:

```bash
node pipeline/scripts/star-history.mjs fetch --max-seconds 600
node pipeline/scripts/star-history.mjs report
```

Exit 2 can mean a time/repository chunk boundary, a persisted quota cooldown,
or unavailable coverage. Repeating `fetch` resumes pending cursors/members and
skips final unavailable statuses. It cannot make a restricted history available.
Exit 1 is a fatal input/transport error; inspect the reported reason. Exit 0
from `fetch` alone means all selected histories have passed validation;
`prepare`, `inventory` and `report` returning 0 make no such claim.

After access changes, explicitly retry unavailable histories in bounded
foreground chunks. The durable `collector.mjs` is an exact source copy of the
committed fetcher so it survives removal of the executor checkout. Its runtime
fetch/report commands need Node 24 and `gh`, with no DuckDB dependency.

```bash
node /Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/collector.mjs fetch --retry-unavailable --max-seconds 600
node /Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/collector.mjs report
```

Continue that retry command only while `retry_round_remaining` is positive;
inspect `api-state.json` for a future `not_before` cooldown before restarting.
At zero remaining, the retry round is finished, even if coverage is still
unavailable. A further explicit invocation starts another retry round.
Do not loop repeatedly against unchanged access restrictions. Page evidence
and checkpoints are local artifacts only, not approved pipeline replacement
inputs, and no data has been rolled up, uploaded or published.
