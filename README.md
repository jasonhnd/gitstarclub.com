# gitstarhub

> 一本可浏览的 GitHub 开源编年史 —— 按月 / 季 / 年回看哪些项目正在被关注。

## 是什么

`gitstarhub` 把整个 GitHub 上**值得关注的开源项目**按时间维度索引，让你可以：

- 翻到任意一个月份，看那个月**最受关注**的项目是什么
- 看任意 repo 的完整 star 曲线和"何时爆发"的拐点
- 用时间作为第一导航，像翻阅编年史一样浏览开源世界

不同于 GitHub Trending（只看当下）或 star-history（只看单个 repo），`gitstarhub` 提供的是**可回溯的、有结构的、有叙事的**开源历史视角。

## MVP 范围

| 项 | 决定 |
|---|---|
| 数据集 | 公开 repo，star ≥ **10,000**（约 5,248 个，2026-05 实测） |
| 时间范围 | 2015-01 至今 |
| 数据源 | [GH Archive](https://www.gharchive.org/) + GitHub GraphQL API |
| 核心页面 | 首页时间轴 / 月度页 / Repo 详情页 |
| 存储 | Postgres（足够；将来扩到 ≥100 star 再切 ClickHouse） |
| 框架 | Next.js 15 App Router + ISR |
| 部署 | Vercel |

> v0.2 之后再加：LLM 月度叙事、主题聚类、相似推荐、对比页、用户系统、下钻到 ≥100 star 的"观察层"。

## 数据规模直觉

GitHub Search API 实测（2026-05）：

| 门槛 | repo 数量 |
|---|---|
| ≥ 100 stars | 460,324 |
| ≥ 1,000 stars | 62,174 |
| **≥ 10,000 stars (MVP)** | **5,248** |

MVP 这一层：

- Star 事件总量约 **2-4 亿条**，Postgres 单库可承载
- 全量 LLM 摘要成本：**$5-10**（Claude Haiku，留待 v0.2）
- 全量 embedding：**$2-5**（留待 v0.2）

## 项目结构（初版）

```
gitstarhub/
├── README.md
├── docs/
│   └── ARCHITECTURE.md          # 数据流、表结构、关键决策
├── pipeline/                    # 数据回填 + 增量同步
│   ├── backfill/
│   │   ├── fetch_gharchive.py   # 从 GH Archive 拉历史 WatchEvent
│   │   ├── build_whitelist.py   # 算出 ≥10k star 白名单
│   │   └── fetch_metadata.py    # GraphQL 拉 repo 元数据
│   ├── incremental/
│   │   └── daily_sync.py        # 每日增量
│   └── sql/
│       └── schema.sql           # Postgres 建表
├── web/                         # Next.js 应用
│   ├── app/
│   │   ├── page.tsx             # 首页时间轴
│   │   ├── [year]/[month]/page.tsx
│   │   └── repo/[owner]/[name]/page.tsx
│   ├── components/
│   │   ├── Timeline.tsx
│   │   ├── StarCurve.tsx
│   │   └── RepoCard.tsx
│   ├── lib/
│   │   └── db.ts
│   └── package.json
└── .env.example
```

## 路线图

### v0.1 — MVP（目标：一周内上线）

- [ ] Day 1-2：GH Archive 回填脚本，2015-至今所有 WatchEvent 落库
- [ ] Day 3：5248 repo 元数据批量抓取
- [ ] Day 4-5：Next.js 三个核心页面
- [ ] Day 6：时间轴可视化 + repo star 曲线
- [ ] Day 7：每日增量 cron + Vercel 部署

### v0.2 — 叙事与发现

- LLM 自动生成每月叙事总结（中英双语）
- 主题聚类、相似 repo 推荐
- 月度 / 年度可分享卡片（OG 图）
- 拐点自动检测与标注

### v0.3 — 下钻与对比

- 扩展数据集到 ≥100 star（46 万 repo）
- 多 repo 对比页
- 按语言 / topic / 创建年份的切片视图

## 主要参考与差异化

| 项目 | 它做什么 | gitstarhub 的差异 |
|---|---|---|
| star-history.com | 单个 repo star 曲线 | 整个生态的时间索引 |
| gitstar-ranking.com | 当前总榜 | 任意时间点的榜单 |
| GitHub Trending | 当日 / 周 / 月 | 任意历史月份可回溯 |
| ossinsight.io | 分析师视角的数据洞察 | 可翻阅的编年史叙事 |

## 开发状态

正在搭骨架。还没有可运行代码。
