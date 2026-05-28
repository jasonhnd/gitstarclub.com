# gitstarclub

> 一本可浏览的 GitHub 开源编年史 —— 按月 / 季 / 年回看哪些项目正在被关注。

## 是什么

`gitstarclub` 把整个 GitHub 上**值得关注的开源项目**按时间维度索引，让你可以：

- 翻到任意一个月份，看那个月**最受关注**的项目是什么
- 看任意 repo 的完整 star 曲线和"何时爆发"的拐点
- 用时间作为第一导航，像翻阅编年史一样浏览开源世界

不同于 GitHub Trending（只看当下）或 star-history（只看单个 repo），`gitstarclub` 提供的是**可回溯的、有结构的、有叙事的**开源历史视角。

## MVP 范围

| 项 | 决定 |
|---|---|
| 数据集 | 公开 repo，star ≥ **10,000**（约 5,248 个，2026-05 实测） |
| 时间范围 | 2015-01 至今 |
| 数据源 | [GH Archive](https://www.gharchive.org/) + GitHub GraphQL API |
| 核心页面 | 首页 / 年度页 / 月度页 / Repo 详情页 |
| 渲染 | **SSG-first**：build 预生成 ~5,400 页（× 3 语言 ≈ 16,200），内容页零客户端 JS |
| 语言 | 英文（主） > 日文 > 中文，hreflang x-default = 英文 |
| SEO | sitemap 分片 + schema.org + 每页 OG（build 时生成），见 docs/SEO.md |
| 核心数据 | **SQLite 单文件**（~150-300MB，存 Vercel Blob）；MVP 不需要数据库 |
| 一次性回填 | **BigQuery**（GH Archive 公开表）+ DuckDB，~$10 |
| 日常采集 | **Vercel Cron + 单 Function**：GraphQL 批量查当前 star，diff 出增量 |
| 框架 | Next.js 15（App Router + RSC + Turbopack） |
| 部署 | Vercel（统一计费） |
| 扛量目标 | 100万–1000万/天 |

> v0.2 之后再加：LLM 月度叙事、主题聚类、相似推荐、对比页、用户系统、下钻到 ≥100 star 的"观察层"。

## 数据规模直觉

GitHub Search API 实测（2026-05）：

| 门槛 | repo 数量 |
|---|---|
| ≥ 100 stars | 460,324 |
| ≥ 1,000 stars | 62,174 |
| **≥ 10,000 stars (MVP)** | **5,248** |

MVP 这一层：

- 我们只关心这 5,248 个 repo 的 star（约 1.3 亿次），按天聚合后 **~800 万行**
- 核心数据 = 单个 **SQLite 文件，150-300MB**（不是 TB！TB 是 GH Archive 全事件量）
- 一次性回填走 BigQuery 扫描（~$10），日常增量靠 GraphQL diff
- 全量 LLM 摘要：**$5-10**（Claude Haiku，留待 v0.2）

## 项目结构（初版）

```
gitstarclub/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          # 技术栈、数据流、数据模型、扛量、build/cron 机制
│   ├── PRODUCT.md               # 页面设计、URL、调性、i18n、命名
│   └── SEO.md                   # sitemap、meta、结构化数据、OG、多语言 SEO
├── pipeline/                    # 数据采集
│   └── backfill/                # 一次性 11 年回填
│       ├── bigquery.sql         # 从 GH Archive 提取 ≥10k repo 日序列
│       ├── load_sqlite.py       # DuckDB 清洗 → 灌入 canonical SQLite
│       └── fetch_metadata.py    # GraphQL 抓 5,248 repo 元数据
├── web/                         # Next.js 应用
│   ├── app/
│   │   ├── page.tsx             # 首页时间轴
│   │   ├── [year]/page.tsx      # 年度页
│   │   ├── [year]/[month]/page.tsx
│   │   ├── r/[owner]/[name]/page.tsx
│   │   └── api/cron/
│   │       ├── daily/route.ts   # 每日：GraphQL diff → SQLite → deploy hook
│   │       └── weekly/route.ts  # 每周：刷新白名单 + 补新晋历史
│   ├── components/
│   │   ├── Timeline.tsx
│   │   ├── StarCurve.tsx
│   │   └── RepoCard.tsx
│   ├── lib/
│   │   ├── data.ts              # better-sqlite3 查询（build 时）
│   │   ├── blob.ts              # Vercel Blob 上传/下载 SQLite
│   │   └── github.ts            # GraphQL 批量查 star
│   └── package.json
└── .env.example
```

## 路线图

### v0.1 — MVP（目标：一周内上线）

- [ ] BigQuery 回填 2015-至今 ≥10k repo 日序列 → canonical SQLite
- [ ] GraphQL 抓 5,248 repo 元数据 → SQLite → 上传 Vercel Blob
- [ ] Next.js 四个核心页面（首页 / 年 / 月 / repo），build 时 better-sqlite3 查询 + SSG
- [ ] 时间轴 + star 曲线（服务端 SVG，零客户端 JS）
- [ ] Vercel Cron 每日 GraphQL diff 增量 + deploy hook
- [ ] Vercel 部署上线

### v0.2 — 叙事与发现

- 全站搜索（Pagefind / Orama 静态索引，仍无需后端数据库）
- LLM 自动生成每月叙事总结（Vercel AI Gateway，中英双语）
- 月度 / 年度可分享卡片（OG 图）
- 拐点自动检测与标注

### v0.3 — 下钻与对比（数据库登场）

- 扩展数据集到 ≥100 star（46 万 repo）—— 单文件吃力，引入 **Tinybird (ClickHouse)**
- 多 repo 对比页
- 按语言 / topic / 创建年份的切片视图
- 必要时加 Neon 存元数据、Turbopuffer 做语义检索

## 主要参考与差异化

| 项目 | 它做什么 | gitstarclub 的差异 |
|---|---|---|
| star-history.com | 单个 repo star 曲线 | 整个生态的时间索引 |
| gitstar-ranking.com | 当前总榜 | 任意时间点的榜单 |
| GitHub Trending | 当日 / 周 / 月 | 任意历史月份可回溯 |
| ossinsight.io | 分析师视角的数据洞察 | 可翻阅的编年史叙事 |

## 开发状态

正在搭骨架。还没有可运行代码。
