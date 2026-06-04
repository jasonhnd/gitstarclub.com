# Roadmap

What is not yet built. For history of what has shipped, see [CHANGELOG.md](./CHANGELOG.md). For how the system currently works, start at [README.md](./README.md).

This document does not track sprint-level execution. It records open work and the architectural decisions that gate it.

---

## Open architectural decision: an analytical data layer

Several recurring user requests cannot be served by the current model (static JSON shards behind a publish pointer):

- **Drill-down beyond the ≥10k whitelist.** The site indexes ~5.3k repos today. Extending to ≥100 stars is roughly 460k repos with full history. The view set explodes.
- **Arbitrary-repo compare.** `/compare` overlays any subset of the tracked ≥10k set today. Comparing repos outside the index requires data on demand.
- **Topic / language / cohort clustering.** Pre-aggregated slices for `topic == X`, `language == Y`, `created_year == N`, and combinations of these.
- **Semantic search.** Embedding-based search over descriptions and topics (intent, not keyword).

All of these need arbitrary filtering / aggregation / vector queries over hundreds of thousands of repos × time series. That is beyond what a fixed view set can answer cheaply, which is why they sit behind this gate.

### Options on the table

| Option | Trade-off |
|---|---|
| **Tinybird (managed ClickHouse)** | Strong analytical engine. Introduces external billing (against the Vercel-first preference) and adds a runtime dependency outside Vercel (against the static-read model). |
| **Vercel Postgres / Neon** | Stays inside Vercel. Relational storage strains under analytical aggregates at this scale. |
| **More precomputed JSON views** | No DB. The combinatorial space of filter/sort/aggregate does not fit a finite set of pre-built shards. |
| **Self-hosted ClickHouse** | Operationally cheap to run, expensive to operate. Already evaluated and ruled out in [ARCHITECTURE.md](./ARCHITECTURE.md). |

A formal selection (option compare + small POC + decision record) must precede any of the work below. Until it lands, this entire backlog is paused.

---

## Backlog (blocked on the decision above)

### Drill-down to ≥100 stars

Expand the tracked set from the current ~5.3k to ~460k repositories. Affects:

- Recompute step budget (data volume, runtime, validate cost).
- Render budget (`generateStaticParams`, sitemap shard count, on-demand ISR cache size).
- Search index size (~5k → ~460k docs is past the comfortable client-side limit of MiniSearch; needs a server-side path).
- Per-repo curve fetch on `/compare` (entity shard count balloons).

### Arbitrary-repo compare

Extend `/compare` so it accepts any GitHub `owner/name`, not only the indexed set. Requires fetching curve data on demand for repos that the recompute did not precompute. Likely depends on the drill-down expansion above.

### Topic / language / cohort clustering

Pre-aggregated rankings for `topic`, `language`, and `created_year` slices (and pairwise combinations). May need a query backend or a much larger view set.

### Semantic search

Embedding-based search over descriptions, topics, and READMEs. Needs an embedding pipeline (offline) and a vector index served at query time. Separate from the existing `/search-index` keyword path.

---

## Ongoing (no architectural decision needed)

- **SEO observation.** Once Search Console coverage and field CWV stabilize, iterate on internal-linking and sitemap shard sizing if long-tail discovery underperforms (see [SEO.md](./SEO.md)).
- **Operational hygiene.** Continue recording post-incident learnings in [OPS.md](./OPS.md). Tighten `validate` invariants whenever contract drift surfaces.
- **Doc rigor.** Whenever a contract or route changes, the corresponding doc updates in the same commit; CHANGELOG records the user-visible change.
