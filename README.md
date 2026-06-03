# gitstarclub

> **状态（2026-06-03）** — v0.1 MVP + Vercel-only 数据生命周期 **Phase 2–5 已线上验证**（`status=published`）；
> v0.2 **全站搜索已上线**。生产数据全流程（白名单→元数据→改名→月+周折叠→重算→校验→发布→版本 GC→回滚）由
> **Vercel Workflow** 每周 cron 自动承载，**零本地依赖、零手动触发**；离线 parity 12,899 视图与 DuckDB 逐字节一致。
> 详见 [docs/VERCEL-DATA-OPERATIONS.md](docs/VERCEL-DATA-OPERATIONS.md) §10、文档总索引 [docs/README.md](docs/README.md)。
>
> **Cron**（3 条，见 [docs/OPS.md](docs/OPS.md) §Cron）：`/api/cron/daily` `0 3 * * *` + `/api/cron/weekly` `0 4 * * 0`（live 活尾）
> + `/api/workflows/refresh/start` `0 6 * * 0`（L3 全量刷新）。
>
> **i18n（option C）**：英文默认 UI 语言；日/简中/繁中/韩/西/法 经 `gsc_lang` cookie 页内切换、URL 不变；页面 BODY 静态英文，
> 仅 chrome 客户端水合后切换——见 [docs/FRONTEND.md](docs/FRONTEND.md) §2.5、[docs/SEO.md](docs/SEO.md) §10。
>
> `pipeline/backfill` 的 BigQuery + 本机 DuckDB 仅作**一次性 bootstrap / 历史归档**，非日常运营路径。

> 一本可浏览的 GitHub 开源编年史 —— 按月 / 季 / 年回看哪些项目正在被关注。

## 是什么

`gitstarclub` 把整个 GitHub 上**值得关注的开源项目**按时间维度索引，让你可以：

- 翻到任意一个月份，看那个月**最受关注**的项目是什么
- 看任意 repo 的完整 star 曲线和"何时爆发"的拐点
- 用时间作为第一导航，像翻阅编年史一样浏览开源世界
- 用导航栏搜索框直接跳到任意 repo / owner（客户端即时检索，typo 容错）

不同于 GitHub Trending（只看当下）或 star-history（只看单个 repo），`gitstarclub` 提供的是**可回溯的、有结构的、有叙事的**开源历史视角。

## MVP 范围

