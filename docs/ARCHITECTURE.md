# gitstarclub 架构

> 精简的 SSG-first 架构。核心洞察：**所有页面都是对 star 事件的确定性聚合，可离线预算成静态 JSON，运行时零数据库。**
> 设计目标：扛 100万–1000万/天访问，运行时纯静态。产品设计见 [PRODUCT.md](./PRODUCT.md)。

## 核心洞察

1. **唯一原子事实 = star 事件**：「某用户某天 star 了某 repo」。历史 star 数、任意窗口任意维度的排名，全是对这串事件的聚合。
2. **历史 = 一张「per-repo × 天」事实表**（`delta`，seam 前 gross / 后 net）。**日**是支持"周排名"的最细必需粒度，能精确推出 周/月/年/全时 × repo/org × flow/stock。~800 万行，**Parquet 列存 ≈ 几十 MB**，只活在离线 pipeline。
3. **所有视图离线预算成 JSON**：pipeline 用 DuckDB 把所有排行榜/曲线算成静态 JSON；**build 只读 JSON，运行时零数据库、零引擎、零原生模块**。
4. **日常增量不下 GH Archive**：每日增量 = 今日总 star − 昨日总 star，GraphQL 批量查即可，秒级。

## 设计原则

- **SSG-first**：所有内容页 build 时预生成静态 HTML，用户请求永不触达 Function/数据库。
- **零客户端 JS**（内容页）：图表服务端渲染 SVG。
- **Vercel-first**：部署、Cron、Blob、Analytics 全在 Vercel，统一计费。回填只一次性读免费的 ClickHouse 公共实例（零 GCP / 零账单），之后运营 100% Vercel + GitHub API。
- **不可变历史 + 小活尾**：canonical = Parquet 事实表（离线，Vercel Blob）→ DuckDB 预算成 **JSON 视图**；活尾（当月）= KB 级 JSON，每日 cron 只读写它。**build 只读 JSON，不带任何引擎**。

## 技术栈

| 层 | 选择 | 性质 |
|---|---|---|
| 框架 | Next.js 16（App Router + RSC + Turbopack） | Vercel 原生 |
| 语言/工具链 | TypeScript 6 · React 19 · Zod 4 · Node 24 · 包管理器 bun | 全部最新版 |
| 样式 | Tailwind 4 + Material 3 Expressive tokens（`material-color-utilities` 生成）；组件库待定（`@material/web` 或自建） | M3E |
| 字体 | Plus Jakarta Sans（几何变量无衬线）+ Geist Mono（数字/repo 名） | M3E 字体 |
| **核心数据** | **Parquet 事实表**（per-repo×天，离线 canonical）→ DuckDB 预算 → **JSON 视图**（build 读）+ JSON 活尾（当月，cron 读写） | 均存 Vercel Blob |
| 对象存储 | Vercel Blob（Parquet canonical + JSON 视图 + 预生成 OG 图） | Vercel 原生 |
| 日常采集 | **Vercel Cron + 单 Function**（GraphQL 批量查） | Vercel 原生 |
| 一次性回填 | **GH Archive via ClickHouse 公共实例**（免费免注册）+ 本机 DuckDB | 一次性、零外部账单 |
| 部署 | Vercel | |
| Web 分析 | Vercel Analytics + Speed Insights · **GA4**（`NEXT_PUBLIC_GA_ID`） | |
| 错误追踪 | Sentry | Vercel Marketplace |

**MVP 不使用**：BigQuery/GCP（回填改用免费 ClickHouse 公共实例）、自建 ClickHouse/Tinybird、Neon/Postgres、Redis、Inngest、GitHub Actions、v0、tRPC。
理由：所有视图离线预算成 JSON，运行时无需查询引擎；日常采集 GraphQL 单 Function 即可；回填一次性、零账单。（"用 ClickHouse" 仅指一次性**读**其免费公共实例，不自建、不托管。）

## 预告页（landing，已上线）

主 SSG 应用就绪前，先用一个**独立的纯静态预告页**占位 gitstarclub.com，零运行时依赖：

