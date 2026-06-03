# gitstarclub 架构

> 精简的 SSG-first 架构。核心洞察：**所有页面都是对 star 事件的确定性聚合，可预算成静态 JSON，运行时零数据库。**
> 设计目标：扛 100万–1000万/天访问，运行时纯静态。产品设计见 [PRODUCT.md](./PRODUCT.md)。
>
> ⚠️ **生产数据运营方向（Vercel-only）**：本文描述的「离线 DuckDB/Parquet pipeline」是**一次性 bootstrap 形态**。
> **生产数据生命周期已完全不依赖本地计算**——白名单 / 元数据 / canonical 折叠 / 全量重算 / 发布 / 回滚
> 都搬上 **Vercel Workflow**（**✅ Phase 2–5 已线上验证，2026-06-03 status=published**）。canonical 也从单个 Parquet 重设计为 **Vercel-friendly JSON shard**。
> 详见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)。本文凡提及 DuckDB/Parquet 处，均指 **bootstrap 归档**，不是 recurring 生产依赖。

## 核心洞察

1. **唯一原子事实 = star 事件**：「某用户某天 star 了某 repo」。历史 star 数、任意窗口任意维度的排名，全是对这串事件的聚合。
2. **历史 = 一张「per-repo × 天」事实表**（`delta`，seam 前 gross / 后 net）。**日**是支持"周排名"的最细必需粒度，能精确推出 周/月/年/全时 × repo/org × flow/stock。~800 万行，bootstrap 时 **Parquet 列存 ≈ 几十 MB**（归档）；**生产阶段折叠成月/周 JSON shard**，日表不进生产读 / 重算路径。
3. **所有视图预算成 JSON**：把所有排行榜/曲线算成静态 JSON；**build 只读 JSON，运行时零数据库、零引擎、零原生模块**。首次 bootstrap 用本机 DuckDB 出 JSON；**生产 recurring 重算目标走 Vercel Workflow + JSON shard，不依赖本地引擎**（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)）。
4. **日常增量不下 GH Archive**：每日增量 = 今日总 star − 昨日总 star，GraphQL 批量查即可，秒级。

## 设计原则

- **SSG-first**：所有内容页 build 时预生成静态 HTML（或按需 ISR 首访生成后持久缓存），用户请求永不触达 Function/数据库。
  > ✅ **已达成（option C 落地）**：早前 cookie 版 i18n 让根 `layout.tsx` 变成 `force-dynamic`、内容页按请求 SSR 的临时态**已解决**——chrome 翻译移到客户端（`i18n/client.tsx` 的 `I18nProvider`/`<T>`），服务端只出默认英文静态页。构建路由表全部 `ƒ`→`○` 静态 / `●` SSG 按需 ISR。证据与决策见 [FRONTEND.md](./FRONTEND.md) §9-J / §2.5。
- **零客户端 JS**（内容页）：图表服务端渲染 SVG。
- **Vercel-first**：部署、Cron、Blob、Analytics 全在 Vercel，统一计费。仅一次性 bootstrap 用 BigQuery 扫 GH Archive（~$10，非 recurring），之后运营 100% Vercel + GitHub API。**生产 recurring 重算（历史 / 元数据 / 全量）走 Vercel Workflow**，不依赖本地（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)）。
- **不可变历史 + 小活尾**：生产 canonical 目标 = **JSON shard**（per-repo 月/周 rollup + 站点日总量 + repo 维度，Vercel 可重算）；活尾（当月）= KB 级 JSON，每日 cron 只读写它。**build 只读 JSON，不带任何引擎**。bootstrap 阶段的 `star_daily.parquet` 仅作历史归档，不在生产读 / 重算路径。

## 技术栈

