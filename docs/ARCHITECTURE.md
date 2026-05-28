# gitstarhub 架构

## 数据流总览

```
┌────────────────────┐
│   GH Archive       │  公开数据集，每小时一个 .json.gz
│ (gharchive.org)    │  含全部 GitHub 公开事件，2011-至今
└─────────┬──────────┘
          │
          │ (1) 一次性回填：2015-01 至今
          │     过滤 WatchEvent + repo 在白名单内
          ▼
┌────────────────────┐         ┌───────────────────────┐
│  pipeline/backfill │ ◄────── │ GitHub GraphQL API    │
│  Python 脚本        │   (2)    │ 拉 repo 元数据         │
└─────────┬──────────┘         └───────────────────────┘
          │
          ▼
┌────────────────────┐
│   Postgres         │  star_events / repos / monthly_rollup
│   (Supabase/Neon)  │
└─────────┬──────────┘
          │
          ├──── (3) 每日 cron 增量 ────┐
          │                            │
          ▼                            │
┌────────────────────┐                 │
│   Next.js (Vercel) │                 │
│   App Router + ISR │  ◄──────────────┘
└────────────────────┘
```

## 关键决策

### 为什么用 GH Archive 而不是 GitHub API？

- GitHub REST/GraphQL API **不返回每次 star 的历史时间戳**——只能拿到当前 star 总数和最近的 stargazer 列表
- GH Archive 保存了每一个 WatchEvent 的精确时间戳（注：GitHub 内部 "watch event" 即 star 事件，2012-08 之后语义稳定）
- BigQuery 上有现成的 `githubarchive.day.*` 表，也可以直接下载 `.json.gz`

### 为什么起点是 2015-01？

- 2012-08 之前 watch ≠ star，语义混乱
- 2012-2014 早期 star 数据稀疏，开源生态也未真正爆发
- 2015 开始数据量和质量都稳定，作为"现代开源时代"起点合适

### 为什么 MVP 选 Postgres 而不是 ClickHouse？

- ≥10k star 这一层只有 ~5k repo，star 事件 2-4 亿条 —— Postgres 单库可承载
- 心智负担低、Supabase/Neon 免费档够用
- 扩到 ≥100 star（46 万 repo，5-7 亿事件）时再切 ClickHouse 不迟

### 白名单刷新策略

- 白名单 = 当前 star ≥ 10,000 的 repo 列表
- MVP：**每周刷新一次**（新 repo 越过门槛是低频事件）
- 一旦进入白名单，所有历史 star 事件回填一次

## 表结构（草案）

```sql
-- repo 元数据
CREATE TABLE repos (
  id            BIGINT PRIMARY KEY,        -- GitHub repo id
  owner         TEXT NOT NULL,
  name          TEXT NOT NULL,
  full_name     TEXT NOT NULL UNIQUE,      -- owner/name
  description   TEXT,
  language      TEXT,
  topics        TEXT[],
  created_at    TIMESTAMPTZ,
  current_stars INTEGER,
  is_archived   BOOLEAN DEFAULT FALSE,
  fetched_at    TIMESTAMPTZ DEFAULT NOW()
);

-- star 事件（按日聚合，单 repo 单日一行）
CREATE TABLE star_events_daily (
  repo_id     BIGINT REFERENCES repos(id),
  date        DATE NOT NULL,
  star_count  INTEGER NOT NULL,            -- 当日新增 star 数
  PRIMARY KEY (repo_id, date)
);
CREATE INDEX ON star_events_daily (date);

-- 月度预聚合（首页/月度页用）
CREATE MATERIALIZED VIEW monthly_rollup AS
SELECT
  repo_id,
  date_trunc('month', date)::date AS month,
  SUM(star_count) AS stars_gained
FROM star_events_daily
GROUP BY repo_id, month;
CREATE INDEX ON monthly_rollup (month, stars_gained DESC);
```

> 注：是否存原始 event 行（一条 star 一行）vs 直接按日聚合，取决于你以后要不要看小时级或 stargazer 维度。MVP 按日聚合足够，省 100 倍存储。

## 增量同步

每日 cron（GitHub Actions 或 Vercel Cron）：

1. 下载昨天的 24 个 GH Archive 文件（~几 GB）
2. 流式过滤 WatchEvent + repo_id ∈ 白名单
3. 按 repo+日聚合，upsert 到 `star_events_daily`
4. 刷新 `monthly_rollup`（增量刷新近 2 个月即可）
5. 每周一次：重新计算白名单，对新进入的 repo 回填历史

## 前端渲染策略

- **历史月份页**（2015-01 到上个月）：完全静态化，永久缓存
- **当月页**：ISR，每小时重新生成
- **首页时间轴**：ISR，每小时
- **Repo 详情页**：ISR，按需生成 + 24h 重新验证

5248 个 repo 详情页全量预生成也只需几分钟，可以在 build 时全部预渲染。

## 成本估算（MVP）

| 项 | 成本 |
|---|---|
| Supabase / Neon Postgres | $0（免费档） |
| Vercel | $0（Hobby 档） |
| GH Archive 下载 | $0（公开） |
| BigQuery 一次性回填（可选） | $5-20 |
| 每日运行 | ~$0 |

**总计：可以完全跑在免费额度内。**
