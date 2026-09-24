---
owner: ranking
status: active
last_reviewed: 2026-08-30
source_of_truth_for:
  - ranking definitions
  - stock anchoring
  - derived rankings
  - ranking edge cases
---

# gitstarclub ranking specification

## Scope

This document defines the definitions and boundaries of every ranking: the precise definition of window × dimension × metric, the stock anchoring algorithm, derived-ranking (growth rate / new member) rules, org aggregation, period boundaries, and tie handling. It must be read before adding a ranking, changing a definition, or changing a floor. Data sources are in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) (the `star_daily` fact table); artifact shapes are in that same document's `rank/*` section; page presentation is in [PRODUCT.md](./PRODUCT.md); the product-level explanation of definition flaws is in [ARCHITECTURE.md](./ARCHITECTURE.md) "honest flaws of the data definitions".

## 1. Matrix overview

A ranking = **window × dimension × metric**:

| Axis | Values |
|---|---|
| **Window** | Week (ISO `YYYY-Www`) · month (`YYYY-MM`) · year (`YYYY`) · all-time (`all`) |
| **Dimension** | repo (by `repo_id`) · org (by `owner` login, including User and Organization) |
| **Metric** | **flow**=added during the period (who is rising) · **stock**=period-end total (who is largest) |

All of them are precomputed in the pipeline into `rank/{window}/{period}/{dim}/{metric}.json` (all-time is stock only).

## 2. Precise definitions of flow / stock

Let an entity be in a window `[t0, t1]`:

