---
owner: GEO measurement / citation review
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - GEO target-query registry
  - citation-review worksheet
---

# GEO target AI query tracking

## Scope

This file is the manual target-query registry for GitStarClub's answer-engine citation reviews. It is intentionally lightweight: reviewers copy prompts into AI search products, record whether GitStarClub was cited, and open follow-up implementation issues for actionable misses.

This workflow has no paid monitoring dependency. Do not add paid GEO monitoring, browser extensions, client analytics, or user-level tracking to run these checks.

## Primary metric

Citation occupancy is the primary metric:

```text
citation occupancy = GitStarClub-cited checks / eligible checks
```

An eligible check is one reviewed query on one engine. Count a check as cited only when the answer links to `gitstarclub.com` or names a GitStarClub page as a source. Exclude checks marked `engine unavailable` from both numerator and denominator, but keep the row for audit history.

Report citation occupancy overall, by engine, and by page type. Track answer accuracy as a secondary metric because a cited answer with a stale fact, wrong fact, or wrong canonical URL still needs follow-up.

## Review cadence

Run the review manually from the public product UIs. Use a clean browser profile or private window when possible, keep location and personalization notes in the row, and do not pay for a monitoring platform.

Weekly for the first eight weeks after GEO deepening launches:

| Engine | Weekly action |
|---|---|
| ChatGPT Search | Run every high-priority target query with search enabled. |
| Perplexity | Run every high-priority target query in default answer mode. |
| Google AI Overview + AI Mode | Run every high-priority target query in Google Search; if AI Mode is available, run the same query there too. |
| Gemini | Run every high-priority target query and inspect linked sources when the UI provides them. |
| Claude | Run every high-priority target query with web/search features available in the current product. |
| Grok | Run every high-priority target query with web/search features available in the current product. |

Monthly after citation occupancy and answer accuracy stabilize:

- Re-run all high-priority queries across all engines.
- Rotate through medium-priority queries so every medium query is checked at least once per quarter.
- Re-run any query tied to a page that changed since the previous review.

Ad hoc after schema, robots, sitemap, answer-capsule, ranking, category, methodology, or data-export changes:

- Re-run affected high-priority queries within one week.
- Record whether the miss is `not indexed`, `not cited`, `wrong URL`, `stale fact`, `wrong fact`, `competitor cited`, or `engine unavailable`.
- Open a follow-up issue for each actionable miss and link it to the relevant `docs/GEO.md` subsection.

## Weekly check row

Copy one row per query-engine check:

| Date | Engine | Query | Cited GitStarClub? | Cited URL | Competitors cited | Answer accuracy | Notes |
|---|---|---|---|---|---|---|---|
| 2026-07-02 | ChatGPT Search | which GitHub repository gained the most stars in June 2026? | yes/no | /rankings/2026/6 | GitHub Trending; blog posts; none | correct / partially correct / wrong / not applicable | Use miss class: not indexed, not cited, wrong URL, stale fact, wrong fact, competitor cited, or engine unavailable. |

Use canonical paths in `Cited URL` when the engine cites GitStarClub. If it cites a non-canonical GitStarClub URL, record the shown URL and mark accuracy as `partially correct` or `wrong` depending on the answer.

## Target queries

Tracked page types are `repo`, `org`, `ranking`, `category`, `pulse`, `compare`, `about`, and `data-export`.

### Repo pages

Expected page family: `/[owner]/[name]`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| repo-react-100k | repo | when did react/react reach 100k GitHub stars? | /react/react | 100k milestone date | entity/repo/{id}.json milestones.crossed_100k | high | Checks exact milestone citation. |
| repo-react-star-history | repo | react GitHub star history | /react/react | current stars, milestone dates, and monthly star curve | entity/repo/{id}.json current_stars, milestones, curve.monthly | high | Checks whether the repo page wins generic star-history demand. |
| repo-nextjs-current-stars | repo | how many stars does vercel/next.js have on GitHub? | /vercel/next.js | current tracked star count and data-as-of date | entity/repo/{id}.json current_stars; meta watermarks | medium | Verify date wording when the answer cites a current value. |
| repo-vscode-10k | repo | when did microsoft/vscode first cross 10k GitHub stars? | /microsoft/vscode | 10k milestone date | entity/repo/{id}.json milestones.crossed_10k | medium | Checks frozen milestone fields, not curve inference. |