- 模板 `src/index.html` + 构建脚本 `build.mjs`（bun 运行，无框架）：每次部署注入**构建时刻的 UTC + JST 双时间戳**写入页脚 → 生成 `public/index.html`，并拷贝 `assets/` 下的 OG 图与 favicon。脚本经 `bun ./build.mjs` / `bun ./render-assets.mjs` 运行（bun 在 Vercel 构建镜像自带，产物与 node 一致）
- Vercel 项目 framework=Other，输出目录 `public/`；CLI `vercel --prod` 部署，生产域名 alias 到该部署
- GA4 以内嵌 gtag 脚本上报（静态页读不到运行时环境变量）
- OG 图（1200×630）与 favicon 用本机 **Chrome 无头模式**渲染（脚本 `render-assets.mjs`，完整支持 Google Fonts；M3E 石墨灰 + 星金配色，与 teaser / web 应用一致），产物提交进 `assets/`。图标 svg 用 `100vmin` 锁定方形，规避无头渲染时画布宽度翻倍导致的内容偏移
- 主应用（`web/` Next.js 16）上线后，此预告页退役

## 数据流

```
┌─ 一次性回填（手动跑一次，本机/全 Node；零外部账单）─┐
│  GH Archive via ClickHouse 公共实例（免费免注册）：  │
│    SQL 查 WatchEvent，按 repo + day 汇总 → 导出       │
│    （量大按年/按批分块；不用 BigQuery/GCP）          │
│  GraphQL: 元数据 + owner(+type) + current_stars(权威)│
│  本机 DuckDB：落 per-repo×天 事实表（Parquet）       │
│    + 算里程碑（破 10k/50k/100k 精确日期）           │
│  → Parquet canonical + repos.json → Vercel Blob      │
└─────────────────────────────────────────────────────┘

┌─ 预算视图（pipeline，DuckDB → JSON）────────────────┐
│  DuckDB 读 Parquet，按 {周/月/年/全时}×{repo/org}    │
│  ×{flow 新增 / stock 总量} 全 rollup → top-N JSON    │
│  + per-repo / per-org 曲线 + 热力图 + 里程碑 → JSON  │
│  → Vercel Blob（build 直接读，运行时零引擎）         │
└─────────────────────────────────────────────────────┘

┌─ 每日（Vercel Cron，JSON-only，秒级）───────────────┐
│  1. GraphQL 查 current_stars（~53 查询）            │
│  2. net 日增 = 今−昨；append 当月 JSON 活尾         │
│  3. 重算 hot-snapshot.json（当前 周/月/年/全时 热视图）│
│  4. revalidatePath 热集页                           │
│     cron 全程不碰 Parquet / DuckDB / 引擎           │
└─────────────────────────────────────────────────────┘

┌─ 每周（Vercel Cron + Deploy Hook，全 Node）─────────┐
│  1. GitHub search ≥10k → diff 白名单                │
│  2. 新晋者：ClickHouse 公共实例补历史 → Parquet      │
│  3. 折叠当月活尾→Parquet；DuckDB 重算受影响 JSON 视图│
│  4. Deploy Hook → 全量 rebuild                       │
└─────────────────────────────────────────────────────┘

┌─ Build（每次 deploy）───────────────────────────────┐
│  读 JSON 视图（已预算）→ 直接烤静态页 + 服务端 SVG   │
│  零查询、零引擎、零原生模块                          │
│  → Vercel Edge CDN                                 │
└─────────────────────────────────────────────────────┘

运行时：100% 静态 HTML 走 CDN，无数据库、无引擎、无 Function 在热路径。
```

## 关键决策

### 为什么日常增量不用 GH Archive？

每日只需"每个 repo 昨天新增多少 star"，而 `昨日增量 = 今日总数 − 昨日总数`。
GitHub GraphQL 可一次查 100 个 repo 的 `stargazerCount`，5,248 repo ≈ 53 个查询，几秒完成。

- 不必每天下载 1-3GB GH Archive
- net delta（净增，含取消 star）比 GH Archive 的 gross adds 更准确反映关注度
- 轻到 Vercel Cron 单 Function 就能跑，无需 Inngest

