# GitStarClub GEO strategy and implementation design

## Scope

This document is the owning document for GitStarClub's GEO strategy: how the existing deterministic GitHub star dataset should be shaped so AI answer engines can cite it. It is a strategy and implementation design document, not an implementation patch. Runtime code, `robots.ts`, `jsonld.ts`, page JSX, visual tokens, and data contracts remain unchanged here.

GEO complements [SEO.md](./SEO.md). SEO owns crawlability, canonical URLs, metadata, sitemap, robots policy, and internal links. GEO owns answer-engine citation tactics layered on top of those surfaces: answer capsules, FAQ blocks, dataset schema, AI crawler hygiene, freshness signals, entity authority, and measurement.

Hard constraints still apply: no runtime AI or LLM calls, content bodies stay server-rendered with zero client JavaScript, pages and metadata read only JSON from Vercel Blob, and implementation must remain deterministic and Vercel-first.

---

## 1. TL;DR / Strategic Thesis

GEO, or Generative Engine Optimization, is the work of making a site more likely to be selected, extracted, and cited by AI answer engines such as ChatGPT, Perplexity, Google AI Overviews and AI Mode, Gemini, Claude, and Grok. The next step for GitStarClub is GEO because the site is already indexable, fast, server-rendered, and backed by a proprietary dataset: GitHub star history curves, week/month/year growth ranks, exact 10k/50k/100k crossing dates, newcomers, organization aggregation, and deterministic time series for 5,300+ repositories. The strategy is not to invent AI content. It is to expose the data already present in Blob JSON as self-contained, dated, source-attributed answer blocks that an answer engine can lift without guessing.

The core thesis is:

> Original data is GitStarClub's strongest citation moat. GEO work should turn every repo, org, ranking, category, pulse, and compare surface into a small, dated, attributable statistical answer, while preserving deterministic static rendering.

This document defines that strategy, the evidence behind it, page-by-page tactics, schema additions, indexing hygiene, measurement, and an implementation roadmap. All implementation items in Section 11 are intended to become separate issues after this document is reviewed.

---

## 2. How GEO Works

AI answer engines generally do not select sources the way a classic search results page does. The real-time layer is closer to retrieval-augmented generation:

1. The user asks a broad question.
2. The engine expands it into related sub-queries. Google explicitly calls this "query fan-out": AI Mode can break one question into subtopics and issue multiple searches in parallel. Industry teardown work often describes this as 8+ related retrieval branches; Google's official claim is the safer implementation assumption: multiple subtopic searches.
3. The engine retrieves candidate pages and passages from search indexes, direct crawlers, or partner indexes.
4. Candidate passages are re-ranked for extractability, authority, freshness, corroboration, structure, and fit to the requested answer.
5. The model synthesizes an answer and attaches a subset of sources.

That means GEO has two different time horizons:

| Layer | What changes | Expected speed | GitStarClub implication |
|---|---|---:|---|
| Real-time retrieval | Search indexes, crawler fetches, fresh pages, structured snippets | Days to weeks | Highest leverage. GitStarClub can publish answer capsules, FAQ, schema, and fresh `dateModified` without changing the data pipeline. |
| Training / model memory | Future model training or distillation reads the web | Months to years | Useful for entity familiarity, but not the first target. Do not design around model training as the primary feedback loop. |

Platform differences matter:

| Platform | Source selection tendency | Practical tactic |
|---|---|---|
| ChatGPT Search | Uses web search with linked citations. Multiple SEO studies report a strong Bing dependency for discovery; treat Bing indexing and IndexNow as high leverage. | Submit sitemap to Bing, add IndexNow on data publish, keep concise source-attributed answer blocks near the top of pages. |
| Perplexity | Strong freshness and fact-density bias; often cites short, extractable passages and tables. | Put "Data as of" visibly near every key fact, keep capsules 40-60 words, add compact tables and FAQ. |
| Google AI Overviews / AI Mode | Google index, structured data, entity clarity, and E-E-A-T matter most; new sites usually need classic SEO footing first. | Preserve SEO basics, add Dataset / FAQPage / `dateModified`, and keep entity names, canonical URLs, and sameAs consistent. |
| Gemini | Benefits from Google index and entity graph. Yext's large citation study reports that brand-managed sources dominate many AI citations, which helps sites that publish authoritative first-party facts. | Treat GitStarClub as the canonical publisher of its derived star-history dataset; add organization identity and Dataset schema. |
| Claude / Grok | Public details are less stable, but crawler logs and search-index visibility still matter. | Allow relevant crawlers, keep pages plain HTML, and measure referrals plus bot traffic rather than assuming citations. |

The page design implication is simple: every important fact should be available as normal server-rendered HTML, not hidden in client-only UI, canvas, images, or a large interactive state. GitStarClub already satisfies much of this through RSC pages, server SVG charts, and Blob-backed static JSON. GEO work should add extractable prose and schema around the same facts.

---

## 3. Citation Levers and Evidence

The table below separates stronger research evidence from industry benchmarks. The exact uplift varies by query class and engine, so these are directional design inputs, not guaranteed traffic forecasts.

