---
owner: product and data pipeline
status: draft
last_reviewed: 2026-10-25
source_of_truth_for:
  - issue 766 preview Pulse period oddities investigation
---

# Preview Pulse period oddities: issue 766

Read-only investigation on 2026-10-25, approximately 15:14–15:19 UTC. Scope:
explain the three reported observations using published files and their readers;
propose the smallest repairs without changing application code or data.
Acceptance: each observation has a cause supported by published fields and code.

The checked-out code is `b0ce06fdc0057dc295c674c058ac46014b9fbd0d`.
Astro references below use `feat/astro-site` at
`b13f13afd2a15d6cb40ffc0a83352d9b167fb965`, inspected with `git show` without
switching branches. Its shared readers and live writer match this checkout.
Evidence was collected with public GET requests, including the preview homepage;
no browser, cron invocation, deployment, or data mutation was used.

A **generation** is a saved data snapshot. A **pointer** is the small file
selecting which snapshot readers use. These were the active pointers:

| Published file | Relevant fields |
| --- | --- |
| [views/latest.json](https://data-pre.gitstarclub.com/views/latest.json) | `version=refresh-2026-10-25T11-36-27-410Z`, `published_at=2026-10-25T13:01:02.673Z`. |
| [live/latest.json](https://data-pre.gitstarclub.com/live/latest.json) | `generation=weekly-2026-10-25T04-00-34-331Z`, `day=2026-10-25`, `month=2026-10`, `week=2026-W43`, `published_at=2026-10-25T04:06:10.366Z`, `lease=null`. |
| [bootstrap/latest.json](https://data-pre.gitstarclub.com/bootstrap/latest.json) | `generation=bootstrap-aggregate-gap-20261022T001946Z`, `published_at=2026-10-22T12:49:05.410Z`. This initial-history snapshot is older than the managed views above. |

The homepage starts at
[`astro/src/pages/index.astro`](https://github.com/jasonhnd/gitstarclub.com/blob/b13f13afd2a15d6cb40ffc0a83352d9b167fb965/astro/src/pages/index.astro),
then `astro/src/packages/p1/page.ts` (`loadPage`) calls `PulsePageView` in
[`astro/src/packages/p1/pulse.tsx`](https://github.com/jasonhnd/gitstarclub.com/blob/b13f13afd2a15d6cb40ffc0a83352d9b167fb965/astro/src/packages/p1/pulse.tsx).
`astro/src/lib/published-readers.ts` (`withPublishedReaders`) adapts the shared
`web/lib/data/` readers to the request's captured publication; `astro/src/lib/data.ts`
reads the native data binding. `astro/src/lib/views.ts` (`baseViewKey`) and shared
`web/lib/data/source.ts` implement publication selection. Thus the homepage
combines managed historical views with independently published current-period
views; the newer managed refresh does not replace the live snapshot.

## 1. Identical weekly and monthly repositories and gains

**Cause: (a), expected with the available current-period observations.** Both
rankings contain only October 21–25 net star changes. Every observed date is in
both October and ISO week 2026-W43 (October 19–25), so the totals coincide.
The page does not accidentally read one ranking twice. These are partial-period
observations, not evidence of complete October coverage.

### Published evidence

| Published file | Relevant fields |
| --- | --- |
| [Weekly flow](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/rank/week/2026-W43/repo/flow.json) | `meta.window=week`, `meta.period=2026-W43`, `meta.metric=flow`, `meta.generated_at=2026-10-25T04:00:34.331Z`. |
| [Monthly flow](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/rank/month/2026-10/repo/flow.json) | `meta.window=month`, `meta.period=2026-10`, same metric and timestamp. All 20 `items` equal the weekly items, including ranks, IDs, values, and null `prev_rank`. |
| [Current-month index](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/current_month.json) | `schema_version=2`, `shard_count=32`, `updated=2026-10-25`; `daily_totals=[[2026-10-21,27648],[2026-10-22,19663],[2026-10-23,121696],[2026-10-24,108823],[2026-10-25,111688]]`. |
| [Current-month shard 21](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/current_month/shards/21.json) | `per_repo["1209966933"]=[[2026-10-21,1968],[2026-10-22,1235],[2026-10-23,8311],[2026-10-24,6649],[2026-10-25,5740]]`; sum `23903`. All 32 shards, `current_month/shards/0.json` through `31.json` under this same generation, were read: their combined date set is exactly October 21–25. |
| [Published repository lookup](https://data-pre.gitstarclub.com/views/refresh-2026-10-25T11-36-27-410Z/lookup/repos.json) | ID `1209966933` has `full_name=morluto/rea`, `tracked_since=2026-10-21`. The lookup supplies the names below. |

The eight displayed rows match exactly:

| Repository | Weekly gain | Monthly gain |
| --- | ---: | ---: |
| morluto/rea | 23,903 | 23,903 |
| Gathin23/cleanyourtv | 14,760 | 14,760 |
| cloudflare/security-audit-skill | 9,543 | 9,543 |
| Ebony-Vinyl/dsh-our-free-model | 7,826 | 7,826 |
| debpalash/VoiceStudio | 5,270 | 5,270 |
| deepseek-ai/DeepInfer | 4,832 | 4,832 |
| DietrichGebert/ponytail | 4,579 | 4,579 |
| stablyai/orca | 4,187 | 4,187 |

### Code path and smallest action

`astro/src/packages/p1/pulse.tsx`, lines 72–84, separately calls
`getRank("week", availablePeriods.week.period, "repo", "flow")` and
`getRank("month", availablePeriods.month.period, "repo", "flow")`, then takes
eight rows from each. Shared `web/lib/data/rank.ts` (`readSelectedRank`) selects
the current-period views because these periods are beyond the completed-period
markers in [managed meta.json](https://data-pre.gitstarclub.com/views/refresh-2026-10-25T11-36-27-410Z/meta.json):
`folded_through.month=2026-09`, `folded_through.week=2026-W40`.
The corresponding managed W43 and October flow files both return HTTP 404.

`web/lib/cron/live-refresh.ts` (`refreshLiveViews`) sums all current-month
`per_repo` observations into `monthDeltas`, and filters the same observations
by ISO week into `weekDeltas`. It merges each with its corresponding base
ranking, absent here. This directly explains the equality.

No arithmetic or routing fix is needed. An optional coverage note could say
that observations start October 21. Older imported daily/weekly surviving-star
counts are a different measure from these observed net changes; they must not
be silently added to October's net ranking. See
[the monthly-history investigation](743-preview-empty-monthly.md) and
[the aggregate-history policy](STAR-HISTORY-AGGREGATE.md).

## 2. YEAR says “Full history” and displays small gains

**Cause: (a) missing annual history, plus (c) a page/source mismatch.** No
published yearly flow ranking exists, so navigation correctly falls back to
`/rankings` and “Full history.” However, the year column and leader keep showing
an unverified saved `current_year.flow` list. Those values are the first daily
poll's partial gains, carried forward unchanged, not full-history totals or
verified 2026 gains.

### Published evidence

| Published file | Relevant fields |
| --- | --- |
| [2026 yearly flow](https://data-pre.gitstarclub.com/views/refresh-2026-10-25T11-36-27-410Z/rank/year/2026/repo/flow.json) | HTTP 404. Every same-prefix `rank/year/<year>/repo/flow.json` for 2015–2025 also returned 404, covering the resolver's entire supported lookback. |
| [Monthly recompute metadata](https://data-pre.gitstarclub.com/ops/workflows/refresh-2026-10-25T11-36-27-410Z/recompute/month-win/meta.json) | `kind=month`, `seamPeriod=2026-10`, `periods=[]`, `buckets=32`, `complete=true`. There are no monthly periods from which to derive annual history. |
| [Yearly recompute metadata](https://data-pre.gitstarclub.com/ops/workflows/refresh-2026-10-25T11-36-27-410Z/recompute/year-win/meta.json) | `kind=year`, `seamPeriod=2026`, `periods=[]`, `buckets=32`, `complete=true`. This is an empty derived window, not a failed yearly request. |
| [Current hot snapshot](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/hot-snapshot.json) | `freshness.current_year=null`, `freshness.year_spine=null`, `home.year_spine=[]`. First eight `current_year.flow` values are `1782,1344,812,619,461,394,363,351`. First row is ID `1209966933`. |
| [First daily hot snapshot](https://data-pre.gitstarclub.com/live/generations/daily-2026-10-21T22-17-18-254Z/hot-snapshot.json) | `generated_at=2026-10-21T22:17:18.254Z`, `freshness.current_year=null`; `current_year.flow` equals `current_month.flow`, led by ID `1209966933`, value `1782`. |
| [First daily manifest](https://data-pre.gitstarclub.com/live/generations/daily-2026-10-21T22-17-18-254Z/manifest.json) | `previous_generation=null`. Following all six manifests from the current live pointer reaches this initial generation; their year leaders stay `1782`. |

The null freshness field means the writer cannot establish the section's
validity; it is not a zero gain or a current timestamp. The current snapshot's
`all_time.repo` instead begins with ID `132750724`, value `556032`, further
demonstrating that the displayed `1782` is not the full-history stock ranking
(stock means total stars, while flow means period gains).

### Code path and smallest fix

Shared `web/lib/data/rank-periods.ts` (`findLatestYear`) probes from 2026 down to
`FIRST_YEAR=2015`. With every annual view missing, `fallbackAllTime()` returns
`{kind:"fallback",href:"/rankings",label:"Full history"}`.
`astro/src/packages/p1/ranking-ui.tsx` (`periodSwitcherLinks`) uses this target for
YEAR; `web/lib/rank-period-labels.ts` (`availablePeriodLabel`) supplies its label.

In contrast, `astro/src/packages/p1/pulse.tsx`, lines 81–85, derives `activeYearLabel`
from `availablePeriods.yearLink` but derives `yearRows` unconditionally from
`snap.current_year.flow`. The same rows and label feed the column and
`PulseLeaderLinks`. At lines 102–106, `freshness.current_year ?? generated_at`
also replaces an explicit unknown section date with the snapshot's fresh
global date, making the carried data appear newly verified.

The writer explains the small values: `web/lib/cron/live-refresh.ts`, lines 229–245,
uses annual base plus month deltas when an annual base exists. Otherwise it
preserves the previous snapshot's year flow; on the first run, with neither
base nor snapshot, it initializes that flow from `currentMonthTop` and leaves
annual freshness null. The published October 21 snapshot verifies that branch.
`web/lib/workflows/recompute/io.ts` (`persistDerivedYearWindow`) derives annual
periods from monthly periods, explaining why an empty monthly history still
produces no annual file after a successful recompute. This follows the preview
history limitation documented in [issue 743](743-preview-empty-monthly.md),
not evidence that this run deleted annual history.

**Smallest fix:** in the Pulse renderer, suppress the year column/leader's
carried gains when there is no actual annual target or annual freshness is
explicitly null, and show annual-data-unavailable copy instead. Keep the
existing Full history navigation fallback, and do not substitute the global
snapshot date for explicit unknown annual freshness. A fuller repair can
couple the column's rows directly to its resolved annual rank. Relabeling the
current saved rows “2026” alone would still misrepresent them.

Issue #783 applies the display-only part of this fix in the Astro Pulse page:
saved year-flow rows are hidden when no annual ranking period is available or
annual freshness is explicitly null, and the YEAR column and leader card use
localized “No yearly data yet” copy. The all-time navigation fallback remains
unchanged.

## 3. “On this day” says it is waiting for the next recompute

**Cause: (a) unavailable milestone history; (c) misleading empty-state copy.**
The renderer receives an explicitly unavailable empty list. This does not
prove that no repository ever crossed a milestone on October 25, and does not
establish a pipeline failure. A milestone here is a repository's first recorded
crossing of 10k, 50k, or 100k stars on this month/day in any year.

### Published evidence

| Published file | Relevant fields |
| --- | --- |
| [Current hot snapshot](https://data-pre.gitstarclub.com/live/generations/weekly-2026-10-25T04-00-34-331Z/hot-snapshot.json) | `home.on_this_day=[]`, `freshness.on_this_day=null`, despite `generated_at=2026-10-25T04:00:34.331Z`. |
| [First daily hot snapshot](https://data-pre.gitstarclub.com/live/generations/daily-2026-10-21T22-17-18-254Z/hot-snapshot.json) | Also `home.on_this_day=[]` and `freshness.on_this_day=null`: the live chain began without verified anniversary data. All subsequent snapshots inspected along the manifest chain retain those fields. |
| [Seed repository metadata, bucket 21](https://data-pre.gitstarclub.com/bootstrap/generations/bootstrap-aggregate-gap-20261022T001946Z/canonical/v2/repos/21.json) | For example, `1209966933` has `tracked_since=2026-10-21` and `crossed_10k`, `crossed_50k`, `crossed_100k` all null. This illustrates missing milestone source fields; it is not a census of October 25 anniversaries. |

### Code path and smallest fix

`astro/src/packages/p1/pulse.tsx`, lines 135–138, reads `snap.home.on_this_day` and
joins names through the lookup. The input is already empty, so this is not a
lookup-join loss. Lines 240–257 render `t.categories.rankingPending` when the
result is empty. That shared English dictionary entry is “Ranking data is
waiting for the next published recompute.” The page also falls back from
`freshness.on_this_day=null` to `snap.generated_at` for the date badge.

`web/lib/cron/live-refresh.ts` (`validOnThisDay`) only filters the previous
snapshot's milestones to today's UTC month/day. If none match and the old
section was not verified today, it returns `{items:[],asOf:null}`. It does not
scan repository milestone fields or discover new anniversaries. Thus another
daily/weekly refresh cannot populate a previously empty list by itself.

The historical exporter `pipeline/backfill/05-precompute.mjs` (`exportHotSnapshot`)
does construct anniversary rows by scanning `crossed_10k/50k/100k` and matching
their month/day to its generation date. The current managed recompute does
not rebuild this hot-snapshot anniversary list. Consequently, the UI promise
of the “next published recompute” is unsupported; a successful managed
publication already occurred later on October 25 without changing it.

**Smallest fix:** give this panel its own copy and respect section freshness:
use “Milestone history is unavailable” for null/absent verification, and a
neutral “No recorded milestones on this day” only for a verified empty list.
Do not present a global snapshot timestamp as the anniversary section's
verification date. Actually filling the panel would require a separate change
to generate today's anniversaries from available milestone history; repeatedly
triggering refresh or inventing milestone dates is not a repair.

Validation: `bun run lint:docs` was run with Bun 1.4.2 and Node 24.21.0.
It stops at the pre-existing missing metadata frontmatter in
`docs/analysis/743-preview-empty-monthly.md`; this report passes that metadata
check. Running the later checks separately passed all eight documentation
consistency tests and `bun scripts/check-docs.mjs`. The Cloudflare gate tests
and assertion cannot load because the checkout lacks the `cf` package.
Published-data cross-checks confirmed all 20 weekly/monthly items match,
the date coverage across all 32 current-month shards, the listed year gains,
and both null freshness fields. `git diff --check` passed. No application
code, configuration, or published data was changed.
