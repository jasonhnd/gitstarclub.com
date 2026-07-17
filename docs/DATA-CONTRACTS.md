---
owner: data contracts
status: active
last_reviewed: 2026-07-17
source_of_truth_for:
  - canonical JSON shard schemas
  - JSON view schemas
  - build-side data types
---

# gitstarclub 数据契约（canonical JSON shard + JSON 视图）

## Scope

本文是 **数据层与 build 之间的接口契约**，给每个 canonical shard 与 JSON 视图的**精确 schema**——字段、类型、口径、引用关系，并作为 `web/lib/contracts/` Zod 定义的事实源。新增产物 / 改字段 / 调口径前必读。
物理形式、取舍与生成流水线见 [ARCHITECTURE.md](./ARCHITECTURE.md)「数据模型」与 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)；前端如何消费见 [FRONTEND.md](./FRONTEND.md)；榜单口径细则见 [RANKING.md](./RANKING.md)；本文不涉及部署、运维、cron 调度（见 [OPS.md](./OPS.md)）。

> ⚠️ **canonical 形态**：§1 的 `star_daily.parquet` 是 **bootstrap 归档**形态。**生产 canonical = §1.4 的 JSON shard**（Vercel 可重算、无引擎）。Workflow / checkpoint / 发布指针契约见 §2.11–2.13。

## Requirement Traceability

