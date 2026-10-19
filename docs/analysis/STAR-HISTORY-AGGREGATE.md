---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-19
source_of_truth_for:
  - GSC_0090 aggregate surviving-star gap inputs
  - issue 682 local collection and conversion contract
---

# Aggregate star-history daily and weekly gap inputs

Owner decision d1019-214826-1 = A authorizes this separately labeled source for
**2026-05-30 through 2026-09-30 only**. Issue #682 / card GSC_0090 supplies the
collector, offline tests and local inputs. Preview publication and reader-facing
labels are separate cards. No output here is a publishable replacement baseline.

The [earlier UTC collector](STAR-HISTORY-GAP.md) remains a distinct tool. Its
empty timestamp connections do not become measured zeros and are not reused as
daily data. This explicit owner decision permits aggregate history without
claiming that it restores exact UTC observations.

## Source, identity and limits

`pipeline/scripts/star-history-aggregate.mjs` uses the existing GitHub CLI login
through `gh api` GET only:

```text
GET /repos/{owner}/{repo}/stargazers/history?per_page=30&page=1
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
```

The [GitHub endpoint contract](https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10#get-repository-star-history)
returns newest-first calendar weeks with Sunday `week` labels, a `total`, and
seven `days` counts starting on Sunday. Zero weeks are explicit observations.
The collector validates seven nonnegative integer values, their sum, Sunday
labels, consecutive descending weeks and complete coverage of all 124 labels.
It expands the daily values without shifting their dates. A first page spans
30 weeks, sufficient for this gap as of October 19, 2026. A subsequent page is
requested only when the first page has not covered the start and the endpoint
advertises another page; no full-lifetime collection is performed.

These are **surviving stars at collection time**, the creation dates of stars
still present then. Removed stars and their removal dates are not recoverable.
Counts can change on later collection. They do not reconstruct net growth,
historical endpoint stocks or complete historical gross additions. Values
collected serially across repositories do not form a transactional snapshot.

GitHub does not guarantee UTC day/week boundaries. GSC_0089's 40-repository
measurement preferred same-date labels for 36 of 38 measurable repositories;
that observation supports the owner's zero-shift choice, not an exact timezone
or an error bound. Its exploratory hour model does not justify a UTC conversion.
The retained investigation is
`/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/gsc0089-report.md`.

Membership is pinned to the 5,249-row R2 whitelist at
`gitstarclub-raw/bigquery-export/whitelist/data-000000000000.parquet`, SHA-256
`d5a484458cf73942126e7f0d1e10b7f7f30c497069b83eb0913b8e42eac648ec`.
GSC_0080 verified exact id-set equality with retained
`leader/gsc0045/whitelist.json`, SHA-256
`07f5a3b79bb26fe2d248686c1b064b405d1ddd0124f76746dc7e5bd75f2cb4de`.
`prepare` requires this exact JSON digest; each later command checks it again
and compares the member ids. Metadata outside that set is ignored.

The same-day GSC_0080 stable-id GraphQL inventory supplies current names; retained
metadata supplies historical names for unavailable inventory records. This
avoids another 5,249 metadata calls. Numeric repository ids in GitHub pagination
links are checked against the whitelist id, rejecting reassigned names when
that evidence is present. A response without such a link relies on the retained
name-to-id inventory; this weaker identity evidence is explicit in its checkpoint.
No discovery, search, alternate token or credential lookup is performed.

## Pacing, checkpoints and foreground execution

Request starts are serial and at least **1.05 seconds apart**, including across
chunk restarts. Before each request its start is persisted. The client preserves
remaining/reset headers and waits before spending the final ten requests. It
honors `Retry-After` in seconds or HTTP-date form, uses at least a minute for
secondary limits with exponential backoff, and bounds retries to six attempts.
The retry counter and cooldown survive restarts. Repeated errors stop the run;
do not erase `api-state.json` to bypass them. These controls follow GitHub's
[REST rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
Other users of the same login share its quota.

Chunks default to 540 seconds and cannot be longer, leaving at most one
60-second in-flight request before ten minutes. Waiting happens in slices of
at most a minute. A cooldown outside the chunk deadline produces an immediate
resumable pause. A process lock prevents concurrent collectors; a stale lock
is recovered only after its recorded process no longer exists.

Raw response evidence is saved before an atomic repository checkpoint. Counts,
the next page and page references advance together, so an interrupted page
replays without double counting. Completed or terminal unavailable repositories
are skipped on resume. There is deliberately no automatic refetch of terminal
sources: a new collection would measure another survivor cohort. A 404 means
missing or inaccessible, not necessarily deleted. Forbidden, empty and incomplete
histories have separate statuses and null daily series; no zeros are fabricated.

## Output and conversion contract

All raw responses, checkpoints, source manifest, reports and generated inputs
live exclusively under this Git-excluded durable directory:

```text
/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history-agg/
  manifest.json                 # pinned source fingerprints and fixed members
  api-state.json                # persisted pacing, quota and retry state
  pages/<id>/*.json             # raw aggregate arrays and safe response headers
  repos/<id>.json               # authoritative atomic checkpoint + gap daily map
  summary.json                  # observed coverage, terminal statuses, holes
  inputs/manifest.json          # export fingerprints and provenance
  inputs/canonical/v2/repo-recent-daily/<0..31>.json
  inputs/canonical/v2/repo-weekly/<0..31>.json
  inputs/partial-iso-weeks.json
```

The existing [canonical shard contract](../DATA-CONTRACTS.md#14-production-canonical-json-shard)
and `pipeline/backfill/07-export-v2.mjs` use `repo_id % 32` buckets with
`{"<id>": [["date or period", value], ...]}`. The aggregate exporter uses that
same shape, sorted ascending. Daily inputs retain **all 124 gap labels**, including
measured zeros, rather than the bootstrap exporter's rolling 90-day tail.
Unavailable repositories are absent from the input shards and listed in the
manifest. Their contribution to a whole-whitelist total remains unknown.

Weekly values are summed from those daily rows using ISO Monday-Sunday weeks,
never by relabeling GitHub's Sunday-Saturday totals. The 17 complete periods
`2026-W23` through `2026-W39` enter `repo-weekly`. Two partial edges are separate:

| ISO week | Gap labels supplied | Integration requirement |
| --- | --- | --- |
| `2026-W22` | May 30-31 | Join existing May 25-29 observations |
| `2026-W40` | September 28-30 | Join existing October 1-4 observations |

`partial-iso-weeks.json` records each sum and its exact days. These sums must
never replace a complete week. A later integration can fill missing dates,
combine adjacent observations with their own provenance and then derive a
complete edge week. This collector does not fetch beyond the approved gap.

**Monthly net stays exactly as published.** This tool emits no `repo-monthly`,
canonical metadata, frozen anchor factor, stock estimate, monthly table or entity
view. Do not pass these inputs through `04-rollup.mjs`, `05-precompute.mjs`,
`07-export-v2.mjs`, or the ordinary month fold to regenerate months/stocks.
Those paths derive monthly series or anchor factors from daily history and
would violate the owner decision. Entity `curve.recent_daily` can eventually
consume this daily tuple shape, but `curve.monthly`, monthly rankings and frozen
series must retain the published values. Consequently the daily sums need not
reconcile to monthly net totals: they measure different things.

The export manifest contains row counts, expected/observed repository-days,
complete week periods, missing ids/names/statuses, observed survivor totals,
every exported file's bytes/SHA-256, every repository checkpoint's SHA-256 and
all raw response fingerprints (including retries and uncommitted page evidence).
Before sealing the manifest, every checkpoint is independently replayed from
its referenced raw responses and must reproduce the exact status/daily/total
values. The manifest records that verification and the source identity evidence.
It records `monthly_files: []` and this machine-readable provenance for the
separate label/integration work:

```json
{
  "source": "github_stargazers_history_aggregate",
  "api_version": "2026-03-10",
  "metric": "surviving_stars_at_query_time",
  "day_boundary": "github_calendar_label_approximate_not_guaranteed_utc",
  "day_shift": 0,
  "week_calendar": "iso_monday_sunday_reaggregated_from_daily",
  "monthly_policy": "preserve_published_net_do_not_fold_these_daily_values_into_months",
  "start": "2026-05-30",
  "end_inclusive": "2026-09-30"
}
```

Provenance is a sidecar, not an extra property inside the strict canonical tuple
schemas. The later publisher must propagate it to its own metadata and prevent
overwriting existing measured dates. Neither that publisher nor a UI change is
part of this card. `local_only: true` is not permission to upload.

## Run, resume and inspect

Use AGENTS.md's archive-verified Node 24.20.0 and Bun 1.4.2 bootstrap and
frozen-lockfile installs first. Set `TMPDIR`, `KANBAN_TMP`, Bun/npm caches and
verification output to this card's excluded `.kanban-work/GSC_0090/` directory.
Do not use `/tmp` or an existing Wrangler login. The whitelist-equivalent source
is already retained, so no Cloudflare command is necessary.

Initial preparation is idempotent for identical source files:

```bash
node pipeline/scripts/star-history-aggregate.mjs prepare \
  --whitelist /Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/gsc0045/whitelist.json \
  --metadata /Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/gsc0045/repos.json \
  --inventory /Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/inventory.json
```

The exact full-list resume command, from the repository root, is:

```bash
node pipeline/scripts/star-history-aggregate.mjs fetch --max-seconds 540
```

Run one chunk in the foreground, inspect its result and repeat until
`fetch_finished` is true. Stay in the active turn and poll any command session
at most a minute apart. Post a card progress comment approximately every thirty
minutes. About 5,249 successful GETs take at least 91.9 minutes at this pace,
plus latency above the pacing interval, quota waits, retries and unavailable
sources. This is a planning estimate, not a completion guarantee.

```bash
node pipeline/scripts/star-history-aggregate.mjs report
node pipeline/scripts/star-history-aggregate.mjs export
```

Exit 2 means the sweep still has pending repositories; exit 1 means an error;
exit 0 means the command finished. In particular, a finished sweep can still
have unavailable repositories: check `coverage_complete`, `missing`, and
`full_whitelist_surviving_stars`, which remains null when any member is missing.
Export refuses an unfinished sweep and fingerprints a reproducible local bundle
afterward. Never clear missing entries, sum them as zeros or broaden the window.

## Verification gate

Offline fixtures cover pinned membership, renames/reassigned names, response
shape, date boundaries, pagination, checkpoint/resume, unavailable sources,
persisted pacing/quota/backoff, retry exhaustion, ISO weeks, partial weeks,
fingerprints, deterministic export and absence of monthly/stock artifacts.
They run in the ordinary full `pipeline` test command.

The delivery gate is the full AGENTS bootstrap and static job, full `web/`
coverage suite and local fixture production `bun run build`, run in a clean
detached checkout of the exact submitted head. A detached local clone inside
the card's temporary directory provides isolation without another worktree.
No local `.env` files or live-smoke opt-ins are copied into it.
GitHub Actions stays off. `cf:dry-run`, Cloudflare builds, OpenNext and every
Wrangler command are skipped by the owner's explicit October 19 order.
The PR and handoff retain actual command results and final collection counts;
temporary logs are removed by card cleanup, so they are not the sole evidence.
