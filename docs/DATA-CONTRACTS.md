# gitstarclub 数据契约（canonical JSON shard + JSON 视图）

> **数据层与 build 之间的接口**。物理形式与取舍见 [ARCHITECTURE.md](./ARCHITECTURE.md)「数据模型」；本文给每个产物的**精确 schema**。
> 这是 build 侧 TypeScript 类型的唯一事实源——用 Zod 定义每个产物 schema，产出时校验、build 读取时 parse（见 [TESTING.md](./TESTING.md) §1.2）。
>
> ⚠️ **canonical 形态**：§1 的 `star_daily.parquet` 是 **bootstrap 归档**形态。**生产 canonical = §1.4 的 JSON shard**（Vercel 可重算、无引擎）。Workflow / checkpoint / 发布指针契约见 §2.11–2.13。整体设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)。

## 全局约定

- **日期**：一律 UTC，`YYYY-MM-DD`。
- **周期标识 `period`**：周 = ISO 周 `YYYY-Www`（如 `2024-W42`）；月 `YYYY-MM`；年 `YYYY`；全时 `all`。
- **主键**：repo = GitHub 数字 `repo_id`（不可变，跨改名稳定）；org = `owner` login 字符串。
- **数值**：整数。`delta` / flow 在 seam 后为 net，**可为负**（取消 star）；stock（累计）非负。
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
| `full_name` | string | 当前 `owner/name`（改名更新；URL 用它，旧 URL 301） |
| `description` | string\|null | |
| `language` | string\|null | 主语言 |
| `topics` | string[] | |
| `created_at` | string | repo 创建日 ISO |
| `current_stars` | int | GraphQL 权威当前总数（**唯一必须精确的数**） |
| `is_archived` | bool | |
| `crossed_10k/50k/100k` | string\|null | 首破里程碑精确日期（供"历史上的今天"） |
| `tracked_since` | string\|null | 进入白名单 / 开始追踪的日期。bootstrap 基线 repo 为 `null`（有完整历史）；新晋 repo = 发现日（页面据此标注，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §6） |
| `fetched_at` | string | 元数据抓取时刻 |

### 1.3 `meta`（→ `meta.json`）

```json
{ "seam_date": "2026-05-30", "backfilled_at": "...", "schema_ver": 1, "generated_at": "..." }
```

`seam_date` = gross→net 边界（回填截止日）：`date < seam_date` 为 gross，之后为 net。`Meta` 契约同时接受**扁平 bootstrap meta**（含 `backfilled_at`）与 **Phase 4 版本化 meta**（含 `folded_through`，无 `backfilled_at`）——二者皆 optional。

### 1.4 生产 canonical JSON shard（✅ 已实现 Phase 3a，取代 Parquet 作为生产真相源）

> 把 §1.1 的 8M 行日表**折叠 + 分桶**成一组小 JSON，让 Vercel Workflow 能无引擎重算。设计与分桶策略见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4.2/§5。`<bucket>` = `repo_id % N`。

**`canonical/v2/meta.json`** —— 全局元信息（驱动 stock 锚定分段 + 收口水位）：

```json
{ "seam_date": "2026-05-30", "schema_ver": 1,
  "folded_through": { "month": "2026-05", "week": "2026-W22" } }
```

- `seam_date`：gross→net 边界，stock 锚定据此分段（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.4）。
- `folded_through`：已折叠进 base 的最末周/月周期；读路径据此判某周期归 live 还是 base（防重复，§8.3）。

**`canonical/v2/repos/{bucket}.json`** —— repo 维度分桶（字段同 §1.2，含 `tracked_since`；外加 `d` = 冻结折扣系数，bootstrap 算定，**存全精度 IEEE double**——舍入会让 JS 重算的 `stock_est` 与 DuckDB 差 ±1）：

```json
{ "1296269": { "id": 1296269, "node_id": "...", "owner": "vuejs", "owner_type": "Organization",
               "name": "vue", "full_name": "vuejs/vue", "language": "TypeScript",
               "current_stars": 207000, "crossed_10k": "2016-10-04", "tracked_since": null,
               "d": 0.9123 } }
```

**`canonical/v2/repo-monthly/{bucket}.json`** —— per-repo 月 flow 序列（驱动月榜 + entity 月曲线）：

```json
{ "1296269": [ ["2015-01", 1200], ["2015-02", 1500] ] }   // { "<id>": [[period, flow], ...]；seam 前 gross / 后 net }
```