[REQUIREMENTS.md §0](./REQUIREMENTS.md#0-需求-id--优先级--追踪矩阵) owns priority and acceptance language. This table identifies which JSON contracts provide evidence for each requirement.

| Requirement ID | Contract artifacts | Contract responsibility |
|---|---|---|
| `REQ-CHRONICLE-001` | `rank/**`, `entity/repo/{id}.json`, `entity/org/{login}.json`, `heatmap/{year|month}/{period}.json`, `lookup/**` | Historical and entity pages can join stable ids/logins to versioned ranking, curve, heatmap, and lookup views. |
| `REQ-PULSE-001` | `live/latest.json`, `live/generations/{run_id}/**`, `ops/sync-runs.json` | Daily movers and pulse pages consume one complete, freshness-labelled live generation independent of full recompute. |
| `REQ-RANKING-001` | `rank/{window}/{period}/{dim}/{metric}.json`, `rank/all-time/{dim}/stock.json`, derived `growth` / `new` rank files | Rank item shape, metric semantics, id-vs-login exclusivity, ordering, continuity, and top-N rules are schema-visible. |
| `REQ-I18N-001` | All data views; no translated repo/org data fields | Data contracts remain language-neutral so frontend locale routes can localize chrome/meta without mutating source facts. |
| `REQ-DATAOPS-001` | `bootstrap/latest.json`, bootstrap phase manifests, `views/latest.json`, `ops/workflows/{run_id}/manifest.json`, `ops/workflows/{run_id}/validation.json`, `ops/workflows/latest-success.json` | Bootstrap and recurring published versions, validation gates, checkpoints, and rollback pointers are explicit artifacts. |
| `REQ-PERF-001` | Budgeted JSON service views, lookup-only rank joins, `/repo-curve` projection | Frontend reads small, precomputed views instead of loading engines or full canonical shards on request paths. |
| `REQ-SEARCH-001` | `search/index.json` | Search has a versioned, compact client index with one document per tracked repo. |
| `REQ-COMPARE-001` | `/repo-curve?id=<id>` projection from `entity/repo/{id}.json` | Compare reuses entity curves and returns only the slim curve payload needed by the client. |
| `REQ-CATEGORY-001` | `categories/registry.json`, `categories/assignments.json`, `lookup/categories.json`, `rank/category/**` | Category pages are driven by public registry and assignment artifacts, with paged all-time rank views. |

## 全局约定

- **日期**：一律 UTC，`YYYY-MM-DD`。
- **周期标识 `period`**：周 = `WeekPeriod` ISO 周 `YYYY-Www`（如 `2024-W42`）；月 = `MonthPeriod` `YYYY-MM`；年 = `YearPeriod` `YYYY`；全时 `all`。
- **主键**：repo = GitHub 数字 `repo_id`（不可变，跨改名稳定）；org = `owner` login 字符串。
- **数值**：整数。`delta` / flow 在 seam 后为 net，**可为负**（取消 star）；stock（累计）非负。
- **契约硬线**：`current_stars` / `current_stars_sum` / `stars` / count 类字段非负；`RankItem.value` 仍可为负（net flow）。`RankItem` 必须且只能携带 `id`（repo）或 `login`（org）之一。
- **文本与时间**：`DateStr` 日期字段使用 UTC `YYYY-MM-DD`；`TimestampStr`（`generated_at` / `published_at` / checkpoint 等）使用带时区的 ISO timestamp。自由文本字段由 React 渲染层转义，同时契约拒绝高风险 active HTML 片段（script/iframe/style 等）。
- **引用 vs 内嵌**：排行榜 JSON 只存实体 **id/login + 数值**，不内嵌名字/描述；build 用 `lookup/*` join 出展示字段 → 榜单文件保持小、改名只需更新 lookup。
- 每个 JSON 带 `meta`（至少 `generated_at`，视图另含 `period/window/dim/metric`）便于缓存与调试。

---

## 1. Canonical（仅数据层触碰：§1.1–1.3 bootstrap Parquet 形态；§1.4 生产 JSON shard）

### 1.1 事实表 `canonical/star_daily.parquet`（🗄️ bootstrap 归档形态）

bootstrap 唯一真相源；生产阶段折叠成 §1.4 的月/周 JSON shard，日表本身退为归档、不在生产读 / 重算路径。

| 列 | 类型 | 说明 |
|---|---|---|
| `repo_id` | INT64 | GitHub 数字 id（不可变主键） |
| `date` | DATE | UTC 日 |
| `delta` | INT32 | 当日 star 增量；seam 前 gross（≥0，GH Archive WatchEvent 计数）、seam 后 net（GraphQL 日差，可负） |

- 逻辑 PK `(repo_id, date)`；按 `repo_id` 排序/分区，利于按 repo 聚合。
- ~800 万行 / 列存 ≈ 几十 MB。**不含进行中当月**——当月在 `current_month.json` 活尾（§2.8），build/cron 合并。

### 1.2 `repos` 维度（→ 同时导出 `lookup/repos.json`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | GitHub 数字 id（主键） |
| `node_id` | string | GraphQL 全局 id（批量 `nodes()` 用） |
| `owner` | string | 属主 login |
| `owner_type` | `"User"\|"Organization"` | 决定 org 榜归类 |
| `name` | string | repo 名 |
| `full_name` | string | 当前 `owner/name`（改名更新；URL 用它，旧 URL 308） |
| `description` | string\|null | |
| `language` | string\|null | 主语言 |
| `topics` | string[] | |
| `created_at` | DateStr\|TimestampStr | repo 创建日期；canonical shard 可保留 GitHub `createdAt` timestamp，entity 视图裁成 `YYYY-MM-DD` |
| `current_stars` | int | GraphQL 权威当前总数（**唯一必须精确的数**） |
| `active` | bool | 是否属于本次 GitHub Search 发现集。`false` = 仅历史保留，不参与当前轮询、当前总量或全时/分类榜 |
| `is_archived` | bool | |
| `crossed_10k/50k/100k` | DateStr\|null | 首破里程碑精确日期（供"历史上的今天"） |
| `tracked_since` | DateStr\|null | 首次进入白名单 / 开始追踪的日期。bootstrap 基线 repo 为 `null`（有完整历史）；新晋 repo = 首次发现日；drop 后 re-entry 保留原日期（页面据此标注，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §10） |
| `fetched_at` | TimestampStr | 元数据抓取时刻 |

#### Repository tracking contract（权威）

1. GitHub Search 只负责**成员发现**。发现先执行开放上界的 `stars:>=MIN_TRACKED_STARS`、按 stars 降序读取当前最高值，再以该动态上界自适应分桶；不存在 600,000 或其他产品级最高星数截断。
2. GraphQL `Repository.stargazerCount` 是 `current_stars`、当前总量及当前/全时排名的唯一权威来源。Search 返回的 `stargazers_count` 只保留在 immutable whitelist snapshot 中用于发现审计，不写入 canonical `current_stars`。
3. `WhitelistSnapshot.count === entries.length` 是本 run 的权威 active tracked count。publish gate 要求该集合与 canonical `active:true`、`lookup/repos.json active:true`、`meta.active_repo_count` 完全一致。
4. drop 不删除：canonical、lookup、search 与 repo entity 继续保留，并写 `active:false`；daily/weekly cron、当前 org/category 聚合和 all-time 榜只使用 active rows。
5. re-entry 由下一次 whitelist `diff.added` 重新激活，GraphQL 重新取权威总数，并保留首次 `tracked_since`。首次 newcomer 才把 immutable whitelist snapshot 的 UTC 日期写入 `tracked_since`。

### 1.3 `meta`（→ `meta.json`）

```json
{ "seam_date": "2026-05-30", "backfilled_at": "...", "schema_ver": 1,
  "active_repo_count": 5302, "historical_repo_count": 17, "generated_at": "..." }
```

`seam_date` = gross→net 边界（回填截止日）：`date < seam_date` 为 gross，之后为 net。版本化 writer 还写 `active_repo_count` / `historical_repo_count`；publish gate 与 whitelist / lookup 交叉校验。`Meta` 契约同时接受**扁平 bootstrap meta**（含 `backfilled_at`）与**版本化 meta**（含 `folded_through`，无 `backfilled_at`）；计数字段在 legacy 读取期间 optional，但新 publish 必须存在且匹配。

### 1.4 生产 canonical JSON shard

> 把 §1.1 的 8M 行日表**折叠 + 分桶**成一组小 JSON，让 Vercel Workflow 能无引擎重算。设计与分桶策略见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5/§5.2。`<bucket>` = `repo_id % N`。

**`canonical/v2/meta.json`** —— 全局元信息（驱动 stock 锚定分段 + 收口水位）：

```json
{ "seam_date": "2026-05-30", "schema_ver": 1,
  "folded_through": { "month": "2026-05", "week": "2026-W22" },
  "generated_at": "2026-06-02T14:32:57.214Z" }
```

- `seam_date`：gross→net 边界，stock 锚定据此分段（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.3）。
- `folded_through`：已折叠进 base 的最末周/月周期；读路径据此判某周期归 live 还是 base（防重复，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.2）。
- `generated_at`：bootstrap 与 recurring fold writer 都必须写入的 UTC timestamp。reader 在迁移期仍接受没有该字段的 legacy generation；managed refresh 的首个 preflight step 会在任何 canonical mutation 前用 `CanonicalMeta` 解析线上对象。

**`canonical/v2/repos/{bucket}.json`** —— repo 维度分桶（字段同 §1.2，含 `tracked_since`、`fetched_at`（元数据抓取时刻）；外加 `d` = 冻结锚定因子（`>= 0`，GitHub Archive 低计时可 `> 1`），bootstrap 算定，**存全精度 IEEE double**——舍入会让 JS 重算的 `stock_est` 与 DuckDB 差 ±1）：

```json
{ "1296269": { "id": 1296269, "node_id": "...", "owner": "vuejs", "owner_type": "Organization",
               "name": "vue", "full_name": "vuejs/vue", "language": "TypeScript",
               "current_stars": 207000, "active": true, "crossed_10k": "2016-10-04", "tracked_since": null,
               "d": 0.9123 } }
```

**`canonical/v2/repo-monthly/{bucket}.json`** —— per-repo 月 flow 序列（period = `MonthPeriod`，驱动月榜 + entity 月曲线）：

```json
{ "1296269": [ ["2015-01", 1200], ["2015-02", 1500] ] }   // { "<id>": [[period, flow], ...]；seam 前 gross / 后 net }
```

**`canonical/v2/repo-weekly/{bucket}.json`** —— per-repo ISO 周 flow 序列（period = `WeekPeriod`，驱动历史周榜）：`{ "<id>": [["2024-W42", 320], ...] }`。

**`canonical/v2/repo-recent-daily/{bucket}.json`** —— per-repo 近 ~90 天日点（曲线尾 + 周边界，net 可负）：`{ "<id>": [["2026-03-01", 30], ["2026-03-02", -5]] }`。⚠️ **bootstrap(`07-export-v2`)一次性 seed**；recurring `fold` step(`fold.ts`)**不读、不写、不修剪** recent-daily(`web/lib/` 内无 writer，仅 reader `io.ts:53`)——「滚出 90 天的日点并入 `repo-monthly`」的老化机制**尚未实现**（xref issue #3 / [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.2）。

**`canonical/v2/site-daily/{yyyy}.json`** —— 站点级日总量（`year` = `YearPeriod`，驱动 heatmap）：`{ "year": "2024", "cells": [["2024-01-01", 82000]] }`。

**`canonical/v2/pending/{period}.json`** —— 已收口、待折叠的月周期活尾冻结快照（period = `MonthPeriod`；cron 跨期重置前写、折叠 step 读，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7.2）：形同 `current_month.json` 的 `per_repo` + `daily_totals`。

> **stock 锚定**(口径同 [RANKING.md](./RANKING.md) §3,**必须分 seam 前后**)：锚定因子 `d = current_stars@seam / cumgross@seam_date`(**分母只含 seam 前 gross**),bootstrap 算定后写入 `repos` shard 冻结；`d >= 0`，Archive 低计时可 `> 1`。seam 前 `stock_est = cumgross × d`；**seam 后 net 不乘 `d`、直接累加**：`stock = stock@seam + Σ(seam 后 net)`。详见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6.3。里程碑同样 bootstrap 算定后冻结、写入 `repos` shard。

---

## 2. 服务视图（JSON，build 读，Vercel Blob 存）

### 2.0 视图 schema 索引（物理 Blob 树见 [OPS.md](./OPS.md) §Blob 布局）

> 下列为**有 §2.x schema 的视图名 → 章节**索引；完整物理布局（含 `canonical/v2/*` shard）不在此重列，见 OPS §Blob 布局。

```text
lookup/repos.json                              # build join 表（§2.1）
lookup/orgs.json
lookup/aliases.json                            # 改名旧 full_name → 当前 repo id（§2.2b）
search/index.json                              # 客户端全站搜索索引（recompute 派生）
rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json
rank/all-time/{repo|org}/stock.json
live/latest.json                              # live generation 指针 + fenced lease（§2.9a）
live/generations/{run_id}/manifest.json       # generation 完整性清单
live/generations/{run_id}/rank/{week|month}/{period}/repo/{flow|stock}.json
live/generations/{run_id}/heatmap/month/{period}.json
live/generations/{run_id}/current_month.json  # 活尾（cron 写，§2.8）
live/generations/{run_id}/hot-snapshot.json   # 热集（cron 写，ISR 读，§2.9）
entity/repo/{id}.json
entity/org/{login}.json
heatmap/{year|month}/{period}.json
current_month.json                             # 迁移期 flat fallback（新 cron 不再覆盖）
hot-snapshot.json                              # 迁移期 flat fallback（新 cron 不再覆盖）
ops/sync-runs.json                             # cron 运行记录（cron 写，运维读）
meta.json
canonical/v2/whitelist/latest.json             # { run_id, ids[] }：已发布 baseline 的兼容 pointer（publish / rollback 写；whitelist step 不推进）
# ── Vercel-only 发布层（见 §2.11–2.13）──
bootstrap/latest.json                          # 冷启动 generation 的 atomic commit / rollback pointer
bootstrap/generations/{generation}/**          # sealed base + canonical payload 与 phase manifests
bootstrap/overlays/{generation}/canonical/**   # recurring canonical copy-on-write 状态
views/latest.json                              # 发布指针（读侧据此解析版本前缀；version = run_id）
views/{run_id}/…                               # 一个 run 的完整视图版本（version=run_id，无独立 staging/published）
ops/workflows/{run_id}/manifest.json           # Workflow run 元信息
ops/workflows/{run_id}/steps/{step}.json       # 每个 step 的 checkpoint
ops/workflows/latest-success.json              # 最近一次成功发布的 run_id（恢复点）
```

> **发布层产物（`views/<version>/*`）的内部结构 = §2.1–2.7 的视图**（`rank/** entity/** heatmap/** lookup/** meta.json`），落在 `views/<run_id>/` 前缀下（version = run_id，无 staging→published 拷贝）。读侧先读 `views/latest.json` 指针解析出 `<version>`，再读该前缀下的视图（无指针时回退扁平布局；见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.1）。

Phase 1 category views also live under `views/<run_id>/`:

- `categories/registry.json` - public category registry and counts.
- `categories/assignments.json` - repo id to category id assignments.
- `lookup/categories.json` - small client/build lookup for public categories;
  category entries may carry `sitemap` eligibility so route discovery can omit
  explicitly hidden categories.
- `rank/category/<dimension>/<slug>/all-time/repo/stock.json` - phase-1 all-time category rank page 1.
- `rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json` - phase-1 all-time category rank pages 2+.

Windowed category rank views are reserved for later category page phases; do not
emit `rank/category/**/{week|month|year}/**` until the write-budget impact is
explicitly accepted.

### 2.1 `lookup/repos.json`

build 的 join 表——只放渲染榜单/卡片所需最小字段（完整元数据在 `entity/repo`）。

```json
{
  "1296269": { "owner": "vuejs", "name": "vue", "full_name": "vuejs/vue",
               "owner_type": "Organization", "language": "TypeScript", "current_stars": 207000,
               "active": true, "tracked_since": null }
}
```

lookup 保留 active 与 historical 两类 repo，供旧 URL / 历史 entity 继续解析；调用方不得用“row 存在”推断当前成员。

### 2.2 `lookup/orgs.json`

```json
{
  "vuejs": { "login": "vuejs", "owner_type": "Organization",
             "repo_count": 14, "current_stars_sum": 312000 }
}
```

### 2.2b `lookup/aliases.json`

改名映射：旧（已弃用）`full_name`（小写）→ 当前 `repo id`。repo 页 `/[owner]/[name]` 在 slug 查不到时据此 **308 永久重定向**到该 id 的当前 `full_name`（`repo_id` 跨改名稳定，重定向目标在请求时从 `lookup/repos.json` 实时解析）。由 `buildAliases` workflow step 产出：并集所有保留的 `ops/workflows/<run>/renames.json` 增量（gc 不删 `ops/`，故能覆盖更早 run 的改名），剔除已不再追踪的 id、自指、以及与活仓库当前名相撞的项。

```json
{ "facebook/react": 10270250, "facebook/react-native": 29028775 }
```

### 2.3 `rank/{window}/{period}/{dim}/{metric}.json`

排行榜。`window∈{week,month,year}`、`period` 见全局约定、`dim∈{repo,org}`、`metric∈{flow,stock}`。
**派生 repo 榜（仅 month/year，dim=repo）**：`metric=growth`（增速，item 含 `rate`=增速%、`base`=期初 stock；**入榜须期初 stock ≥ 20,000 且当期 flow > 0**——`flow<=0` 一并剔除，见 `ranks.ts:131`）、`metric=new`（新晋，item 含 `date`=破 10k 日期）。口径见 [RANKING §4](./RANKING.md)；`RankItem` 因此带可选 `rate`/`base`/`date` 三字段。

```json
{
  "meta": { "window": "month", "period": "2024-10", "dim": "repo",
            "metric": "flow", "generated_at": "..." },
  "items": [
    { "rank": 1, "id": 1296269, "value": 12345, "prev_rank": 2 },
    { "rank": 2, "id": 28457823, "value": 11900, "prev_rank": 1 }
  ]
}
```

- `dim="repo"` → 用 `id`；`dim="org"` → 用 `login`（另一字段省略）。
- `value`：`flow` = 期间 ∑delta；`stock` = 期末累计（历史=锚定估算、seam 后=精确）。
- `prev_rank`：上一同类周期的名次（供"↑↓ / 进出 TOP50"），无则 `null`。
- top-N：repo 默认 100、org 默认 100（页面按需截断）。

### 2.4 `rank/all-time/{dim}/stock.json`

`items` 形状同上；全时仅 `stock`（仅 `active:true`；repo = GraphQL `current_stars` 排序，org = active 成员的 `current_stars_sum` 排序）。

### 2.4a `rank/category/<dimension>/<slug>/all-time/repo/stock*.json`

Phase-1 category rank views are all-time repo stock lists only. They reuse
`RankItem` rows but add category metadata to the rank meta object. Page 1 keeps
the compatibility path `rank/category/<dimension>/<slug>/all-time/repo/stock.json`;
page 2+ lives at
`rank/category/<dimension>/<slug>/all-time/repo/stock/page/<page>.json`.

```json
{
  "meta": {
    "window": "all",
    "period": "all",
    "dim": "repo",
    "metric": "stock",
    "generated_at": "...",
    "category": { "id": "language/python", "dimension": "language", "slug": "python" }
  },
  "items": [
    { "rank": 1, "id": 1296269, "value": 12345, "prev_rank": null }
  ]
}
```

Rules:

- `dim` is always `repo`.
- `metric` is `stock` for the Phase-1 all-time view.
- Each category rank file is capped to `CATEGORY_DETAIL_PAGE_SIZE` rows; ranks
  continue across page files (`101`, `102`, ... on page 2).
- Every `item.id` must be assigned to `meta.category.id` in `categories/assignments.json`.
- Windowed `flow`/`stock` category ranks are future work; avoid emitting them until the category route phase has accepted the extra view count.

### 2.5 `entity/repo/{id}.json`

```json
{
  "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "owner_type": "Organization",
  "name": "vue", "description": "...", "language": "TypeScript",
  "languages": [
    { "name": "TypeScript", "size": 120000, "color": "#3178c6" },
    { "name": "JavaScript", "size": 30000, "color": "#f1e05a" }
  ],
  "topics": ["vue","framework"],
  "homepage_url": "https://vuejs.org/", "license": "MIT",
  "latest_release": { "name": "v3.5.0", "tag_name": "v3.5.0", "published_at": "2024-09-01", "url": "https://github.com/vuejs/core/releases/tag/v3.5.0" },
  "created_at": "2013-07-29", "current_stars": 207000,
  "active": true, "tracked_since": "2026-07-17", "is_archived": true,
  "milestones": { "crossed_10k": "2016-10-04", "crossed_50k": "2017-12-09", "crossed_100k": "2018-10-26" },
  "curve": {
    "monthly": [ ["2015-01", 1200, 18000], ["2015-02", 1500, 19500] ],
    "recent_daily": [ ["2026-03-01", 30], ["2026-03-02", -5] ]
  },
  "monthly_table": [ { "month": "2024-10", "adds": 1234, "rank": 42 } ],
  "rank_history": { "month": [ ["2024-10", 42], ["2024-11", 38] ] },
  "inflections": [ { "period": "2018-10", "flow": 12000, "kind": "peak" } ]
}
```

- `curve.monthly`：`[period, adds, total_end]`——历史走月点（11 年≈132 点）。
- `active` / `tracked_since`：明确展示当前追踪状态与 newcomer provenance；historical entity 不删除，repo 页显示“历史保留”及可用的首次追踪日期。
- `languages`: optional GitHub language breakdown from GraphQL
  `Repository.languages`, sorted by byte size descending. Older published shards
  may omit it; pages fall back to the primary `language` field.
- `homepage_url` / `license` / `latest_release`：可选 GitHub metadata 字段。页面只读 JSON 视图；这些字段由离线 metadata pipeline / cron 补齐，不在请求路径实时抓 GitHub。`homepage_url` 也可作为 repo JSON-LD `sameAs` 的 deterministic first-party identity source。
- `curve.recent_daily`：`[date, net_adds]`——近 ~90 天日点（曲线尾部），可负。
- `monthly_table`：近 N 月的新增 + 当月 flow 名次。
- `rank_history`：可选，名次史（驱动"名次走势"）。
- `inflections`：可选，拐点标记 `[{period, flow, kind}]`，由 recompute 派生——月 flow ≥ K× 滚动中位数且过绝对下限的"爆发"月，最高月 `kind:"peak"`、其余 `"surge"`，至多 3 个；`StarCurve` 据此画标记 + tooltip。旧数据无此字段（optional）。

### 2.6 `entity/org/{login}.json`

```json
{
  "login": "vuejs", "owner_type": "Organization", "current_stars_sum": 312000, "repo_count": 14,
  "members": [ 1296269, 11730342 ],
  "curve": { "monthly": [ ["2015-01", 2100, 30000] ], "recent_daily": [ ["2026-03-01", 55] ] },
  "rank_history": { "month": [ ["2024-10", 7] ] }
}
```

- `members`：该 org 的白名单（≥10k）repo id 列表。
- `curve` = 成员聚合（∑ 成员 delta；stock = ∑ 成员累计）。

### 2.7 `heatmap/{year|month}/{period}.json`

站点级总量（"爆发日/月"）。

```json
{ "meta": { "scope": "month", "period": "2024-10", "generated_at": "..." },
  "cells": [ ["2024-10-01", 82000], ["2024-10-02", 91000] ] }
```

- `heatmap/month/2024-10.json` → 当月各日总量（日历热力图）。
- `heatmap/year/2024.json` → 该年 12 个月总量（年页月格子），`cells` 用 `["2024-10", 总量]`。
- 进行中当月的日总量来自 `current_month.json`，build 合并。

### 2.8 `live/generations/{run_id}/current_month.json`（活尾——Vercel cron 写）

`month` 字段是 `MonthPeriod`；`updated` / `daily_totals` / `per_repo` 日期字段是 `DateStr`。

```json
{
  "month": "2026-05", "updated": "2026-05-29",
  "daily_totals": [ ["2026-05-01", 80000], ["2026-05-02", 76000] ],
  "per_repo": { "1296269": [ ["2026-05-01", 30], ["2026-05-02", -5] ] },
  "current_stars": { "1296269": 207000 }
}
```

- 当月内 **append-only + 按 UTC 日 upsert**（幂等，见 [OPS.md](./OPS.md)）。
- 同一 UTC 日重跑时，日初基线由 `current_stars - 已记录今日 delta` 重建，再以最新 GraphQL 数值计算完整当日 delta；相同输入产生相同日状态，后续增长或回落仍保留相对日初的完整差值。
- GitHub 对删除/改名仓库可返回 partial data。cron 明确支持这种 partial publication：只更新成功返回的 repo，缺失 repo 的 `per_repo` 今日值和 `current_stars` 原样保留；若非复用路径一个 repo 都未返回则 fail closed，不覆盖 live state。
- `current_stars`：每日 GraphQL 最新权威值（也用于锚定）。
- `current_stars` map 只含 active repo；已 drop repo 的既有 `per_repo` 日序列保留供月末 fold，但不再发出 GraphQL 请求，也不进入 current rank。
- 每日/每周 Vercel cron 在同一 immutable generation 内写活尾、当前周/月 rank 与当月 heatmap；所有对象及 `manifest.json` 写完并通过 schema 后才切 `live/latest.json`。基础 `rank/*` / `heatmap/*` 不被 cron 覆盖，避免重复合并活尾。**周期收口时折叠进 `canonical/v2` 月/周 shard**（不是 Parquet）由 Vercel Workflow 分片承载（月+周折叠 `fold.ts`，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6/§7.2）；交接靠 `canonical/v2/pending/<period>.json` + generation 内 `rollover/<period>.json` 恢复副本 + `folded_through` 水位防重复/丢数据。

### 2.9 `live/generations/{run_id}/hot-snapshot.json`（cron 写，热集 ISR 读）

KB 级；热集 ISR 页**只读它**，绝不加载大文件。

```json
{
  "generated_at": "2026-05-30T03:00:00.000Z",
  "freshness": {
    "current_month": "2026-07-17T03:00:00.000Z",
    "current_year": "2026-05-30T03:00:00.000Z",
    "year_spine": "2026-05-30T03:00:00.000Z",
    "on_this_day": null,
    "all_time": "2026-07-17T03:00:00.000Z"
  },
  "home": {
    "year_spine": [ ["2015", 1200000], ["2016", 1800000] ],
    "current_month_top": { "flow": [ {"rank":1,"id":1296269,"value":1234} ], "stock": [ ... ] },
    "on_this_day": [ { "id": 1296269, "crossed": "10k", "date": "2016-05-29" } ]
  },
  "current_year": { "...": "同 rank items 子集" },
  "current_month": { "...": "" },
  "all_time": { "repo": [ ... ], "org": [ ... ] }
}
```

`freshness` 是各 section 的 source-as-of，`null` 表示 writer 无法证明该
section 当前有效；legacy flat snapshot 可暂时缺此字段。`generated_at` 为已知
section 中最保守的时间，不能把 carry-forward 的旧 `year_spine` /
`current_year` 冒充为本次刷新。cron 有 year rank/heatmap base 时会用
base + 当前月重算；无法重算的 `on_this_day` 只保留与本 UTC 月日匹配的条目，
否则发布空数组且 `freshness.on_this_day=null`。

### 2.9a `live/latest.json` + generation manifest（原子 live 发布）

`live/latest.json` 是唯一可变 live 控制对象，同时保存当前完整 generation 与
15 分钟 lease。lease 获取与最终发布都使用 Blob ETag CAS；获取 lease 只改变
`lease`，不会改变 `generation`，因此读者始终看到旧完整版本或新完整版本。

```json
{
  "schema_ver": 1,
  "generation": "daily-2026-07-17T03-00-00-000Z",
  "run_id": "daily-2026-07-17T03-00-00-000Z",
  "idempotency_key": "daily:2026-07-17",
  "job": "daily",
  "day": "2026-07-17",
  "month": "2026-07",
  "week": "2026-W29",
  "published_at": "2026-07-17T03:02:00.000Z",
  "previous_generation": "daily-2026-07-16T03-00-00-000Z",
  "lease": null
}
```

运行中 `lease={run_id,idempotency_key,job,acquired_at,expires_at}`；首发前
`generation` 及发布元数据可为 `null`。manifest 重复上述 run/period 元数据并
列出 generation 内全部相对 `files[]`。默认幂等 key 为 `<job>:<UTC-day>`；
同 key running→attached，committed→直接返回已发布，不同 key active→409。
对象写或验证失败只留下未引用的 orphan generation，pointer 不变；revalidate
和 IndexNow 必须在 pointer CAS 成功之后执行。

### 2.10 `ops/sync-runs.json`（cron 运行记录）

轻量运维日志；由 Vercel cron 覆盖写，保留最近 100 次运行。

```json
{
  "generated_at": "2026-06-02T00:00:00.000Z",
  "runs": [
    {
      "id": "daily-2026-06-02T03-00-00-000Z",
      "job": "daily",
      "status": "ok",
      "dry": false,
      "started_at": "2026-06-02T03:00:00.000Z",
      "finished_at": "2026-06-02T03:02:11.000Z",
      "duration_ms": 131000,
      "result": {
        "day": "2026-06-02",
        "month": "2026-06",
        "week": "2026-W23",
        "polled": 5249,
        "generation": "daily-2026-06-02T03-00-00-000Z",
        "previous_generation": "daily-2026-06-01T03-00-00-000Z",
        "writes": [
          "live/generations/daily-2026-06-02T03-00-00-000Z/current_month.json",
          "live/generations/daily-2026-06-02T03-00-00-000Z/hot-snapshot.json",
          "live/latest.json"
        ]
      }
    }
  ]
}
```

### 2.11 `views/latest.json` — 发布指针

读侧据此解析当前生效的视图版本前缀；切指针 = 原子发布 / 回滚（见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7）。

```json
{
  "version": "2026-06-02T04-00-00Z",
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "published_at": "2026-06-02T04:03:11.000Z",
  "prev_version": "2026-05-26T04-00-00Z",
  "schema_ver": 1
}
```

- 读侧 pointer fetch 带 `published-views-pointer` cache tag；解析 `version` → 读 immutable `views/<version>/**`（无指针时回退扁平布局）。publish / rollback 主动失效 tag + 根 layout，其他暖实例的 memo 也被 60s SLA 上限约束。
- 回滚必须走 fenced rollback API / `rollbackVersion()`，不能只手改 Blob；它会同步 recovery、published whitelist pointer 和 cache invalidation。
- publish 前先写 immutable `ops/workflows/<run_id>/publish-intent.json`；其中固定首次观察到的 `prev_version`，因此局部成功后的重试不会生成自指 rollback。

### 2.11a `bootstrap/latest.json` — 冷启动 generation 指针

一次性 `pipeline/backfill` 不直接覆盖任何线上 views / canonical 对象。`06-upload` 与 `07-export-v2` 先 create-only 写入 `bootstrap/generations/<generation>/**`；两个 phase manifest 分别记录该 phase 每个对象的 logical path、byte count 与 SHA-256。只有远端逐对象复核、本地 Zod 校验和共享 Workflow lease 全部通过，才单文件覆盖此 pointer。

```json
{
  "schema_ver": 1,
  "generation": "bootstrap-20260717T120000Z",
  "prefix": "bootstrap/generations/bootstrap-20260717T120000Z",
  "previous_generation": "bootstrap-20260710T120000Z",
  "published_at": "2026-07-17T12:10:00.000Z",
  "base_manifest_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "canonical_manifest_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

- `generation` 必须匹配 `^bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$`；`prefix` 必须严格等于 `bootstrap/generations/<generation>`。
- 两个 manifest digest 都是 64 位 lowercase hex；pointer 使用 strict Zod object，未知字段拒绝。
- `previous_generation:null` 是明确的 `legacy-flat` recovery edge。首次 commit 必须在共享 lease 内验证 legacy `meta` / lookup / all-time rank 与全部 `4 × 32` canonical shard families；`--rollback legacy-flat --execute` 在同一 lease 内复核这些 mutable artifacts 后原子删除 pointer。删除成功但响应丢失的同命令重试是 no-op success。
- base 读在 managed pointer 成功返回 version 时再读取 bootstrap pointer，并按 `published_at` 使用更新的完整 generation；因此新 bootstrap commit / rollback 能一次切 base + canonical，之后更新的 managed publish 会重新接管 base。managed pointer 若超时、非 404 失败或形状不可用，则 fail-safe 保持 legacy flat 且不查询 bootstrap，避免误跳到旧 generation；只有 managed pointer 明确 404 时才查询 bootstrap，而 bootstrap 也明确 404 时继续使用 legacy flat。
- canonical 读先查 `bootstrap/overlays/<generation>/canonical/**`，对象不存在时回退 sealed generation；canonical writer 只写 overlay，不覆盖 generation。`previous_generation` 因而同时恢复旧 seed 与其 overlay。
- 同 generation 的 resume 必须 byte-identical；validation / upload / active lease 失败时 pointer 不变。generation rollback 在 lease 前复核 sealed target，再在 lease 内重读 pointer；legacy rollback 的 target 验证必须在 lease 内完成。

### 2.12 `ops/workflows/{run_id}/manifest.json` + `steps/{step}.json` — Workflow checkpoint

业务可读的 run 进度账本（Workflow SDK 自身另有持久化）。

```json
// manifest.json
{
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "started_at": "2026-06-02T04:00:00.000Z",
  "status": "running",                          // running | published | failed
  "steps": ["preflight","whitelist","rename","metadata","fold","recompute","buildAliases","validate","publish","gc"],  // manifest 分组（细粒度步骤见 VERCEL-DATA-OPERATIONS §4）
  "published_version": null
}
```

> `steps[]` 为 **manifest 分组**（10 项，对应进度账本，含 read-only `preflight` 与真实 `buildAliases` 阶段）；**细粒度 13 步**（preflight/whitelist/rename/metadata/fold/rank/repo-entities/org-entities/heatmap/aliases/validate/publish/gc）见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4。Workflow SDK 自身持久化 step 结果；`validate` 另写 `canonical-manifest.json`（全部必需 canonical shard 的路径、bucket、记录数、SHA-256 与完整性结论）及 `validation.json`，其余 run 级账本包括 manifest / error / latest-success。

`ops/workflows/active.json` 是 refresh / rollback 的互斥 lease。start 路由和执行体都通过 Blob ETag 条件写更新；takeover 会递增 `fencing_token`。lease 30 分钟到期，长写入每 ≤5 分钟 heartbeat；canonical、checkpoint 和 publish pointer 写前必须同时核对 `run_id` 与 token。

```json
{
  "run_id": "refresh-2026-06-07T06-00-00-000Z",
  "status": "running",
  "acquired_at": "2026-06-07T06:00:00.000Z",
  "expires_at": "2026-06-07T06:30:00.000Z",
  "fencing_token": 12,
  "idempotency_key": "workflow-refresh:2026-W23",
  "trigger": "manual-or-cron"
}
```

#### 2.12.1 `ops/workflows/health/{pipeline}.json` — 独立健康状态

`pipeline` 固定为 `workflow-refresh`、`cron-daily` 或 `cron-weekly`。每条 pipeline 使用独立对象和 ETag compare-and-set，避免并发运行互相覆盖。

```json
{
  "schema_version": 2,
  "pipeline": "cron-daily",
  "status": "ok",
  "at": "2026-07-17T03:02:11.000Z",
  "correlation_id": "daily-2026-07-17T03-00-00-000Z",
  "run_id": "daily-2026-07-17T03-00-00-000Z",
  "idempotency_key": null,
  "error": null,
  "last_success": { "at": "2026-07-17T03:02:11.000Z", "correlation_id": "daily-2026-07-17T03-00-00-000Z", "run_id": "daily-2026-07-17T03-00-00-000Z", "idempotency_key": null, "error": null },
  "last_failure": null,
  "freshness": { "last_success_at": "2026-07-17T03:02:11.000Z", "expected_within_seconds": 129600, "stale_after": "2026-07-18T15:02:11.000Z" }
}
```

- `status` 是最新时间信号（`ok | failed | attached | rejected`）。较旧的迟到写不能倒退 latest。
- `last_success` 与 `last_failure` 独立保留；恢复成功不会抹掉上次失败的诊断。
- `freshness.stale_after` 是依据 pipeline 频率计算的绝对时间，读取者无需相信写入时的静态 age 值。

```json
// steps/recompute.json
{
  "step": "recompute", "status": "ok",          // ok | running | error
  "started_at": "...", "finished_at": "...",
  "shards_done": 32, "files_written": 4120,
  "error": null
}
```

`ops/workflows/latest-success.json` = `{ "run_id": "...", "version": "...", "published_at": "..." }`（恢复点）。

`ops/workflows/<run_id>/publish-intent.json` 是 immutable retry state：

```json
{
  "operation": "publish",
  "run_id": "refresh-2026-06-07T06-00-00-000Z",
  "version": "refresh-2026-06-07T06-00-00-000Z",
  "prev_version": "refresh-2026-05-31T06-00-00-000Z",
  "published_at": "2026-06-07T06:18:00.000Z",
  "fencing_token": 12
}
```

同一 operation retry 必须重放该对象；不能重新读取 pointer 后覆盖 `prev_version`。`operation` 也可为 `rollback`。

### 2.13 `ops/workflows/{run_id}/validation.json` — 校验报告

step `validate` 对 `views/<run_id>/**` 跑 Zod + sanity，并对全部必需 canonical bucket 跑 schema / ID / anchoring 完整性；`ok=false` 则不切指针。
**`checked` = 关键派生视图抽样读次数 + 全部必需 canonical shard 数**。派生视图仍抽查 `meta` / `rank/all-time` / lookup / search / categories / top-repo entity / 去年 heatmap；canonical 的 `repos`、`repo-monthly`、`repo-weekly`、`repo-recent-daily` 则逐 bucket 全量读取，并另写 `canonical-manifest.json`。

```json
{
  "run_id": "...", "ok": true,
  "checked": 6, "schema_failures": 0,
  "invariants": { "ranks_sorted": true, "org_eq_members": true, "drift_pct": 0.3 },
  "failures": []
}
```

### 2.14 `search/index.json` — 客户端全站搜索

recompute 从 `repos` 维度派生的精简检索索引（每 repo 一条；描述头部截断 200 字符以控体积），随 entity/org step 写入 `views/<run_id>/search/index.json`，并入 `validate`（断言条目数 ≥ 阈值）。客户端 `SearchBox` 首次聚焦时懒加载 + 建 MiniSearch 索引（typo 容错 + prefix + 按 stars 加权），**零运行时后端**；读侧经 `/search-index` 路由服务端解析发布指针读取版本化产物。endpoint method、cache、fallback 与 status contract 见 [API.md](./API.md)。schema `SearchIndex`/`SearchDoc`（`web/lib/contracts/search.ts`）。

```json
{
  "generated_at": "2026-06-02T00:00:00.000Z",
  "count": 5302,
  "repos": [
    { "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "language": "JavaScript",
      "current_stars": 207000, "description": "...", "active": true, "tracked_since": null }
  ]
}
```

> **月度叙事无独立产物**：榜页叙事是**确定性模板**、**渲染时**从该月 rank 数据（top/增速/新晋）现拼（`web/lib/narrative.ts`），**不落 Blob、不引 AI**。故此处无 `narrative/*` 契约。

### 2.15 `/repo-curve?id=<id>` — 多 repo 对比瘦路由（无独立产物）

多 repo 对比（`/compare`）需要浏览器**按需**取若干 repo 的曲线。**不新建 Blob 产物**：`app/repo-curve/route.ts` 服务端经发布指针读版本化 `entity/repo/<id>.json`（§2.5），**投影**出对比所需的精简 payload 返回。endpoint method、query、cache、error status contract 见 [API.md](./API.md)。schema `CompareCurve`（`web/lib/contracts/compare.ts`）：

```json
{ "id": 10270250, "full_name": "facebook/react", "current_stars": 232000, "crossed_10k": "2014-09-15", "points": [["2014-01", 9800], ["2014-02", 10400]] }
```

`points = [period, total_end][]`（取 entity `curve.monthly` 的累计列）；`crossed_10k` 来自 `entity.milestones.crossed_10k`，供「对齐到 10k」x 轴重映。**故此处无 `compare/*` 或 `curve/*` Blob 契约**——它是 entity 的只读投影，离线 parity 集合不变。

---

## 3. 版本 / 缓存 / 原子性

- **原子切换**：冷启动写 sealed `bootstrap/generations/<generation>/**` → validate → 更新 `bootstrap/latest.json`（§2.11a）；recurring base 发布写 `views/<run_id>/...` → validate → 更新 `views/latest.json`（§2.11）；live 发布写 `live/generations/<run_id>/...` → manifest → fenced CAS 更新 `live/latest.json`（§2.9a）。三条路径都只有一个 logical commit point，读侧只消费指针指向的不可变完整版本。
- `meta.schema_ver`：破坏性 schema 改动 bump，build 启动校验版本匹配，不符 fail-fast。
- live 指针 60s 短缓存可能读到上一完整 generation，但不会读到混合 generation；pointer 非 404 错误时读侧使用已缓存的旧 generation 或 fail closed，只有真正 404 才允许迁移期 flat fallback。

## 4. 类型来源（单一事实源）

每个产物用 Zod schema 定义于 `web/lib/contracts/`（canonical shard / workflow checkpoint / 发布指针的 schema 也归此处）：

- bootstrap / Workflow 产出每个 JSON 后用对应 schema **校验**（脏数据不发布、不切指针，见 TESTING §1.2/§1.3）。
- build / 运行时读取时 `schema.parse(json)` → 得到带类型的对象，类型即从 Zod 推导，**不另写 interface**。
- 改 schema = 改 Zod = 同时改契约、校验、类型——三者不会漂移。