### 为什么回填用 ClickHouse 公共实例（不用 BigQuery）？

过去 11 年的事件级历史只有 GH Archive 有——但 **GH Archive ≠ BigQuery**，BigQuery 只是查它的一种工具（要 GCP 账号 + ~$10）。ClickHouse 官方公共实例（`play.clickhouse.com`）免费免注册挂着同一份 GH Archive（`github_events` 表），直接 SQL 查 WatchEvent 按 repo+day 汇总导出即可，**零账号、零账单**，契合 Vercel-first / 避免外部账单。量大就按年/按批分块查。

**为什么不用 GitHub stargazers API**：每 repo 4 万 stargazer 硬上限（>4 万星的大 repo 历史取不全），且只能采样、不精确——分多日也绕不过上限。历史精度是本产品卖点，不将就。

### 为什么 build 读 JSON、引擎只在离线？

- 所有页面都是**确定性聚合、查询固定**，没有运行时临时查询需求
- 于是把引擎关进离线 pipeline：DuckDB 读 Parquet 把所有视图预算成 JSON，**build/cron/运行时只碰 JSON**，零原生模块、零数据库、零并发写
- 代价：新增切片视图要改 pipeline 重算（而非 build 里随手写 SQL）——MVP 视图固定，可接受

### 为什么按天存（而非月/周）？

要**周排名**，而周不整除月——日是能精确拼出 周/月/年/全时 的最小粒度，也正是 GH Archive 原生给的。日粒度 ~800 万行用 Parquet 列存仅几十 MB，且只在离线，对服务端零成本。

### org 维度零新增数据

「组织排名」= per-repo 事件**按 `owner` 分组求和**（owner 已在元数据）。owner 含组织(Organization)与个人(User)，存 `owner_type` 区分、两者都参与排名。换个分组字段再聚合一次而已。

### 数据口径的诚实瑕疵（会在 About 页说明）

- 历史曲线为 gross adds（GH Archive WatchEvent），上线后为 net delta（GraphQL diff），接缝处语义略不一致——star-history.com 同样如此
- 幸存者偏差：只回填当前 ≥10k 的 repo（org 排名同理只含其 ≥10k repo）；历史上曾火后衰退的项目缺席，接受此口径，About 页注明
- 累计 gross 曲线终点未必精确等于当前总数（历年有取消 star）；以 GraphQL 当前总数为权威锚点
- repo 改名/迁移：历史事件按 ClickHouse 表的 `repo_name` 匹配，极少数改名 repo 早期历史可能对不齐（无稳定 id）；影响很小，About 页注明

### 起点 2015-01

2012-08 之前 GitHub "watch" ≠ "star"；2015 起数据稳定，作为现代开源时代起点。

### 白名单

= 当前 star ≥ 10,000 的 repo（约 5,248 个）。每周 Vercel Cron 用 GitHub search 刷新，新晋者补历史一次。

## 数据模型（逻辑模型 + JSON 物理形式）

物理上没有数据库：**canonical = Parquet 事实表（离线）**，**服务 = pipeline 预算好的 JSON 视图**。先逻辑模型，再物理形式。

### 逻辑模型（概念，非物理表）

- **事实表 `star_daily(repo_id, date, delta)`** —— 每 repo 每天 star 增量（seam 前 gross / 后 net，可负）。~800 万行，**唯一真相源**，存 Parquet。所有聚合从它推。
- **维度 `repos`**：`id, node_id, owner, owner_type(User/Org), name, full_name, description, language, topics, created_at, current_stars`（GraphQL 权威）`, is_archived, crossed_10k/50k/100k, fetched_at`。
- **`meta`**：`seam_date`（gross→net 边界）、`backfilled_at`、`schema_ver`。

### 派生 = 窗口 × 维度 × 指标（DuckDB 在 pipeline 预算）

- **窗口**：周 / 月 / 年 / 全时
- **维度**：repo（按 `repo_id`）/ org（按 `owner` 分组，含 User 与 Organization）
- **指标**：flow（窗口内 ∑delta，"谁在涨"）/ stock（累加到窗口末、锚 `current_stars`，"谁最大"）