**`canonical/v2/repo-weekly/{bucket}.json`** —— per-repo ISO 周 flow 序列（驱动历史周榜）：`{ "<id>": [["2024-W42", 320], ...] }`。

**`canonical/v2/repo-recent-daily/{bucket}.json`** —— per-repo 近 ~90 天日点（曲线尾 + 周边界，net 可负）：`{ "<id>": [["2026-03-01", 30], ["2026-03-02", -5]] }`。滚出 90 天的日点由折叠 step 并入 `repo-monthly`（单一真相，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.3）。

**`canonical/v2/site-daily/{yyyy}.json`** —— 站点级日总量（驱动 heatmap）：`{ "year": "2024", "cells": [["2024-01-01", 82000]] }`。

**`canonical/v2/pending/{period}.json`** —— 已收口、待折叠的周期活尾冻结快照（cron 跨期重置前写、折叠 step 读，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §8.3）：形同 `current_month.json` 的 `per_repo` + `daily_totals`。

> **stock 锚定**(口径同 [RANKING.md](./RANKING.md) §3,**必须分 seam 前后**)：折扣 `d = current_stars@seam / cumgross@seam_date`(**分母只含 seam 前 gross**),bootstrap 算定后写入 `repos` shard 冻结。seam 前 `stock_est = cumgross × d`；**seam 后 net 不打折、直接累加**：`stock = stock@seam + Σ(seam 后 net)`。详见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.4。里程碑同样 bootstrap 算定后冻结、写入 `repos` shard。

---

## 2. 服务视图（JSON，build 读，Vercel Blob 存）

### 2.0 视图 schema 索引（物理 Blob 树见 [OPS.md](./OPS.md) §Blob 布局）

> 下列为**有 §2.x schema 的视图名 → 章节**索引；完整物理布局（含 `canonical/v2/*` shard）不在此重列，见 OPS §Blob 布局。

```
lookup/repos.json                              # build join 表（§2.1）
lookup/orgs.json
search/index.json                              # 客户端全站搜索索引（recompute 派生，v0.2）
rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json
rank/all-time/{repo|org}/stock.json
live/rank/{week|month}/{period}/repo/{flow|stock}.json
live/heatmap/month/{period}.json
entity/repo/{id}.json
entity/org/{login}.json
heatmap/{year|month}/{period}.json
current_month.json                             # 活尾（cron 写）
hot-snapshot.json                              # 热集（cron 写，ISR 读）
ops/sync-runs.json                             # cron 运行记录（cron 写，运维读）
meta.json
# ── Vercel-only 发布层（✅ 已实现 Phase 4，见 §2.11–2.13）──
views/latest.json                              # 发布指针（读侧据此解析版本前缀；version = run_id）
views/{run_id}/…                               # 一个 run 的完整视图版本（version=run_id，无独立 staging/published）
ops/workflows/{run_id}/manifest.json           # Workflow run 元信息
ops/workflows/{run_id}/steps/{step}.json       # 每个 step 的 checkpoint
ops/workflows/latest-success.json              # 最近一次成功发布的 run_id（恢复点）
```

> **发布层产物（`views/<version>/*`）的内部结构 = §2.1–2.7 的视图**（`rank/** entity/** heatmap/** lookup/** meta.json`），落在 `views/<run_id>/` 前缀下（version = run_id，无 staging→published 拷贝）。读侧先读 `views/latest.json` 指针解析出 `<version>`，再读该前缀下的视图（无指针时回退扁平布局；见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4.1）。

### 2.1 `lookup/repos.json`

build 的 join 表——只放渲染榜单/卡片所需最小字段（完整元数据在 `entity/repo`）。

```json
{
  "1296269": { "owner": "vuejs", "name": "vue", "full_name": "vuejs/vue",
               "owner_type": "Organization", "language": "TypeScript", "current_stars": 207000 }
}
```

### 2.2 `lookup/orgs.json`

```json
{
  "vuejs": { "login": "vuejs", "owner_type": "Organization",
             "repo_count": 14, "current_stars_sum": 312000 }
}
```

### 2.3 `rank/{window}/{period}/{dim}/{metric}.json`

排行榜。`window∈{week,month,year}`、`period` 见全局约定、`dim∈{repo,org}`、`metric∈{flow,stock}`。
**派生 repo 榜（仅 month/year，dim=repo）**：`metric=growth`（增速，item 含 `rate`=增速%、`base`=期初 stock）、`metric=new`（新晋，item 含 `date`=破 10k 日期）。口径见 [RANKING §4](./RANKING.md)；`RankItem` 因此带可选 `rate`/`base`/`date` 三字段。

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