| Lever | Evidence / scale | Source | GitStarClub action |
|---|---:|---|---|
| Cite sources, statistics, and quotations | Princeton / KDD 2024 GEO experiments found the best-performing methods improved visibility by roughly 30-40% on position-adjusted word count and 15-30% on subjective impression. | [GEO paper, KDD 2024](https://collaborate.princeton.edu/en/publications/geo-generative-engine-optimization/), [arXiv PDF](https://arxiv.org/pdf/2311.09735) | Each page needs dated facts, named source attribution, and compact statistical sentences. |
| Original data | Industry GEO research consistently identifies unique, verifiable first-party data as a top citation driver because models cannot replace it with commodity summaries; issue-source industry benchmarks report pages with 19+ data points being cited roughly 2-3x more often. | [ZipTie original research analysis](https://ziptie.dev/blog/how-original-research-wins-ai-citations/), [WeAreCited citation factors](https://wearecited.com/what-makes-ai-cite) | Lead with GitStarClub-only data: historical star curves, milestone dates, growth ranks, org aggregation, newcomers, and seam-aware stock series. |
| Data tables | Presence AI's citation-rate study reports data tables at 67% citation rate, the highest content format in their study. | [Presence AI citation-rate study](https://presenceai.app/blog/ai-search-citation-rates-research-which-content-gets-cited) | Preserve visible tables for rankings, recent activity, categories, and org members; add concise prose summaries above them. |
| Comparison matrices / reviews | The same study reports comparison matrices at 61%. | [Presence AI citation-rate study](https://presenceai.app/blog/ai-search-citation-rates-research-which-content-gets-cited) | Make `/compare` produce extractable comparison conclusions for common shared URLs or future server-rendered compare snapshots. |
| FAQ-heavy content with schema | Presence AI reports FAQ-heavy content with schema at 58%; issue-source industry benchmarks report question-style headings and FAQ improving AIO inclusion by roughly 89%. | [Presence AI](https://presenceai.app/blog/ai-search-citation-rates-research-which-content-gets-cited), [Google FAQPage](https://developers.google.com/search/docs/appearance/structured-data/faqpage), [WeAreCited citation factors](https://wearecited.com/what-makes-ai-cite) | Add 3-5 real FAQ items per major page type and mirror them in FAQPage JSON-LD. |
| Answer-first capsules | Industry GEO benchmarks report up to roughly +140% extractability for direct answer-first blocks; CXL's AI Overview analysis found citation links skew toward content placed near the top of pages. | [Averi GEO guide](https://www.averi.ai/learn/the-definitive-guide-to-geo-get-cited-by-ai-in-2026), [CXL AIO source-position study](https://cxl.com/blog/google-ai-overview-citation-sources/) | Put 40-60 word answer capsules before long charts or ranking tables. |
| Freshness | Ahrefs analyzed 16.975M cited URLs and found AI assistants cited pages averaging 1,064 days old versus 1,432 days for organic results, about 25.7% fresher; issue-source industry benchmarks report visible date/year signals in the +30-47% range. | [Ahrefs freshness study](https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content/), [Averi GEO guide](https://www.averi.ai/learn/the-definitive-guide-to-geo-get-cited-by-ai-in-2026) | Show real data dates and use real `dateModified`; do not fake freshness by changing dates without data changes. |
| Entity consistency / brand mentions | Signals reports Ahrefs-derived correlations where unlinked brand mentions correlate around 0.664 with AI Overview visibility; industry GEO reports frequently call earned media a several-hundred-percent lever, including +325% claims, but this is less controlled than peer-reviewed work. | [Signals / Ahrefs summary](https://signals.sh/blog/backlinks-vs-brand-mentions-for-ai-visibility), [Averi GEO guide](https://www.averi.ai/learn/the-definitive-guide-to-geo-get-cited-by-ai-in-2026) | Build a consistent GitStarClub entity footprint and make data easy to cite externally. |
| AI crawler reach | Cloudflare reports GPTBot's crawler share rose from 2.2% to 7.7% from May 2024 to May 2025, with ChatGPT-User requests up sharply. | [Cloudflare AI crawler study](https://blog.cloudflare.com/from-googlebot-to-gptbot-whos-crawling-your-site-in-2025/) | Keep retrieval crawlers allowed and monitor user agents. Explicit robot rules should document intent. |
| Core Web Vitals / FCP | Google defines good thresholds as LCP under 2.5s, INP under 200ms, and CLS under 0.1; industry GEO guidance commonly treats FCP under 1s as a crawl/extraction hygiene target. | [Google Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals), [Averi GEO guide](https://www.averi.ai/learn/the-definitive-guide-to-geo-get-cited-by-ai-in-2026) | Preserve the static HTML / near-zero-client-JS posture. GitStarClub's #25 baseline passed Lighthouse CWV lab checks on representative pages. |
| Structured data | Google states structured data helps it understand page content and can make pages eligible for richer features; schema.org defines Dataset, FAQPage, Organization, and dateModified. | [Google structured data intro](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data), [schema.org Dataset](https://schema.org/Dataset) | Add schema as a parsing and entity hygiene layer, not as a substitute for visible HTML. |

Avoid over-reading any one number. The pattern across sources is more important: AI citations favor extractable, fresh, factual, attributable, structured pages. GitStarClub's data already has those properties; the missing layer is page-level packaging.

---

## 4. Why GitStarClub Is Naturally GEO-Fit

GitStarClub has several advantages that most content sites must build from scratch:

| Asset | Current state | GEO value |
|---|---|---|
| Proprietary dataset | Deterministic GitHub star histories for 5,300+ tracked repositories, with repo/org/ranking/category views in Vercel Blob. | The numbers are not generic web copy. Answer engines need a source for "when did repo X cross 100k stars?" or "which Python repos are largest?". |
| Server-rendered content | `FRONTEND.md` defines content bodies as RSC/static HTML; charts are server SVG/DOM; client JS is limited to explicit islands. | Crawlers and answer extractors see the actual facts without hydrating the app. |
| Fast pages | #25 Lighthouse baseline recorded mobile FCP around 0.91-1.22s and desktop FCP around 0.25-0.29s on representative production pages; CLS was 0.000-0.003. | Performance is already unlikely to be the blocking factor for extraction or crawl. |
| HTTPS production host | The public site is served from `https://gitstarclub.com`, with canonical URLs generated from `NEXT_PUBLIC_SITE_URL`. | AI search engines and classic crawlers get one secure apex identity, not fragmented preview or subdomain URLs. |
| Canonical URL model | Language-neutral canonical URLs; repo URLs match GitHub slugs; old repo aliases redirect to current slugs. | Entity matching is simple: `/react/react`, `/o/vercel`, `/rankings/2026/6`. |
| Sitemap coverage | Public sitemap sampled on 2026-06-24 contained 10,877 `<loc>` entries with real `lastModified`, `changeFrequency`, and `priority`. | Long-tail ISR pages are discoverable even before natural links exist. |
| Existing schema | `web/lib/jsonld.ts` emits WebSite, SoftwareSourceCode, Organization/Person, CollectionPage, and ItemList; breadcrumbs emit BreadcrumbList. | The schema foundation exists; GEO needs Dataset, FAQPage, stronger sameAs, and real dateModified. |
| Deterministic narrative | Month pages already generate narrative from rank data without AI. | Answer capsules can use the same deterministic pattern: template + JSON fields, no LLM. |
| Robots baseline | When indexable, current robots policy allows `/` and disallows `/api/`, which also permits AI crawlers unless separately blocked. | The gap is explicit intent and training-vs-retrieval policy, not a crawl blockade. |

The gaps are equally clear:

| Gap | Why it matters |
|---|---|
| FAQ still pending | Many user questions are latent in the data, but pages do not yet expose question-led answers. |
| Dataset schema still pending | GitStarClub is fundamentally a dataset, but schema currently describes pages and entities, not the dataset itself. |
| Schema freshness still pending | Visible capsules now carry data-as-of dates; schema still needs matching `dateModified` fields in a later implementation. |
| No explicit AI crawler policy | Wildcard allow is permissive, but not communicative. Explicit rules reduce ambiguity and make policy reviewable. |
| No Bing / IndexNow workflow | If ChatGPT discovery depends on Bing-like indexes, relying only on passive crawling is slower than necessary. |

---

## 5. Page-Type Tactics

Implementation rule for every page type:

- The concrete numbers in the example capsules below are format examples, not durable assertions of the current production value; implementation must generate them deterministically from the current Blob JSON fields.
- The capsule must be normal server-rendered HTML, near the top of the content.
- The capsule should be 40-60 English words by default because canonical pages are English-first. UI translations can mirror it, but data fields stay language-neutral.
- It must include a real date, at least one distinctive GitStarClub-only statistic, and attribution: `— GitStarClub`.
- FAQ must answer natural user questions, not internal implementation questions.
- Statistical sentences must be generated from existing JSON fields only.

### 5.1 Repo pages: `/:owner/:name`

Relevant fields:

- `entity/repo/{id}.json`: `full_name`, `description`, `current_stars`, `created_at`, `language`, `languages`, `topics`, `milestones.crossed_10k/50k/100k`, `curve.monthly`, `curve.recent_daily`, `monthly_table`, `rank_history`, `inflections`.
- `lookup/repos.json`: deterministic lookup for related repo links.
- `rank/*`: linked from milestone chips and recent monthly rows.

Answer capsule example:

> As of 2026-06-24, react/react has 246.0k GitHub stars. GitStarClub records its exact 10k, 50k, and 100k crossing months as May 2015, January 2017, and June 2018, plus its monthly star curve, recent monthly gains, rank history, languages, and related React ecosystem repositories. — GitStarClub

FAQ candidates:

- When did react/react cross 10k, 50k, and 100k GitHub stars?
- How many stars does react/react have today?
- How fast did react/react grow in the latest month?
- Which repositories are most similar to react/react by owner or language?
- Where does react/react appear in GitStarClub monthly or all-time rankings?

Statistical sentence patterns:

- `{repo.full_name} has {current_stars} GitHub stars as of {data_date}.`
- `{repo.full_name} crossed 10k stars in {crossed_10k}, 50k in {crossed_50k}, and 100k in {crossed_100k}.`
- `In {month}, {repo.full_name} added {monthly_table.adds} stars and ranked #{monthly_table.rank} among tracked repositories.`
- `{repo.full_name}'s primary language is {language}; GitStarClub also links it to {category_count} deterministic category pages.`
- `Because milestone chips use frozen repo.milestones fields, 10k/50k/100k dates match newcomer ranking logic.`

Implementation notes:

- Exact 10k/50k/100k milestones must come from `repo.milestones`, not curve reverse-inference.
- Higher thresholds without frozen fields should be omitted or explicitly marked estimated.
- Capsule links should include `/o/{owner}` and public category pages but must not create newcomer links from estimated milestones.

### 5.2 Organization pages: `/o/:login`

Relevant fields:

- `entity/org/{login}.json`: `login`, `owner_type`, `current_stars_sum`, `repo_count`, `members`, `curve.monthly`, `rank_history`.
- `lookup/repos.json`: member repository names, languages, current stars.

Answer capsule example:

> As of 2026-06-24, the vercel GitHub organization has 371.5k stars across 11 tracked repositories. Its largest tracked projects are vercel/next.js at 140.1k, vercel/hyper at 44.6k, and vercel/swr at 32.4k, with the org curve aggregating member repository history. — GitStarClub

FAQ candidates:

- How many total GitHub stars does vercel have across tracked repositories?
- Which Vercel repository has the most stars?
- How many Vercel repositories are tracked by GitStarClub?
- How is an organization star curve calculated?
- Is a GitHub user owner handled differently from a GitHub organization?

Statistical sentence patterns:

- `{org.login} has {current_stars_sum} total stars across {repo_count} tracked repositories as of {data_date}.`
- `{top_member.full_name} is {org.login}'s largest tracked repository with {top_member.current_stars} stars.`
- `{org.login}'s organization curve sums member repository monthly totals after lookup-joining member ids.`
- `Owner type is {owner_type}; schema should emit Organization for GitHub organizations and Person for user owners.`

Implementation notes:

- Org pages currently have `orgLd` with GitHub `sameAs`; GEO should allow sameAs arrays when GitStarClub itself or high-profile owners have additional trusted profiles.
- FAQ should explain aggregation without implying GitHub has a native "organization star count" field.

### 5.3 Ranking pages: `/rankings`, `/rankings/:year`, `/rankings/:year/:period`

Relevant fields:

- `rank/{week|month|year|all-time}/{period}/{repo|org}/{flow|stock}.json`
- `heatmap/{year|month}/{period}.json`
- `lookup/repos.json`, `lookup/orgs.json`
- deterministic narrative for month pages.

Answer capsule example:

> In June 2026, tracked repositories added 1.9M GitHub stars. pewdiepie-archdaemon/odysseus led the month with +46,399 stars, ahead of mattpocock/skills at +28.1k and chopratejas/headroom at +26.8k. This ranking is generated from deterministic month-level GitHub star deltas. — GitStarClub

FAQ candidates:

- Which GitHub repository gained the most stars in June 2026?
- How does GitStarClub calculate monthly star growth?
- What is the difference between flow and stock rankings?
- Why can weekly and monthly rankings differ?
- Are current-period rankings final or live overlays?

Statistical sentence patterns:

- `In {period_label}, tracked repositories added {period_total_flow} GitHub stars.`
- `{rank.items[0].full_name} ranked #1 for {period_label} with +{rank.items[0].value} stars.`
- `The top three repositories were {r1}, {r2}, and {r3}.`
- `{scope} stock rankings use seam-aware anchored totals; flow rankings sum deltas in the selected period.`
- `Current week and current month pages may read live overlay JSON before falling back to base views.`

Implementation notes:

- Ranking detail pages already expose "Complete ranking" links; GEO should add a capsule and FAQ above or near the visible top slice.
- Date language must distinguish frozen historical periods from current live overlays.
- "Newcomers" should use frozen `crossed_10k`, matching `RANKING.md`.

### 5.4 Category pages: `/categories`, `/categories/:dimension`, `/categories/:dimension/:slug`

Relevant fields:

- `categories/registry.json`: public category dimensions and labels.
- `categories/assignments.json`: deterministic repository assignments.
- `rank/category/{dimension}/{slug}/all-time/repo/stock.json`
- `lookup/repos.json`

Answer capsule example:

> As of 2026-06-24, GitStarClub tracks 1,175 repositories in the Python category. The largest are public-apis/public-apis at 442.9k stars, EbookFoundation/free-programming-books at 390.6k, and donnemartin/system-design-primer at 354.0k. Category pages rank repositories from deterministic category assignments and all-time stock views. — GitStarClub

FAQ candidates:

- What are the largest Python repositories on GitHub?
- How does GitStarClub decide whether a repository belongs in the Python category?
- Why can a repository appear in a category even if its primary language is different?
- How many repositories are tracked in this category?
- Where can I browse all repositories in a large category?

Statistical sentence patterns:

- `GitStarClub tracks {category_count} repositories in {category_label} as of {data_date}.`
- `{category_label}'s top repository is {top_repo.full_name} with {top_repo.current_stars} stars.`
- `Category assignment is deterministic from registry rules and repository metadata, not an editorial manual list.`
- `For categories with more than 100 repositories, page 1 links to paginated complete lists.`

Implementation notes:

- Do not duplicate taxonomy rules in page code; the owning source is `CATEGORIES.md` plus `categories/registry.json`.
- FAQ wording should be category-specific enough for answer engines, but generated deterministically from category labels and counts.

### 5.5 Pulse and home: `/pulse` and `/`

Relevant fields:

- `hot-snapshot.json`
- `live/rank/week/{current}/repo/flow.json`
- current month/year/all-time slices
- `current_month.json` / heatmap overlays where applicable.

Answer capsule example:

> For week 2026-W26, DietrichGebert/ponytail led GitHub's tracked weekly movers with +12.5k stars and 40.3k total stars. chopratejas/headroom followed with +6.5k, and mattpocock/skills added +5.1k. The pulse page is refreshed from the daily live overlay. — GitStarClub

FAQ candidates:

- What repository gained the most stars on GitHub this week?
- What is trending this month among tracked open-source repositories?
- How often is GitStarClub Pulse refreshed?
- Why can pulse results change before a month closes?
- What is the difference between Pulse and historical ranking pages?

Statistical sentence patterns:

- `For {current_week}, {weekly_top.full_name} leads tracked weekly movers with +{weekly_top.value} stars.`
- `For {current_month}, {monthly_top.full_name} leads month-to-date growth with +{monthly_top.value} stars.`
- `The pulse surface reads the live overlay and hot snapshot, while frozen period pages read base rank views.`
- `Pulse is a current-period surface; historical months and years should be cited from their period pages.`

Implementation notes:

- The capsule must not imply current week/month data is final.
- Use "week-to-date" or "month-to-date" for live periods.
- Home and `/pulse` can share the same deterministic capsule generator but should avoid duplicate long FAQ if both pages are indexed.

### 5.6 Compare page: `/compare`

Relevant fields:

- Current surface: static shell plus client `CompareClient`.
- Data route: `/repo-curve?id=` projects `entity/repo/{id}.json` into compact curve data for comparison.
- `compare` contract and core logic handle absolute and 10k-aligned views.

Answer capsule example:

> As of 2026-06-24, GitStarClub's compare surface can explain whether react/react or vuejs/vue grew faster after 10k stars by aligning each repository's monthly `total_end` series to its `crossed_10k` date, while preserving absolute current-star totals for context. — GitStarClub

FAQ candidates:

- How can I compare two GitHub repositories by star history?
- What does "align to 10k stars" mean?
- Which grew faster after 10k stars: react/react or vuejs/vue?
- Can a compare URL be cited by an AI answer engine?
- Why does compare use a client island while content pages stay server-rendered?

Statistical sentence patterns:

- `{repo_a.full_name} reached 10k stars in {repo_a.crossed_10k}; {repo_b.full_name} reached 10k stars in {repo_b.crossed_10k}.`
- `After {n} months from 10k, {winner.full_name} had {winner_total} stars versus {loser_total} for {loser.full_name}.`
- `Absolute comparison uses each repo's monthly total_end values; aligned comparison remaps x=0 to crossed_10k.`

Implementation notes:

- The current `/compare` canonical page is a static tool shell, so the first GEO implementation should add a generic comparison capsule and FAQ without pretending URL query state is server-rendered.
- If citeable pair-specific compare pages are desired later, add deterministic server-rendered snapshot routes in a separate design issue; do not make content extraction depend on client-only state.

---

## 6. Structured Data Specification

Schema is a hygiene and parsing layer, not magic. LLMs may read JSON-LD as text, but the strongest value is helping Google and other systems disambiguate page type, entity identity, dataset ownership, dates, and FAQ. Visible HTML must remain the primary source of truth.

Current `web/lib/jsonld.ts` builders:

- `webSiteLd(...)` -> `WebSite`
- `repoLd(...)` -> `SoftwareSourceCode`
- `orgLd(...)` -> `Organization` or `Person`
- `collectionLd(...)` -> `CollectionPage`
- `itemListLd(...)` -> `ItemList`
- Breadcrumb schema lives in the `Breadcrumbs` component as `BreadcrumbList`

GEO should add the following shapes in later implementation PRs.

### 6.1 Dataset: site-level and optional ranking-level

Use on the home page and optionally on major ranking/category pages. GitStarClub is fundamentally a derived, transformed dataset of GitHub star history; Dataset is the missing schema type.

The `variableMeasured.name` values below are descriptive schema labels, not a byte-for-byte JSON contract. Where a label maps to a production field, it uses or names the real field path (`current_stars`, `current_stars_sum`, rank item `value`, `curve.monthly` `total_end`, `milestones.crossed_*`).

```json
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "GitStarClub GitHub Star History Dataset",
  "description": "Deterministic GitHub star history, milestone dates, growth rankings, organization aggregates, and category views for 5,300+ repositories with at least 10,000 stars.",
  "url": "https://gitstarclub.com",
  "creator": {
    "@type": "Organization",
    "name": "GitStarClub",
    "url": "https://gitstarclub.com"
  },
  "isAccessibleForFree": true,
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "temporalCoverage": "2015/2026",
  "dateModified": "2026-06-24T00:00:00Z",
  "variableMeasured": [
    { "@type": "PropertyValue", "name": "current_stars" },
    { "@type": "PropertyValue", "name": "current_stars_sum" },
    { "@type": "PropertyValue", "name": "rank item value (flow stars added)" },
    { "@type": "PropertyValue", "name": "curve.monthly total_end" },
    { "@type": "PropertyValue", "name": "milestones.crossed_10k" },
    { "@type": "PropertyValue", "name": "milestones.crossed_50k" },
    { "@type": "PropertyValue", "name": "milestones.crossed_100k" }
  ],
  "measurementTechnique": "GitHub public API current totals plus GH Archive WatchEvent history, reconciled through deterministic seam-aware anchoring."
}
```

Implementation linkage:

- Add a `datasetLd(meta, path, locale)` builder in `web/lib/jsonld.ts`.
- `dateModified` should use `meta.generated_at`, `meta.folded_through`, or the page's actual latest data watermark, never a hard-coded date.
- `temporalCoverage` should derive from the first available year and current data year.
- The visible page should include a matching "Data as of" line.

### 6.2 FAQPage: generated from visible FAQ

Use only when the FAQ is visible on the page. Do not emit hidden FAQ schema.

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "When did react/react cross 100k GitHub stars?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "GitStarClub records react/react crossing 100k GitHub stars in June 2018, using the frozen repo.milestones.crossed_100k field."
      }
    },
    {
      "@type": "Question",
      "name": "How many stars does react/react have today?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "As of 2026-06-24, react/react has 246.0k GitHub stars in GitStarClub's current_stars field."
      }
    }
  ]
}
```

Implementation linkage:

- Add `faqPageLd(items, path, locale)` in `web/lib/jsonld.ts`.
- Build FAQ answers from the same deterministic capsule helpers used for visible HTML.
- Do not add FAQPage to the compare query-state view until compare facts are server-rendered.

### 6.3 Organization sameAs

Existing `orgLd` sets `sameAs` to the GitHub owner URL. GEO should support arrays where trustworthy profiles exist.

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "GitStarClub",
  "url": "https://gitstarclub.com",
  "sameAs": [
    "https://github.com/jasonhnd/gitstarclub.com"
  ]
}
```

For GitHub owner pages:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "vercel",
  "url": "https://gitstarclub.com/o/vercel",
  "sameAs": [
    "https://github.com/vercel",
    "https://vercel.com"
  ]
}
```

Implementation linkage:

- Keep GitHub sameAs mandatory when rendering owner pages.
- Add optional sameAs enrichment only from deterministic metadata fields or approved static registry; do not scrape arbitrary profile links at request time.
- If Wikidata or other profiles are added, record source and ownership in the docs before shipping.

### 6.4 CollectionPage / Article dateModified

Current `collectionLd` lacks `dateModified`. GEO should add optional date fields to collection and entity schema.

```json
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "June 2026 GitHub Star Rankings",
  "url": "https://gitstarclub.com/rankings/2026/6",
  "inLanguage": "en",
  "dateModified": "2026-06-24T00:00:00Z",
  "about": {
    "@type": "Dataset",
    "name": "GitStarClub GitHub Star History Dataset"
  }
}
```

Implementation linkage:

- Extend `collectionLd(name, path, locale, options)` rather than adding ad hoc JSON-LD in pages.
- Repo pages should add `dateModified` to `SoftwareSourceCode` only if it describes GitStarClub's page data update, not the upstream repository's code update.
- Keep `BreadcrumbList` as-is in `Breadcrumbs`; do not duplicate breadcrumbs.

---

## 7. Freshness Strategy

Freshness is already present in the data pipeline. The missing piece is visible and machine-readable surfacing.

Current facts:

- Core current surfaces use daily cron and hot snapshots.
- Current week/month live overlays can refresh without a deploy.
- Historical periods are frozen once folded into base views.
- `sitemap.ts` already emits real `lastModified`, `changeFrequency`, and `priority`; the public sitemap sampled on 2026-06-24 showed current pages with 2026-06-21 timestamps and historical month pages with period-end timestamps.

GEO implementation should add:

| Surface | Visible freshness copy | Schema freshness |
|---|---|---|
| Repo | `Data as of {meta.generated_at or daily watermark}` near the capsule. | `dateModified` on page schema and Dataset relationship. |
| Org | Same as repo, using org entity / base watermark. | `dateModified` on Organization/Person page schema. |
| Current rankings | `Month-to-date as of {date}` or `Week-to-date as of {date}`. | `dateModified` from live overlay or meta. |
| Historical rankings | `Final period data through {period_end}`. | `dateModified` can be the publish date; the text should clarify the ranking period is frozen. |
| Categories | `Category assignments and star totals as of {date}`. | `CollectionPage.dateModified`. |
| Pulse | `Updated daily; live period as of {date}`. | WebSite / CollectionPage / Dataset dateModified. |

Rules:

- Never hard-code a freshness date.
- Never update `dateModified` merely to look fresh; it must correspond to a real data publish, live overlay, or page content change.
- Use year and period terms in H1 or capsule where they matter: `June 2026 GitHub Star Rankings`, `2026-W26 weekly movers`.
- For current-period surfaces, use `month-to-date` or `week-to-date`; for historical periods, use `final` or `frozen`.

This matches Ahrefs' finding that AI assistants cite fresher URLs than classic organic results on average, while avoiding the common false-freshness trap.

---

## 8. Crawlers and Indexing Pipeline

### 8.1 robots.txt policy

Current implementation:

- If `SITE_INDEXABLE !== "1"`, robots disallows all crawlers.
- If indexable, robots allows `/`, disallows `/api/`, and publishes the sitemap URL.
- This wildcard allow already permits AI crawlers unless they are otherwise blocked.

GEO implementation should make the policy explicit:

```txt
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Bingbot
Allow: /

User-agent: CCBot
Allow: /

User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://gitstarclub.com/sitemap.xml
```

Policy notes:

- Retrieval/user-action crawlers (`OAI-SearchBot`, `ChatGPT-User`, `Perplexity-User`, `Claude-SearchBot`) directly support cited answers and should be allowed.
- Search crawlers (`Bingbot`, Google crawlers) remain essential because answer engines often retrieve from classic indexes.
- Training crawlers (`GPTBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`, and similar) are a product/legal policy choice. The recommended default for GitStarClub is to allow them while the project is in growth mode because the published HTML is derived from public GitHub/GH Archive data and the citation benefit outweighs the moat loss. If bandwidth abuse or rights constraints appear, change this through a documented issue.
- `robots.txt` is a crawler-traffic convention, not a security boundary; `/api/` disallow does not protect private data and must not be treated as access control.

### 8.2 Bing Webmaster Tools and IndexNow

ChatGPT Search and several AI search surfaces depend heavily on Bing-like discovery paths, so Bing should not be left passive.

Current implementation:

- IndexNow key file: `web/public/3a620d7fc7e043aa854c68841375d81b.txt`, served at `https://gitstarclub.com/3a620d7fc7e043aa854c68841375d81b.txt`.
- IndexNow code: `web/lib/indexnow.ts`.
- Workflow publish hook: `web/lib/workflows/steps/publish.ts` calls IndexNow after `views/latest.json` and `ops/workflows/latest-success.json` are written.
- Daily/weekly live-overlay hook: `web/lib/cron/live-refresh.ts` calls IndexNow after live overlay JSON writes and hot-path revalidation.
- Canonical URL formatting shares the sitemap helpers in `web/lib/sitemap.ts`; the hook does not submit `sitemap.xml` or every sitemap URL by default.

Bing Webmaster verification steps:

1. Add `https://gitstarclub.com` in Bing Webmaster Tools.
2. Preferred repo-free option: import verification from the already verified Google Search Console property, or use DNS verification in Cloudflare.
3. Repo-hosted file option: download Bing's verification XML file and commit it under `web/public/` so it is served from the site root. The expected path is usually `web/public/BingSiteAuth.xml`, which becomes `https://gitstarclub.com/BingSiteAuth.xml`.
4. Meta-tag option: set `BING_SITE_VERIFICATION=<Bing msvalidate.01 token>` in the Vercel Production environment. `web/app/layout.tsx` emits `<meta name="msvalidate.01" content="...">` when that variable is present.
5. After verification, submit `https://gitstarclub.com/sitemap.xml` in Bing Webmaster Tools.

IndexNow runtime configuration:

- `NEXT_PUBLIC_SITE_URL` must be `https://gitstarclub.com` in production so submitted URLs match the canonical sitemap host.
- `INDEXNOW_ENABLED=1` forces submission, useful for a controlled production smoke test.
- `INDEXNOW_ENABLED=0` disables submission without removing the hooks.
- With neither override set, submission is enabled only when `VERCEL_ENV=production` and the canonical host is `gitstarclub.com` or `www.gitstarclub.com`.

Batching and failure policy:

- Per request cap: 100 URLs.
- Per run cap: 200 URLs.
- URL ordering is deterministic for the same input set: hot core pages first, then ranking periods, then entity/category paths sorted by canonical URL.
- Workflow publish compares selected versioned Blob views from `views/<run_id>/` and `views/<prev_version>/` to submit only changed core, period, category, repo, and org URLs.
- Daily/weekly cron submits `/`, `/pulse`, `/rankings`, current year/month/week ranking URLs, and the repo/org URLs for live movers.
- IndexNow POST errors and URL-derivation errors log `[indexnow]` warnings with source, run id/job, batch, status or error, and URL count. They never throw back into workflow publish or cron, so external indexing cannot block data publication.

No runtime database, runtime AI, LLM, or external paid indexing service is required. The hook runs from deterministic URL lists already known to the workflow or live-overlay refresh.

### 8.3 llms.txt

`llms.txt` should be treated honestly: cheap hygiene, not a proven citation lever. The shipped `/llms.txt` is a discovery aid only; there is no proven citation or ranking benefit.

Evidence:

- The proposed spec defines `/llms.txt` as a Markdown file with an H1, optional blockquote summary, and sectioned links.
- SE Ranking's 300k-domain study found no measurable evidence that LLMs rely on `llms.txt` in a way that affects citations or traffic.
- Ahrefs' 137k-domain study, as summarized by Search Engine Journal, reported that most valid `llms.txt` files received no requests in the sampled period.
- Google representatives have publicly described `llms.txt` as speculative and comparable to old meta-keyword behavior for now.

Current implementation:

```md
# GitStarClub

> Deterministic GitHub star history, rankings, milestones, category views, and organization aggregates for tracked open-source repositories.

## Core data surfaces

- [GitStarClub home](https://gitstarclub.com/)
- [Open-source pulse](https://gitstarclub.com/pulse)
- [All-time rankings](https://gitstarclub.com/rankings)
- [June 2026 rankings](https://gitstarclub.com/rankings/2026/6)
- [Python category rankings](https://gitstarclub.com/categories/language/python)
- [Repository comparison](https://gitstarclub.com/compare)
- [Vercel organization star history](https://gitstarclub.com/o/vercel)
- [react/react star history](https://gitstarclub.com/react/react)

## Methodology and docs

- [About GitStarClub data sources](https://gitstarclub.com/about)
- [Ranking methodology](https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/RANKING.md)
- [Data contracts](https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-CONTRACTS.md)
- [GEO and crawler hygiene](https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/GEO.md)
```

The file is checked in at `web/public/llms.txt`, served from the site root by Next static assets, and covered by `web/lib/llms.test.ts`. It intentionally remains a curated list, not a sitemap replacement.

Recommendation on `llms-full.txt`:

- Do not ship a full 10,877-URL dump first. It duplicates sitemap, risks becoming stale, and has no proven citation benefit.
- If added later, generate it deterministically from the same sitemap builder and keep it small by grouping canonical examples plus methodology pages.

---

## 9. Entity Authority and Earned Media

Engineering can prepare the assets, but earned media is mostly an operations loop. Studies that track AI citations repeatedly find that external mentions, brand/entity consistency, and third-party corroboration matter. Signals' summary of Ahrefs research reports brand-mention correlations around 0.664 with AI Overview visibility, while many GEO industry reports treat Reddit, Hacker News, Wikipedia, and comparison articles as stronger corroboration than isolated self-published copy.

Engineering enablement:

| Item | Scope | Why it helps |
|---|---|---|
| Public dataset landing page | A server-rendered methodology and dataset page explaining fields, license, cadence, and examples. | Gives journalists, Wikipedia editors, and AI engines one canonical citation target. |
| Downloadable snapshots | Small CSV/JSON extracts for top rankings, milestones, and org aggregates, generated from Blob views. | Makes GitStarClub's original data easier to reuse and cite. |
| Organization sameAs | GitHub repository, project homepage, social profiles, and later Wikidata if approved. | Helps entity disambiguation across Google and answer engines. |
| Embeddable snippets | Static "this week in GitHub stars" or "repo milestone" cards with canonical links. | Makes external mention and community sharing easier without adding runtime services. |
| Citation guide | Short copy explaining attribution: "Data from GH Archive, derived and transformed by GitStarClub." | Reduces inconsistent external naming. |

Operations / editorial seed work:

- Weekly "largest GitHub star movers" posts to communities where this data is useful.
- Data stories around milestones: fastest to 10k, fastest after 10k, biggest org growth.
- Outreach to maintainers when a repo crosses 50k/100k, linking the relevant GitStarClub page.
- Wikipedia/Wikidata should only be touched where notable and policy-compliant; do not spam entity pages.

The engineering goal is to make external citation easy. It should not fabricate authority signals or create low-quality syndication.

---

## 10. Measurement

Do not introduce paid GEO monitoring by default. Use Vercel-first measurement and a small manual query set.

### 10.1 Bot and referrer logs

Track user-agent families in Vercel logs or a Vercel-native log export:

- `GPTBot`
- `OAI-SearchBot`
- `ChatGPT-User`
- `PerplexityBot`
- `Perplexity-User`
- `ClaudeBot`
- `Claude-SearchBot`
- `anthropic-ai`
- `Google-Extended`
- `Applebot`
- `Applebot-Extended`
- `Bingbot`
- `CCBot`

Track likely AI referrers:

- `chatgpt.com`
- `chat.openai.com`
- `perplexity.ai`
- `gemini.google.com`
- `google.com` with AI Overview / AI Mode query patterns where visible
- `copilot.microsoft.com`
- `claude.ai`
- `grok.com` / `x.com` where distinguishable

Keep the first implementation aggregate-only. Do not add user-level tracking or client analytics without a separate privacy review.

### 10.2 Manual target query set

Create `docs/geo/queries.md` in a later issue. It should list real prompts GitStarClub should win, grouped by page type:

- Repo: "when did react/react reach 100k GitHub stars?"
- Repo: "react GitHub star history"
- Org: "how many GitHub stars does vercel have across repositories?"
- Ranking: "which GitHub repository gained the most stars in June 2026?"
- Category: "largest Python repositories on GitHub by stars"
- Pulse: "top GitHub repositories gaining stars this week"
- Compare: "did React or Vue grow faster after 10k stars?"

Weekly manual checks:

| Field | Example |
|---|---|
| Date | `2026-06-24` |
| Engine | `ChatGPT Search` |
| Query | `which GitHub repository gained the most stars in June 2026?` |
| Cited GitStarClub? | `yes/no` |
| Cited URL | `/rankings/2026/6` |
| Competitors cited | `GitHub Trending`, blog posts, none |
| Answer accuracy | `correct / partially correct / wrong` |
| Notes | `needed "month-to-date" wording` |

Primary metric:

- Citation occupancy: percentage of target queries where GitStarClub is cited.

Secondary metrics:

- AI crawler hits by user-agent.
- AI referrer sessions.
- Indexed URL count in Google and Bing.
- Answer accuracy when cited.
- Stale citation rate: answers citing old periods or non-canonical URLs.

---

## 11. Phased Implementation Roadmap

Each item is intentionally issue-sized and should be implemented in a separate PR unless a reviewer explicitly groups compatible docs-only changes.

### Phase 1: Engineering, highest leverage, no constraint conflict

| Proposed issue title | Scope | Acceptance sketch |
|---|---|---|
| `[geo] Add answer capsules and visible data-as-of blocks` | Implemented in #52: deterministic server-rendered capsules on repo, org, rankings, category, pulse, and compare surfaces. Existing Blob JSON fields only. | Each page type has a 40-60 word capsule, a real data date, GitStarClub attribution, no runtime AI, no new client JS, and tests for visible changes. |
| `[geo] Add visible FAQ blocks and FAQPage JSON-LD` | Add 3-5 deterministic FAQ items per page type and emit matching FAQPage schema from a shared builder. | FAQ is visible in HTML; JSON-LD exactly mirrors visible answers; no hidden schema; tests cover escaping and schema shape. |
| `[geo] Add Dataset and dateModified schema` | Add `datasetLd`, optional `dateModified` to collection/entity builders, and Dataset linkage on home/ranking/category pages. | JSON-LD validates structurally; dates come from `meta` or actual watermarks; no hard-coded date; docs updated. |
| `[geo] Make AI crawler policy explicit in robots` | Extend `robots.ts` to explicitly list retrieval, search, and training crawlers while preserving preview noindex and `/api/` disallow. | Production robots includes explicit agents; preview still disallows all; tests assert expected robots output. |
| `[geo] Add Bing Webmaster and IndexNow publish hook` | Document verification, host IndexNow key, and POST changed URLs after workflow publish and cron live overlay writes. | No external paid service; URL batches are deterministic and capped; failure does not block data publish but logs warning. |
| `[geo] Add llms.txt hygiene file` | Generate a concise `/llms.txt` from static links and methodology pages. | File follows spec, does not duplicate entire sitemap, has no runtime dependency, and docs state no proven citation benefit. |

### Phase 2: Entity authority enablement

| Proposed issue title | Scope | Acceptance sketch |
|---|---|---|
| `[geo] Enhance existing /about methodology page for GEO` | Extend the existing `/about` page with Dataset schema, user-facing field definitions, license, cadence, seam explanation, and sample queries. | Existing about page links DATA-CONTRACTS/RANKING concepts in user-facing language, emits Dataset schema, keeps footer access through the existing About link, and adds no new route. |
| `[geo] Publish small deterministic data exports` | Generate top rankings, milestone, and org aggregate CSV/JSON extracts from existing views. | Exports are versioned, documented, downloadable without runtime engines, and have stable license/attribution copy. |
| `[geo] Add GitStarClub Organization identity schema` | Add site-level Organization schema with approved sameAs entries. | sameAs entries are reviewed, stable, and documented; no scraped external links. |
| `[geo] Add shareable static data snippets` | Add copy/link/embed affordances for weekly movers, milestones, and org totals. | Server-rendered snippets preserve visual baseline, include canonical links, and require visual signoff if UI changes. |

### Phase 3: Measurement

| Proposed issue title | Scope | Acceptance sketch |
|---|---|---|
| `[geo] Add AI crawler and referrer log reporting` | Build a Vercel-first aggregate report for AI crawler user-agents and AI referrers. | No client analytics; report aggregates only; docs list user-agent/referrer taxonomy. |
| `[geo] Add target AI query tracking doc` | Create `docs/geo/queries.md` with target questions, manual weekly check workflow, and citation occupancy metric. | Query list covers all page types; weekly row format is copy-paste ready; no paid monitoring dependency. |
| `[geo] Review citations and stale answers after launch` | Run manual checks across ChatGPT, Perplexity, Google AI Mode/AIO, Gemini, Claude, and Grok. | Report records citations, wrong answers, missing pages, and follow-up implementation issues. |

### Off-chain / operations

| Proposed issue title | Scope | Acceptance sketch |
|---|---|---|
| `[ops] Seed weekly GitHub star mover data story` | Publish and share weekly summaries externally. | Each post links canonical GitStarClub pages and uses approved attribution. |
| `[ops] Build external citation targets` | Identify Wikipedia/Wikidata/GitHub/Kaggle/community contexts where the dataset is notable and useful. | No spam; only policy-compliant targets; engineering provides stable pages and exports first. |

---

## 12. Pitfalls, Non-Goals, and Constraint Fit

Pitfalls:

- Do not treat `llms.txt` as a proven ranking lever. Ship it only as low-cost hygiene.
- Do not treat schema as a replacement for visible HTML. If a fact matters, it must be on the page.
- Do not keyword-stuff headings or FAQ. Princeton's GEO work found content-optimization tactics can help, but low-quality keyword injection is not the same as extractable evidence.
- Do not fake freshness. A stale number with a new date is worse than an honest frozen-period label.
- Do not make compare facts depend on client-only state if the goal is citation.
- Do not introduce an LLM to write summaries. The site already has deterministic templates and structured data.
- Do not modify visual tokens without the design workflow. Answer capsules and FAQ are user-visible UI and must respect the locked amber baseline in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).
- Do not add external paid GEO tools by default. Measurement starts with Vercel logs and manual query checks.