| 层 | 选择 | 性质 |
|---|---|---|
| 框架 | Next.js 16（App Router + RSC + Turbopack） | Vercel 原生 |
| 语言/工具链 | TypeScript 6 · React 19 · Zod 4 · Node 24 · 包管理器 bun | 全部最新版 |
| 样式 | Tailwind 4 + Material 3 Expressive tokens（`material-color-utilities` 生成）；组件库待定（`@material/web` 或自建） | M3E |
| 字体 | Plus Jakarta Sans（几何变量无衬线）+ Geist Mono（数字/repo 名） | M3E 字体 |
| **核心数据** | **JSON 视图**（build / 运行时读）+ JSON 活尾（当月，cron 读写）；生产 canonical = **JSON shard**（目标，[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)） | 均存 Vercel Blob |
| 对象存储 | Vercel Blob（canonical JSON shard + JSON 视图 + 预生成 OG 图；bootstrap Parquet 归档） | Vercel 原生 |
| 日常采集 | **Vercel Cron + Function**（GraphQL 批量查 + JSON 视图覆盖，已实现） | Vercel 原生 |
| 生产重算（历史/元数据/全量） | **Vercel Workflow**（多 step + Blob checkpoint） | Vercel 原生 |
| 一次性 bootstrap | **BigQuery**（GH Archive，含稳定 `repo.id`）+ 本机 DuckDB → Parquet | 一次性 ~$10，归档 |
| 部署 | Vercel | |
| Web 分析 | Vercel Analytics + Speed Insights · **GA4**（`NEXT_PUBLIC_GA_ID`） | |
| 错误追踪 | Sentry | Vercel Marketplace |

**MVP 不使用**：自建 ClickHouse/Tinybird、Neon/Postgres、Redis、Inngest、GitHub Actions、v0、tRPC。
理由：所有视图预算成 JSON，运行时无需查询引擎；日常采集 GraphQL Function 即可；历史/元数据/全量重算用 **Vercel Workflow**（自带队列 + 持久化 + 重试，无需 Inngest/GitHub Actions）；bootstrap 才一次性用 BigQuery（~$10，非 recurring），之后日常运营不再碰 GCP。

## 预告页（landing，已上线）

主 SSG 应用就绪前，先用一个**独立的纯静态预告页**占位 gitstarclub.com，零运行时依赖：

- 模板 `src/index.html` + 构建脚本 `build.mjs`（bun 运行，无框架）：每次部署注入**构建时刻的 UTC + JST 双时间戳**写入页脚 → 生成 `public/index.html`，并拷贝 `assets/` 下的 OG 图与 favicon。脚本经 `bun ./build.mjs` / `bun ./render-assets.mjs` 运行（bun 在 Vercel 构建镜像自带，产物与 node 一致）
- Vercel 项目 framework=Other，输出目录 `public/`；CLI `vercel --prod` 部署，生产域名 alias 到该部署
- GA4 以内嵌 gtag 脚本上报（静态页读不到运行时环境变量）
- OG 图（1200×630）与 favicon 用本机 **Chrome 无头模式**渲染（脚本 `render-assets.mjs`，完整支持 Google Fonts；M3E 石墨灰 + 星金配色，与 teaser / web 应用一致），产物提交进 `assets/`。图标 svg 用 `100vmin` 锁定方形，规避无头渲染时画布宽度翻倍导致的内容偏移
- 主应用（`web/` Next.js 16）上线后，此预告页退役

## 数据流

```
┌─ 一次性 BOOTSTRAP（手动跑一次，本机/全 Node；~$10；🗄️ 归档，非 recurring）┐
│  BigQuery: 查 GH Archive WatchEvent（含 repo.id）     │
│    按 repo+day 汇总 → 导出（仅扫 type/repo.id/created）│
│  GraphQL: 元数据 + owner(+type) + current_stars(权威)│
│  本机 DuckDB：落 per-repo×天 事实表（Parquet, repo.id）│
│    + 算里程碑（破 10k/50k/100k 精确日期）→ JSON 视图  │
│  → JSON shard + JSON 视图 → Vercel Blob（之后由 Vercel 接管）│
└─────────────────────────────────────────────────────┘

┌─ 生产重算（Vercel WORKFLOW，多 step + Blob checkpoint；见 VERCEL-DATA-OPERATIONS §10）┐
│  Cron 触发 → Workflow 编排 steps：                   │
│  whitelist → rename → metadata（分桶）→ fold（月/周）→ │
│  recompute（rank/entity/heatmap 写 views/<run_id>）→  │
│  validate（闸门）→ publish（切 views/latest 指针）→ gc │
│  全程无 DuckDB/Parquet；大文件走 Blob 直链          │
│  （step 详表见 VERCEL-DATA-OPERATIONS §3.4）         │
└─────────────────────────────────────────────────────┘

┌─ 每日（Vercel Cron，JSON-only，秒级；已实现）────────┐
│  1. GraphQL 查 current_stars（~53 查询）            │
│  2. net 日增 = 今−昨；append 当月 JSON 活尾         │
│  3. 重算 hot-snapshot.json（当前 周/月/年/全时 热视图）│
│  4. revalidatePath 热集页                           │
│     cron 全程不碰 Parquet / DuckDB / 引擎           │
└─────────────────────────────────────────────────────┘

┌─ 每周（Vercel Cron，JSON-only 增量）────────────────┐
│  1. GraphQL 查 current_stars                         │
│  2. 覆盖当前周/月 rank + 当月 heatmap + hot snapshot │
│  3. 写 ops/sync-runs.json                            │
│  4. revalidatePath 当前周/月与热集页                 │
└─────────────────────────────────────────────────────┘

┌─ Build（每次 deploy）───────────────────────────────┐
│  读 JSON 视图（已预算）→ 直接烤静态页 + 服务端 SVG   │
│  零查询、零引擎、零原生模块                          │
│  → Vercel Edge CDN                                 │
└─────────────────────────────────────────────────────┘

运行时：100% 静态 HTML 走 CDN，无数据库、无引擎、无 Function 在热路径。
（✅ option C 已落地：chrome 客户端 i18n、移除 `force-dynamic`,内容页回到 `○` 静态 / `●` 按需 ISR——见 [FRONTEND.md](./FRONTEND.md) §9-J / §2.5）
```