DuckDB SQL 示例（仅 pipeline 内，非运行时）：

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

DuckDB 把所有 period × dim × metric 预算成 JSON：

- `rank/{week|month|year}/{period}/{repo|org}/{flow|stock}.json` → top-N（引用 + 数值 + 名次）
- `rank/all-time/{repo|org}/stock.json`
- `entity/repo/{id}.json`、`entity/org/{login}.json` → 曲线（周/月点 + 近期日点）+ 里程碑 + 历期表 + 名次史
- `heatmap/{year|month}/{period}.json` → 站点级日/月总量
- `lookup/repos.json`、`lookup/orgs.json` → 元数据（build join 用）
- 活尾 `current_month.json`（cron 写）、`hot-snapshot.json`（cron 写，热集 ISR 读）

> build 把这些 JSON 直接烤成 HTML——不聚合、不带引擎、不碰原生模块。新增视图 = pipeline 多算一类 JSON。

## 渲染与分发

### 页面规模

| 类型 | 数量 | × 3 语言 |
|---|---|---|
| 首页 | 1 | 3 |
| 年度页 | ~11 | ~33 |
| 月度页 | ~132 | ~396 |
| Repo 详情页 | ~5,248 | ~15,744 |
| OG 图（每页一张） | ~5,400 | ~16,200 |
| **静态页合计** | **~5,400** | **~16,200** |

三语 × 5,400 ≈ **16,200 个静态页**（语言策略见 [SEO.md](./SEO.md)）。

> ⚠️ 上表是原始"repo 月度编年史"页面。新增的 **周排名 + org 维度 + 全时榜** 视图已在数据层全部预算（见数据模型），但**哪些视图独立成页**（周页 ~600/语言、org 页可能上千/语言）是待定的 PRODUCT 取舍——下文页面分层（热 / 周更 / 冻结）三层节奏对新增页同样适用。

### Build 时长策略（必须正视）

16,200 页 + 16,200 张 OG 图，全量 build 不能假设"几分钟"。约束与对策：

- **Vercel build 时间**：Pro 计划单次 build 上限 45 分钟。16,200 页若每页 ~30-100ms，渲染约 8-27 分钟，**接近但可控**；OG 图生成是大头，需分摊
- **OG 图离线化**：OG 图**不在每次 build 生成**。仅在数据变化时（pipeline 侧）增量生成变化页的 OG → 存 Blob。历史页 OG 永不重生成
- **数据查询**：聚合已在 pipeline 预算成 JSON 视图；build 只读对应视图 JSON 直接渲染，**不在 build 做聚合、不带引擎**
- **页面分层重建（核心，见下）**：按"数据是否还会变"分三层配不同节奏，让重 build 只在每周发生

### 页面分层与重建节奏（已决：解 SSG × 新鲜 × build 三角）

| 层 | 页面 | 新鲜度 | 机制 |
|---|---|---|---|
| **热集** | 首页 · 当年 · 当月（×3 语言 ≈ 9 页） | 每日 | ISR 读 Blob 上 `hot-snapshot.json`（~KB 小聚合）；每日 cron `revalidatePath` 触发再生。Function 仅再生时跑、读 KB 快照不碰大文件/引擎，用户热路径仍 100% 命中 CDN |
| **周更** | repo / org 详情页 | 每周 | build 时 SSG，每周重算 JSON 视图后随之重生；曲线尾部周级新鲜，编年史产品可接受 |
| **冻结** | 历史年 / 月页 | 永不变 | 首次 build 生成后视为 immutable，后续不再重生（Next build cache / `revalidate:false`） |

**重建节奏**：

- **每周全量 build**（周日 cron + Deploy Hook）：重生周更层 + 新历史页，~16k 页 ~8-27min——**唯一的重 build**，落在 45min 预算内
- **每日**：**不触发 deploy**；cron 更新数据 + 写 `hot-snapshot.json` + revalidate 热集 9 页，秒级完成
- **按需**：代码 / 结构变更走正常全量 deploy

