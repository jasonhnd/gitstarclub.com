---
owner: data operations / workflows
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - production data lifecycle
  - Vercel Blob publish model
  - Workflow refresh pipeline
  - rollback and garbage collection
---

# gitstarclub Vercel data operations (VERCEL-DATA-OPERATIONS)

> Document goal: describe the current operating form of the gitstarclub production data lifecycle on Vercel—all recurring data jobs are triggered, run, recorded, published, and rolled back on Vercel. Local `pipeline/backfill` serves only as a one-time bootstrap tool / historical archive, and is not on the daily operations path.
>
> Related: architecture overview [ARCHITECTURE.md](./ARCHITECTURE.md) · data contracts [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) · operations [OPS.md](./OPS.md) · pipeline [PIPELINE.md](./PIPELINE.md) · testing [TESTING.md](./TESTING.md) · changelog [CHANGELOG.md](./CHANGELOG.md).
>
> Official references:[Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) · [Vercel Workflows](https://vercel.com/docs/workflows)(including [Concepts](https://vercel.com/docs/workflows/concepts))· [Vercel Functions Limits](https://vercel.com/docs/functions/limitations).

---

## Scope

This document describes how recurring data refresh runs on Vercel: Vercel Workflow orchestration, Blob physical layout, `views/latest.json` publish pointer, atomic version switch and rollback model. **Before modifying the recompute pipeline or the read-side version resolution path, read this document first**. Read-side contracts are in [DATA-CONTRACTS.md](./DATA-CONTRACTS.md); the operations runbook is in [OPS.md](./OPS.md).

---

## 1. System overview and boundaries

### 1.1 System positioning

gitstarclub's runtime is **purely static**: user requests only read precomputed JSON / Blob, **never touching Workflow / engine / database** (see [ARCHITECTURE.md](./ARCHITECTURE.md)). The data operations layer this document describes is responsible for **producing these static JSON offline**: whitelist refresh, metadata refresh, rename detection, newcomer tracking, canonical fold, rank/entity/heatmap recompute, validation, publish, rollback—all triggered and run on Vercel.

### 1.2 Unchanging constraints

- **Runtime purely static**: Workflow only produces data, and pages do not know it exists.
- **Vercel-first / avoid scattered bills**: do not introduce GCP / third-party queues / external databases as recurring dependencies. BigQuery is only an optional historical data source during one-time bootstrap (see §10).
- **Do not do a 16k full build**: publish only switches the pointer + revalidate the core hot set, and the long tail uses on-demand ISR (see [ARCHITECTURE.md](./ARCHITECTURE.md) page layering).

### 1.3 Key design decision: why a full recompute cannot be stuffed into one Function

| Limit | Ordinary Vercel Function(Pro,Node.js) | Impact on full recompute |
|---|---|---|
| **Max duration** | default 300s,**max 800s**(13 minutes) | DuckDB reading 8M rows of Parquet to fully precompute 16k+ views far exceeds 13 minutes |
| **Memory / CPU** | default 2GB / 1 vCPU,**max 4GB / 2 vCPU** | local precompute already needs `--max-old-space-size=4096`, pressing against the limit |
| **Bundle size** | deployed bundle **≤ 250MB**(uncompressed) | `@duckdb/node-api` native module is large, and running native modules on serverless is unreliable |
| **Response body** | request / response body **≤ 4.5MB** | large files must use Blob direct-link read/write to bypass this limit |

> The official docs explicitly recommend ([Functions Limits](https://vercel.com/docs/functions/limitations)): **workloads that need extra-long execution time should use [Vercel Workflows](https://vercel.com/docs/workflows)**—it lets code pause / resume / save state across steps, **with no single-function duration cap**.
>
> Therefore the conclusion: **Cron is only responsible for triggering** (one GET against the production URL); **long tasks are handed to Workflow and split into multiple steps**, each step is an independent, retryable, short Function invocation, and Blob checkpoints record progress between steps. **Do not load DuckDB / Parquet inside any single Function to do a full recompute.**

---

## 2. Runtime layering

Data jobs are split into four layers by "frequency × weight", making clear where each runs:

| Layer | Job | Where it runs | Trigger |
|---|---|---|---|
| **L1 daily live** | poll current_stars → write immutable `live/generations/<run_id>/**` + manifest → fenced CAS switch `live/latest.json` → revalidate hot set | **Vercel Function**(single function, JSON-only, seconds) | Cron `0 3 * * *` |
| **L2 weekly live** | reuse live refresh, overwrite current week / current month rank + current-month heatmap + hot snapshot + `ops/sync-runs.json` | **Vercel Function**(single function, JSON-only) | Cron `0 4 * * 0` |
| **L3 Managed refresh** | canonical readiness preflight → whitelist diff → metadata shard → rename detection → month+week fold → rank/entity/heatmap full recompute → validate → publish (switch pointer) → version GC (step details in §4) | **Vercel Workflow**(multi-step, Blob checkpoint) | weekly cron + manual (schedule see [OPS.md](./OPS.md) §Cron) |
| **L4 Bootstrap archive** | first backfill of 11 years of event-level history (Search → BigQuery → DuckDB → JSON → Blob) | **local / full Node**(`pipeline/backfill`) | manual, one-time |

> The "Trigger" column in the table above only marks each layer's schedule ownership; **the authoritative schedule of the three crons (`0 3` / `0 4` / `0 6` and the `vercel.json` declaration) is in [OPS.md](./OPS.md) §Cron**.

**Division of labor**:
- **L1 / L2** handle "the live tail of the current period"—KB-level JSON, single function, seconds.
- **L3** handles "cross-period full / historical / metadata refresh"—heavy, slow, needs checkpoints, must be Workflow. **This is the core of this document.**
- **L4** runs once only for "cold start from zero" or "disaster rebuild"; once its output is taken over by L3 it is retired.

> Relationship between L2 and L3: L2 is "lightweight live-tail fallback", L3 is responsible for "full recompute + historical fold + metadata". The two read and write different Blob prefixes (live overlay vs canonical / `views/<run_id>`), naturally isolated.

---

## 3. Vercel Workflow pattern (L3 design core)

### 3.1 Responsibility split between Workflow and Cron / Function

```text
Vercel Cron(GET /api/workflows/refresh/start,with CRON_SECRET)  ← production schedule source of truth, P1 does not change vercel.json
  └─ route: auth + read-only canonical meta/repos preflight + acquire lease + startRefresh, return run_id immediately (non-blocking)
       └─ workflows runtime(startRefresh / enqueueStep / completeStep; no Workflow SDK)
            ├─ step 0  full canonical preflight          (4-bucket windows on CF/HTTP; read-only)
            ├─ step 1  refresh whitelist                 (plain async + explicit retry)
            ├─ step 2  rename detection(before metadata, read old full_name)
            ├─ step 3  metadata shards(loop by bucket, including newcomer-aware `tracked_since`)
            ├─ step 4  canonical fold(month+week fold of already-closed periods)
            ├─ step 5  rank recompute(cross-bucket gather)        → views/<run_id>/rank/**
            ├─ step 6a entity/repo recompute(independent within bucket)    → views/<run_id>/entity/repo/**
            ├─ step 6b entity/org recompute(cross-bucket gather + derived search/index.json)
            │                                              → views/<run_id>/entity/org/** + lookup/** + search/index.json
            ├─ step 7  heatmap update                       → views/<run_id>/heatmap/**
            ├─ step 8  build aliases(renamed old name→current id)      → views/<run_id>/lookup/aliases.json
            ├─ step 9  validate(Zod + sanity, for this version of views/<run_id>)
            ├─ step 10 publish(persist intent → update views/latest.json pointer → actively invalidate cache)
            └─ step 11 gc(version garbage collection, best-effort)
```

> The step order in the diagram above matches implementation source `web/lib/workflows/refresh.ts` L27–60:
> `preflight → whitelist → rename → metadata(per-bucket loop)→ fold → rank → repo-entities → org-entities → heatmap → aliases → validate → publish → gc`.
> Workflow publish actively invalidates the `published-views-pointer` cache tag and the root layout; the in-process pointer memo cap of other already-warm function instances is 60s, so the publish / rollback visibility SLA is **≤60s** (§7.4).

**Why the Cron route does not do the work directly**: a Cron trigger is one HTTP GET against the production URL, constrained by Function duration / memory. So the route only does "auth + read-only preflight of canonical meta/32 repos shards + lease + start workflow + return", and hands the real long task to the Workflow runtime for async orchestration. The route gate checks `active` / `tracked_since` / `d`, repo key/id and bucket before lease and enqueue; workflow step 0 then validates all 128 required shards (on CF / HTTP, invocations are split by 4-bucket windows to avoid Workers 1102), preventing objects from changing between enqueue and execution, and blocking empty time series, orphan repo IDs, missing shards, or read errors before any canonical mutation.

### 3.2 P1 runtime landed form

P1 removes the Vercel Workflow SDK. Steps are ordinary async functions, explicitly retried and scheduled by `web/lib/workflows/runtime/`:

- **`startRefresh(runId)`**: after acquiring the lease, enqueue the first step.
- **`enqueueStep(job)`**: hand one step to the memory queue, HTTP `/api/workflows/refresh/step`, or a non-production CF Queue.
- **`completeStep(job, result)`**: write `ops/workflows/<run_id>/steps/<step>.json`, then enqueue the next step.

The production schedule is still the Sunday 06:00 Vercel cron in `web/vercel.json`. CF Cron/Queue is used only for non-production proof; rollback see [CF-MIGRATION-P1.md](./CF-MIGRATION-P1.md) (stop CF Cron, production remains Vercel).

Skeleton sketch (**structural sketch; implementation see `web/lib/workflows/refresh.ts` + `runtime/*` + `steps/*`, function names follow the code**):

```ts
// web/lib/workflows/refresh.ts
export async function refreshWorkflow(runId: string) {
  await preflightCanonical(runId);                       // step 0(read-only schema gate)
  await refreshWhitelist(runId);                       // step 1
  await detectRenames(runId);                          // step 2(before metadata, read old full_name)
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await refreshMetadataBucket(runId, bucket);        // step 3(per-bucket loop, including newcomer-aware tracked_since)
  }
  await foldCanonical(runId);                          // step 4(month+week fold; read the pending frozen snapshot, prevent duplicates/data loss)
  await recomputeRank(runId);                          // step 5(cross-bucket gather)
  await recomputeRepoEntities(runId);                  // step 6a(independent within bucket, can be parallelized in batches)
  await recomputeOrgEntities(runId);                   // step 6b(cross-bucket gather + member carry-forward + derived search/index.json)
  await recomputeHeatmap(runId);                       // step 7
  await buildAliases(runId);                           // step 8(renamed old full_name → current id, for 308 redirect)
  await validateVersion(runId);                        // step 9
  await publishVersion(runId);                         // step 10(switch the views/latest.json pointer)
  await gcVersions(runId);                             // step 11(version GC, best-effort does not throw)
  return { runId, ok: true };
}

// web/lib/workflows/steps/recompute-rank.ts
async function recomputeRank(runId: string) {
  // independent step, explicit retry, idempotent
  // load all canonical/v2 month/week shards (Blob direct link) to build a period index → compute rank → write views/<runId>/rank/**
  // ⚠️ cross-bucket: rank/all-time/org all need every repo, cannot split by bucket (see §3.3 two recompute shapes)
}
```

> Implementation source see `web/lib/workflows/refresh.ts` (workflow orchestration)+ `web/lib/workflows/steps/*` (each step's implementation). Function names follow the code; tables in this document use "logical responsibilities" to describe them.

### 3.3 Step split principles

| Principle | How it lands |
|---|---|
| **Each step is short** | A single step stays within Function duration / memory (< 800s, < 4GB). Recompute is **batched by shard**: each rank-recompute step handles 1 period or 1 period batch, not "computing all periods at once". |
| **Each step is idempotent** | step input = `(run_id, shard range)`; output overwrites `views/<run_id>/` at a deterministic path. Rerunning the same `run_id` = overwriting the same artifact, not accumulating again (see §11). |
| **Blob checkpoints between steps** | After each step completes, write `ops/workflows/<run_id>/steps/<step>.json` (status + artifact list + counts). The checkpoint is a **business-readable** progress ledger, for operations / recovery. |
| **Large data uses Blob direct links** | Steps do not pass large payloads through Workflow (subject to the 4.5MB limit). A step only passes small identifiers such as `run_id` / shard key; data lands in Blob, and the next step reads it from the Blob direct link. |
| **Long waits use sleep** | On hitting a GitHub secondary rate limit / `Retry-After`, wait briefly inside the step; for hour-scale quota recovery use workflow `sleep('1 hour')`, and do not spin occupying resources. |
| **Ownership can be isolated** | The `active.json` lease carries an incrementing `fencing_token`, expires in 30 minutes, and active writes heartbeat at most every 5 minutes; canonical, checkpoint, and the publish pointer renew the lease and check `(run_id, fencing_token)` before every write. Renewal does ifMatch with the same response body+etag from origin `getOrigin()` (same class as live pointer #402 / #475: public GET / CDN cannot fence; when #499 week hop crosses isolates, do not compare only `head()` against a CDN GET and then drop the etag). Same-generation CAS 412 backs off and merges into a peer same-owner renew, and does not record a conflict that still holds the token as ownership loss. An old run that was taken over fails closed. |

> ⚠️ **Two recompute shapes (implementers must read)**: shards are bucketed by `repo_id % N`, but **not every recompute is self-contained within a bucket**—
> - **Independent within a bucket (can be parallelized by bucket in batches)**: **entity/repo** — each repo's entity file depends only on the data in its own bucket (monthly/weekly/recent-daily/meta), and can naturally be split into steps by bucket.
> - **Must cross-bucket gather (cannot split by bucket)**: **rank (any period needs all repos' same-period flow/stock), entity/org (member `repo_id`s are scattered across different buckets, see C2), all-time (full sort)** — these steps must first **load all `repo-monthly` (and `repo-weekly` when needed) buckets into memory to build an index**, then aggregate by period / owner. Full repo-monthly ≈ several MB (see §5.2); loading the whole set is far below 4GB and feasible; but **never mistakenly assume it can be finished within a bucket**.

---

## 4. Workflow pipeline responsibilities

| # | step | Read | Write | Notes |
|---|---|---|---|---|
| 0 | canonical readiness preflight | route: `meta.json` + 32 `repos` shards; workflow: all 128 required shards (runtime splits steps by 4-bucket windows) | none | The route, before lease/enqueue, verifies the repo lifecycle/anchoring/bucket contract required by the current model; the workflow, before any whitelist/canonical mutation, rechecks all shards, that time series are non-empty, and repo ID referential integrity. CF Workers must not read all 128 shards in a single invocation (1102). Mutation inputs of Workflow and of daily/weekly cron all use authoritative reads: only a confirmed 404 may mean missing; 403, timeout, and schema/pointer errors all fail closed. Preview `PREFLIGHT_RELAX_EMPTY_SHARDS=1` (policy `preview-empty-canonical-placeholder`) treats missing/empty shards as `{}` placeholders and does not void the whole run; production and a closed gate still fail closed. This is not a compatibility fallback for lifecycle / `d` / schema. The 2026-07 legacy lifecycle remediation goes only through [OPS](./OPS.md) §one-time canonical lifecycle provenance migration: reviewed dry-run first, then execute with an exact plan digest + shared fenced lease. |
| 1 | refresh whitelist | GitHub Search `stars:>=MIN_TRACKED_STARS` (default 10000; preview wrangler `env.pre` = 1000) + the whitelist snapshot of the currently published run | immutable `canonical/v2/whitelist/<run_id>.json` + diff; when sharded, also write mutable `ops/workflows/<run_id>/whitelist-search.json`; also write `ops/workflows/latest-unpublished-whitelist.json` | Search only does membership discovery: after an open-upper-bound query of the current highest star, bucket dynamically, with no 600k ceiling; snapshot `count` is this run's authoritative active count. Retries of the same run reuse the snapshot; a failed run does not advance the baseline. If the next run's `latest-unpublished-whitelist.json` points at an unpublished snapshot (and Search progress `minStars` still matches), reuse entries and do not search again. Preview `WHITELIST_SEARCH_SHARDS=1` splits Search into ≤10 min hops; each hop must finish within the `gitstarclub-jobs-pre` 15 min Queue wall; `0` / unset = the old single hop. The production default remains ≥10k until top-level / Vercel explicitly changes the gate. Opening a page still only reads precomputed data. |
| 2 | rename detection | old and new `repos/<bucket>` | rename map → `ops/workflows/<run_id>/renames.json` | repos whose full_name changed: record the old→new mapping; its delta is merged by the later build-aliases step into `lookup/aliases.json`, for 308 redirects on the repo page (see [FRONTEND.md](./FRONTEND.md)). **Runs before metadata**—metadata overwrites `full_name`, so rename detection must read the old value before the overwrite. canonical is merged by `repo_id`, so a rename does not lose history. |
| 3 | metadata shards (**by bucket, 1 step/bucket**, includes lifecycle) | run whitelist(Search membership/node_id/rename-aware identity)+ previous canonical/lookup | `canonical/v2/repos/<bucket>.json` (`active`/`tracked_since`/GraphQL metadata) + mutable `ops/workflows/<run_id>/metadata-<bucket>.json` | For **each active repo**, batch-fetch metadata + authoritative `stargazerCount` with GraphQL `nodes()`; if any active id lacks a GraphQL result, fail closed, and never fall back to Search stars. Previous rows are marked `active:false` first, then this run's entries are activated; drop history is retained, re-entry keeps the first `tracked_since`, and a first-time newcomer writes the snapshot discovery date. Each bucket persists progress in 100-id batches; GitHub GraphQL **502/503/504/429** (including `error code: 502` wording) and fetch timeout continue the same hop (lease is not released), and already-successful batches are not refetched; a single hop `markFailed` after at most **12** transients (8s→60s backoff). When the next run reuses the snapshot via `latest-unpublished-whitelist.json`, the snapshot carries `metadata_resume_run_id`, and metadata merges the old run's `fetched` and resets the transient count. At ≥1k a single bucket can far exceed two batches; do not fall back to single-hop Search. |
| 4 | canonical fold | **frozen snapshot** of closed periods `canonical/v2/pending/<period>.json` | `canonical/v2/repo-monthly/**` `repo-weekly/**` `site-daily/**` + `meta.json.folded_through` | **Fold**: when a period closes, fold the live tail net delta into month/week rollup shards; append site daily totals. **Handoff uses a watermark mark to prevent duplicates/data loss**—see §7.2 (H1): before cron resets `current_month.json` across periods, it first lands the previous period's complete `per_repo` into `canonical/v2/pending/<period>.json`; fold only reads pending, and after folding marks `folded_through=period`. `repo-recent-daily` does not participate in recurring fold (see §6.2 / issue #3). Dropped-out repos keep historical shards and stop polling. |
| 5 | rank recompute (**cross-bucket gather**) | all `repo-monthly`/`repo-weekly` + `repos`/`meta` shards | `views/<run_id>/rank/**` | Load all monthly/weekly buckets to build a "period→repos" index, compute flow/stock + all-time by period, and idempotently write staging. **growth**: period-start stock = the previous period-with-data value of monthly `stock_est` (§6.3), floor period-start ≥20k; **new**: use `repos.crossed_10k` directly for the current-period decision (**do not recompute separately with stock_est**, same definition as [RANKING.md](./RANKING.md) §4). Stock anchoring see §6.3 / [RANKING.md](./RANKING.md) §3. |
| 5a | category artifacts(**same gather as rank**) | `repos` + rank inputs already loaded by step 5 | `views/<run_id>/categories/**` + `lookup/categories.json` + `rank/category/**/all-time/repo/stock*.json` | Phase-1 deterministic category registry, repo assignments, public category lookup, and bounded page slices for all-time category stock ranks. Windowed category ranks stay out of Phase 1 to avoid a large view-count expansion. |
| 6a | entity/repo recompute (**independent within bucket**) | single-bucket `repo-monthly`/`repo-weekly`/`repo-recent-daily`/`repos` | `views/<run_id>/entity/repo/**` | Each repo depends only on its own bucket, and steps can be split in parallel by bucket. |
| 6b | entity/org recompute (**cross-bucket gather**) | all `repo-monthly`/`repo-weekly` + `repos` (owner→members) | `views/<run_id>/entity/org/**` + `lookup/**` + `search/index.json` | **Cannot compute by bucket**: the current org aggregate/curve uses only active members, while historical period rank may still keep the historical contribution of already-dropped repos; active member stock is carry-forwarded first and then summed, and the endpoint aligns to active `current_stars_sum`. repo lookup/search/entity also keep historical rows and propagate `active` / `tracked_since`. |
| 7 | heatmap update | `site-daily` shard (+ derived monthly total) | `views/<run_id>/heatmap/**` | Site-level daily / monthly totals (monthly total = sum of site-daily for the current month). |
| 8 | build aliases | all retained `ops/workflows/<run>/renames.json` + this run's `lookup/repos.json` | `views/<run_id>/lookup/aliases.json` | Cumulative alias table of old full_name → current id, for 308 redirects of renamed old URLs on the repo page. Union of historical renames deltas (gc does not delete ops/), self-healing, automatically covering renames from earlier runs; drop dangling / self-pointing / items that collide with a live repo name. |
| 9 | validate | `views/<run_id>/**` | `ops/workflows/<run_id>/validation.json` | Zod schema + sanity invariants (see the measured checklist in §8). **Do not publish if it does not pass**. |
| 10 | publish | `views/<run_id>/**` + immutable whitelist snapshot | immutable `publish-intent.json` + `views/latest.json` + `latest-success.json` + published whitelist pointer | intent fixes the original `prev_version`; all overwrites are idempotent, and retries will not produce `prev_version === version`. Check fencing ownership before every write, and actively invalidate the cache tag / route after completion. |
| 11 | gc | `views/latest.json` + `list(views/)` | `del views/<old version>/**` | **Version GC** (`gc.ts`, runs after publish): keep the latest 4 versions + the current / `prev_version` pointer (rollback target), and delete older orphan versions. **best-effort, never throw**—a cleanup failure does not take down an already-published run. |

> The table above enumerates **logical responsibilities**, and the order matches `web/lib/workflows/refresh.ts` exactly. **Fine grain = 13 real step-functions**: `preflight → whitelist → rename → metadata(per-bucket loop)→ fold → rank → repo-entities → org-entities → heatmap → aliases → validate → publish → gc` (no `revalidate`, no independent `newcomer` step—the workflow does not call `revalidatePath`, and newcomer tracking is folded into metadata's `tracked_since`). The run manifest collapses these responsibilities into 10 checkpoint steps (`preflight / whitelist / rename / metadata / fold / recompute / buildAliases / validate / publish / gc`), see [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.12.
>
> publish / rollback both call the same `invalidatePublishedViews()`: invalidate the pointer tag and the root layout; the 60s process memo cap is the worst-case propagation window, not the normal wait time.

---

## 5. Blob physical layout

> Continues the single PUBLIC store from [OPS.md](./OPS.md). Below lists only **prefixes directly related to the L3 Workflow lifecycle** and L1/L2 live generation. The complete Blob tree treats OPS as authoritative; root-level `current_month.json` / `hot-snapshot.json` are kept only as first-publish migration fallbacks, and new crons no longer overwrite them. `canonical/star_daily.parquet` has been downgraded to a bootstrap archive.

```text
blob://
├── bootstrap/
│   ├── latest.json                          # L4 single-file commit/rollback pointer
│   ├── generations/<generation>/            # sealed bootstrap payload; create-only
│   │   ├── manifests/{base,canonical}.json  # exact object count/bytes/SHA-256
│   │   ├── views/**                         # initial base view generation
│   │   └── canonical/{star_daily.parquet,v2/**}
│   └── overlays/<generation>/canonical/v2/** # L1/L3 canonical copy-on-write state
│
├── ops/workflows/                           # L3 Workflow checkpoints + meta info
│   ├── <run_id>/
│   │   ├── manifest.json                    # run meta info: trigger time, step list, overall status
│   │   ├── publish-intent.json              # immutable:version, original prev_version, published_at, fencing token
│   │   ├── steps/<step>.json                # checkpoint for each step (status + artifacts + counts)
│   │   ├── renames.json                     # rename mapping (rename step output)
│   │   ├── canonical-manifest.json           # record counts + SHA-256 integrity receipt of all required canonical shards
│   │   ├── validation.json                  # validation report (validate step output, see §8)
│   │   ├── metadata-<bucket>.json           # metadata GraphQL batch progress (resume after 502)
│   │   └── error.json                       # written on failure (markFailed, includes step + message, for debugging)
│   ├── active.json                          # current lease (ETag CAS + idempotency key + fencing_token + expiry)
│   ├── latest-unpublished-whitelist.json    # unpublished snapshot pointer (reuse Search after failure)
│   ├── latest-success.json                  # run_id of the most recent successful publish (recovery point)
│   └── health/                              # independent ETag-CAS health state per pipeline (no flat health.json)
│       ├── workflow-refresh.json            # Sunday 06:00 sole operator signal
│       ├── cron-daily.json
│       └── cron-weekly.json
│
├── canonical/v2/                            # production canonical (JSON shard)
│   ├── meta.json                            # seam_date · schema_ver · folded_through (week/month watermark, see §6.3/§7.2)
│   ├── whitelist/<run_id>.json              # whitelist snapshot + diff (produced each whitelist step)
│   ├── whitelist/latest.json                # compatibility pointer; advanced only on successful publish / rollback
│   ├── repos/<bucket>.json                  # repo dimensions + active/history + tracked_since + frozen anchor factor d
│   ├── repo-monthly/<bucket>.json           # per-repo month flow series (drives monthly rank + monthly curve)
│   ├── repo-weekly/<bucket>.json            # per-repo ISO week flow series (drives historical weekly rank)
│   ├── repo-recent-daily/<bucket>.json      # per-repo recent ~90-day daily points (curve tail + week boundary)
│   ├── site-daily/<yyyy>.json               # site-level daily totals (drives heatmap)
│   └── pending/<period>.json                # frozen snapshot of a closed, not-yet-folded period live tail (cron writes, fold step reads, see §7.2)
│   # (sibling canonical/star_daily.parquet is the bootstrap archive, only for L4 / disaster rebuild—see OPS §Blob layout)
│
├── live/                                    # L1/L2 atomic live tail
│   ├── latest.json                          # current complete generation + ETag/CAS lease/fence
│   └── generations/<run_id>/                # immutable; publishable only after all files + manifest are complete
│       ├── manifest.json
│       ├── current_month.json               # v2 index (schema_version=2, no per_repo)
│       ├── current_month/shards/<0-31>.json # repo_id % 32; reader assembles them into CurrentMonth
│       ├── hot-snapshot.json
│       ├── rank/** · heatmap/**
│       └── rollover/<period>.json            # cross-month pending recovery copy (optional)
│
└── views/                                   # publish layer (pointer switch)
    ├── latest.json                          # pointer: currently effective version prefix (version = run_id; see §7)
    └── <run_id>/                            # one run's complete view version (version=run_id, no separate staging/published)
        ├── meta.json                        # seam/fold watermark + active_repo_count/historical_repo_count
        ├── rank/**                          # all-period flow/stock + all-time (repo + org)
        ├── entity/repo/<id>.json            # per-repo entity (curve monthly + recent_daily + milestones)
        ├── entity/org/<login>.json          # per-org entity (sum after carry-forward)
        ├── heatmap/year/<yyyy>.json         # yearly heatmap
        ├── lookup/repos.json                # active + historical lookup table (includes tracked_since)
        ├── search/index.json                # client search index (see DATA-CONTRACTS §2.14)
        └── current_month.json               # current-month live-tail projection under this version's snapshot (read side may use it as fallback)
        # write finishes→validate→once the pointer points at it, it is live
```

Phase-1 category outputs under `views/<run_id>/`:

- `categories/registry.json`
- `categories/assignments.json` (v2 index; v1 monolith is still readable)
- `categories/assignments/shards/<0..31>.json`
- `lookup/categories.json`
- `rank/category/<dimension>/<slug>/all-time/repo/stock.json`
- `rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json` for page 2+

These are written by the rank recompute gather. Windowed category ranks are not
part of Phase 1 because they multiply the view count across every public
category and every historical week/month/year.

### 5.1 Read-path priority (how a page chooses a version)

The page / data layer first reads the `views/latest.json` pointer and resolves `<version>` (below, `V = views/<version>`, version = run_id), then fetches by "live first, fall back to base". **Key: use the `meta.folded_through` watermark to decide whether a period belongs to live or to base, avoiding double counting (§7.2)**:

```text
unfolded periods (period > folded_through, i.e. current / just closed and not yet published):
    rank/heatmap:  live/* (L1/L2 live tail) → fall back to V/* (previous version's base, which may not yet include this period)
folded periods (period ≤ folded_through, base already includes them):
    rank/heatmap:  read V/* directly (do not overlay live, prevent duplicates)
entity / lookup:    V/* (L3 published version)
hot-snapshot / current_month: read live/latest.json → live/generations/<generation>/*
```

> Page base views (rank/all-time/entity/heatmap/meta/lookup) go through `readView(path, schema, { base:true })`. The bootstrap pointer is read only when the managed pointer successfully returns a version, and the newer complete generation is chosen by `published_at`: after a managed publish, read `views/<version>/<path>`; after a newer bootstrap commit / rollback, read sealed `bootstrap/generations/<generation>/views/<path>`. Page reads keep the existing legacy flat tolerance when the managed pointer times out, fails non-404, or the shape is unusable; mutation inputs of Workflow/control-plane and of daily/weekly cron instead go through `readAuthoritativeView` / `readRequiredView`, and pointer or object 403/timeout/parse failures always throw; only a confirmed 404 may mean missing, and an overlay non-404 error never falls back to sealed bytes. live snapshot/rank/heatmap use an independent `live/latest.json`, then read `live/generations/<generation>/<logical-path>`; fall back to the old flat layout only when the live pointer is a true 404; when the pointer cannot be accessed/parsed, reuse the cached verified generation, otherwise fail closed. When a bootstrap pointer exists, logical `canonical/*` first reads `bootstrap/overlays/<generation>/canonical/*`, and falls back to the immutable generation seed only on a single-object 404; writes always go into the overlay. Thus recurring mutation does not change the sealed payload, and bootstrap rollback also restores that generation's canonical overlay. `ops/*` still uses flat. **The "live vs base" criterion is tightened by the `meta.folded_through` watermark** (period ≤ `folded_through` reads base directly, unfolded periods overlay live, §7.2), preventing double counting.

> ⚠️ **Both kinds of pointer reads must use a revalidating cache rather than `no-store`**: the base pointer defaults to 1h (some daily entries 1d), and the live pointer is 60s. `resolveLiveGeneration()` also has single-flight, so concurrent sibling reads on the same cold instance share one pointer result.

### 5.2 Bucketing (bucket) strategy

| shard | Bucket key | Bucket count (suggested) | Per-bucket size (estimate) | Recompute grain |
|---|---|---|---|---|
| `repos/<bucket>` | `repo_id % N` | 32 | ~165 repo / bucket, ~a few hundred KB | metadata step handles several buckets per step |
| `repo-monthly/<bucket>` | `repo_id % N` | 32 | ~165 repo × ~132 month points × ~20B ≈ **~430 KB** | rank/entity gather |
| `repo-weekly/<bucket>` | `repo_id % N` | 64 | ~82 repo × ~570 week points × ~22B ≈ **~1 MB** | historical weekly-rank recompute |
| `repo-recent-daily/<bucket>` | `repo_id % N` | 32 | ~165 repo × ≤90 daily points, ~a few hundred KB | bootstrap one-time seed; entity recompute is read-only; recurring fold currently does not age / prune (issue #3 chooses to document the status quo) |
| `site-daily/<yyyy>` | year | 1/year | 365 points, KB-level | heatmap step |

**Memory check**: cross-bucket gather steps (rank / entity-org / all-time) must load **all** buckets at once—
- All `repo-monthly`: 32 × ~430KB ≈ **~14 MB**; all `repo-weekly`: 64 × ~1MB ≈ **~64 MB**.
- Even loading monthly + weekly + repos together ≈ **&lt; 100 MB**, far below the Function **4GB** cap.
- Single-file reads use **Blob direct links** (bypassing the 4.5MB response-body limit), and a single `repo-weekly` bucket of ~1MB is also safe.
- Write side: full entities (~16k files) throttled at **75/s** ≈ 213s, but entity/repo is split into multiple steps by bucket (7a), and each step is only ~165 files ≈ 2–3s, not approaching 800s.

> Bucket count is a tunable knob: the goal is **a single bucket's JSON far smaller than Function memory, and a single step processing several buckets finishing within the duration**. When scale grows (whitelist expansion), increase the bucket count; do not change the logic.

---

## 6. Canonical shard model

### 6.1 Why JSON shards

Historically canonical = **a single `star_daily.parquet`** (per-repo×day, ~8 million rows). It can only be read by **DuckDB** (local native module, 4GB memory) to do a full precompute—this is the root cause of "depending on local compute". Production canonical is changed into **a set of small JSON shards that can be recomputed individually**. Each shard:

- **Pure JSON**: readable with `fetch` + `JSON.parse`, no native module, no engine.
- **Small**: a single shard is far below 4.5MB (large files are read via Blob direct link to bypass the response-body limit), and can fit entirely in Function memory.
- **Individually recomputable**: changing one repo bucket recomputes only that bucket, not the full set.
- **Pre-aggregated to the grain views need**: what production recompute needs is "per-repo month / week flow + cumulative stock" and "site daily totals", and it **does not need** the raw 8M rows of every repo every day.

### 6.2 Shard model

| Logical fact | History (Parquet column) | Production shard (JSON) | Who consumes |
|---|---|---|---|
| per-repo×day delta | `star_daily(repo_id,date,delta)` full | **not in production**: folded into the month/week rollups below; the raw daily table remains only as a bootstrap archive | — |
| per-repo×month flow | DuckDB `GROUP BY repo,month` | `canonical/v2/repo-monthly/<bucket>.json` = `{ "<id>": [[period, flow], ...] }` | monthly rank + entity monthly curve |
| per-repo×week flow | DuckDB `GROUP BY repo,ISO week` | `canonical/v2/repo-weekly/<bucket>.json` | historical weekly rank |
| per-repo recent 90-day daily points | DuckDB takes the recent 90 days | `canonical/v2/repo-recent-daily/<bucket>.json` | entity curve tail + week boundary |
| site-level daily totals | DuckDB `GROUP BY day` | `canonical/v2/site-daily/<yyyy>.json` | heatmap |
| repo dimensions + milestones | `repos` dimensions | `canonical/v2/repos/<bucket>.json` | lookup + entity meta + newcomers |

> **Key insight**: day grain is needed only at bootstrap (compute milestone threshold-crossing days + the first rollup into month/week). **Milestones are computed once and then frozen**; afterward the production system only **appends new-day deltas (cron live tail) and folds them into month/week shards when the period closes**. So **production canonical = month/week/site rollup shards + recent 90 days + repo dimensions**, all JSON, all small, all recomputable on Vercel. The raw 8M-row daily table is retired to a bootstrap archive.

> ⚠️ **recent-daily is not currently aged (consistent with issue #3)**: `repo-recent-daily` is **one-time seeded by bootstrap (`07-export-v2`)**, and the recurring `fold` step (`fold.ts`) **only folds month/week rollup + site-daily, and does not read, write, or prune `repo-recent-daily`**—there is no `repo-recent-daily` writer anywhere under `web/lib/`, only a reader (`io.ts:53`). Therefore the rolling aging mechanism "when a daily point slides past 90 days, merge it into `repo-monthly` and delete it from recent-daily" is **not yet implemented**; do not infer from this that seam dedup is already in effect. Seam continuity where the entity curve `monthly` (month points) meets `recent_daily` (day tail) is guaranteed by the recompute stage (both are net delta; the stock segment is anchored per §6.3), and does not depend on fold's pruning.

### 6.3 stock anchoring (must be split before and after seam, same definition as [RANKING.md](./RANKING.md) §3)

> ⚠️ **Key: `d` applies only to pre-seam gross; post-seam net is summed directly and is no longer multiplied by `d`**. This is the authoritative definition in [RANKING.md](./RANKING.md) §3; production shards copy it, otherwise the curve endpoint will not match `current_stars`.

- **Persisted `seam_date`**: `canonical/v2/meta.json` contains `seam_date` and `schema_ver` (see [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §1.4). seam = the gross→net boundary (bootstrap cutoff day).
- **Anchor factor** (per repo, frozen after bootstrap computes it): `d = current_stars@seam / cumgross@seam_date`, **the denominator contains only the pre-seam gross cumulative** (no net of any kind). The contract only requires `d >= 0`; when GitHub Archive undercounts, `d > 1` is allowed.
- **Pre-seam (history)**: `stock_est[period] = round(cumgross[period] × d)`, where `cumgross` = the prefix sum, inside the bucket, of that repo's month flow (gross). The endpoint (seam month) = `cumgross@seam × d = current_stars@seam`, exactly anchored.
- **Post-seam (net periods)**: `stock[period] = stock_est@seam + Σ(net flow from seam to period)`, **no longer multiplied by `d`**—net is the real increment and is tracked exactly (RANKING §3 "no longer estimated after seam").
- **Implementation**: each period in a repo-monthly bucket is marked gross/net (judged by `seam_date`); `d` is multiplied only into the gross-segment prefix sum, and the net segment is added directly. Pure JS, and single-bucket memory is controllable.

> That is: inside a production shard it is pure JS that "reads one repo bucket → prefix-sums in segments by seam (gross segment multiplied by d, net segment not multiplied)", the same definition as RANKING §3, and it does not need Parquet / DuckDB. **After bootstrap computes `d`, it is written into the `repos` shard and frozen; Workflow does not recompute `d` (to avoid net accumulation drifting the denominator).** Old DuckDB parity is used only for an equivalent cross-check where folded_through is not later than seam; post-seam correctness is asserted by an independent synthetic fixture.

---

## 7. Live overlay and publish pointer

### 7.1 L1 / L2 live overlay

L1 daily cron / L2 weekly cron first acquire the embedded lease in `live/latest.json`, then write one complete immutable generation; finally they switch with fenced CAS using the same pointer ETag. Acquiring the lease changes only `lease`, not `generation`, so any object-write failure will not expose a half set of views. The read side composites with the base view per §5.1:

- **Current / just-closed unfolded periods**: read the `live/*` overlay (if falling back to base, base does not yet include that period, so the live tail will be missing).
- **Already-folded periods**: read base (`views/<version>/*`), and do not overlay live, avoiding double counting.

Each live generation contains only the current week/month files produced by this refresh, not a copy of every unfolded period. Period-shaped rank / heatmap first read the pointer's current generation; when an object is a confirmed 404, the read side walks back along the immutable manifest's `previous_generation` with a bound (at most 64 generations, cycle detection, and a consistency check of manifest generation/files). If the requested week/month is newer than the period the hop declares, stop immediately (an older generation cannot have that period). Only after the chain reaches `null` does it try migration-era flat `live/*`. If the manifest declares a file but the read is 404, or pointer/manifest/transport/schema/cycle is abnormal, always fail closed. When the scan hits the 64-generation cap and has not yet reached `null`, truncate as missing (return null; the page falls back to base / empty state, does not 500, and does not guess legacy). A public-CDN 403 under high-concurrency SSG is not missing: a page read tries the same historical object at most 2 times, and after a 60-second circuit break by Blob/key stops the whole live chain and hands off to base / `notFound`; the circuit breaker recovers automatically, and must not be used as a chance to fetch an older generation. The required product gate still treats 403 as failure. `current_month` / `hot-snapshot` remain single-generation snapshots, and historical fallback is forbidden.

L1/L2 and L3 write different Blob prefixes (`live/generations/*` vs `canonical/v2/**` + `views/<run_id>/**`); the prefixes do not overlap, and during L3 recompute L1/L2 keep refreshing the live tail as usual. The default idempotency key is `<job>:<UTC-day>`; same-key running/committed attach / return directly respectively, and a different key while active returns 409. A manual same-day extra refresh uses an explicit new key.

### 7.2 Period-close handoff contract (prevent duplicates / data loss)

The `current_month.json` inside a generation initializes a new month when crossing months, so the previous period's data must be landed in durable storage before the pointer switch:

| Step | Who | Action |
|---|---|---|
| 1. Freeze the previous period | **L1/L2 cron** (the cross-period run) | Detect that the old generation's month ≠ this month → fix `frozen_at` at UTC day 00:00, write `canonical/v2/pending/<old period>.json` before the pointer commit, and put the same payload into the new generation's `rollover/<period>.json`. Retries are byte-equivalent; even if the generation fails afterward, the old pointer remains readable. |
| 2. Fold | **L3 fold step** | Read only `canonical/v2/pending/<period>.json` (already frozen, no longer changing) → fold into `repo-monthly`/`repo-weekly` → mark `folded_through=period` (write `canonical/v2/meta.json`). |
| 3. Prevent duplicates | **Read path §5.1** | Already-folded periods (`≤ folded_through`) read only base (already includes that period); unfolded current / just-closed periods read the live overlay. **The same period is never counted as both live and canonical.** |

> Thus: ① the previous month's last-day net always enters pending before being overwritten → **not lost**; ② base and live fetch **mutually exclusively** along the `folded_through` watermark line → **not duplicated**; ③ pending is a frozen snapshot, and cron does not touch it while L3 is folding → what step 5 reads is a stable input. `folded_through` is both the week and month watermarks (week closes earlier than month).

### 7.2a Live generation atomic publish and failure semantics

```text
1. CAS live/latest.json, write a 15m lease (generation keeps the old value)
2. Generate and Zod-validate all payloads
3. Sequentially write live/generations/<run_id>/** (allowOverwrite:false)
4. Write immutable manifest.json last
5. Use Blob API `head()` to check the origin etag recorded at claim time (do not public GET the pointer body)
6. Fenced CAS with that origin ETag: generation=<run_id>, lease=null
7. revalidatePath / IndexNow / sync-run log only after commit succeeds
```

- Any prerequisite/data/manifest/pointer write failure makes the reader keep resolving the old
  `generation`; a partial generation is an invisible orphan.
- When the same run retries and hits an existing immutable file, accept only **exactly the same bytes**; a content conflict
  fail closed. A writer whose lease has expired or been replaced has no authority to clear the lease or switch the pointer.
- The pointer's `previous_generation` keeps a one-hop operations rollback target; each immutable manifest
  field of the same name also forms the read-side history chain of period files. Read-side walk-back is a bounded query, and does not change the rollback command
  still accepting only an explicit one-hop target. live GC is not in this issue yet; do not delete generations the history chain might
  reference, current/previous, or that carry an active lease.
- `hot-snapshot.freshness` marks source-as-of per section; a carry-forward section must not
  use this run's time. A date-dependent old `on_this_day` that does not match the current UTC month-day is cleared.

### 7.3 Publish pointer model (atomic pointer swap)

> **Version prefix = run_id, with no separate staging/published two-stage**. Recompute writes directly to `views/<run_id>/**` (a new prefix, which does not affect what is live); until the pointer references this version it is invisible to the read side, equivalent to "staging". publish goes live by atomically overwriting a single pointer file—saving one full copy (~12,899 files).

```text
1. step 6–8 recompute artifacts are written to views/<run_id>/** (version = run_id, does not affect what is live)
2. step 9 validate: run Zod + sanity on this version (see TESTING)
   └─ does not pass → throw and stop, the pointer was never switched; views/<run_id> becomes an unreferenced orphan, kept for debugging / later GC
3. step 10 publish first creates immutable `ops/workflows/<run_id>/publish-intent.json`, fixing the first-read
   `prev_version` and `published_at`. Only a confirmed 404 of `views/latest.json` means first publish; timeout / 5xx /
   schema error is always thrown, and must not be downgraded to `prev_version=null`.
4. Using the intent's fixed values, first idempotently switch `views/latest.json`, the logical commit point, and after success sync
   `ops/workflows/latest-success.json` and `canonical/v2/whitelist/latest.json`. Before any write, check the current
   fencing token; if a later write fails, the retry still writes the exact same pointer, and never misrecords the current run as its own
   rollback target. The next run's baseline follows the commit point directly.
5. Call `invalidatePublishedViews()`: clear this instance's memo and immediately invalidate the `published-views-pointer` tag,
   and `revalidatePath('/', 'layout')`. Normal requests pick it up immediately; other warm instances pick it up within 60s at latest.
```

### 7.4 `views/latest.json` pointer contract

```jsonc
{
  "version": "refresh-2026-06-02T15-48-35-661Z",   // = run_id(version prefix views/<version>/)
  "run_id": "refresh-2026-06-02T15-48-35-661Z",
  "published_at": "2026-06-02T15:59:13.901Z",
  "prev_version": null,                              // previous version (null on first publish), for one-click rollback
  "schema_ver": 1
}
```

- **Read side**: the data layer first reads `views/latest.json`, resolves the `version` prefix, then reads the immutable views under that prefix. The pointer fetch carries the `published-views-pointer` cache tag.
- **Atomicity**: switching the pointer is a **single-file overwrite**; the worst case is one request reading a pointer one version behind (the old version's data is still self-consistent), with no half-publish risk.
- **Visibility SLA**: `PUBLICATION_VISIBILITY_SLA_MS = 60_000` caps every in-process memo, even when a page uses a 1h / 24h pointer data-cache TTL to avoid shortening ISR lifetime. publish / rollback actively invalidate the shared tag and route; existing instances that cannot receive this active signal also re-resolve the pointer within ≤60s.
- **mutable read**: reads of `canonical/**`, `ops/**`, and `views/latest.json` directly always use `cache:'no-store'` + per-read cache-bust (also bypassing the Blob CDN's short overwrite cache); only immutable `views/<version>/**` keep `force-cache`.

### 7.5 L4 bootstrap publication pointer

`06-upload` and `07-export-v2` no longer overwrite flat production paths. The two steps share one explicit `bootstrap-<id>`, and respectively create-only stage the `base` / `canonical` phase; each phase's sealed manifest fixes the object path, exact bytes, and SHA-256. On a network failure in the same generation, only missing objects are filled in; existing objects must be byte-identical, otherwise fail closed.

`07` completes the following order before commit: recheck both remote manifests and every object → Zod-validate all local views, canonical meta/site-daily, and the `4 × 32` required shards → ETag CAS on `ops/workflows/active.json` to acquire the fenced lease shared with managed refresh → re-read the current pointer inside the lease; a first commit must also verify legacy flat's key base artifacts and all bucketed canonical families → single-file overwrite of `bootstrap/latest.json`. Only the last step changes the read side; any earlier failure leaves an invisible generation, and what is live still fully points at the old state.

```jsonc
{
  "schema_ver": 1,
  "generation": "bootstrap-20260717T120000Z",
  "prefix": "bootstrap/generations/bootstrap-20260717T120000Z",
  "previous_generation": "bootstrap-20260710T120000Z",
  "published_at": "2026-07-17T12:10:00.000Z",
  "base_manifest_sha256": "<64 lowercase hex>",
  "canonical_manifest_sha256": "<64 lowercase hex>"
}
```

The read side first looks at the copy-on-write canonical overlay bound to the generation, then falls back to the sealed seed; thus the generation body itself never changes, while pointer rollback restores the old generation and its overlay. `previous_generation:null` does not mean there is no recovery point; it is the retained `legacy-flat` recovery edge. The rollback command must name the target explicitly: `--rollback <generation> --execute`, or, after the first publish, `--rollback legacy-flat --execute`. The sealed generation is verified before the lease; mutable legacy flat is rechecked inside the lease, then restored by atomically deleting the pointer. When a pointer write/delete already succeeded but the response was lost, a retry of the same target returns `already-rolled-back` and does not flip the other way.

---

## 8. Validation gate (validate)

Before the pointer switch, the validate step **samples** `views/<run_id>/**` and **does not publish if it does not pass**. Below is the checklist actually executed by `web/lib/workflows/steps/validate.ts`—the code is authoritative, and this document only records what the code does:

### 8.1 Checks actually executed now

- **Zod schema validation** (each file, when read, is validated field by field against the [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2 contract; any file whose schema parse fails is counted in `schema_failures` and added to `failures`):
  - `views/<run_id>/meta.json` (contract `Meta`)
  - `views/<run_id>/rank/all-time/repo/stock.json` (contract `RankList`)
  - `views/<run_id>/rank/all-time/org/stock.json` (contract `RankList`)
  - `views/<run_id>/lookup/repos.json` (contract `ReposLookup`)
  - `views/<run_id>/lookup/orgs.json` (contract `OrgsLookup`)
  - `views/<run_id>/search/index.json` (contract `SearchIndex`)
  - `views/<run_id>/categories/registry.json` (contract `CategoryRegistry`)
  - `views/<run_id>/categories/assignments.json` (contract `CategoryAssignmentsDocument`: v2 index or v1 monolith)
  - `views/<run_id>/categories/assignments/shards/<bucket>.json` (contract `CategoryAssignmentsShard`; UTF-8 JSON **< 1.50 MiB**)
  - `views/<run_id>/lookup/categories.json` (contract `CategoriesLookup`)
  - `views/<run_id>/rank/category/<sample>/all-time/repo/stock.json` (contract `CategoryRankList`)
  - `views/<run_id>/entity/repo/<id>.json` (contract `RepoEntity`, full lookup set; top repos are also sampled for a non-empty curve)
  - `views/<run_id>/entity/org/<login>.json` (contract `OrgEntity`, full lookup set)
  - `views/<run_id>/heatmap/year/<lastYear>.json` (contract `Heatmap`, previous calendar year sample)
- **Sanity invariants** (asserted separately, beyond schema validation; failure throws and stops the workflow):
  - **`meta.seam_date` exists** (boolean truthy);
  - **`meta.folded_through` is monotonic**: if the previous published version has `folded_through`, the new version's month/week must not go backward;
  - **rank list integrity**: staging `all-time` repo/org rank checks that rank is contiguous from 1, `value` is non-increasing, there is no duplicate rank, and there is no duplicate `id/login`;
  - **Referential integrity**: a repo rank item's `id` must exist in `lookup/repos.json`; an org rank item's `login` must exist in `lookup/orgs.json`;
  - **repository lifecycle**: every ID in `lookup/repos.json` matches canonical exactly; the three sets of whitelist entries, canonical `active:true`, and lookup `active:true` are exactly equal; `meta.active_repo_count == whitelist.count`, and `meta.historical_repo_count == lookup active:false`; a drop must be retained and be historical, and an inactive re-entry may be reactivated as `diff.added`;
  - **`lookup/aliases.json`**: no dangling / live-shadow, and the alias count does not regress relative to the previous published version (buildAliases must scan every workflow run folder; a read error fails, and a missing `renames.json` counts as an empty delta);
  - **canonical integrity**: every bucket of `repos` / `repo-monthly` / `repo-weekly` / `repo-recent-daily` must exist and pass schema; the repo key must equal the row `id` and fall in the correct bucket; the three time series must not be entirely empty, and must not reference an ID outside `repos`; output `canonical-manifest.json` (record count + SHA-256); any missing item or error blocks publish;
  - **`d` of `canonical/v2/repos/*`**: `d > 2` is warning only; a historical repo missing a finite `d` is a hard failure; a newcomer repo with `tracked_since` explicitly starts at `d=0`;
  - **`search/index.json`**: `count ≥ MIN_LOOKUP` (=1000), `count === repos.length`, and each entry explicitly propagates `active` / `tracked_since`;
  - **category views**: `registry` is non-empty and has public categories; assignments cover ≥ `MIN_LOOKUP`; `language`/`language_family` has at least one per repo, and `owner_kind` is a single value per repo; every assignment reference exists in the registry; every repo in a sampled category rank belongs to that category; the real JSON byte length of the index and of each shard is < 1.50 MiB;
  - **entities**: before writing Blob, recompute fully Zod-parses every `RepoEntity` / `OrgEntity`; validate then reads the full lookup set again. `stock_est` must not be negative (do not relax `MonthlyPoint`). Top repos also require `curve.monthly` length > 0, and explicitly propagate `active` / `tracked_since`;
  - **Previous calendar year's heatmap exists**: `heatmap/year/<UTCFullYear - 1>.json` can be read (the prior calendar year is always already closed).
- **Output**: `ops/workflows/<run_id>/canonical-manifest.json` + `validation.json` (the latter's contract is `WorkflowValidation`, containing `run_id` / `ok` / `checked` / `schema_failures` / `invariants` / `failures`). Any integrity / sanity failure → `failures` non-empty → throw; the publish step does not start, and the version prefix is left as an orphan pending GC.

Validation does not pass = the pointer was never switched = what is live stays the previous version, **no half-publish risk**.

### 8.2 Invariants not enabled (future work)

The following checks were listed as "hard invariants" in an early design draft, but **`validate.ts` does not implement them now**—they are either too expensive (a full traversal), or they depend on sync semantics between the L1 cron and the L3 fold (the runtime has separate detection/alerting), and they are kept as future enhancements and must not be misread as already in effect:

- ~~rank file count matches the period set~~ — currently it samples all-time repo/org rank, and does not enumerate every historical period.
- ~~org stock endpoint = members' `current_stars_sum` (carry-forward equation)~~ — not inside validate; the definition relies on invariants inside the recompute step (see [RANKING.md](./RANKING.md) §5).
- ~~the entity curve monthly / recent_daily seam is continuous at the 90-day watermark~~ — only samples that a top repo's `monthly` is non-empty, and does **not** check the monthly↔recent_daily seam.
- ~~seam continuity of the monthly rank / recent daily rank~~ — not inside validate; seam anchoring is guaranteed by the recompute stage (§6.3).

> To strengthen any one of these, change `validate.ts` directly and update this section in sync; do not claim in other documents (such as TESTING) that it is already in effect.

---

## 9. Failure modes and rollback

### 9.1 Invariants

| Invariant | How it is guaranteed |
|---|---|
| **Each step is idempotent** | step output overwrites a path determined by `(run_id, shard)`; rerunning the same `run_id` and the same shard = overwriting the same artifact, not accumulating again. |
| **Rerunning the same `run_id` does not write bad data** | the version prefix contains `run_id`; rerunning the same run only overwrites its own `views/<run_id>`, and does not touch an already-published version. |
| **Failure affects only that version prefix** | before the pointer switches, what is live is the previous version pointed at by `views/latest.json`; any step failure does not affect what is live. |
| **`ops/workflows/latest-success.json` is the recovery point** | it records the run_id of the most recent successful publish; a new run incrementally recomputes starting from its canonical state. |
| **publish retry keeps the rollback target** | immutable `publish-intent.json` records the original `prev_version` before the pointer is switched; if the pointer has switched but a later write fails, the same-run retry replays the intent. A non-404 pointer read failure aborts directly. |
| **whitelist discovery ≠ publication** | the `<run_id>.json` snapshot is immutable; the next run finds the baseline through the published `views/latest.run_id`, and a failed run never becomes the baseline. `tracked_since` takes the snapshot's `generated_at` date. |
| **An expired owner must not keep writing** | lease takeover increments `fencing_token`; canonical / ops / pointer renew and check before a write. A failed release throws and enters the alert/error path, and is no longer silently ignored. |

### 9.2 Recovery paths

- **A step fails**: the runtime explicitly retries ordinary async steps (network errors). The business side writes an `ops/workflows/<run_id>/steps/<step>.json` checkpoint for each step. A lease **ownership** error (token / run_id / expiry) fails closed and is not retried. Same-generation ETag CAS exhaustion is retryable (`WorkflowLeaseCasError`), and is not loss of ownership.
- **A whole run is stuck / times out**: the lease expires in 30 minutes, and active writes heartbeat every ≤5 minutes. After a new run's CAS takeover the fencing token increments; the old run's next write or publish fails closed. Operations read the owner from the manifest / active lease, and must not manually reuse the old token.
- **GitHub rate limiting**: inside a step, on `403` / secondary limit / `Retry-After`, wait briefly and retry; do not spin.

### 9.3 Rollback

| Scenario | Action |
|---|---|
| New-version data is bad (already published) | Call the Bearer-authenticated `POST /api/workflows/refresh/rollback`, explicitly passing `target_version` and a stable `idempotency-key`. This path acquires a fenced lease, persists the rollback intent, syncs the recovery / whitelist pointer, and actively invalidates cache. Do not hand-edit the Blob pointer anymore. |
| Validation did not pass (not published) | No rollback needed: the pointer was never switched, and what is live stays the previous version; the orphan `views/<run_id>` is kept for debugging. |
| Deployment-layer problem | Vercel keeps historical deployments; Promote the previous healthy deployment (see [OPS.md](./OPS.md) rollback). |

- **Copies retained**: `views/<version>` keeps the most recent N copies (for example 4); old versions / orphans are cleared by GC. The manual tool `web/scripts/blob-del-prefix.ts <prefix>` by default only prints the exact count/bytes of the full inventory; deletion must additionally supply `--execute --confirm <the same prefix>`.
- **Order**: go through the rollback API first → within the 60s SLA, use cache-bust to check the pointer / page → redeploy if needed → check that workflow artifacts and drift are back to normal.

### 9.4 Version garbage collection (GC)

step 11 (`gc`) runs after pointer publish and before the owning refresh lease is released, and reclaims old version prefixes:

- **Retention policy**: the latest 4 versions of `views/<version>` + the current pointer + `prev_version` (rollback target).
- **Delete targets**: `list(views/)` lists every `<version>` prefix, excludes the retention set, then `del`s prefix by prefix through the shared protection helper. Each chunk, inside the same fenced lease, renews, re-reads current / rollback protection, and proves ownership again before deleting; publish / rollback cannot cut in between the check and `del`.
- **best-effort, never throw**: a cleanup failure is only logged, and does not take down an already-published run. The next run retries clearing the same batch of orphans.
- **Manual cleanup**: `web/scripts/blob-del-prefix.ts <prefix>` is preview only; after confirming the exact count/bytes, use `--execute --confirm <prefix>` to delete allowed temporary verify / orphan generations. execute acquires the same fenced lease and rechecks protection chunk by chunk. The tool refuses canonical, ops, live, pointer, and wide containers, and also refuses views, bootstrap payloads, and overlays that are current / active / rollback-target.

---

## 10. Newcomer repo history strategy

How is the **historical star curve** backfilled for a newcomer repo (the first time star ≥ 10,000 after launch, and not in the bootstrap baseline)? Three options, each with a tradeoff:

| Option | How | Completeness | Speed / quota | Vercel-first? | Introduces a bill? |
|---|---|---|---|---|---|
| **A conservative (default)** | track from **the day it enters the whitelist**; the entity page marks `tracked_since`, and there is no curve before that day | only after the discovery day | fast, no external quota | yes, pure Vercel | no |
| **B GitHub stargazers API** | Workflow paginates `GET /repos/{o}/{r}/stargazers` (`Accept: application/vnd.github.star+json` to get `starred_at`) and aggregates by day to backfill history | fairly complete, but with a hard cap | **slow and limited** (see below) | yes, pure Vercel (slow) | no |
| **C BigQuery rerun** | rerun the GH Archive extract for the new repo_id (including a stable repo.id and gross adds) | **most complete** | one-time, needs a human | ❌ introduces GCP | **yes (~a small amount + a GCP account)** |

### 10.1 An honest statement of the limits

- **Hard limit of option B**: GitHub stargazers pagination is **at most about 400 pages × 100 = 40,000 stargazers**—a repo with more than 40,000 stars **cannot fully fetch** its early history. And under the REST **5,000 requests/hour** quota, a 40,000-star repo = 400 requests ≈ one repo consumes 8% of the hourly quota, and is **very slow**; it has to batch across quota windows with Workflow `sleep('1 hour')`, and may take hours to days. It is realistically feasible only for **small / new** repos (stars not far above 10,000).
- **Option C is the most complete but violates Vercel-first**: querying GH Archive with BigQuery is the only source that can precisely obtain "any repo's gross adds on any historical day + a stable repo.id", but it **introduces a GCP account and cost**, which conflicts with "avoid scattered bills", so it can only be a **manual one-time bootstrap / rebuild** tool (L4), and does not enter the recurring production path.

### 10.2 Recommended tradeoff

- **Default to option A (conservative)**: the existing bootstrap historical baseline is **kept**; a newly added repo is **tracked from the discovery day**, and the page honestly marks `tracked_since` (the same definition as the About page's "survivorship bias / as-of", see [ARCHITECTURE.md](./ARCHITECTURE.md) data definition).
- **Option B as an optional best-effort enhancement**: for a newcomer repo whose star count is not too large, Workflow may along the way call the stargazers API to backfill an approximate stretch of history; on failure / hitting the limit it degrades back to option A (mark `tracked_since`), and **never** blocks the main flow in order to backfill history.
- **Option C is run manually once only when "a large-scale backfill / baseline rebuild" is required** (L4 bootstrap); after the artifact is uploaded, L3 takes over, and it is not made routine.

---

## 11. Cost boundaries

> A Workflow step itself is billed by usage ([Workflows Pricing](https://vercel.com/docs/workflows/pricing):Events / Data Written / Data Retained); the real bulk is **Function compute + Blob IO + GitHub API time**. The design must actively control these three.

| Cost item | Driver | Control |
|---|---|---|
| **Function compute** | step count × duration per step | batch steps by shard and control the total step count; I/O waits (GraphQL / Blob) do not count as active CPU, but active compute must be controlled (prefix sums / sorts are done inside the bucket, and buckets are not too large). |
| **Blob write rate / volume** | number of view files written by recompute | obey the **75/s write cap** ([OPS.md](./OPS.md)); batch puts limit concurrency + throttle; write only **shards that changed** (diff-aware), and do not fully rewrite 16k+ files every time. |
| **Blob storage / retention** | number of published historical versions | keep only the most recent N published copies; clean up old versions. canonical shards are small (tens of MB). |
| **GitHub API time** | metadata / stargazers calls | GraphQL `nodes()` is 100/query, and scalar fields are cheap (about 5,302 repos ≈ 54 queries ≈ 1% of the hourly quota); stargazers (option B) are limited to 5,000 req/hr and are batched with sleep. |
| **Page regeneration** | cold generation after revalidate | **do not generate 16k pages at once**; keep using ISR / revalidate, and a long-tail first visit cold-generates once (it reads a KB view, which is negligible). |

**Hard constraints restated**:
- A single Function ≤ 800s / ≤ 4GB / bundle ≤ 250MB / response body ≤ 4.5MB—**so a full recompute must be sharded by Workflow, and large files use Blob direct links**.
- Do not put any Workflow / engine on the request hot path; the runtime forever only reads static JSON (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

---

## 12. Design acceptance

- [x] The production data lifecycle (whitelist / metadata / rename / newcomers / canonical fold / recompute / validation / publish / rollback) **entirely** has a Vercel landing point, and no recurring step requires local compute.
- [x] Clearly distinguish four layers: L1/L2 live cron · L3 Workflow (month+week fold / recompute / publish / version GC) · L4 `pipeline/backfill` archive.
- [x] The Blob checkpoint / version prefix / publish pointer / rollback patterns are clearly defined (§3, §5, §7, §9).
- [x] canonical is redesigned from a single Parquet into JSON shards, and production recompute does not depend on DuckDB / Parquet (§6).
- [x] The three-option tradeoff for newcomer repo history is written honestly, defaulting to conservative + `tracked_since` (§10).
- [x] Costs / limits (Cron, Function 800s/4GB/250MB/4.5MB, Workflow, Blob 75/s, GitHub quota) are written clearly (§1.3, §11).
- [x] BigQuery/GCP is one-time bootstrap only, and is not on the recurring production path.
