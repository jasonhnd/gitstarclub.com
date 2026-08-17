---
owner: track-c / data-layer
status: draft
last_reviewed: 2026-08-17
source_of_truth_for:
  - Track C data-layer decision draft
  - option comparison and recommendation leans
  - POC must-prove criteria if a later decision chooses build
---

# Data-layer decision draft (Track C)

This is a **draft**. It is not the 2026-09-12 choose-or-defer record.

- **Clock started:** 2026-08-15 ([#361](https://github.com/jasonhnd/gitstarclub.com/issues/361)).
- **Draft due:** ~2026-08-29 ([#381](https://github.com/jasonhnd/gitstarclub.com/issues/381)).
- **Formal decide-or-defer owner:** [#383](https://github.com/jasonhnd/gitstarclub.com/issues/383) on **2026-09-12**. Missing that date **is** a six-month deferral of the [blocked expansion backlog](https://github.com/jasonhnd/gitstarclub.com/issues/362).
- **Map:** [ROADMAP.md](../ROADMAP.md) Track C remains the iteration index. This file is the comparative write-up that #383 will accept, amend, or replace.

**POC allowed: no.** No POC. No isolated POC repository is authorized by this draft.

This document does not implement [#362](https://github.com/jasonhnd/gitstarclub.com/issues/362). It does not authorize ≥100-star drill-down, arbitrary-repo compare, open faceting, or semantic search. Finite [CATEGORIES.md](../CATEGORIES.md) pages stay **outside** this decision.

## 1. Why a decision exists

Four recurring requests cannot be served by the current static JSON shards behind a publish pointer. They are **one gate**, not four features:

| Blocked request | Why static views cannot answer it |
|---|---|
| Drill-down beyond the ≥10k whitelist | Current universe is ~5.3k public repos with ≥10,000 stars. ≥100 stars is on the order of 460k repos with history. MiniSearch, sitemap, on-demand ISR, weekly GraphQL polling, and compare curve shards do not scale linearly. |
| Arbitrary-repo compare | `/compare` overlays the tracked set. Unindexed `owner/name` needs on-demand curves the recompute did not publish. |
| Open topic / language / year clustering | Arbitrary and pairwise slices. Different from the finite, registry-driven category pages. |
| Semantic search | Embeddings over descriptions, topics, or READMEs, plus a query-time vector index. Not an extension of client MiniSearch. |

All four need filtering, aggregation, or vector query over a large repo × time matrix.

Track A can still deepen the **current** ≥10k chronicle (repo/org hubs, finite categories, pulse, honest citation) without touching this gate. There is no proven reader demand that Track A cannot serve on the current whitelist.

## 2. Current law (do not silently amend)

From [README.md](../../README.md), [ARCHITECTURE.md](../ARCHITECTURE.md), and [ROADMAP.md](../ROADMAP.md):

| Constraint | Current meaning |
|---|---|
| Zero runtime engine in the request path | Build, cron, and request paths only read JSON. No DuckDB, ClickHouse, Postgres, or vector index in the serving image. |
| Zero runtime database | Read-side state is versioned Blob views behind a publish pointer (`views/<run_id>/**` + `views/latest.json`). No SQL connection to open. |
| Static content pages | Home, rankings, repo, org, pulse, and categories render as server HTML. Near-zero client JS on content surfaces. Named islands stay in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). |
| Vercel-first | Deploy, cron, Blob, workflow, and analytics stay on Vercel. No scattered third-party billing. BigQuery is a one-off bootstrap exception only. |
| AI-free product copy | No LLM-generated summaries or classifications at request time. |

Related operating facts that any option must still explain:

- **MiniSearch** is a chrome combobox over versioned `search/index.json`. There is no `/search?q=` results page ([REQ-SEARCH-001](../REQUIREMENTS.md)).
- **Sitemap + on-demand ISR** are how the long tail is discovered and generated. Current planning is ~10k URLs per locale, not a 460k × 7 cross-product ([SEO.md](../SEO.md)).
- **Weekly / daily refresh** polls GraphQL `current_stars` for the tracked set (~54 queries today against a 5,000-point hourly budget).
- **Product-gates stay fail-closed.** Base pointer and export `data_as_of` must stay within 14 days. This draft does not invent a serving pointer and does not loosen those gates.

[ARCHITECTURE.md](../ARCHITECTURE.md) already keeps self-hosted ClickHouse, Tinybird, and Neon/Postgres **out** of the production runtime stack. This draft re-opens them only as options to reject or condition, not as a license to add them to `web/`.

## 3. Option compare (summary)

Self-hosted ClickHouse is included only as **ruled out — do not reopen**.

| Option | Request-path engine? | Vercel-first? | Cost shape | Lean |
|---|---|---|---|---|
| Tinybird (managed ClickHouse) | yes, if it answers the four blocked items | no | Second vendor: ingest + storage + query; paid whether or not the four products exist | **no** |
| Vercel Postgres / Neon | yes | partial | Row store + compute for an analytical matrix; idle can sleep, cold start hits the request path | **no** |
| More precomputed JSON views | no | yes | Blob + weekly recompute, linear in shard count; combinatorial slices explode | **only-if** a tiny finite extra shard, not open faceting |
| Defer 6 months | no | yes | Zero incremental platform cost; Track A keeps using the current views | **yes** |
| Self-hosted ClickHouse | yes | no | Cheap machine theory, expensive operations; already rejected | **no** (ruled out, do not reopen) |

Leans are recommendations for #383, not a decision.

## 4. Option notes

Each option below answers the same questions: request-path engine, Vercel-first, cost shape, effect on MiniSearch / sitemap / weekly refresh / ISR / product-gates, which hard constraints would have to change, and a lean.

### 4.1 Tinybird (managed ClickHouse) — lean: **no**

**Request-path engine?** Yes, if used to serve the four blocked items. A write-side-only Tinybird that still emits the current JSON views would add a vendor without unlocking drill-down, arbitrary compare, open faceting, or semantic search.

**Vercel-first?** No. External runtime, external auth, external billing.

**Cost shape.** Usage-based ingest, storage, and query. A 460k-repo × multi-year daily/weekly grain is a large ingest even before open queries. Query cost then scales with faceting and on-demand compare. The bill exists whether or not readers use the new surfaces. This document does not invent invoice numbers.

**What happens to the current plane.**

| Plane | Effect |
|---|---|
| MiniSearch | Either stays on the ≥10k chrome index (two search products) or is replaced by a server query (breaks “go to a name”, no `/search?q=`). |
| Sitemap / ISR | Unchanged unless the universe grows. Tinybird does not make 460k × 7 locale URLs cheap to enumerate, generate, or crawl. |
| Weekly refresh | GraphQL polling still has to happen. ~460k repos is thousands of `stargazerCount` queries per refresh, not ~54. Tinybird does not raise GitHub’s hourly budget. |
| Product-gates | Temptation to treat warehouse lag as “eventual” and loosen the 14-day Blob / export gates. That is not allowed. |

**Hard constraints that would change.**

- Zero runtime engine in the request path (README / ARCHITECTURE #1).
- Zero runtime database (a remote query plane is still a runtime database).
- Vercel-first (scattered third-party billing).
- Static content pages, if HTML is composed from Tinybird results instead of Blob views.
- ARCHITECTURE’s explicit “deliberately not in the production runtime stack: … Tinybird”.

AI-free copy can stay. Finite categories can stay view-only.

**Lean: no.** Strong analytics, wrong operating model. External runtime plus a second bill conflicts with Vercel-first and the static-read default, and it does not remove the sitemap / ISR / GraphQL-budget walls.

### 4.2 Vercel Postgres / Neon — lean: **no**

**Request-path engine?** Yes.

**Vercel-first?** Partial. Marketplace-adjacent, still a SQL connection on the serving side.

**Cost shape.** Rows + compute. The logical model is a fact table over star events (repo × day), not transactional rows. ~460k repos × thousands of days is the wrong shape for Postgres even before indexes for faceting. Autosuspend lowers idle cost and puts cold start on the request path.

**What happens to the current plane.**

| Plane | Effect |
|---|---|
| MiniSearch | Same fork as Tinybird: keep a ≥10k client index, or invent a SQL-backed `/search` product. |
| Sitemap / ISR | Independent of the store. 460k entity pages still cannot be a linear ISR / sitemap expansion. |
| Weekly refresh | Same GraphQL budget problem. Postgres does not poll GitHub. |
| Product-gates | Same fail-closed contract. A SQL “source of truth” beside `views/latest.json` would split freshness. Do not do that. |

**Hard constraints that would change.**

- Zero runtime engine.
- Zero runtime database (this option is exactly a runtime database).
- Vercel-first only in the weak sense of “a Vercel integration”; the serving image would open a SQL connection.
- Static content pages, if rankings or compare HTML are assembled from queries.
- ARCHITECTURE’s “deliberately not in the production runtime stack: … Neon/Postgres”.

**Lean: no.** Staying on the Vercel bill does not fix the analytical shape. Relational storage is the wrong tool for a repo × time matrix at the ≥100-star scale.

### 4.3 More precomputed JSON views — lean: **only-if**

**Request-path engine?** No.

**Vercel-first?** Yes.

**Cost shape.** Blob bytes and weekly Workflow CPU, linear in the number of published shards. A single extra bounded view on the current ~5.3k set is cheap. Combinatorial `topic × language × year` (and pairs) is not a finite shard set.

**What happens to the current plane.**

| Plane | Tiny finite extra shard (allowed to consider) | Open faceting / 460k expansion (not this option) |
|---|---|---|
| MiniSearch | Unchanged client index over `search/index.json`. | Client MiniSearch will not hold ~460k docs. |
| Sitemap / ISR | Unchanged ~10k-URL-per-locale planning. | Would require a new discovery model. |
| Weekly refresh | Same ~54 GraphQL queries. | Same GitHub budget wall. |
| Product-gates | New shards go through validate → publish pointer. Do not invent another serving pointer. Do not loosen 14-day gates. | Same, plus a much larger validate surface. |

**Hard constraints that would change.**

- **None**, if the extra shard is tiny, finite, and derived from the current whitelist (same rule family as existing rank / category / lookup views).
- If someone tries to stretch this option into open faceting or ≥100-star coverage: MiniSearch, sitemap, ISR, GraphQL budget, and compare-shard assumptions in README / REQUIREMENTS / SEO / ARCHITECTURE all break. That stretch is how this option becomes a hidden Track C build.

Finite [CATEGORIES.md](../CATEGORIES.md) pages already use this pattern. They are outside this decision and are not a preview of arbitrary faceting.

**Lean: only-if** for a tiny finite extra shard that Track A can name and bound (for example one more precomputed rank or lookup the current whitelist already supports). **Not** for open faceting, not for unindexed compare, not for ≥100-star history.

### 4.4 Defer 6 months — lean: **yes**

**Request-path engine?** No.

**Vercel-first?** Yes. Status quo.

**Cost shape.** Zero new platform cost. The cost of deferral is opportunity cost on the four blocked items, not a bill.

**What happens to the current plane.**

| Plane | Effect |
|---|---|
| MiniSearch | Stays a ≥10k go-to-name combobox. |
| Sitemap / ISR | Stay on the current whitelist and on-demand long tail. |
| Weekly refresh | Same GraphQL set, same Workflow, same live overlay. |
| Product-gates | Unchanged and still fail-closed. |
| Track A | Continues: hubs, finite categories, pulse, citation. That is the reader loop the site actually has. |

**Hard constraints that would change.** None.

**Lean: yes.** The four blocked items remain one unproven gate. Nothing in [PRODUCT.md](../PRODUCT.md) or current traffic shape shows that Track A cannot serve the chronicle + pulse loop on ~5.3k repos. Spending Track C weeks on a query plane before that demand exists would trade a working static-read site for an architecture project.

If #383 accepts this lean on 2026-09-12, the default review date is six months later (**~2027-03-12**). #383 owns that date. This draft does not set it.

### 4.5 Self-hosted ClickHouse — lean: **no** (ruled out, do not reopen)

Already rejected in [ARCHITECTURE.md](../ARCHITECTURE.md): cheap to run in theory, expensive to operate; public ClickHouse playgrounds are the wrong grain and identity model; self-hosting implies operating OLAP outside Vercel.

**Request-path engine?** Yes. **Vercel-first?** No. **Cost shape?** Operator time dominates any machine-hour story.

Do not reopen. A future #383 “build” cannot be “we will run ClickHouse ourselves.”

## 5. Overall lean

**Defer 6 months.**

| Option | Lean |
|---|---|
| Tinybird | **no** |
| Vercel Postgres / Neon | **no** |
| More precomputed JSON views | **only-if** (tiny finite extra shard, not open faceting) |
| Defer 6 months | **yes** |
| Self-hosted ClickHouse | **no** (ruled out, do not reopen) |

This is a recommendation for [#383](https://github.com/jasonhnd/gitstarclub.com/issues/383), not the decision. #383 may still choose build. Until it does, the four [#362](https://github.com/jasonhnd/gitstarclub.com/issues/362) items stay paused and have no implementation children.

Nothing in ARCHITECTURE, ROADMAP, or PRODUCT forced a build lean: there is no shipped product that already requires a request-path engine, and Track A’s surfaces are explicitly finite views.

## 6. POC authorization

**POC allowed: no.**

**no POC.**

This draft does not authorize a POC repository, a Tinybird workspace, a Neon/Postgres instance, a vector index, or a query engine in the `web/` serving path. Track C’s remaining child is #383 (choose or defer). POC harness and constraint-amendment PRs are filed only if #383 chooses build.

## 7. If #383 later chooses build, the must-prove list would be

No POC is authorized now. If #383 later chooses build, these metrics and constraints must be written and accepted **before** any POC repository exists. Success/fail is defined here so 2026-09-12 has criteria; it is not a green light.

| Must-prove | Why it exists | Fail looks like |
|---|---|---|
| Content HTML stays on views | Home, rankings, repo, org, pulse, and finite categories keep reading Blob views through the publish pointer. The query plane, if any, is isolated from content HTML. | A ranking, repo, or pulse page opens SQL / Tinybird / a vector index on first byte. |
| No query engine in the `web/` serving path | Even a POC must not put DuckDB, ClickHouse, Postgres, or a vector index in the Next.js image. | `web/` gains a client or native engine used by a route handler or RSC page. |
| Latency | p95 of any path that leaves views (compare overlay, facet, search) versus today’s CDN / ISR path. | Regression that makes content pages wait on the query plane. |
| Cost per 1k compares (or per 1k analytical queries) | Compare is the cheapest concrete unit among the four blocked items. | Unbounded per-query or per-ingest cost with no owner. |
| Operational owner | Named owner for outage, schema drift, and the vendor bill. | “We’ll notice from Vercel” with a second vendor and no runbook. |
| GraphQL / refresh budget | Proposed universe must fit the 5,000-point hourly budget or an explicit, cheaper membership rule. | Silent expansion of the polled set toward ~460k. |
| Sitemap / ISR plan | Must not enumerate 460k × 7 locales at deploy or as a single sitemap. | Linear ISR / sitemap expansion “because the warehouse can answer it.” |
| MiniSearch posture | Either search stays ≥10k go-to-name, or a replacement is specified that is still not a request-path engine in `web/`. | Shipping `/search?q=` plus a vector index as a “small POC.” |
| Product-gates | 14-day base pointer and export SLAs stay fail-closed. No new serving pointer beside `views/latest.json`. | Weakening gates, or adding a new request-path existence probe / extra serving pointer, to land the POC. |
| Isolation | POC stays out of weekly refresh and out of content HTML. No rewrite of the Workflow. | Folding the warehouse into `recompute` / `validate` / `publish` before the must-prove list is green. |

A later build decision would still have to list which README / ARCHITECTURE hard constraints it is amending. This draft’s lean is that none of them should be amended in 2026.

## 8. What this draft does not do

- Does not close or decide [#383](https://github.com/jasonhnd/gitstarclub.com/issues/383) or [#361](https://github.com/jasonhnd/gitstarclub.com/issues/361).
- Does not implement or split [#362](https://github.com/jasonhnd/gitstarclub.com/issues/362).
- Does not change CATEGORIES.md, product-gates, or the current publish pointer.
- Does not add a query engine to `web/`.