**为什么这样分**：历史数据根本不变，每天重建纯浪费；repo 曲线是"历史"非"实时"，周级够用；只有首页 / 当期要每日新鲜。重 build 频率从每天降到每周，build 预算彻底脱险。

**运行时不碰大文件**：每日 cron 只读写 KB 级 JSON 活尾；热集 ISR 再生只读 KB 级 `hot-snapshot.json`，绝不在请求路径加载 Parquet 或任何引擎；周更 / 冻结层是纯静态产物。

### 渲染策略

- **build 时**：读 pipeline 预算好的 JSON 视图 → 直接渲染静态页 → Vercel Edge CDN（不聚合、不带引擎）
- **运行时**：用户请求 99.99% 命中边缘缓存（0 查询、热路径 0 Function）；仅热集 ISR 在被 cron revalidate 后、由首个请求触发再生跑一次轻量 Function（读 KB 快照）
- **每日更新**：见下「每日 cron 的无状态机制」

### 每日 cron 机制（JSON-only，无需碰 Parquet/引擎）

每日 cron 只更新**当月 JSON 活尾**（KB 级），不下载/改写大文件，机制极简：

```
1. GraphQL 查 5,248 repo current_stars（~53 查询）
2. 读 current_month.json（Blob，KB）← 拿昨日值算 net 日增
3. append 今日：per-repo 日增 + daily_total；更新 current_stars
4. 写回 current_month.json（覆盖即可——当月内 append-only）
5. 重算 hot-snapshot.json（首页 / 当年 / 当月聚合）→ Blob
6. revalidatePath 首页 / 当年 / 当月（×3 语言）→ 仅这 ~9 页按需再生
   （全量 rebuild 不在每日；改由每周 Deploy Hook 触发）
```

**并发与原子性**：
- cron 只动当月小 JSON；build 读「上次周预算的 JSON 视图 + 当月活尾 JSON」。视图 / Parquet 仅每周重算，天然与 cron 隔离，**无需每日版本化大文件**
- current_month.json 当月内 append-only，覆盖写最坏只让某次请求读到滞后一天的热力图，无半写风险；要更稳可加 `latest.json` 指针，但压力已极低

**资源核对**：
- cron：只处理 KB 级 JSON + 53 GraphQL，内存 / 时间 / tmp 全不构成约束（秒级）
- DuckDB + Parquet 只在**离线 pipeline / 每周全 Node 构建**里跑；build / cron / 运行时无任何查询引擎或原生模块

### GraphQL 限额核对

GitHub GraphQL 按 point 计费，**5,000 points/小时**。查 `stargazerCount` 这类标量字段的 query 成本极低（通常 1 point/query）。5,248 repo / 100 per query ≈ **53 query ≈ 53 points**，占小时额度的 ~1%。完全安全。元数据回填（含 topics 等）成本略高但仍远低于上限。

### 性能策略（为 10M/天）

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

两个来源会漂移：GH Archive（ClickHouse）历史是 **gross adds**（只记加 star，数不到取消）；GraphQL 是**权威当前总数**。

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
| **MVP** | — | Parquet 事实表 + JSON 视图，纯静态 |
| **v0.2** | 要全站搜索 / 月度 LLM 叙事 | Pagefind/Orama 静态搜索索引；Vercel AI Gateway 跑摘要 |
| **v0.3** | 扩到 ≥100 star（46 万 repo），单文件吃力 | **Tinybird (ClickHouse)** 作主库；可能加 **Neon** 存元数据 |
| later | 用户系统 / 对比 / 个性化 | Neon + 运行时查询；Turbopuffer 向量检索 |

> ClickHouse 的引入留作 v0.3 真实扩展动力，而非 MVP 硬塞。

## 成本估算

| 阶段 | 月成本 |
|---|---|
| MVP（< 100k/天） | ~$20（Vercel Pro）+ 一次性回填 **$0**（ClickHouse 公共实例） |
| 1M/天 | ~$40–100 |
| 10M/天（纯 Vercel） | ~$2100（bandwidth 为主） |
| 10M/天（前挂 Cloudflare） | ~$200–400 |