## 关键决策

### 为什么日常增量不用 GH Archive？

每日只需"每个 repo 昨天新增多少 star"，而 `昨日增量 = 今日总数 − 昨日总数`。
GitHub GraphQL 可一次查 100 个 repo 的 `stargazerCount`，约 5,261 repo ≈ 53 个查询，几秒完成。

- 不必每天下载 1-3GB GH Archive
- net delta（净增，含取消 star）比 GH Archive 的 gross adds 更准确反映关注度
- 轻到 Vercel Cron 单 Function 就能跑，无需 Inngest

### 为什么回填用 BigQuery（评估免费方案后）？

过去 11 年的事件级历史只有 GH Archive 有。免账单的免费路子都评估过、均不可行：
- **ClickHouse 公共实例**（`play.clickhouse.com`）：`play` 账户硬限 `max_result_rows=1000`/响应、`readonly`，且表只有 `repo_name`、无 `repo.id` → 800 万行要分上万次分页、改名 repo 还对不齐。
- **自建 ClickHouse/DuckDB 摄入**：要把 11 年原始档**下载 4–12TB**（无法按类型预筛）才能滤出 WatchEvent，不现实。
- **GitHub stargazers API**：每 repo 4 万 stargazer 硬上限 + 只能采样，大 repo 历史取不全。

→ **BigQuery 一次性 ~$10**：一条 SQL、服务端聚合、含**稳定 `repo.id`**（改名正确归并）、精确又省事；回填完永不再碰 GCP（非 recurring，符合"避免散落账单"的本意）。`githubarchive.*` 列式表 `WHERE type='WatchEvent'` 只扫 type/repo.id/created_at。

### 为什么 build 读 JSON、不带引擎？

- 所有页面都是**确定性聚合、查询固定**，没有运行时临时查询需求
- 于是不在 build / 运行时放引擎：所有视图**预算成 JSON**，**build/cron/运行时只碰 JSON**，零原生模块、零数据库、零并发写
- bootstrap 阶段用 DuckDB 读 Parquet 出 JSON（一次性）；**生产 recurring 重算目标不用引擎**——直接读 canonical JSON shard、用纯 JS 做前缀和/排序（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5）
- 代价：新增切片视图要改重算逻辑（而非随手写 SQL）——MVP 视图固定，可接受

### 为什么按天存（而非月/周）？

要**周排名**，而周不整除月——日是能精确拼出 周/月/年/全时 的最小粒度，也正是 GH Archive 原生给的。日粒度 ~800 万行在 **bootstrap** 时用 Parquet 列存仅几十 MB；**生产阶段日表折叠为月/周 JSON shard**（日粒度只在 bootstrap 算里程碑 + 首次 rollup 时需要，之后冻结），生产重算只读小 shard，不依赖本地。

### org 维度零新增数据

