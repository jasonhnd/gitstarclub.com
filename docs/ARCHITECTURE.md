# gitstarhub 架构

> 精简的 SSG-first 架构。核心洞察：**数据只有 ~150-300MB，MVP 不需要数据库。**
> 设计目标：扛 100万–1000万/天访问，运行时纯静态。产品设计见 [PRODUCT.md](./PRODUCT.md)。

## 核心洞察

1. **数据很小**：5,248 个 ≥10k star repo × 11 年日序列 ≈ 800 万行 ≈ 单个 SQLite 文件 150-300MB。
2. **所有页面都是确定性聚合**：~5,400 页全部可在 build 时算完，烤进静态 HTML，运行时零查询。
3. **日常增量不需要 GH Archive**：每日增量 = 今日总 star − 昨日总 star，用 GraphQL 批量查即可。
4. **数据库延后**：MVP database-free；ClickHouse/Tinybird 留到 v0.3 扩到 ≥100 star 时才有真实需求。

## 设计原则

- **SSG-first**：所有内容页 build 时预生成静态 HTML，用户请求永不触达 Function/数据库。
- **零客户端 JS**（内容页）：图表服务端渲染 SVG。
- **Vercel-first**：部署、Cron、Blob、Analytics 全在 Vercel，统一计费。
- **单文件数据**：canonical 数据 = 一个版本化的 SQLite 文件，存 Vercel Blob。

## 技术栈

| 层 | 选择 | 性质 |
|---|---|---|
| 框架 | Next.js 15（App Router + RSC + Turbopack） | Vercel 原生 |
| 样式 | Tailwind 4 + shadcn/ui | |
| 字体 | Fraunces (variable serif) + Inter | 编辑调性 |
| **核心数据** | **SQLite 单文件**（`better-sqlite3` build 时查询） | 存 Vercel Blob |
| 对象存储 | Vercel Blob（SQLite 数据 + 预生成 OG 图） | Vercel 原生 |
| 日常采集 | **Vercel Cron + 单 Function**（GraphQL 批量查） | Vercel 原生 |
| 一次性回填 | **BigQuery**（GH Archive 公开表）+ DuckDB | 一次性 |
| 部署 | Vercel | |
| Web 分析 | Vercel Analytics + Speed Insights | Vercel 原生 |
| 错误追踪 | Sentry | Vercel Marketplace |

**MVP 不使用**：Tinybird/ClickHouse、Neon/Postgres、Redis、Inngest、GitHub Actions、v0、tRPC。
理由：数据 < 300MB 无需查询引擎；日常采集足够轻，Vercel Cron 单 Function 即可。

## 数据流

```
┌─ 一次性回填（手动跑一次）──────────────────────────┐
│  BigQuery: 从 githubarchive 提取 ≥10k repo 的       │
│            (repo_id, day, stars_gained)            │
│    · 仅扫描 type/repo.id/created_at 列，~$10        │
│    · 导出 ~128MB CSV/Parquet                       │
│  DuckDB: 清洗 → 灌入 canonical SQLite               │
│  GraphQL: 抓 5,248 repo 元数据 → 同一 SQLite        │
│  上传 SQLite → Vercel Blob                          │
└─────────────────────────────────────────────────────┘

┌─ 每日（Vercel Cron，03:00，单 Function，轻量）──────┐
│  1. 下载 SQLite ← Blob                              │
│  2. GraphQL 批量查 5,248 repo 当前 star（~53 查询）  │
│  3. 昨日增量 = 今日总数 − 昨日总数，append 到 SQLite │
│  4. 上传 SQLite → Blob                              │
│  5. POST Vercel Deploy Hook → 触发重建              │
└─────────────────────────────────────────────────────┘

┌─ 每周（Vercel Cron）────────────────────────────────┐
│  GitHub search stars:>=10000 → diff 白名单           │
│  新晋者：stargazers API（starred_at）补历史 → SQLite │
└─────────────────────────────────────────────────────┘

┌─ Build（每次 deploy）───────────────────────────────┐
│  下载 SQLite ← Blob                                 │
│  better-sqlite3 查询 → 算全部 rollup               │
│  生成 ~5,400 静态页 + 服务端 SVG 图表（零客户端 JS） │
│  → Vercel Edge CDN                                 │
└─────────────────────────────────────────────────────┘

运行时：100% 静态 HTML 走 CDN，无数据库、无 Function 在热路径。
```

## 关键决策

### 为什么日常增量不用 GH Archive？

每日只需"每个 repo 昨天新增多少 star"，而 `昨日增量 = 今日总数 − 昨日总数`。
GitHub GraphQL 可一次查 100 个 repo 的 `stargazerCount`，5,248 repo ≈ 53 个查询，几秒完成。

- 不必每天下载 1-3GB GH Archive
- net delta（净增，含取消 star）比 GH Archive 的 gross adds 更准确反映关注度
- 轻到 Vercel Cron 单 Function 就能跑，无需 Inngest

### 为什么回填用 BigQuery？

过去 11 年的每日曲线需要事件级历史，只有 GH Archive 有。BigQuery 上 `githubarchive.*` 是列式表，`WHERE type='WatchEvent'` 只扫 3 个列（type/repo.id/created_at），扫描约 1.5TB，**计费 ~$10**，且一个字节都不用本地下载。一次性导出 ~128MB 结果。

### 为什么 MVP 用 SQLite 而非 ClickHouse？

- 数据 150-300MB，单文件即可，`better-sqlite3` build 时同步查询飞快
- 无运行时查询、无并发写、无事务——ClickHouse 的能力全用不上
- 省掉 Tinybird + Neon 两个服务和对应心智

