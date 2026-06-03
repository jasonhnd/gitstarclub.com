# gitstarclub

> 2026-06-03 Vercel cron note: all scheduled entrypoints now run in Vercel.
> `/api/cron/daily` `0 3 * * *` + `/api/cron/weekly` `0 4 * * 0` refresh the live
> JSON tail; `/api/workflows/refresh/start` `0 6 * * 0` triggers the managed L3
> refresh workflow (whitelist → metadata → fold → recompute → publish → GC).
>
> 数据运营方向：每日 / 每周 live cron + 每周 L3 workflow 全部 **Vercel-only、零本地依赖、零手动触发**。
> **生产数据生命周期（白名单 / 元数据 / 改名 / 月+周折叠 / 全量重算 / 校验 / 发布 / 版本 GC / 回滚）由
> Vercel Workflow 承载**——**Phase 2–5 已线上验证（2026-06-03 `status=published`）：重算 →
> `views/<run_id>/**` → validate → 切 `views/latest.json` 指针 → 版本 GC；离线 parity 12,899 视图与
> DuckDB 逐字节一致；seam-aware 折叠用合成+集成测试覆盖**，见
> [docs/VERCEL-DATA-OPERATIONS.md](docs/VERCEL-DATA-OPERATIONS.md)。`pipeline/backfill`
> 的 BigQuery + 本机 DuckDB 仅作为**一次性 bootstrap / 历史归档**，不再是日常运营路径。
>
> 2026-06-01 i18n note: English is the default UI language. Other languages are
> selected from a compact dropdown and stored in the `gsc_lang` cookie without
> changing the URL. The client writes the cookie and refreshes the current RSC
> view immediately. Supported UI languages are English, Japanese, Simplified
> Chinese, Traditional Chinese, Korean, Spanish, and French.
>
> i18n rendering (option C): page bodies are static/ISR and rendered in the
> default locale (English) so they stay cacheable on the CDN; only the chrome
> (nav, footer, section/UI labels) is translated client-side via an
> `I18nProvider` (`web/lib/i18n/client.tsx`) that reads the `gsc_lang` cookie
> after hydration. Data (rankings, numbers, repo names, dates) is
> locale-independent and never translated.
>
> 2026-06-03 v0.2 note: 全站搜索已落地（导航栏搜索框）——recompute 派生 `search/index.json`，客户端
> MiniSearch 即时检索（prefix + typo 容错 + 按 stars 加权），**零运行时后端、走 CDN**，索引随每次
> recompute 刷新。见 [docs/V0.2-DESIGN.md](docs/V0.2-DESIGN.md) §1。

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
- canonical = **Parquet 事实表**（离线，几十 MB）；服务层 = DuckDB 预算好的 **JSON 视图**（build 只读，运行时零引擎）
- 一次性回填走 **BigQuery**（查 GH Archive，~$10、含稳定 repo.id；评估过免费的 ClickHouse 公共实例/自建均不可行），日常增量靠 GraphQL diff
- 全量 LLM 摘要：**$5-10**（Claude Haiku，留待 v0.2）

## 项目结构（初版）

```
gitstarclub/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          # 技术栈、数据流、数据模型、扛量、build/cron 机制
│   ├── VERCEL-DATA-OPERATIONS.md # Vercel-only 数据运营设计（Workflow/canonical shard/月+周折叠/发布回滚，✅ 已线上验证）
│   ├── PRODUCT.md               # 页面设计、URL、调性、i18n、命名
│   ├── SEO.md                   # sitemap、meta、结构化数据、OG、多语言 SEO
│   └── TESTING.md               # 测试策略：数据质量/视觉回归/a11y/E2E/性能/跨浏览器
│
│   # ── 预告页（已上线 gitstarclub.com，纯静态零依赖）──
├── src/index.html               # 预告页模板（含 {{BUILD_UTC/JST/ISO}} 占位符）
├── assets/                      # OG 图 + favicon 源与产物（M3E 石墨灰+星金）
│   ├── og.html / icon.html      # Chrome 无头渲染源（M3E：Plus Jakarta Sans + 石墨灰+金）
│   ├── og.png (1200×630)        # 社交分享图
│   ├── favicon.svg / favicon.png / apple-touch-icon.png
├── render-assets.mjs            # 无头 Chrome 渲染 og/favicon PNG（仅源变更时重跑）
├── build.mjs                    # 注入 UTC+JST 时间戳 → 生成 public/，拷贝 assets
├── package.json                 # 脚本：render（出图）/ build（部署）
├── public/                      # 构建产物（gitignore）：index.html + 图标 + og
│
├── pipeline/                    # 🗄️ bootstrap 归档（一次性 / 灾难重建，非日常运营路径）
│   └── backfill/                # 一次性 11 年回填（本机 / 全 Node；产物上传后由 Vercel 接管）
│       ├── 02-extract.sql       # BigQuery 查 GH Archive 日序列（含 repo.id）
│       ├── 04-rollup.mjs         # 本机 DuckDB → Parquet 事实表 + 里程碑
│       ├── 05-precompute.mjs     # 本机 DuckDB → 全部 JSON 视图
│       └── 06-upload.mjs         # 上传 Vercel Blob（节流 <75/s）
├── web/                         # Next.js 16 应用
│   ├── app/
│   │   ├── page.tsx             # 首页 = Pulse / 脉搏
│   │   ├── pulse/page.tsx
│   │   ├── rankings/page.tsx
│   │   ├── rankings/[year]/page.tsx
│   │   ├── rankings/[year]/[period]/page.tsx
│   │   ├── [owner]/[name]/page.tsx # GitHub 风格 repo URL
│   │   ├── o/[login]/page.tsx
│   │   ├── about/page.tsx
│   │   └── api/
│   │       ├── cron/daily/route.ts
│   │       └── lang/route.ts     # 页内语言偏好 cookie
│   ├── components/
│   │   ├── Timeline.tsx
│   │   ├── StarCurve.tsx
│   │   └── RepoCard.tsx
│   ├── lib/
│   │   ├── data.ts              # 读预算 JSON 视图（build 时）
│   │   ├── blob.ts              # Vercel Blob 读写 JSON 视图 / 活尾
│   │   └── github.ts            # GraphQL 批量查 star
│   └── package.json
└── .env.example
```

