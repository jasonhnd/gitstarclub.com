---
owner: roadmap
status: active
last_reviewed: 2026-09-06
source_of_truth_for:
  - open work
  - architectural decisions
  - backlog
  - iteration tracks
  - Track C dated data-layer decision (product lock-002)
---

# Roadmap

How the site iterates from here. For what has shipped, see [CHANGELOG.md](./CHANGELOG.md). For how the system works today, start at [README.md](./README.md). For what the product is, see [PRODUCT.md](./PRODUCT.md).

This document is the **iteration map**. GitHub issues that implement it must stay inside a track below. Smaller child issues are split from the track epics; they are not invented beside the map.

It is not a sprint board. It records (1) the operating rule for doing three kinds of work without collapsing them, (2) Track A product depth on the current ≥10k universe, (3) Track B production-as-product hygiene, (4) the Track C analytical-layer decision, now **recorded as product lock-002: a permanent product veto of the request-path query plane**, and (5) the expansion backlog that stays **paused** until a constitution-level revision amends the hard constraints.

## Operating rule

The site is past “does the surface exist?”. Chronicle, pulse, rankings, search, compare, and categories are live. Weekly refresh, product-gates, and the 14-day freshness contract work again. The gap is the **reader loop**, not a missing page type:

1. Arrive from search (`X star history`, a year of trending).
2. Understand a frozen slice or a single curve.
3. Jump to peers, a category, or compare.
4. Come back because pulse changed.

Differentiation stays what [REQUIREMENTS.md](./REQUIREMENTS.md) already states: GitHub Trending is only today, star-history.com is one repo at a time, gitstar-ranking.com is current totals. GitStarClub is **retrospective + structured + pulse**.

Two tracks remain in flight. Only **one of those tracks owns most of any given week**. Track C is closed as a build track.

| Track | Share of weeks | Purpose | Hard stop |
|---|---|---|---|
| **A — Current-universe product** | ~80% | Make the existing ≥10k chronicle and pulse denser to read and cite | No whitelist expansion, no query engine, no request-path ranking |
| **B — Production as product** | ~20%, standing | Freshness, cost, publish gates, lockfile hygiene | Not a feature factory |
| **C — Analytical-layer decision** | closed | Written decision: product veto of request-path live computation (lock-002) | No production PRs for ≥100-star drill-down, arbitrary compare, open faceting, semantic search, or a request-path query plane. Reopening requires a constitution-level revision, not a feature PR and not a calendar date. |

Track A edits pages and precomputed views. Track C does not authorize a POC, a query plane, or a revisit date. Track B moves on a fixed window or when something is on fire.

### Hard constraints (do not renegotiate in feature PRs)

From [README.md](../README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md):

- Zero runtime engine in the request path (no DuckDB / ClickHouse / Postgres / vector index in the serving image).
- Zero runtime database. Read-side state is versioned Blob views behind a publish pointer.
- Static content pages. Near-zero client JavaScript on content surfaces. Named exceptions stay in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).
- Vercel-first. Deploy, cron, Blob, workflow, and any future analytics stay on Vercel unless a constitution-level revision amends this constraint.
- AI-free product copy. No LLM-generated summaries or classifications at request time.

A proposal that cannot pass this list is vetoed. It is not a Track A ticket, not a Track C POC, and not a feature PR.

### Sequence