### Org pages

Expected page family: `/o/[login]`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| org-vercel-stars | org | how many GitHub stars does vercel have across repositories? | /o/vercel | organization aggregate star total and repo count | entity/org/{login}.json current_stars_sum, repo_count | high | Checks org aggregation citation. |
| org-microsoft-rank | org | what are the top GitHub organizations by repository stars? | /rankings | all-time org stock ranking | rank/all-time/org/stock.json items | high | The answer may cite `/rankings` or a high-ranking org page. |
| org-facebook-star-history | org | facebook GitHub organization star history | /o/facebook | organization aggregate curve and current total | entity/org/{login}.json current_stars_sum, curve.monthly | medium | Checks org time-series extraction. |

### Ranking pages

Expected page families: `/rankings`, `/rankings/[year]`, `/rankings/[year]/[period]`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| ranking-june-2026-top | ranking | which GitHub repository gained the most stars in June 2026? | /rankings/2026/6 | top monthly flow row for 2026-06 | rank/month/2026-06/repo/flow.json items[0] | high | Checks period-specific ranking citation. |
| ranking-this-week-top | ranking | which GitHub repository gained the most stars this week? | /rankings | current weekly mover from live ranking or pulse data | rank/week/{current-week}/repo/flow.json items[0]; hot-snapshot.json | high | Review notes must capture whether the answer treats current data as provisional. |
| ranking-fastest-growing-2026 | ranking | fastest growing GitHub repositories in 2026 | /rankings/2026 | year flow or growth ranking | rank/year/2026/repo/{flow|growth}.json items | medium | Accept the most relevant canonical year ranking URL. |
| ranking-flow-vs-stock | ranking | what is the difference between GitHub star flow and stock rankings? | /rankings | explanation of flow versus stock ranking metrics | docs/RANKING.md; rank/{window}/{period}/{dim}/{metric}.json meta.metric | medium | Checks methodology citation, not only list citation. |

### Category pages

Expected page families: `/categories`, `/categories/[dimension]`, `/categories/[dimension]/[slug]`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| category-python-largest | category | largest Python repositories on GitHub by stars | /categories/language/python | all-time stock ranking for the Python category | rank/category/language/python/all-time/repo/stock.json items | high | Checks category detail citation. |
| category-rust-largest | category | largest Rust repositories on GitHub by stars | /categories/language/rust | all-time stock ranking for the Rust category | rank/category/language/rust/all-time/repo/stock.json items | medium | Checks another priority language category. |
| category-javascript-largest | category | top JavaScript repositories on GitHub by stars | /categories/language/javascript | all-time stock ranking for the JavaScript category | rank/category/language/javascript/all-time/repo/stock.json items | medium | Record if an engine cites GitHub search or GitHub topics instead. |
| category-taxonomy | category | how does GitStarClub classify GitHub repositories by category? | /categories | public category dimensions and rules summary | categories/registry.json dimensions; docs/CATEGORIES.md | low | Checks taxonomy/methodology citation. |

### Pulse page

Expected page family: `/pulse`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| pulse-this-week | pulse | top GitHub repositories gaining stars this week | /pulse | current weekly movers and data-as-of date | hot-snapshot.json current_month/current_year flow; rank/week/{current-week}/repo/flow.json | high | Checks freshness and provisional wording. |
| pulse-open-source-now | pulse | what open source repositories are trending by GitHub stars right now? | /pulse | live pulse movers from the latest snapshot | hot-snapshot.json generated_at and current lists | high | Competitors will often include GitHub Trending; record them. |
| pulse-current-month | pulse | top GitHub repositories gaining stars this month | /pulse | current month-to-date movers | hot-snapshot.json current_month.flow | medium | Mark stale if the answer cites a closed month for a current-month query. |