Constraint fit:

| Constraint | GEO-compatible approach |
|---|---|
| No runtime AI | Capsules, FAQ, and statistical sentences are deterministic templates over JSON fields. |
| Content pages zero client JS | All answer blocks, FAQ, and schema are server-rendered. Compare remains the only interactive exception until pair-specific server pages are designed. |
| Runtime zero engine / zero database | All facts come from precomputed Blob JSON views and existing lookup joins. |
| Vercel-first | IndexNow and measurement can run from Vercel workflow/cron/logs; no new database or paid monitoring service is required. |
| Docs as source of truth | This document owns GEO strategy; [SEO.md](./SEO.md) owns crawler/canonical/sitemap mechanics; implementation PRs must update the owning docs when behavior changes. |
| Visual guardrails | New visible blocks require design review and screenshots before merge, because they change page composition even if colors do not change. |

### References

- Princeton / KDD 2024, "GEO: Generative Engine Optimization": [publication page](https://collaborate.princeton.edu/en/publications/geo-generative-engine-optimization/) and [arXiv PDF](https://arxiv.org/pdf/2311.09735).
- Google AI features and query fan-out: [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features), [AI Mode update](https://blog.google/products/search/google-search-ai-mode-update/).
- OpenAI search and crawlers: [Introducing ChatGPT search](https://openai.com/index/introducing-chatgpt-search/), [OpenAI crawlers](https://developers.openai.com/api/docs/bots).
- ChatGPT / Bing discovery evidence: [Search Engine Land on ChatGPT Search and Bing](https://searchengineland.com/chatgpt-search-microsoft-bing-seo-448019), [SEER Interactive SearchGPT/Bing overlap study](https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results).
- AI citation source mix: [Yext AI citation behavior research](https://www.yext.com/research/ai-citation-behavior-across-models).
- Perplexity crawlers: [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers).
- AI crawler growth: [Cloudflare crawler study](https://blog.cloudflare.com/from-googlebot-to-gptbot-whos-crawling-your-site-in-2025/).
- Freshness: [Ahrefs study on AI assistants and fresh content](https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content/).
- Content format citation rates: [Presence AI citation-rate study](https://presenceai.app/blog/ai-search-citation-rates-research-which-content-gets-cited).
- Original research and statistics: [ZipTie original research analysis](https://ziptie.dev/blog/how-original-research-wins-ai-citations/).
- Brand mentions and AI visibility: [Signals summary of Ahrefs findings](https://signals.sh/blog/backlinks-vs-brand-mentions-for-ai-visibility).
- Structured data: [Google structured data intro](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data), [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization), [schema.org Dataset](https://schema.org/Dataset), [schema.org FAQPage](https://schema.org/FAQPage), [schema.org dateModified](https://schema.org/dateModified).
- Core Web Vitals: [Google Core Web Vitals thresholds](https://developers.google.com/search/docs/appearance/core-web-vitals).
- IndexNow: [Bing IndexNow](https://www.bing.com/indexnow), [IndexNow protocol documentation](https://www.indexnow.org/documentation).
- `llms.txt`: [specification](https://llmstxt.org/core.html), [Answer.AI proposal](https://www.answer.ai/posts/2024-09-03-llmstxt.html), [SE Ranking study](https://seranking.com/blog/llms-txt/), [Ahrefs / Search Engine Journal summary](https://www.searchenginejournal.com/97-of-llms-txt-files-got-no-requests-ahrefs-data-shows/579478/), [Google skepticism summary](https://www.searchenginejournal.com/google-says-llms-txt-is-purely-speculative-for-now/577576/).
