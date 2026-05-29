# gitstarclub 数据契约（Parquet canonical + JSON 视图）

> **pipeline 与 build 之间的接口**。物理形式与取舍见 [ARCHITECTURE.md](./ARCHITECTURE.md)「数据模型」；本文给每个产物的**精确 schema**。
> 这是 build 侧 TypeScript 类型的唯一事实源——用 Zod 定义每个产物 schema，pipeline 产出时校验、build 读取时 parse（见 [TESTING.md](./TESTING.md) §1.2）。

## 全局约定

- **日期**：一律 UTC，`YYYY-MM-DD`。
- **周期标识 `period`**：周 = ISO 周 `YYYY-Www`（如 `2024-W42`）；月 `YYYY-MM`；年 `YYYY`；全时 `all`。
- **主键**：repo = GitHub 数字 `repo_id`（不可变，跨改名稳定）；org = `owner` login 字符串。
- **数值**：整数。`delta` / flow 在 seam 后为 net，**可为负**（取消 star）；stock（累计）非负。
- **引用 vs 内嵌**：排行榜 JSON 只存实体 **id/login + 数值**，不内嵌名字/描述；build 用 `lookup/*` join 出展示字段 → 榜单文件保持小、改名只需更新 lookup。
- 每个 JSON 带 `meta`（至少 `generated_at`，视图另含 `period/window/dim/metric`）便于缓存与调试。

---

## 1. Canonical（离线，Parquet，仅 pipeline 触碰）

### 1.1 事实表 `canonical/star_daily.parquet`

唯一真相源。所有视图都从它聚合。

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
| `fetched_at` | string | 元数据抓取时刻 |

### 1.3 `meta`（→ `meta.json`）

```json
{ "seam_date": "2026-05-31", "backfilled_at": "...", "schema_ver": 1, "generated_at": "..." }
```

`seam_date` = gross→net 边界（回填截止日）：`date < seam_date` 为 gross，之后为 net。

---

## 2. 服务视图（JSON，build 读，Vercel Blob 存）

### 2.0 产物清单（Blob 布局见 [OPS.md](./OPS.md)）

```
lookup/repos.json                              # build join 表
lookup/orgs.json
rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json
rank/all-time/{repo|org}/stock.json
entity/repo/{id}.json
entity/org/{login}.json
heatmap/{year|month}/{period}.json
current_month.json                             # 活尾（cron 写）
hot-snapshot.json                              # 热集（cron 写，ISR 读）
meta.json
```

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
  "created_at": "2013-07-29", "current_stars": 207000, "is_archived": true,
  "milestones": { "crossed_10k": "2016-10-04", "crossed_50k": "2017-12-09", "crossed_100k": "2018-10-26" },
  "curve": {
    "monthly": [ ["2015-01", 1200, 18000], ["2015-02", 1500, 19500] ],
    "recent_daily": [ ["2026-03-01", 30], ["2026-03-02", -5] ]
  },
  "monthly_table": [ { "month": "2024-10", "adds": 1234, "rank": 42 } ],
  "rank_history": { "month": [ ["2024-10", 42], ["2024-11", 38] ] }
}
```

- `curve.monthly`：`[period, adds, total_end]`——历史走月点（11 年≈132 点）。
- `curve.recent_daily`：`[date, net_adds]`——近 ~90 天日点（曲线尾部），可负。
- `monthly_table`：近 N 月的新增 + 当月 flow 名次。
- `rank_history`：可选，名次史（驱动"名次走势"）。

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

### 2.8 `current_month.json`（活尾——每日 cron 写）

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
- 月底由每周 job 折叠进 Parquet（日→`star_daily`，聚合→月度），然后清空开新月。

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

---

## 3. 版本 / 缓存 / 原子性

- **原子切换**：每次 pipeline 发布可写到 `v/<build_id>/...` 前缀 + 更新 `latest.json` 指针，build 读指针指向的版本；或直接覆盖 + 读取时 query cache-bust（`?v=<date>`，见 [OPS.md](./OPS.md) Blob 60s 传播）。
- `meta.schema_ver`：破坏性 schema 改动 bump，build 启动校验版本匹配，不符 fail-fast。
- 活尾 `current_month.json` 覆盖写最坏读到滞后一天，无半写风险。

## 4. 类型来源（单一事实源）

每个产物用 Zod schema 定义于 `web/lib/contracts/`：

- pipeline 产出每个 JSON 后用对应 schema **校验**（脏数据不发布，见 TESTING §1.2/§1.3）。
- build 读取时 `schema.parse(json)` → 得到带类型的对象，类型即从 Zod 推导，**不另写 interface**。
- 改 schema = 改 Zod = 同时改契约、校验、类型——三者不会漂移。