「组织排名」= per-repo 事件**按 `owner` 分组求和**（owner 已在元数据）。owner 含组织(Organization)与个人(User)，存 `owner_type` 区分、两者都参与排名。换个分组字段再聚合一次而已。

### 数据口径的诚实瑕疵（会在 About 页说明）

- 历史曲线为 gross adds（GH Archive WatchEvent），上线后为 net delta（GraphQL diff），接缝处语义略不一致——star-history.com 同样如此
- 幸存者偏差：只回填当前 ≥10k 的 repo（org 排名同理只含其 ≥10k repo）；历史上曾火后衰退的项目缺席，接受此口径，About 页注明
- 累计 gross 曲线终点未必精确等于当前总数（历年有取消 star）；以 GraphQL 当前总数为权威锚点
- repo 改名/迁移：BigQuery 的 GH Archive 有稳定 `repo.id`，按 id 归并，改名不丢历史（`repo_name` 仅作显示；URL 用当前 `full_name` + 旧 URL 301）

### 起点 2015-01

2012-08 之前 GitHub "watch" ≠ "star"；2015 起数据稳定，作为现代开源时代起点。

### 白名单

= 当前 star ≥ 10,000 的 repo（约 5,261 个，随周变动）。普通 Vercel Cron 不跑多年历史补片；新晋者补历史和全量 metadata 刷新要拆成 Vercel Workflow 分片，按 repo id 幂等写 Blob。

## 数据模型（逻辑模型 + JSON 物理形式）

物理上没有数据库：**生产 canonical = JSON shard**（per-repo 月/周 rollup + 站点日总量 + repo 维度，Vercel 可重算，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5；bootstrap 形态是 `star_daily.parquet`，归档）；**服务 = 预算好的 JSON 视图**。先逻辑模型，再物理形式。

### 逻辑模型（概念，非物理表）

- **事实表 `star_daily(repo_id, date, delta)`** —— 每 repo 每天 star 增量（seam 前 gross / 后 net，可负）。~800 万行，bootstrap 唯一真相源，存 Parquet（归档）；**生产形态 = 折叠后的月/周 JSON shard**（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5）。所有聚合从它推。
- **维度 `repos`**：每 repo 的属主 / 语言 / 里程碑等展示与归类字段，主键用不可变数字 `id`（改名稳定），`current_stars` 为 GraphQL 权威当前总数（唯一必须精确的数）。
- **`meta`**：全局元信息——`seam_date`（gross→net 边界）等。

（字段级 schema 见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §1.2/§1.3）

### 派生 = 窗口 × 维度 × 指标（bootstrap 用 DuckDB；生产用 Workflow 纯 JS）

- **窗口**：周 / 月 / 年 / 全时
- **维度**：repo（按 `repo_id`）/ org（按 `owner` 分组，含 User 与 Organization）
- **指标**：flow（窗口内 ∑delta，"谁在涨"）/ stock（累加到窗口末、锚 `current_stars`，"谁最大"）

聚合逻辑示例（bootstrap 用下列 DuckDB SQL；**生产 Workflow 用等价纯 JS** 在 JSON shard 上做前缀和/分组，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5.4。两者都**只在数据层、非运行时**）：

```sql
-- 某月 repo 新增榜 (flow)
SELECT repo_id, SUM(delta) AS adds FROM star_daily
WHERE date BETWEEN '2024-10-01' AND '2024-10-31'
GROUP BY repo_id ORDER BY adds DESC LIMIT 100;

-- 某周 org 新增榜 (flow)：join 取 owner 再分组
SELECT r.owner, SUM(s.delta) AS adds
FROM star_daily s JOIN repos r ON s.repo_id = r.id
WHERE s.date BETWEEN :wk_start AND :wk_end
GROUP BY r.owner ORDER BY adds DESC LIMIT 100;

-- 全时总榜 (stock, repo)：current_stars 直接排
SELECT id, current_stars FROM repos ORDER BY current_stars DESC LIMIT 100;
```

### 物理：JSON 视图 artifacts（build 读，Blob 存）

数据层把所有 period × dim × metric 预算成 JSON（bootstrap 由 DuckDB 产出，生产由 Workflow 重算）：排行榜（rank）、实体曲线（entity repo/org）、热力图（heatmap）、join 表（lookup）、客户端搜索索引（search/index，v0.2）、活尾（current_month / hot-snapshot，cron 写）。