### 数据口径的诚实瑕疵（会在 About 页说明）

- 历史曲线为 gross adds（BigQuery WatchEvent），上线后为 net delta（GraphQL diff），接缝处语义略不一致——star-history.com 同样如此
- 幸存者偏差：只回填当前 ≥10k 的 repo，历史上曾火后衰退的项目缺席；接受此口径，About 页注明
- 累计 gross 曲线终点未必精确等于当前总数（历年有取消 star）；以 GraphQL 当前总数为权威锚点

### 起点 2015-01

2012-08 之前 GitHub "watch" ≠ "star"；2015 起数据稳定，作为现代开源时代起点。

### 白名单

= 当前 star ≥ 10,000 的 repo（约 5,248 个）。每周 Vercel Cron 用 GitHub search 刷新，新晋者补历史一次。

## 数据模型（SQLite）

```sql
-- repo 元数据
CREATE TABLE repos (
  id                INTEGER PRIMARY KEY,   -- GitHub repo id
  owner             TEXT NOT NULL,
  name              TEXT NOT NULL,
  full_name         TEXT NOT NULL UNIQUE,
  description       TEXT,
  language          TEXT,
  topics            TEXT,                  -- JSON 数组字符串
  created_at        TEXT,                  -- ISO date
  current_stars     INTEGER,
  is_archived       INTEGER DEFAULT 0,
  first_crossed_10k TEXT,                  -- 首破 10k 日期（里程碑）
  fetched_at        TEXT
);

-- 每日 star（按 repo+日）
CREATE TABLE star_daily (
  repo_id      INTEGER NOT NULL REFERENCES repos(id),
  date         TEXT NOT NULL,              -- 'YYYY-MM-DD'
  stars_gained INTEGER NOT NULL,           -- 当日净增
  total_stars  INTEGER,                    -- 当日累计总数（上线后由 GraphQL 权威填充）
  PRIMARY KEY (repo_id, date)
);
CREATE INDEX idx_star_daily_date ON star_daily(date);

-- 同步运行日志
CREATE TABLE sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date    TEXT,
  repos_polled INTEGER,
  status      TEXT,
  finished_at TEXT
);
```

build 时的聚合（示例）：

| 页面 | 查询 |
|---|---|
| 月度 top | `SELECT repo_id, SUM(stars_gained) FROM star_daily WHERE date LIKE '2024-10%' GROUP BY repo_id ORDER BY 2 DESC LIMIT 20` |
| 月度增速 | top 同上，除以月初 total_stars |
| 月度热力图 | `SELECT date, SUM(stars_gained) FROM star_daily WHERE date LIKE '2024-10%' GROUP BY date` |
| repo 时间线 | `SELECT date, stars_gained, total_stars FROM star_daily WHERE repo_id=? ORDER BY date` |
| 年度脊柱 | `SELECT substr(date,1,4) AS y, SUM(stars_gained) FROM star_daily GROUP BY y` |

## 渲染与分发

### 页面规模

| 类型 | 数量 |
|---|---|
| 首页 | 1 |
| 年度页 | ~11 |
| 月度页 | ~132 |
| Repo 详情页 | ~5,248 |
| **合计** | **~5,400** |

build 全量预生成，几分钟完成。

### 渲染策略

- **build 时**：下载 SQLite → 查询 → 生成全部静态页 → Vercel Edge CDN
- **运行时**：99.99% 请求命中边缘缓存，0 Function、0 查询
- **每日更新**：Cron 更新 SQLite + 触发 deploy hook → 全量重建（几分钟，可接受）。后续可优化为只重建首页/当月/当年/变化的 repo 页

### 性能策略（为 10M/天）

| 策略 | 目的 |
|---|---|
| 完全 SSG，无 SSR | Function 调用归零 |
| HTML < 20KB | 直接降 bandwidth |
| 内容页零客户端 JS | 图表服务端渲染 SVG |
| `Cache-Control: s-maxage=86400, stale-while-revalidate` | 历史页强缓存 |
| 字体子集化 + woff2 | Fraunces 控制在 ~30KB |
| OG 图预生成存 Blob | 不消耗 Function |

### Bandwidth 防御阶梯

10M/天主要成本是 bandwidth（约 15TB/月）：

1. **MVP – 1M/天**：纯 Vercel Pro，~$40–100/月，先验证真实流量
2. **1M – 5M/天**：极致压缩（Brotli 11、精简 HTML）
3. **5M+/天**：Vercel 前挂 Cloudflare 吸收 egress，可砍 80–90% → ~$200–400/月

## 演进路线（数据库何时引入）

| 阶段 | 触发条件 | 引入 |
|---|---|---|
| **MVP** | — | SQLite 单文件，纯静态 |
| **v0.2** | 要全站搜索 / 月度 LLM 叙事 | Pagefind/Orama 静态搜索索引；Vercel AI Gateway 跑摘要 |
| **v0.3** | 扩到 ≥100 star（46 万 repo），单文件吃力 | **Tinybird (ClickHouse)** 作主库；可能加 **Neon** 存元数据 |
| later | 用户系统 / 对比 / 个性化 | Neon + 运行时查询；Turbopuffer 向量检索 |

> ClickHouse 的引入留作 v0.3 真实扩展动力，而非 MVP 硬塞。

## 成本估算

| 阶段 | 月成本 |
|---|---|
| MVP（< 100k/天） | ~$20（Vercel Pro）+ 一次性回填 ~$10（BigQuery） |
| 1M/天 | ~$40–100 |
| 10M/天（纯 Vercel） | ~$2100（bandwidth 为主） |
| 10M/天（前挂 Cloudflare） | ~$200–400 |