- **Weeks 1–4 (done on `pre`):** Track A A1–A4 children shipped. Track B hygiene. #380 measured crawlers then **left Firewall empty** (operator chose to allow them). Track C draft + must-prove (#381 / #382); **POC allowed: no**.
- **Through 2026-09-12 (superseded):** Track C #383 recorded defer six months, review 2027-03-12, no POC. That dated auto-review is **void**.
- **2026-09-06 (lock-002):** Track C is a **product veto** of the request-path query plane / live computation on the request path. No POC. No calendar revisit. Reopening requires a constitution-level revision. See [Track C](#track-c--analytical-data-layer-decision).
- **Now:** the four #362 expansion items stay vetoed. Further Track A work is filed as a new child of a new or reopened Track A epic — not invented beside this map. Track B stays standing.

---

## Track A — Product depth on the current ≥10k set

**Goal.** Strengthen the reader loop without changing the data plane. Finite, precomputed JSON / ISR only. Current whitelist (~5.3k public repos with ≥10,000 stars) is the universe.

**Non-goals.** ≥100-star expansion; compare of unindexed GitHub names; arbitrary `topic × language × year` query builder; embedding search.

**Done when.** From a typical repo page, three clicks can tell a story (who moved in the same period, who is larger in the same language, how this curve compares). Pulse gives a reason to return. Category pages read as rule-based slices, not as a third ranking product. Citation surfaces (as-of, export, GEO capsules) stay honest.

Work this track in order. Do not open all four steps as parallel implementation streams. **A1–A4 first-pass children are closed on `pre`.** New Track A work needs a new child under an open epic; do not invent tickets beside this map.

### A1. Repo and org pages as hubs

The inbound URL for most long-tail traffic is `/{owner}/{name}` or `/o/{login}`. If the visitor can only bounce back to GitHub, the site is a multi-repo star-history.

**Intent**

- Treat repo/org pages as the hub [SEO.md](./SEO.md) §9 already describes: related repos, owner, public categories, compare, and the period when the repo crossed a milestone.
- Use data already on the entity / lookup / category views. Do not add request-time GitHub calls.

**Likely surfaces**

- `/{owner}/{name}`, `/o/{login}`
- Existing related-repo helpers (`web/lib/repo-page.ts` and category assignment views)
- Compare entry (`?repos=`), category links, period links into `/rankings/...`

**Acceptance (epic level)**

- A tracked repo page exposes working links to: owner/org (when applicable), at least one public category it belongs to, add-to-compare, and at least one historical ranking period that is not “all-time only”.
- Related repos are deterministic (same owner and/or same primary language, ranked by current stars, bounded).
- No new client JS on the content body. No extra Blob probes per related card beyond views already required for the page.
- Docs: [SEO.md](./SEO.md) §9 and [FRONTEND.md](./FRONTEND.md) stay true after the change.

**Children**

| Issue | Work | Order |
|---|---|---|
| [#363](https://github.com/jasonhnd/gitstarclub.com/issues/363) | Lock the repo-hub contract with tests | First |
| [#364](https://github.com/jasonhnd/gitstarclub.com/issues/364) | Link milestone dates to ranking months | After #363 |
| [#365](https://github.com/jasonhnd/gitstarclub.com/issues/365) | Surface week and year ranking appearances | After #363; close if views lack the data |
| [#366](https://github.com/jasonhnd/gitstarclub.com/issues/366) | Org page hub parity | After #363 |
| [#367](https://github.com/jasonhnd/gitstarclub.com/issues/367) | Related-repo empty states and tests | After #363 |

### A2. Categories as a topic entry, not a third leaderboard

Categories are already the scoped, static-read system in [CATEGORIES.md](./CATEGORIES.md). They must stay a **finite rule slice** of the current whitelist, not a preview of arbitrary faceting.

**Intent**

- Readers should enter a theme from a month board or a repo page and understand the rule (“public language category, precomputed”) rather than “filter GitHub”.
- Keep registry-driven public categories only. No generated route per low-volume tag.

**Likely surfaces**

- `/categories`, `/categories/:dimension`, `/categories/:dimension/:slug`
- Inbound links from repo hubs (A1) and from ranking pages

**Acceptance (epic level)**

- Repo → category and category → repo links are bidirectional for public assignments.
- Category copy does not imply live GitHub search or multi-facet query.
- Still no request-time classification. Still no combinatorial filter UI.

**Children**

| Issue | Work |
|---|---|
| [#368](https://github.com/jasonhnd/gitstarclub.com/issues/368) | Ranking pages exit to public categories |
| [#369](https://github.com/jasonhnd/gitstarclub.com/issues/369) | Honest copy on thin category pages |
| [#370](https://github.com/jasonhnd/gitstarclub.com/issues/370) | Bidirectional repo↔category assignment tests |

### A3. Pulse as the reason to return

Home is already the Pulse experience ([INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md)). The product difference versus GitHub Trending is **old projects waking up** and a bridge into frozen history.

**Intent**

- Make movers, revival, and spike readable as chronicle, not as another hot list.
- Connect “moving now” to the week/month slice a reader can cite later.

**Likely surfaces**

- `/`, `/pulse`
- `hot-snapshot.json` / current week live overlay (already published by daily cron)

**Acceptance (epic level)**

- Pulse states the actual period of each panel (current ISO week vs fallback week) and does not imply request-time GitHub polling.
- At least one path from a pulse mover to that repo’s hub and to the matching weekly or monthly ranking page.
- Content HTML stays inside the existing low-JS / ISR contract.

**Children**

| Issue | Work |
|---|---|
| [#371](https://github.com/jasonhnd/gitstarclub.com/issues/371) | Pulse panels state the actual period |
| [#372](https://github.com/jasonhnd/gitstarclub.com/issues/372) | Pulse movers link to the matching ranking period |
| [#373](https://github.com/jasonhnd/gitstarclub.com/issues/373) | Confirm home and `/pulse` share one view |

### A4. Search stays “go to a name”; citation stays honest

Search is a chrome combobox over `search/index.json`, not a `/search?q=` results page ([REQ-SEARCH-001](./REQUIREMENTS.md)). Citation is as-of dates, exports, and GEO capsules ([GEO.md](./GEO.md), [DATA-EXPORTS.md](./DATA-EXPORTS.md)).

**Intent**

- Do not turn search into a server query product (that is a vetoed request-path query plane, not Track A).
- Make numbers quotable: data-as-of, export alias, answer capsules, without inventing live stars.

**Likely surfaces**

- SearchBox, `/search-index`
- `/about`, `/data/exports/v1/latest/*`, GEO FAQ / capsules on rankings and entity pages

**Acceptance (epic level)**

- Search still has no results URL; compare-from-search still works for indexed repos only.
- Export `data_as_of` continues to move only after a successful views publish (product-gates already enforce age).
- Capsules and about copy do not claim request-time freshness.

**Children**

| Issue | Work |
|---|---|
| [#374](https://github.com/jasonhnd/gitstarclub.com/issues/374) | Search empty, typo, and inactive-repo edges |
| [#375](https://github.com/jasonhnd/gitstarclub.com/issues/375) | Export regenerate runbook after weekly publish |
| [#376](https://github.com/jasonhnd/gitstarclub.com/issues/376) | GEO capsule gaps on high-value routes |

---

## Track B — Production as product

**Goal.** Keep the site publishable and cheap enough to read. This is standing work, not a launch theme.

**Non-goals.** Weakening product-gates. Inventing `bootstrap/latest.json` while production is still legacy-flat. Claiming crawler-cost savings without metrics.

### Standing items

| Item | Why it exists | Done looks like |
|---|---|---|
| Weekly managed refresh stays visible when it fails | Aug 2026 publish stalled for weeks because validate and enqueue failures were easy to miss | `ops/workflows/health/workflow-refresh.json` is the only live operator signal; retired `ops/workflows/health.json` is not read |
| New pages must not re-probe missing Blob objects | Crawler-driven 404 amplification on `bootstrap/latest.json` | Pointer 404 remains a cached legacy state; no new per-request existence probes |
| Dependabot + bun lockfiles | npm Dependabot PRs against `main` fail `bun install --frozen-lockfile` | Next Dependabot wave is retargeted or immediately replaced with a `pre` + lockfile PR (pattern from #351) |
| Product-gates stay fail-closed | 14-day base pointer and export SLAs are the live contract (#286) | Do not skip or loosen the job to land features |
| Vercel Firewall | Optional extra crawler control after robots | Recipe in [OPS.md](./OPS.md). 2026-08-20: denies published then removed the same day; operator chose to allow crawlers. Zero custom rules live. |

Every Track A PR inherits: no layout-wide `revalidatePath`, no new always-on Blob 404s, product-gates remain required on `pre`/`main`.

**Children**

| Issue | Work |
|---|---|
| [#377](https://github.com/jasonhnd/gitstarclub.com/issues/377) | Retire stale `health.json` as the operator signal |
| [#378](https://github.com/jasonhnd/gitstarclub.com/issues/378) | Dependabot targets `pre` + bun lockfile convention |
| [#379](https://github.com/jasonhnd/gitstarclub.com/issues/379) | Sunday refresh failure runbook |
| [#380](https://github.com/jasonhnd/gitstarclub.com/issues/380) | Firewall only if crawler spend justifies it |
| [#402](https://github.com/jasonhnd/gitstarclub.com/issues/402) | Weekly live publish must not false-fence on a CDN-stale `live/latest.json` |

---

## Track C — Analytical data-layer decision

**Decided: product veto (lock-002). No request-path query plane. No live computation on the request path. No POC. No dated auto-review.** The record is [Decision — product veto (lock-002)](#decision--product-veto-lock-002) below.

**Goal (closed).** A written decision, dated, in-repo. That decision is a **permanent product veto** of the request-path analytical query plane. Track C does not authorize a POC, a query engine, or a calendar reminder to reopen the question.

The 2026-08-31 [#383](https://github.com/jasonhnd/gitstarclub.com/issues/383) record (defer six months, review 2027-03-12) is **superseded**. There is no 2027-03-12 review and no other automatic revisit date.

Several recurring requests cannot be served by static JSON shards behind a publish pointer:

- **Drill-down beyond the ≥10k whitelist.** ~5.3k repos today. ≥100 stars is on the order of 460k repos with history. The view set, sitemap, ISR, and MiniSearch index do not scale linearly.
- **Arbitrary-repo compare.** `/compare` overlays the tracked set. Unindexed `owner/name` needs on-demand curves.
- **Open topic / language / year clustering.** Arbitrary and pairwise slices. Different from finite [CATEGORIES.md](./CATEGORIES.md) pages.
- **Semantic search.** Embeddings over descriptions/topics/READMEs. Separate from `/search-index`.

All four need filtering, aggregation, or vector query over a large repo × time matrix. That is one gate, not four features. Lock-002 vetoes that gate.

### Decision — product veto (lock-002)

This is the dated record [#430](https://github.com/jasonhnd/gitstarclub.com/issues/430) owns. It keeps [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md) as the option-comparison history and records the product outcome as a **veto**, not a deferral.

| Field | Record |
|---|---|
| Recorded | 2026-09-06 (lock-002), superseding the 2026-08-31 #383 deferral |
| Outcome | **Veto.** No analytical query plane. No live computation on the request path. |
| Review on | **None.** No dated auto-review. No calendar reminder. |
| POC authorized | **No.** |
| Hard constraints changed | **None.** |
| Reopen by | A **constitution-level revision**: a new dated constitutional record that amends the hard constraints. Not a feature PR. Not a Track C POC. Not a calendar date. |
| Basis | [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md), accepted as comparison history; product outcome is veto |

Rejected: Tinybird (**no**), Vercel Postgres / Neon (**no**), self-hosted ClickHouse (**no — ruled out, do not reopen**). More precomputed JSON views stays **only-if**: a tiny, finite, whitelist-derived shard in the same rule family as the existing rank / category / lookup views is Track A work and needs no Track C decision. Stretching that option into open faceting or ≥100-star coverage is a request-path analytical plane and is **vetoed**.

What the veto means in practice:

- The four [#362](https://github.com/jasonhnd/gitstarclub.com/issues/362) items stay paused and keep **no implementation children**. #362 is not a review-date carrier; it is a vetoed expansion backlog.
- Every rule in [Hard constraints](#hard-constraints-do-not-renegotiate-in-feature-prs) stands unchanged. No request-path engine, no runtime database, no vector index in the serving image, no second vendor bill.
- No POC repository, Tinybird workspace, Neon/Postgres instance, or embedding index is authorized. The must-prove list in the draft §7 is historical criteria, not a green light and not a scheduled review checklist.
- Track A continues on the current ~5.3k ≥10k-star universe. Finite [CATEGORIES.md](./CATEGORIES.md) pages were always outside this decision and are unaffected.
- Product-gates stay fail-closed. Nothing here loosens the 14-day base-pointer or export SLAs, and nothing adds a serving pointer beside `views/latest.json`.

What would reopen this: a constitution-level revision — a new dated constitutional record that names each hard constraint being amended and why. A feature PR is not a reopening mechanism. A calendar reminder is not a reopening mechanism. Reader demand alone does not reopen it.

### Options (compare that produced the decision)

The comparative draft is [analysis/DATA-LAYER-DECISION.md](./analysis/DATA-LAYER-DECISION.md). Lock-002 keeps its option rejects and replaces the 2026-08-31 deferral with a product veto.

Recorded outcome per option: Tinybird **no**; Vercel Postgres / Neon **no**; more JSON views **only-if** (tiny finite extra shard, not open faceting); self-hosted ClickHouse **ruled out, do not reopen**; defer 6 months **superseded**; product veto (lock-002) **chosen**. **POC allowed: no.**

| Option | Trade-off |
|---|---|
| **Tinybird (managed ClickHouse)** | Strong analytics. External billing and a non-Vercel runtime dependency. Conflicts with Vercel-first and static-read defaults. Draft lean: **no**. |
| **Vercel Postgres / Neon** | Stays on Vercel. Relational storage is a poor fit for this analytical shape and scale. Draft lean: **no**. |
| **More precomputed JSON views** | No database. Combinatorial filter/sort/aggregate does not fit a finite shard set. Draft lean: **only-if** a tiny finite extra shard. |
| **Self-hosted ClickHouse** | Cheap to run in theory, expensive to operate. Already ruled out in [ARCHITECTURE.md](./ARCHITECTURE.md). Do not reopen. |
| **Defer 6 months** | Historical lean of the 2026-08-17 draft, recorded by #383. **Superseded** by lock-002. The dated 2027-03-12 review is void. |
| **Product veto (lock-002)** | **Chosen.** No request-path query plane. No live computation on the request path. No POC. No auto-review. Reopen only by constitution-level revision. |

The selection is recorded above. Finite category pages stay **outside** this decision.

### Decision-record acceptance

The record above satisfies each requirement:

| Requirement | Where it is met |
|---|---|
| In-repo markdown (extend this file or add a dated decision note linked from here) | [Decision — product veto (lock-002)](#decision--product-veto-lock-002) extends this file |
| States the chosen option **or** an explicit defer-until date | **Veto.** No defer-until date. No auto-review. |
| Lists which hard constraints would change if a query plane is introduced (and which pages would still be view-only) | None change. Amending them requires a constitution-level revision. Per-option constraint deltas stay in the draft §4 as history. |
| If a POC is approved: isolated from content HTML, no weekly-refresh rewrite, success/fail metrics written before code | Not applicable — no POC authorized. Criteria stay in the draft §7 as historical must-prove language, not a green light. |

**Children (decision only — no #362 implementation)**

| Issue | Work | Due | Status |
|---|---|---|---|
| [#381](https://github.com/jasonhnd/gitstarclub.com/issues/381) | Write the data-layer decision draft | ~2026-08-29 | Done |
| [#382](https://github.com/jasonhnd/gitstarclub.com/issues/382) | Write POC must-prove list (or close if defer) | with / after #381 | Done |
| [#383](https://github.com/jasonhnd/gitstarclub.com/issues/383) | Decide or defer | **2026-09-12** | Superseded: #383 recorded defer + 2027-03-12 review; lock-002 ([#430](https://github.com/jasonhnd/gitstarclub.com/issues/430)) vetoes the query plane with no auto-review |

POC harness and constraint-amendment PRs are not authorized. A constitution-level revision is the only reopening path.

---

## Backlog (vetoed expansion — no auto-review)

Track C [vetoed the request-path query plane](#decision--product-veto-lock-002). Do not file implementation issues for these, and do not land them as "small" Track A additions. Tracker: [#362](https://github.com/jasonhnd/gitstarclub.com/issues/362). Reopening requires a constitution-level revision, not a calendar date.

### Drill-down to ≥100 stars

Expand the tracked set from ~5.3k to ~460k repositories. Affects recompute budget, `generateStaticParams` / sitemap / ISR, search (MiniSearch will not hold 460k docs), and compare curve shard count.

### Arbitrary-repo compare

`/compare` accepts any GitHub `owner/name`. Needs on-demand curves for repos the recompute did not publish. Likely depends on the drill-down expansion.

### Topic / language / cohort clustering

Pre-aggregated rankings for `topic`, `language`, `created_year`, and pairs. Not the current category registry.

### Semantic search

Offline embeddings + a query-time vector index. Not an extension of MiniSearch.

---

## Continuous hygiene (always in flight)

- **SEO observation.** After Search Console coverage and field CWV stabilize, iterate internal links and sitemap shards if long-tail discovery underperforms ([SEO.md](./SEO.md)).
- **Operational hygiene.** Post-incident notes stay in [OPS.md](./OPS.md). Tighten `validate` when contract drift appears (the Aug 2026 all-time vs lookup split is the template).
- **Doc rigor.** Contract or route changes update the owning doc in the same commit. [CHANGELOG.md](./CHANGELOG.md) records user-visible change.

---

## Issue map

GitHub epics match this table. Child implementation issues are split from an epic, not from chat. **#362 has no implementation children.**

| Track | Epic | Issue | Children | Status |
|---|---|---|---|---|
| — | Iteration program (this map) | #354 | — | Closed (map shipped) |
| A | Product depth on the current ≥10k set | #355 | A1–A4 | First pass done on `pre`; epic closes with A1–A4 |
| A1 | Repo and org pages as hubs | #356 | #363 #364 #365 #366 #367 | Done on `pre` |
| A2 | Categories as topic entry | #357 | #368 #369 #370 | Done on `pre` |
| A3 | Pulse as return engine | #358 | #371 #372 #373 | Done on `pre` |
| A4 | Search stays go-to-name; citation stays honest | #359 | #374 #375 #376 | Done on `pre` |
| B | Production as product | #360 | #377 #378 #379 #380 #402 | Open; standing. Children including #380 done |
| C | Analytical data-layer decision | #361 | #381 #382 #383 | Decided: product veto (lock-002, #430). No POC. No dated auto-review. Epic is closed as a build track. |
| — | Vetoed expansion backlog | #362 | none | No impl. Not a review-date carrier. Reopen only by constitution-level revision |

When an epic is done, update this table and [CHANGELOG.md](./CHANGELOG.md) in the same change set as the last child.