（完整 Blob 树见 [OPS.md](./OPS.md) §Blob 布局；视图 schema 见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2）

> build 把这些 JSON 直接烤成 HTML——不聚合、不带引擎、不碰原生模块。新增视图 = pipeline 多算一类 JSON。

## 渲染与分发

### 页面规模

| 类型 | 数量（单语言） |
|---|---|
| 首页 | 1 |
| 年度页 | ~11 |
| 月度页 | ~132 |
| Repo 详情页 | 约 5,261 |
| OG 图（每页一张） | 约 5.3k |
| **静态页合计** | **约 5.3k** |

> 语言走**页内 cookie 偏好**，URL 语言中立、不为语言建独立 URL ⇒ 页数即单语言数，**不 × 语言数**。

单语言 约 5.3k（语言走页内 cookie，不 × 语言数）≈ **约 5.3k 单语言静态页**（语言策略见 [SEO.md §10](./SEO.md)：页内 cookie、无独立语言 URL）。

> ⚠️ 上表是原始"repo 月度编年史"页面。新增的 **周排名 + org 维度 + 全时榜** 视图已在数据层全部预算（见数据模型）。因长尾走**按需 ISR**（懒生成、不占 build 预算，见下），org / 周页"成页"成本极低；**哪些视图独立成页**仍是待定的 PRODUCT 取舍，但已不受 build 预算约束。

### Build 时长策略（必须正视）

16k+ 页**不在 deploy 时全量构建**（会撞 45min 上限，且 deploy 本就会重置 ISR）。约束与对策：

- **Vercel build 上限 45min**：deploy 只构建**小核心**（首页 / 当年 / 当月 / 全时榜，~数十页；语言中立单一 URL，不 × 语言数），秒~分钟级；长尾交给按需 ISR
- **OG 图离线化**：OG 图**不在 build 生成**，仅在数据变化时（pipeline 侧）增量生成变化页的 OG → 存 Blob
- **数据查询**：聚合已在 pipeline 预算成 JSON 视图；build 只读对应视图 JSON 直接渲染，**不在 build 做聚合、不带引擎**
- **长尾按需 ISR（核心，见下）**：历史 / repo / org / 周页首访生成、持久缓存，不占 build 预算

### 页面分层与重建节奏（已决；按 Vercel ISR 实况修正）

> ⚠️ Vercel 上**每次 deploy 重建所有 build-时 SSG 页**，`.next/cache` 不跨 deploy 保留预渲染 HTML——"历史页 build 一次永不重生"做不到。正解：deploy 只 build 小核心，长尾走**按需 ISR**。

> **新鲜度 = 编年史（冻结）+ 脉搏（事件驱动）**。比喻报社：旧报纸归档永不重印；今天头版每天换；大新闻（老项目爆发）上头版 + 更新它那一页，但不重印整个报库。详见 [REQUIREMENTS §6](./REQUIREMENTS.md)。

| 层 | 页面 | 机制 |
|---|---|---|
| **核心（deploy 构建）** | 首页 · 当年 · 当月 · 全时榜 · `/pulse`（~数十页，语言中立单一 URL） | deploy 时 SSG；每日 cron 写 `hot-snapshot.json` + `revalidatePath` 每日刷新 |
| **mover（每日·事件驱动）** | 当日"显著在动"的 repo/org（通常几十~几百） | 每日 cron 据日增挑出（今日涨幅前 ~50 ∪ ≥ 其 90d 日均 5× 且当日 ≥200 ∪ 破里程碑）→ 刷新这些 repo/org 页 + 脉搏面 |
| **长尾（按需 ISR）** | 历史年/月/周 · 未在动的 repo/org（~16k+） | `dynamicParams=true` 且不在 `generateStaticParams` → **不在 deploy 构建**；首访生成、持久缓存；仅数据变更时 `revalidatePath` 定点失效 |
| **历史（冻结）** | 已完成 周/月/年页 | 一次生成后**永不变**，标 "as of 日期" |

**节奏**：