## 路线图

### v0.1 — MVP（目标：一周内上线）

- [x] 预告页上线（gitstarclub.com，M3 Expressive 静态页 + 明暗双模式 + GA4 + UTC/JST 页脚时间戳 + OG/favicon）
- [x] OG 图 / favicon 渲染为 M3E 石墨灰+星金配色（`assets/og.html`、`assets/icon.html`、`favicon.svg`，经 `render-assets.mjs` 出图）
- [x] Next.js 16 骨架（TS6 / React19 / Zod4 / Tailwind4 / bun）
- [ ] BigQuery 回填 2015-至今 ≥10k repo 日序列 → Parquet 事实表（**一次性 bootstrap**，非 recurring）
- [ ] GraphQL 抓元数据 + owner + current_stars → JSON → 上传 Vercel Blob
- [ ] Next.js 四个核心页面（首页 / 年 / 月 / repo），build 读预算 JSON 视图 + SSG
- [ ] 时间轴 + star 曲线（服务端 SVG，零客户端 JS）
- [x] Vercel Cron 每日 / 每周 live refresh → 活尾 + revalidate（已实现）
- [x] **Vercel Workflow** 承载白名单 / 元数据 / 改名 / 月+周折叠 / rank+entity+heatmap 全量重算 / 校验 / 发布 / 版本 GC（脱离本地、每周 cron 全自动，**Phase 2–5 已线上验证**，见 [docs/VERCEL-DATA-OPERATIONS.md](docs/VERCEL-DATA-OPERATIONS.md)）
- [ ] Vercel 部署上线

### v0.2 — 叙事与发现

- ✅ 全站搜索已上线（导航栏 MiniSearch 即时检索；构建期 `search/index.json` + `/search-index` CDN 路由，仍无需后端数据库）
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

- **生产站已切到 Next.js Web 应用**：`gitstarclub.com` / `www.gitstarclub.com` 现在指向 Vercel 项目 `zkscio/gitstarclub.com`（Root Directory = `web`）。
- **测试环境使用同一 Vercel 项目的 Preview deployment**：`pre.gitstarclub.com` 已指向 `https://gitstarclub-6pxbb945v-zkscio.vercel.app`，并由 Vercel Preview Protection 保持私有。
- **域名入口已整理**：正式入口只看 `gitstarclub.com` / `www.gitstarclub.com`，测试入口只看 `pre.gitstarclub.com`；随机 `gitstarclub-<hash>-zkscio.vercel.app` 只作为 Vercel inspect/promote/回滚用。
- **旧项目 `gitstarclub-web` 暂保留为回滚参考**：后续部署不要再使用；确认生产与 `pre` 稳定后再删除旧项目。
- **信息架构已调整为“脉搏 / 总榜 / GitHub 风格 repo URL”**：`/` 与 `/pulse` 展示本周、本月、本年脉搏；`/rankings` 收纳 all-time、年度、月度、周度历史；项目详情页使用 `/{owner}/{repo}`，语言改为页内偏好而非 URL 前缀。详见 `docs/INFORMATION-ARCHITECTURE.md`。
- **榜单视觉约束**：总榜的仓库 / 组织双栏使用固定行高、单行截断与同类 secondary pill，确保同数量榜单在桌面端高度一致。
- **Daily cron 已真实跑通**：2026-05-31 首次触发遇到 GitHub GraphQL `403`，随后加入批次 pacing / `Retry-After` 限流处理并把函数预算调到 800s；复测已写入 `current_month.json` 与 `hot-snapshot.json`，并通过 live-view contract 校验。