| 项 | 决定 |
|---|---|
| 数据集 | 公开 repo，star ≥ **10,000**（2026-05 实测约 5,248 个，当前约 5,261） |
| 时间范围 | 2015-01 至今 |
| 数据源 | [GH Archive](https://www.gharchive.org/) + GitHub GraphQL API |
| 核心页面 | 首页 / 脉搏 / 总榜 / 年月周榜 / GitHub 风格 Repo 详情页 |
| 渲染 | JSON 视图驱动；热页 `○` 静态、长尾 repo/org/rankings `●` 按需 ISR；chrome 客户端 i18n（option C，不再 force-dynamic） |
| 语言 | 英文默认；下拉切换日文、简中、繁中、韩文、西文、法文；URL 不带语言前缀 |
| SEO | sitemap 分片 + schema.org + 每页 OG（build 时生成），见 docs/SEO.md |
| 核心数据 | **JSON 视图**（build / 运行时只读）+ JSON 活尾（当月，cron 读写）；运行时无数据库。生产 canonical = **Vercel-friendly JSON shard**（`canonical/v2/*`，脱离本地 Parquet/DuckDB，**✅ 已实现**，见 [docs/VERCEL-DATA-OPERATIONS.md](docs/VERCEL-DATA-OPERATIONS.md)） |
| 一次性 bootstrap | **BigQuery**（GH Archive，含稳定 repo.id）+ 本机 DuckDB → Parquet 事实表，~$10。**仅首次冷启动 / 历史归档**，非日常运营路径 |
| 日常采集 | **Vercel Cron + 单 Function**：GraphQL 批量查当前 star，diff 出增量（已实现）；元数据 / 月+周折叠 / 全量重算 / 发布 / GC 走 **Vercel Workflow**（**✅ Phase 2–5 已线上验证**，每周 cron 全自动） |
| 框架 | Next.js 16（App Router + RSC + Turbopack） |
| 语言/工具链 | TypeScript 6 · React 19 · Zod 4 · Tailwind 4 · 包管理器 **bun** · Node 24 |
| 部署 | Vercel（统一计费） |
| 扛量目标 | 100万–1000万/天 |

> v0.2 之后再加：LLM 月度叙事、主题聚类、相似推荐、对比页、用户系统、下钻到 ≥100 star 的"观察层"。

## 数据规模直觉

GitHub Search API 实测（2026-05）：

| 门槛 | repo 数量 |
|---|---|
| ≥ 100 stars | 460,324 |
| ≥ 1,000 stars | 62,174 |
| **≥ 10,000 stars (MVP)** | **5,248**（当前约 5,261） |

MVP 这一层：

- 我们只关心这约 5,261 个 repo 的 star（约 1.3 亿次）；存成 per-repo×天 事实表 ≈ **800 万行**，Parquet 列存仅几十 MB（只在离线）
- bootstrap canonical = **Parquet 事实表**（离线，几十 MB）；**生产 canonical 已折叠为 `canonical/v2` JSON shard**（Vercel 无引擎重算）；服务层 = 预算好的 **JSON 视图**（build / 运行时只读，零引擎）
- 一次性回填走 **BigQuery**（查 GH Archive，~$10、含稳定 repo.id；评估过免费的 ClickHouse 公共实例/自建均不可行），日常增量靠 GraphQL diff
- 全量 LLM 摘要：**$5-10**（Claude Haiku，留待 v0.2）

## 项目结构（初版）

```
gitstarclub/
├── README.md
├── docs/                          # 15 篇设计/运维文档；索引与阅读顺序见 docs/README.md
│   ├── README.md                  # 📑 文档总索引 + 单一真相源归属图 + 阅读顺序
│   ├── REQUIREMENTS.md            # 需求基准（repo/视图计数口径的单一源）
│   ├── ARCHITECTURE.md            # 技术栈、数据流、数据模型、扛量、页面分层
│   ├── VERCEL-DATA-OPERATIONS.md  # Vercel-only 数据生命周期（Workflow/折叠/发布回滚，✅ 线上验证）
│   ├── DATA-CONTRACTS.md          # 每个产物的 Zod schema（构建侧类型唯一事实源）
│   ├── PIPELINE.md  RANKING.md  OPS.md  TESTING.md
│   ├── FRONTEND.md  SEO.md  PRODUCT.md  DESIGN-SYSTEM.md  INFORMATION-ARCHITECTURE.md
│   └── IMPLEMENTATION-PLAN.md     # v0.1 里程碑 + v0.2/v0.3 范围与设计
│
├── pipeline/backfill/             # 🗄️ 一次性 bootstrap / 历史归档（本机 / 全 Node，非日常运营）
│   ├── 01-whitelist.mjs           # Search ≥10k 自适应分桶 → whitelist
│   ├── 02-extract.sql             # BigQuery 查 GH Archive 日序列（含 repo.id）
│   ├── 03-metadata.mjs            # GraphQL 元数据
│   ├── 04-rollup.mjs              # DuckDB → Parquet 事实表 + 里程碑
│   ├── 05-precompute.mjs          # DuckDB → 全部 JSON 视图
│   ├── 06-upload.mjs              # 上传 Vercel Blob（节流）
│   └── 07-export-v2.mjs           # 导出 canonical/v2 JSON shard（脱离 Parquet）
│
├── web/                           # Next.js 16 应用（App Router + RSC + Turbopack）
│   ├── app/
│   │   ├── page.tsx               # 首页 = Pulse / 脉搏
│   │   ├── pulse/  about/         # 脉搏 / 关于
│   │   ├── rankings/[year]/[period]/   # 全时 / 年 / 月 / 周榜
│   │   ├── [owner]/[name]/        # GitHub 风格 repo URL（+ opengraph-image）
│   │   ├── o/[login]/             # org / owner 页
│   │   ├── search-index/route.ts  # 客户端搜索索引端点（服务端读版本化产物 + CDN s-maxage）
│   │   ├── api/{cron/daily, cron/weekly, workflows/refresh/start, lang}/route.ts
│   │   ├── _explore/              # Chrome · SearchBox · RankingList · Heatmap · StarCurve · Breadcrumbs · Footer · JsonLd · RegisterSW
│   │   ├── components/            # ThemeToggle · LanguageSwitcher
│   │   ├── robots.ts  sitemap.ts  manifest.ts  opengraph-image.tsx
│   │   └── layout.tsx  template.tsx  globals.css
│   ├── lib/
│   │   ├── contracts/             # Zod schema（构建侧类型唯一事实源）
│   │   ├── data/                  # 读取器：fetch Blob + Zod parse + React cache
│   │   ├── workflows/             # L3 refresh workflow + steps（recompute / fold / gc / …）
│   │   ├── search/                # MiniSearch 纯核心（SearchBox 懒加载）
│   │   ├── i18n/                  # 7 语手写字典 + 客户端 I18nProvider（option C）
│   │   ├── observability/         # 告警 / 健康（alert.ts）
│   │   ├── cron/                  # live-refresh（当月活尾）
│   │   └── format.ts  seo.ts  jsonld.ts  periods.ts  github.ts
│   └── vercel.json                # 3 条 cron（daily / weekly / refresh-workflow）
│
├── src/index.html  assets/  build.mjs  render-assets.mjs   # 🗄️ 已退役的预告页（纯静态，保留备查）
└── .env.example
```

## 路线图

> 概览如下；里程碑 + v0.2/v0.3 范围与设计均见 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)（路线图状态-of-record）。