- **deploy**（代码/结构变更）：只构建小核心，永不逼近 45min；会重置 ISR store，长尾首访冷生成一次（10M/天下可忽略）
- **每日**：不 deploy；cron 更新 JSON 活尾 + 写 `hot-snapshot.json` + **挑出 mover 集（在动的几十~几百个）刷新它们 + 脉搏面** + revalidate 核心热集。**没动的实体与全部历史一概不碰。**
- **每周**：Vercel cron 做当前周/月 live refresh + 对变更页 `revalidatePath`（**不做 16k 全量 build**）。白名单 diff、新晋者多年回填、DuckDB 全量重算只走 Vercel Workflow 分片，不作为单个 Function。

**为什么**：16k+ 全量 build 会撞 45min，且 deploy 会重置 ISR——所以长尾交按需 ISR（懒生成、持久缓存），deploy 只管小核心。附带好处：org / 周页变"免费"（懒生成、不占 build 预算），page-surface 可放开。

**配置要点**：`cacheComponents` 关闭（开启会禁用 `dynamicParams`）；长尾 `revalidate=false`（仅靠定点失效）；热集 ISR 只读 KB 级 `hot-snapshot.json`，绝不在请求路径加载 Parquet / 引擎。

### 渲染策略

- **build 时**：读 pipeline 预算好的 JSON 视图 → 直接渲染静态页 → Vercel Edge CDN（不聚合、不带引擎）
- **运行时**：用户请求 99.99% 命中边缘缓存（0 查询、热路径 0 Function）；仅热集 ISR 在被 cron revalidate 后、由首个请求触发再生跑一次轻量 Function（读 KB 快照）
- **每日更新**：见下「每日 cron 的无状态机制」

### Vercel cron 机制（JSON-only，无需碰 Parquet/引擎）

每日/每周 cron 都只更新**当月 JSON 活尾与当前周期 rank**（KB 级），不下载/改写大文件，机制极简：

```
1. GraphQL 查约 5,261 repo current_stars（~53 查询）
2. 读 current_month.json（Blob，KB）← 拿昨日值算 net 日增
3. append 今日：per-repo 日增 + daily_total；更新 current_stars
4. 写回 current_month.json（覆盖即可——当月内 append-only）
5. 挑 mover 集：今日涨幅前 ~50 ∪（今日 ≥ 其 90d 日均 5× 且当日净增 ≥200）∪ 破里程碑（几十~几百个）
6. 重算 hot-snapshot.json、当前周 rank、当前月 rank、当月 heatmap → Blob
7. 写 ops/sync-runs.json；revalidatePath：核心热集（首页 / 当年 / 当月 / 全时 / pulse）+ 当前周/月页
   （没动的实体 + 全部历史都不碰；不做全量 rebuild，长尾按需 ISR）
```

**并发与原子性**：
- cron 只动当月小 JSON（写 `live/*` 覆盖层）；base 视图由 Workflow 全量重算后**切 `views/latest.json` 指针**发布（见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7）。live 覆盖层与 base 发布层前缀不重叠，天然与 cron 隔离
- current_month.json 当月内 append-only，覆盖写最坏只让某次请求读到滞后一天的热力图，无半写风险；base 发布用指针原子切换、可回滚

**资源核对**：
- cron：只处理 KB 级 JSON + 53 GraphQL，内存 / 时间 / tmp 全不构成约束（秒级）
- DuckDB + Parquet 只在**一次性 bootstrap** 里跑；**生产的历史 / 元数据 / 全量刷新走 Vercel Workflow 分片**（纯 JS + JSON shard，无引擎）；build / 普通 cron / 运行时无任何查询引擎或原生模块

### GraphQL 限额核对

GitHub GraphQL 按 point 计费，**5,000 points/小时**。查 `stargazerCount` 这类标量字段的 query 成本极低（通常 1 point/query）。约 5,261 repo / 100 per query ≈ **53 query ≈ 53 points**，占小时额度的 ~1%。完全安全。元数据回填（含 topics 等）成本略高但仍远低于上限。

### 性能策略（为 10M/天）

> ✅ 下表「完全 SSG / Function 归零」**已达成**：option C 落地后 chrome 走客户端 i18n、移除 `force-dynamic`,内容页回到 `○` 静态 / `●` 按需 ISR（构建路由表证据见 [FRONTEND.md](./FRONTEND.md) §2.5 / §9-J）。