`items` 形状同上；全时仅 `stock`（repo = `current_stars` 排序，org = `current_stars_sum` 排序）。

### 2.5 `entity/repo/{id}.json`

```json
{
  "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "owner_type": "Organization",
  "name": "vue", "description": "...", "language": "TypeScript", "topics": ["vue","framework"],
  "homepage_url": "https://vuejs.org/", "license": "MIT",
  "latest_release": { "name": "v3.5.0", "tag_name": "v3.5.0", "published_at": "2024-09-01", "url": "https://github.com/vuejs/core/releases/tag/v3.5.0" },
  "created_at": "2013-07-29", "current_stars": 207000, "is_archived": true,
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
- `homepage_url` / `license` / `latest_release`：可选 GitHub metadata 字段。页面只读 JSON 视图；这些字段由离线 metadata pipeline / cron 补齐，不在请求路径实时抓 GitHub。
- `curve.recent_daily`：`[date, net_adds]`——近 ~90 天日点（曲线尾部），可负。
- `monthly_table`：近 N 月的新增 + 当月 flow 名次。
- `rank_history`：可选，名次史（驱动"名次走势"）。
- `inflections`：可选，拐点标记 `[{period, flow, kind}]`（recompute 派生，v0.2 §3，见 [IMPLEMENTATION-PLAN](./IMPLEMENTATION-PLAN.md)）——月 flow ≥ K× 滚动中位数且过绝对下限的"爆发"月，最高月 `kind:"peak"`、其余 `"surge"`，至多 3 个；`StarCurve` 据此画标记 + tooltip。旧数据无此字段（optional）。

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

### 2.8 `current_month.json`（活尾——Vercel cron 写）

```json
{
  "month": "2026-05", "updated": "2026-05-29",
  "daily_totals": [ ["2026-05-01", 80000], ["2026-05-02", 76000] ],
  "per_repo": { "1296269": [ ["2026-05-01", 30], ["2026-05-02", -5] ] },
  "current_stars": { "1296269": 207000 }
}
```

- 当月内 **append-only + 按 UTC 日 upsert**（幂等，见 [OPS.md](./OPS.md)）。
- `current_stars`：每日 GraphQL 最新权威值（也用于锚定）。
- 当前实现由每日/每周 Vercel cron 写活尾，并同步覆盖 `live/rank/*` 当前周/月 rank 与 `live/heatmap/*` 当月 heatmap。基础 `rank/*` / `heatmap/*` 不被 cron 覆盖，避免重复合并活尾。**周期收口时折叠进 `canonical/v2` 月/周 shard**（不是 Parquet）由 Vercel Workflow 分片承载（✅ 已实现，月+周折叠 `fold.ts`，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5/§8.3）；交接靠 `canonical/v2/pending/<period>.json` + `folded_through` 水位防重复/丢数据。

### 2.9 `hot-snapshot.json`（cron 写，热集 ISR 读）

KB 级；热集 ISR 页**只读它**，绝不加载大文件。

```json
{
  "generated_at": "...",
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
        "writes": ["current_month.json", "hot-snapshot.json"]
      }
    }
  ]
}
```

### 2.11 `views/latest.json`（发布指针，✅ 已实现 Phase 4）

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

- 读侧带短缓存 / cache-bust（规避 Blob 60s 传播）；解析 `version` → 读 `views/<version>/**`（version = run_id；无指针时回退扁平布局）。
- 回滚 = 把 `version` 写回 `prev_version`（旧版本仍在 `views/<prev>`）。

### 2.12 `ops/workflows/{run_id}/manifest.json` + `steps/{step}.json`（Workflow checkpoint，✅ 已实现）

业务可读的 run 进度账本（Workflow SDK 自身另有持久化）。

```json
// manifest.json
{
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "started_at": "2026-06-02T04:00:00.000Z",
  "status": "running",                          // running | published | failed
  "steps": ["whitelist","rename","metadata","fold","recompute","validate","publish","gc"],  // manifest 分组（细粒度 12 步见 VERCEL-DATA-OPERATIONS §3.4）
  "published_version": null
}
```

> `steps[]` 为 **manifest 分组**（8 项，对应进度账本）；**细粒度 12 步**（whitelist/rename/metadata/newcomer/fold/rank/entity-repo/entity-org/heatmap/validate/publish/gc/revalidate）见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §3.4。

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

### 2.13 `ops/workflows/{run_id}/validation.json`（校验报告，✅ 已实现）

step `validate` 对 `views/<run_id>/**` 跑 Zod + sanity 的结果（[TESTING.md](./TESTING.md) §1.2/§1.3）；`ok=false` 则不切指针。
**`checked` 是抽样读的视图数（非全量逐文件）**：闸门只抽查关键视图（`meta` / `rank/all-time` / `lookup/repos` / `search/index` / 抽样 top-repo entity / 去年 heatmap，约 6 个）作 schema + 不变量断言，`checked` 即这些抽样次数。

```json
{
  "run_id": "...", "ok": true,
  "checked": 6, "schema_failures": 0,
  "invariants": { "ranks_sorted": true, "org_eq_members": true, "drift_pct": 0.3 },
  "failures": []
}
```

### 2.14 `search/index.json`（✅ 已实现 v0.2，客户端全站搜索）

recompute 从 `repos` 维度派生的精简检索索引（每 repo 一条；描述头部截断 200 字符以控体积），随 entity/org step 写入 `views/<run_id>/search/index.json`，并入 `validate`（断言条目数 ≥ 阈值）。客户端 `SearchBox` 首次聚焦时懒加载 + 建 MiniSearch 索引（typo 容错 + prefix + 按 stars 加权），**零运行时后端**；读侧经 `/search-index` 路由（服务端解析发布指针读版本化产物，响应带 `s-maxage` 走 CDN）。schema `SearchIndex`/`SearchDoc`（`web/lib/contracts/search.ts`）。

```json
{
  "generated_at": "<run_id>",
  "count": 5261,
  "repos": [
    { "id": 1296269, "full_name": "vuejs/vue", "owner": "vuejs", "language": "JavaScript", "current_stars": 207000, "description": "..." }
  ]
}
```

> **月度叙事无独立产物**（v0.2 §2）：榜页叙事是**确定性模板**、**渲染时**从该月 rank 数据（top/增速/新晋）现拼（`web/lib/narrative.ts`），**不落 Blob、不引 AI**。故此处无 `narrative/*` 契约。

### 2.15 `/repo-curve?id=<id>`（✅ 规划 v0.2 §5，多 repo 对比瘦路由——无独立产物）

多 repo 对比（`/compare`）需要浏览器**按需**取若干 repo 的曲线。**不新建 Blob 产物**：新增一个与 `/search-index` 同构的瘦服务端路由 `app/repo-curve/route.ts`，服务端经发布指针读版本化 `entity/repo/<id>.json`（§2.5），**投影**出对比所需的精简 payload 返回，响应带 `s-maxage` 走 CDN。schema `CompareCurve`（`web/lib/contracts/compare.ts`）：

```json
{ "id": 10270250, "full_name": "facebook/react", "current_stars": 232000, "crossed_10k": "2014-09-15", "points": [["2014-01", 9800], ["2014-02", 10400]] }
```

`points = [period, total_end][]`（取 entity `curve.monthly` 的累计列）；`crossed_10k` 来自 `entity.milestones.crossed_10k`，供「对齐到 10k」x 轴重映。**故此处无 `compare/*` 或 `curve/*` Blob 契约**——它是 entity 的只读投影，离线 parity 集合不变。

---

## 3. 版本 / 缓存 / 原子性

- **原子切换**：生产发布写 `views/<run_id>/...` → validate → 更新 `views/latest.json` 指针（§2.11），读侧读指针指向的版本；当期活尾仍用覆盖写 + `?v=<date>` cache-bust（见 [OPS.md](./OPS.md) Blob 60s 传播）。
- `meta.schema_ver`：破坏性 schema 改动 bump，build 启动校验版本匹配，不符 fail-fast。
- 活尾 `current_month.json` 覆盖写最坏读到滞后一天，无半写风险。

## 4. 类型来源（单一事实源）

每个产物用 Zod schema 定义于 `web/lib/contracts/`（canonical shard / workflow checkpoint / 发布指针的 schema 也归此处）：

- bootstrap / Workflow 产出每个 JSON 后用对应 schema **校验**（脏数据不发布、不切指针，见 TESTING §1.2/§1.3）。
- build / 运行时读取时 `schema.parse(json)` → 得到带类型的对象，类型即从 Zod 推导，**不另写 interface**。
- 改 schema = 改 Zod = 同时改契约、校验、类型——三者不会漂移。