### Compare page

Expected page family: `/compare`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| compare-react-vue-10k | compare | did React or Vue grow faster after 10k stars? | /compare | compare page supports 10k-aligned star-history overlays | /repo-curve?id= projection from entity/repo/{id}.json curve.monthly and milestones.crossed_10k | high | Current page is a generic citeable compare surface, not a server-rendered pair-specific answer. |
| compare-repo-star-history | compare | compare GitHub star history for multiple repositories | /compare | multi-repo star-history comparison tool with absolute and 10k-aligned modes | web/lib/contracts/compare.ts CompareCurve; /repo-curve?id= | high | Checks whether engines cite the canonical compare tool. |
| compare-react-nextjs | compare | compare react and next.js GitHub star growth | /compare | generic comparison workflow and curve source | /repo-curve?id= projection from entity/repo/{id}.json | medium | Do not treat client-only selected pairs as server-rendered evidence. |

### About / methodology page

Expected page family: `/about`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| about-star-history-methodology | about | how does GitStarClub calculate GitHub star history? | /about | GitStarClub combines GH Archive WatchEvent history with public GitHub API current totals using deterministic seam-aware anchoring | web/app/about/page.tsx; docs/DATA-CONTRACTS.md; docs/RANKING.md | high | Checks methodology citation for star-history derivation. |
| about-citable-fields | about | what GitStarClub fields can be cited for GitHub stars? | /about | citable fields include current_stars, current_stars_sum, rank item value, monthly curve totals, recent daily net change, and 10k/50k/100k milestones | web/app/about/page.tsx ABOUT_DATASET_VARIABLES | medium | Checks whether engines cite the methodology surface for field definitions. |
| about-license-attribution | about | what attribution is required for GitStarClub GitHub star history data? | /about | GitStarClub uses CC BY 4.0 attribution copy: Data from GH Archive, derived by GitStarClub | web/app/about/page.tsx; docs/DATA-EXPORTS.md | medium | Checks attribution and license citation. |

### Data-export files

Expected page family: `/data/exports/v1/latest/*`.

| id | page_type | query | expected_url | expected_fact | source_fields | priority | notes |
|---|---|---|---|---|---|---|---|
| data-export-manifest | data-export | GitStarClub data exports manifest | /data/exports/v1/latest/manifest.json | export manifest lists export_date, data_as_of, license, attribution, limits, and latest URLs for top rankings, repo milestones, and org aggregates | web/public/data/exports/v1/{date}/manifest.json; docs/DATA-EXPORTS.md | high | Checks citation of the stable latest manifest alias. |
| data-export-top-rankings | data-export | download GitHub repository ranking data as CSV from GitStarClub | /data/exports/v1/latest/top-rankings.csv | bounded top rankings export includes current-month repository growth rows and all-time repository stock rows with license and attribution columns | web/public/data/exports/v1/{date}/top-rankings.csv; web/public/data/exports/v1/{date}/top-rankings.json | high | Checks dataset-file citation rather than only the human page. |
| data-export-repo-milestones | data-export | download GitHub repository milestone crossing dates dataset | /data/exports/v1/latest/top-repo-milestones.csv | repo milestones export includes top repository current_stars plus crossed_10k, crossed_50k, and crossed_100k fields | web/public/data/exports/v1/{date}/top-repo-milestones.csv; web/public/data/exports/v1/{date}/top-repo-milestones.json | high | Checks exact milestone dataset citation. |
| data-export-org-aggregates | data-export | download GitHub organization aggregate star counts dataset | /data/exports/v1/latest/top-org-aggregates.csv | org aggregates export includes top owner login, owner_type, repo_count, current_stars_sum, rank_value, and canonical org URL | web/public/data/exports/v1/{date}/top-org-aggregates.csv; web/public/data/exports/v1/{date}/top-org-aggregates.json | medium | Checks organization aggregate dataset citation. |