| 策略 | 目的 |
|---|---|
| 完全 SSG，无 SSR | Function 调用归零 |
| HTML < 20KB | 直接降 bandwidth |
| 内容页零客户端 JS | 图表服务端渲染 SVG |
| `Cache-Control: s-maxage=86400, stale-while-revalidate` | 历史页强缓存 |
| 字体子集化 + woff2 | Plus Jakarta Sans 子集控制在 ~30KB |
| OG 图预生成存 Blob | 不消耗 Function |

### Bandwidth 防御阶梯

10M/天主要成本是 bandwidth（约 15TB/月）：

1. **MVP – 1M/天**：纯 Vercel Pro，~$40–100/月，先验证真实流量
2. **1M – 5M/天**：极致压缩（Brotli 11、精简 HTML）
3. **5M+/天**：Vercel 前挂 Cloudflare 吸收 egress，可砍 80–90% → ~$200–400/月

## 运维 / 数据质量 / 合规

### 时间与时区

- **存储**：一律 UTC。每日 star 聚合按 **UTC 天边界**（与 GH Archive 一致），避免边界歧义
- **显示**：凡出现具体时间点处（如 "last synced"、里程碑达成时刻），**双时间显示 UTC + JST**（日本时间）
- JA locale 默认以 JST 为主、UTC 为辅；其余 locale 以 UTC 为主、JST 为辅
- 日期粒度的数据（某日新增 star）不涉及时区换算，按 UTC 日呈现

### 数据校验 / 对账

两个来源会漂移：GH Archive（BigQuery）历史是 **gross adds**（只记加 star，数不到取消）；GraphQL 是**权威当前总数**。

- 每日 cron 抓到 GraphQL `current_stars` 后，与"按 adds 累加出的总数"比对
- 漂移超阈值（如 > 2%）时，**以 GraphQL 为权威锚点**：`current_stars` 直接取 GraphQL；历史 `total_end` 估算用新折扣重锚；记录 `sync_runs.total_drift_pct`
- 当前 star 数始终精确；历史曲线形状保留（gross），仅终点锚定
- pipeline sanity check：单日新增极端突刺打日志告警；net 日增允许为负（取消 star）

### 合规 / 署名

- **GH Archive**：数据按其公开条款使用，About 页注明来源 "Data from GH Archive (gharchive.org)"
- **GitHub**：通过官方 GraphQL/Search API 取数，遵守 ToS 与限额；仅展示公开 repo 公开数据
- About 页声明数据口径（gross vs net、幸存者偏差、起点 2015）与来源链接

### 无障碍（a11y）

- SVG 图表（star 曲线 / 热力图）带 `<title>` + `aria-label`，并提供视觉隐藏的**数据表 fallback** 供屏幕阅读器
- 语义化 HTML（`<main>`/`<nav>`/`<article>`），面包屑用 `<nav aria-label>`
- M3 amber/teal 角色对暖调 surface 满足 WCAG AA 对比度（M3 tone 映射保证 on-* 配对可读），明暗双模式均达标
- 键盘可达：所有内链可 Tab 聚焦，focus 态可见

## 演进路线（数据库何时引入）

| 阶段 | 触发条件 | 引入 |
|---|---|---|
| **MVP** | — | JSON shard canonical + JSON 视图，纯静态（bootstrap 用 Parquet 一次性产出） |
| **v0.2** | 叙事与发现（搜索 / 叙事 / 拐点 / 分享卡片） | ✅ 四条主线全部已上线：搜索（MiniSearch + `search/index.json` + `/search-index`）、月度叙事（**确定性模板、无 AI**）、拐点标记、榜单 OG 卡 + 分享按钮。**v0.2 不引入任何新数据层 / AI** |
| **v0.3** | 扩到 ≥100 star（46 万 repo），单文件吃力 | **Tinybird (ClickHouse)** 作主库；可能加 **Neon** 存元数据 |
| later | 用户系统 / 对比 / 个性化 | Neon + 运行时查询；Turbopuffer 向量检索 |

> ClickHouse 的引入留作 v0.3 真实扩展动力，而非 MVP 硬塞。

## 成本估算

| 阶段 | 月成本 |
|---|---|
| MVP（< 100k/天） | ~$20（Vercel Pro）+ 一次性回填 ~$10（BigQuery，一次性） |
| 1M/天 | ~$40–100 |
| 10M/天（纯 Vercel） | ~$2100（bandwidth 为主） |
| 10M/天（前挂 Cloudflare） | ~$200–400 |