### v0.1 — MVP（✅ 已上线）

- [x] 预告页上线（gitstarclub.com，M3 Expressive 静态页 + 明暗双模式 + GA4 + UTC/JST 页脚时间戳 + OG/favicon）
- [x] OG 图 / favicon 渲染为 M3E 石墨灰+星金配色（`assets/og.html`、`assets/icon.html`、`favicon.svg`，经 `render-assets.mjs` 出图）
- [x] Next.js 16 骨架（TS6 / React19 / Zod4 / Tailwind4 / bun）
- [x] BigQuery 回填 2015-至今 ≥10k repo 日序列 → Parquet 事实表（**一次性 bootstrap**，非 recurring）
- [x] GraphQL 抓元数据 + owner + current_stars → JSON → 上传 Vercel Blob
- [x] Next.js 四个核心页面（首页 / 年 / 月 / repo），build 读预算 JSON 视图 + SSG
- [x] 时间轴 + star 曲线（服务端 SVG，零客户端 JS）
- [x] Vercel Cron 每日 / 每周 live refresh → 活尾 + revalidate（已实现）
- [x] **Vercel Workflow** 承载白名单 / 元数据 / 改名 / 月+周折叠 / rank+entity+heatmap 全量重算 / 校验 / 发布 / 版本 GC（脱离本地、每周 cron 全自动，**Phase 2–5 已线上验证**，见 [docs/VERCEL-DATA-OPERATIONS.md](docs/VERCEL-DATA-OPERATIONS.md)）
- [x] Vercel 部署上线

### v0.2 — 叙事与发现

- ✅ 全站搜索已上线（导航栏 MiniSearch 即时检索；构建期 `search/index.json` + `/search-index` CDN 路由，仍无需后端数据库）
- LLM 自动生成每月叙事总结（Vercel AI Gateway，中英双语）
- ✅ 月度 / 年度可分享卡片（榜单 OG 卡 + 分享按钮）
- ✅ 拐点自动检测与标注（已实现：`entity/repo.inflections` + StarCurve 标记）

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

- **生产站已切到 Next.js Web 应用**：`gitstarclub.com` / `www.gitstarclub.com` 现在指向 Vercel 项目 `zkscio/gitstarclub.com`（Root Directory = `web`）。
- **测试环境使用同一 Vercel 项目的 Preview deployment**：`pre.gitstarclub.com` 已指向 `https://gitstarclub-6pxbb945v-zkscio.vercel.app`，并由 Vercel Preview Protection 保持私有。
- **域名入口已整理**：正式入口只看 `gitstarclub.com` / `www.gitstarclub.com`，测试入口只看 `pre.gitstarclub.com`；随机 `gitstarclub-<hash>-zkscio.vercel.app` 只作为 Vercel inspect/promote/回滚用。
- **旧项目 `gitstarclub-web` 暂保留为回滚参考**：后续部署不要再使用；确认生产与 `pre` 稳定后再删除旧项目。
- **信息架构已调整为“脉搏 / 总榜 / GitHub 风格 repo URL”**：`/` 与 `/pulse` 展示本周、本月、本年脉搏；`/rankings` 收纳 all-time、年度、月度、周度历史；项目详情页使用 `/{owner}/{repo}`，语言改为页内偏好而非 URL 前缀。详见 `docs/INFORMATION-ARCHITECTURE.md`。
- **榜单视觉约束**：总榜的仓库 / 组织双栏使用固定行高、单行截断与同类 secondary pill，确保同数量榜单在桌面端高度一致。
- **Daily cron 已真实跑通**：2026-05-31 首次触发遇到 GitHub GraphQL `403`，随后加入批次 pacing / `Retry-After` 限流处理并把函数预算调到 800s；复测已写入 `current_month.json` 与 `hot-snapshot.json`，并通过 live-view contract 校验。