- **flow** = `Σ delta` (the sum of each day's increment inside the window). After the seam this includes net (**it may be negative** — a window where unstars exceed new adds). The flow ranking is descending by flow.
- **stock** = the period-end cumulative total (the cumulative stars on day `t1`). The stock ranking is descending by stock; the all-time ranking = `current_stars` / `current_stars_sum` descending.

> An entity with **no events at all** inside the window does not enter that window's ranking (flow=0 may still enter but ranks at the tail; no data ≠ 0, see §8).

## 3. stock historical anchoring algorithm (undoing gross being high)

History is gross (GH Archive has no unstar events), so accumulation is **systematically high**; the only exact anchor is today's `current_stars` (GraphQL). The algorithm:

```text
cumgross[repo, date] = Σ_{d ≤ date} delta            # gross accumulation curve
d[repo] = current_stars[repo] / cumgross[repo, seam_date]   # anchoring factor (>= 0; archive undercount can make it > 1)
stock_est[repo, date] = round(cumgross[repo, date] × d[repo])   # anchoring estimate
```

- The **anchoring factor** anchors, uniformly onto `current_stars`, the gap from GitHub Archive undercounting or from unstarred stars, so `d` may be less than, equal to, or greater than 1.
- **After the seam**: stock is tracked exactly by each day's `current_stars`, and is no longer estimated. `computeRepoWindow` still uses the frozen `anchor + cumNet`; if that formula is negative (`d=0` newcomer, negative flow in the first segment), the **published** `stock_est` is clamped to 0, and flow stays signed.
- Before writing Blob, Zod-parse every `RepoEntity` / `OrgEntity`; do not relax the `NonNegativeInt` of `MonthlyPoint`.
- `total_end` of `entity/repo.curve.monthly` = the month-end `stock_est` (history) / exact (after the seam).
- **A year window's stock is anchored to that year's last month that has data**: the year ranking's stock is **not** recomputed independently as gross/net at year grain; it takes directly the monthly `stock_est` of that year's **last month that has data** (year flow = the sum of the flow of that year's months that have data). In this way the "within-year seam split" already undone by monthly logic inside the year that crosses the seam is inherited as-is into the year window, avoiding double anchoring (`web/lib/workflows/recompute/windows.ts` `deriveYearWindow`).
- **Precision boundary**: assuming the unstar rate is uniform over time (in practice it changes) is an estimate the MVP can accept; the About page notes that "the historical curve is an anchoring estimate, and the endpoint is exact". star-history.com does the same kind of thing.

> **The only number that must be exact = `current_stars`** (the current star shown on the page). It is enough to keep the shape of the historical curve and to anchor the endpoint.

## 4. Derived rankings: growth rate (growth) + new member (new member)

The two are derived from flow/stock, with **zero newly added data**, and are used mainly on the month/year pages of the repo dimension.

### Growth-rate TOP (growth rate)
- Definition: `current-period flow / period-start stock`, descending.
- **Two conditions for inclusion (both must hold)**: ① **period-start stock ≥ 20,000** (Floor); ② **current-period flow > 0** (take only positive growth, excluding unstar/flat periods whose flow ≤ 0, so that the meaning of "growth rate" stays clean). Without a floor the growth-rate ranking is forever a "ranking of small projects that just entered", and it duplicates the new-member ranking; after the floor is added it becomes "the established middle that already has size and is still accelerating", and the information stands on its own.
- period-start stock = the previous period-end that has data, as `stock_est` (history) / exact (after the seam).

### New member (new member)
- Definition: `stock` is **for the first time** ≥ 10,000 inside the current period (the whitelist threshold).
- **Decision source**: read the frozen `repos.crossed_10k` directly (written into `canonical/v2/repos/<bucket>.json` after bootstrap has computed it), and classify it into the current period when its `slice(0,len(period))` equals the current period — **do not, in recompute or on the page, reverse-infer the first-cross date from `stock_est`**, so that it does not drift from the milestone computed by bootstrap.
- **Dedupe**: the growth-rate ranking's ≥20k floor implicitly excludes new-member projects that have just crossed 10,000; the two rankings' information domains naturally do not overlap.

## 5. Aggregation in the org dimension

The org ranking does not fetch new data — it groups per-repo by `owner` and sums:

- `flow_org[period] = Σ_{r ∈ org whitelist repo} flow[r, period]`
- `stock_org[period] = Σ stock[r, period]`; the current all-time ranking aggregates only `active:true` members, and the value = GraphQL `current_stars_sum`. The historical entity/curve of an `active:false` repo is kept, but it does not enter the current all-time ranking.
- **Forward-fill of member stock (implementation detail)**: when a member repo has no event in some period its `stock_est` is missing, and summing directly would make the org curve drop at the final period and the endpoint fail to match `current_stars_sum`. So, before aggregating, **carry-forward** each member's `stock_est` along that member's own `first-event period→global final period` (an empty period reuses the previous period's cumulative), and then sum — the org stock curve is therefore monotonic, and the endpoint equals `current_stars_sum` exactly (drift=0 has been verified). The cost: org flow in a period when every member is idle is recorded as 0 (rather than "no data"), a slight departure from §2's "no event means not on the ranking", affecting only the very sparse early period and the tail of the ranking, which is acceptable.
- org members = that owner's ≥10k whitelist repos (`entity/org.members`).
- owner_type (User/Organization) both take part; the page may add a filter (Org only / all), and the data layer does not distinguish them.
- An org's "growth rate/new member" is optional (the MVP does not have to do it); if it is done: growth rate = org flow / org period-start stock (a higher floor, such as ≥100k).

## 6. Period boundaries

- **Week** = an ISO 8601 week (starts on Monday, UTC), identified as `YYYY-Www`; a week that crosses years is assigned per ISO (week 1 contains that year's first Thursday).
- **Month / year** = UTC calendar boundaries.
- Because a week does not divide a month evenly, canonical must be **day** grain (see the ARCHITECTURE decision); any window is obtained exactly by aggregating days.
- An "in progress" period (the current week/month/year) includes that day's live-tail data, and the daily cron refreshes it (hot-snapshot).

## 7. Rank and change

- `rank`: descending by the metric inside the window, starting at 1; for ties see §8.
- `prev_rank`: the rank, in the previous period of the same kind (previous week/previous month/previous year), for the same dimension and the same metric, for "↑↓ / entering and leaving TOP-N". If there is none (newly on the ranking) then `null`.
- A month/year page's "previous/next period comparison" = the enter/drop-out diff of this period vs the previous period's TOP-50, computed from `rank` + `prev_rank`.

## 8. Boundary cases

| Case | Handling |
|---|---|
| flow is negative (unstars > new adds) | Enters the ranking normally and ranks at the tail; it is not clipped (shown honestly) |
| Tie (same value) — main ranking | Secondary sort: inside a window the flow ranking is descending by `stock_est`; inside a window the stock ranking is descending by `flow`; **the all-time repo stock ranking is descending by `current_stars`**; the final stable sort is by `repo_id` (`web/lib/workflows/recompute/ranks.ts`) |
| Tie (same value) — growth rate growth | `rate` (=flow/base) descending → `flow` descending → `repo_id` ascending |
| Tie (same value) — new member new | `current_stars` descending → `repo_id` ascending |
| Tie (same value) — all-time org stock | `current_stars_sum` descending → `login` ascending |
| The entity has no data in the window | It does not enter that window's ranking (distinct from flow=0) |
| A new repo (created inside the window) | It has data only from the creation day on; stock starts from 0 |
| `stock_est` would go negative (`d=0` newcomer, first-period unstars, opening negative flow) | Clamp the **published** count to 0. Flow stays signed. Running `cumGross` / `cumNet` / `anchor` stay unclamped so later periods can recover. Do not relax `MonthlyPoint` `NonNegativeInt`. |
| A repo drops out of the ≥10k whitelist | History is kept (the chronicle does not delete it), and daily polling stops; whether it still enters the current ranking = a PRODUCT choice (default: the current ranking follows the current whitelist, and historical rankings are kept) |
| Rename/transfer | Consolidated by `repo.id` (PIPELINE §4); display uses the current `full_name` |

## 9. Mapping to product pages (see PRODUCT for details)

| Page | Rankings used |
|---|---|
| Home | Year spine (year flow) · this-month focus (month repo flow/stock) · on this day in history (milestones) |
| Month page | Month repo flow TOP · month repo growth-rate TOP · new members this month · calendar heatmap · previous/next month comparison · (week section to be decided) |
| Year page | Year repo flow TOP50 · year new members · 12-month heatmap · (week/month breakdown) |
| Repo page | Its own curve (stock_est + recent daily) · milestones · monthly table (flow + rank) |
| Org page | The org's own curve · member repos · the org's rank in each period |
| All-time ranking `/rankings` | All-time repo/org stock TOP |
