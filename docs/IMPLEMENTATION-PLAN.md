# gitstarclub 实现计划（构建顺序）

> 从"文档齐全"到"逐模块开工"的桥，也是**路线图的状态-of-record**：v0.1 里程碑 M0–M5（下）+ **v0.2 / v0.3 范围与设计**（文末「v0.2」「v0.3」节）。按**依赖顺序**给里程碑，每个含产出、依赖、验收。需求基准见 [REQUIREMENTS](./REQUIREMENTS.md)，各层细节见对应文档。
> 原则：先立**契约**（类型即真相）→ 再出**真实数据** → 再让 web 接真实数据 → 扩页型 → 接 cron → SEO/上线。
>
> ⚠️ **与 Vercel-only 迁移的关系**：本文 M1 的「本机回填」是**一次性 bootstrap**；M4 的「每周 cron 白名单 diff / 新晋回填 / 折叠重算」的**生产形态目标是 Vercel Workflow，不依赖本地**——迁移分 **Phase 0–5**，见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §10。本文里程碑（M0–M5）讲「先把 MVP 跑起来」，VERCEL-DATA-OPERATIONS 讲「把生产数据路径搬离本地」，两者并行推进。

## 依赖图

```
M0 契约/脚手架
   └─ M1 回填出真实数据（一次性）
        └─ M2 web 接真实数据（替占位）
             ├─ M3 新页型（org/全时/周/pulse）
             └─ M4 每日/每周 cron
                  └─ M5 SEO / i18n / PWA / 上线
```

---

## M0 — 契约与脚手架（先于一切）

- **Zod 契约** `web/lib/contracts/`：把 [DATA-CONTRACTS](./DATA-CONTRACTS.md) 落成可校验 schema + 推导类型（**本仓已写初版**）。这是 pipeline 产出与 web 读取的唯一类型来源。
- **pipeline 脚手架** `pipeline/`：`package.json`（`@duckdb/node-api`、`@vercel/blob`；运行用 node/全 Node 环境）、`lib/github.mjs`（Search 自适应分桶 + GraphQL 批量）。
- **验收**：`tsc --noEmit` 过；契约覆盖所有视图；github 客户端能跑通一次小查询。

## M1 — bootstrap 出真实数据（🗄️ 一次性，本机/全 Node；非日常运营路径）

> 这是**首次冷启动**用的一次性 bootstrap（[PIPELINE §1](./PIPELINE.md)）。产物上传 Blob 后，recurring 刷新由 Vercel（live cron + Workflow）接管——见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) Phase 1–4。
>
> **状态**：◐ 本机 bootstrap 已跑过——`whitelist`→`extract`→`rollup`→`precompute` 已产出全套 JSON 视图并过 Zod 校验（[TESTING §1.2](./TESTING.md)：12,615 文件 0 失败）。`star_daily_gross/*.parquet`、`whitelist.json` 在 `pipeline/data/`。**上传/线上接入以 Vercel 实况为准**（页面已读 `@/lib/data`，说明 Blob 已有产物）。注：当前线上离线 parity = 12,899 视图，与此处 bootstrap 的 12,615 文件计数是不同口径（前者为线上重算产出的视图数，后者为首次冷启动精算的文件数）。

按 [PIPELINE §1](./PIPELINE.md)：
1. `whitelist`：Search `stars:>=10000` 自适应分桶 → `whitelist.json`（bootstrap 基线 ≈5,248，当前约 5,261）。
2. `extract`：BigQuery **先 dry-run 确认 ~$10**，再跑 WatchEvent→(repo.id, day, gross) → 导出 Parquet。
3. `metadata`：GraphQL → owner+type / lang / topics / createdAt / current_stars。
4. `rollup`（DuckDB）→ `star_daily.parquet` + 里程碑（cumsum 跨阈首日）+ daily_totals。
5. `precompute`（DuckDB）→ 全部 JSON 视图，**逐一过 Zod 校验**（脏数据不发布）。
6. `upload` → Vercel Blob（put 节流 <75/s）。
- **依赖**：M0。
- **验收**：Blob 上有全套真实 JSON、Zod + sanity（[TESTING §1](./TESTING.md)）全过；抽查 vue/react 等知名 repo 曲线/里程碑合理。

## M2 — web 接真实数据（把原型从占位切到真实）✅ 基本完成

按 [FRONTEND §3 + §9](./FRONTEND.md)：
- ✅ `web/lib/data/`：fetch Blob + Zod parse + `cache()`；lookup-join 已落地;占位 `_explore/data.ts` 已删除。
- ✅ 处置 §9：**B** 未知 param → `notFound()`(`[owner]/[name]`)、**E/F** i18n cookie + `metadataBase` 已收敛、**H** 去硬编码 synced 时间。**D** 非单调曲线待验证。
- ✅ 页面渲染真实 JSON（首页/rankings/月/repo/org/pulse 均读 `@/lib/data`）。
- **依赖**：M1。**验收**：核心页真实数据、`notFound` 正确 —— 已达。
- ✅ **§9-J 已解（option C）**：chrome i18n 移到客户端（`I18nProvider` 水合后读 `gsc_lang` cookie 换 chrome 字串），页面 BODY 回到默认英文 SSG/ISR、不再 `force-dynamic`，扛量模型恢复。见 [FRONTEND §2.5](./FRONTEND.md)。

## M3 — 新页型 ✅ 基本完成

- ✅ `/o/[login]`(org)、`/rankings`(全时)、`/rankings/[year]/W[week]`(周)、`/pulse`(脉搏) 已落地，全读 `@/lib/data`。
- ◐ 月/年页 **org 榜 + flow/stock 并列** 视 PRODUCT 取舍（[PRODUCT](./PRODUCT.md)、[RANKING](./RANKING.md)），按需补。
- **依赖**：M2。**验收**：各页可达、复用契约、SEO meta/canonical 就位 —— 已达。

## M4 — 每日 / 每周 cron

按 [PIPELINE §2–3](./PIPELINE.md) + [ARCHITECTURE 页面分层](./ARCHITECTURE.md)：
- ✅ `web/app/api/cron/daily`：CRON_SECRET 校验 → GraphQL current_stars → net 日增 → 更新 `current_month.json` → 重算 `hot-snapshot.json` + `live/*` 当前周期覆盖层 → `revalidatePath`（核心热集）。**已实现**。
- ✅ `web/app/api/cron/weekly`：复用 live refresh，覆盖当前周/月 + hot snapshot + `ops/sync-runs.json`。**已实现**。
- ✅ **白名单 diff / 新晋追踪 / 全量重算 / 发布 / 回滚 / canonical 月+周折叠 / 版本 GC → Vercel Workflow**（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) Phase 2–5，均已线上验证）。
- **此处现场定**（文档最薄两块）：① 当期增量聚合的 **YTD-base**（存哪/每月更新）；② mover 的 **90 天基线**数据源（每日 cron JSON-only，需备一份滚动基线）。
- **依赖**：M2/M3。
- **验收**：cron 幂等；mover 当天上 `/pulse` + 其页刷新；漂移告警。Workflow 落地后全量重算走 staging→指针→revalidate。

## M5 — SEO / i18n / PWA / 上线 ◐ 大部分落地

按 [SEO](./SEO.md) + [OPS](./OPS.md)：
- ✅ `sitemap.ts`/`robots.ts`/JSON-LD/OG/`generateMetadata` 已建；i18n 手写字典(en/ja/zh/zh-TW/ko/es/fr)已建（页内 cookie 切换，无 hreflang 矩阵）；PWA 保留（例外③）。
- ✅ 已切生产域名（`gitstarclub.com` 指 web 应用，teaser 退役，见 [OPS](./OPS.md)）。
- **验收**：[SEO 验收清单](./SEO.md) + CWV + Search Console 收录 —— 上线后待核（§9-J 已解为 option C，页面回到 SSG/ISR，扛量模型不再受 `force-dynamic` 影响）。

---

## 测试（贯穿，见 [TESTING](./TESTING.md)）
- M1：Zod schema + sanity 不变量（CI 阻断脏数据）。
- M2+：视觉回归（明暗×断点）、a11y、E2E 导航、零 JS / HTML<20KB 断言。

## 当前进度（2026-06-03 拉齐到代码现状）
- ✅ **M0 契约** `web/lib/contracts/`（common/lookup/entity/live/canonical/workflow/search）。
- ◐ **M1 bootstrap**：本机已跑出全套 JSON 视图 + Zod 校验；现为**一次性归档路径**，recurring 刷新由 Vercel 接管。
- ✅ **M2 web 接真实数据**：页面读 `@/lib/data`，占位已删，`notFound` 已落地。
- ✅ **M3 新页型**：org/rankings/周/pulse 已建。
- ✅ **M4 live cron**：每日/每周已在 Vercel 跑通（Phase 0）。
- ✅ **M5 SEO/i18n/PWA**：sitemap/robots/JSON-LD/OG（含每页 og:image 修复）/ 7 语 i18n（option C 客户端译 chrome）/ PWA 已建；已切生产域名；CWV/收录上线后核对。
- ✅ **Vercel-only Phase 2–5 已线上验证（2026-06-03 `status=published`）**：metadata/whitelist/rename（Phase 2）+ canonical/v2 shard + 读侧指针（Phase 3）+ rank/entity/heatmap 纯 JS 重算 → `views/<run_id>/**` → validate → 切 `views/latest.json` 指针（Phase 4）+ **月+周 canonical 折叠 / 版本 GC（Phase 5）**；离线 parity 12,899 视图与 DuckDB 逐字节一致；监控/告警 + 345 bun 测试。`workflow@4.3.1` + `web/lib/workflows/*`。
- ✅ **两大开口已闭合**：① §9-J 渲染模式 → **option C**（静态基底 + 客户端译 chrome）已实现，页面回 SSG/ISR；② Vercel-only **Phase 5**（折叠 / GC / backfill 归档）已完成。
- 🚧 **v0.2 叙事与发现（设计 + 进度见下「v0.2」节）已启动**：§1 **全站搜索 ✅ 已线上验证**（`search/index.json` 5,261 repo + `/search-index` CDN 路由 + 客户端 MiniSearch）、§3 **拐点检测 ✅**（`entity/repo.inflections` + StarCurve 标记）、§4 **可分享卡片 ✅**（榜单 OG 卡 + ShareButton）、§2 **月度叙事 ✅**（确定性模板、渲染时拼、无 AI）——**§1–§4 主线全部落地**；§5 **多 repo 对比（简版）🚧 进行中**（≥1 万星集叠图对比，URL 即状态，瘦路由 `/repo-curve` 复用 entity，零新数据产物/零 DB）；≥100★下钻 / 任意 repo 对比 / 聚类 / 语义检索属 v0.3，**阻塞于 DB 选型决策（见下「v0.3」节）**。

---

## v0.2 — 叙事与发现（设计 + 进度）

> 主题：让用户更容易**找到**和**读懂**开源编年史。**继续守 v0.1 硬约束**——运行时纯静态只读 JSON/Blob、零运行时引擎/数据库、Vercel-first 统一计费、零本地 recurring 依赖。凡是需要 DB 的（下钻 / 任意对比 / 语义检索）推到「v0.3」节。每项纪律同 v0.1：先离线/合成验证正确性，再上；产物落 Blob、读侧带回退；workflow step 幂等 + best-effort。
>
> **建造顺序**：① 搜索 ✅ → ② 拐点 ✅ → ③ 分享卡片补全 ✅ → ④ 月度叙事 ✅（确定性模板，**无 AI**）→ ⑤ 多 repo 对比（简版，🚧 开工；守约束、零新数据产物、零 DB）→（v0.3 闸门）DB 选型。**v0.2 §1–§4 主线全部落地；§5 简版对比进行中。**

### v0.2 §1 全站搜索 ✅ 已实现

- **目标**：导航栏搜索框，输入 repo 名 / owner / 关键词 → 即时结果 → 点进 repo/org 页。
- **技术**：客户端检索 + 构建期静态索引（MiniSearch 索引 JSON；不选 Pagefind——repo 页按需 ISR、构建期未全预渲染，且我们本就有结构化数据）。recompute 从 `repos` shard 派生 `search/index.json`（`{id, full_name, owner, language, current_stars, description}`，~5,261 条），落 Blob 走 CDN，随每次 recompute 刷新（自动含新晋 repo）。
- **✅ 已落地**：① recompute（entity/org step）派生 + Zod 契约 `lib/contracts/search.ts` + 并入 `validate`（断言条目数）；② 纯核心 `lib/search/core.ts`（prefix + fuzzy 0.2 + 按 stars 加权）+ 客户端 `app/_explore/SearchBox.tsx`（首次聚焦懒加载索引/MiniSearch、键盘 ↑↓/Enter/Esc、combobox a11y、placeholder/空态走 7 语 chrome i18n）+ 接进 `Chrome`；③ `/search-index` 路由（服务端读版本化 `views/<version>/search/index.json`，响应带 `s-maxage` 走 CDN，无产物时优雅回退空索引）。18 例单测覆盖 core/builder/契约，离线 parity 跳过该新视图，已线上验证（5,261 repo published 2026-06-03）。

### v0.2 §2 月度叙事 ✅ 已实现（确定性模板，**无 AI**）

- **目标**：每月榜页顶部一段自动生成的中英叙事（"2026 年 6 月，X 领涨……"），让数字有故事。
- **技术（确定性、零依赖、不引 AI）**：**不引 LLM / 外部依赖 / 鉴权 / Blob 产物**——月榜页本就加载该月 top movers / 增速 / 新晋，**渲染时**用纯函数 `lib/narrative.ts` `buildNarrative()` 把这些拼成一句**如实**的中英叙事。更契合本站 factual 调性、零账单、可复现、无鉴权摩擦；代价：只复述事实、没有 LLM 那种"因 X 而爆发"的因果洞察——这是刻意取舍。
- **✅ 已落地**：纯函数 `lib/narrative.ts`（`buildNarrative(input) → {en,zh}|null`，4 例单测）；月页**渲染时**用已加载的 flow/增速/新晋拼叙事 → 客户端 `Narrative` 组件（en 默认 / zh·zh-TW 水合后切，option C）；7 语 `month.narrative` 标题。**无 workflow step、无契约、无 Blob 产物、无 `ai` 依赖**。`next build` 绿、单测过。

### v0.2 §3 拐点检测与标注 ✅ 已实现

- **目标**：在 repo 的 star 曲线上自动标出"何时爆发"的拐点。
- **技术**：纯算法跑在 recompute（零新数据源、零 LLM）——对每个 repo 月度 flow 做 changepoint（flow ≥ K × 前 N 月滚动中位数 + 绝对下限），写进 `entity/repo/<id>.json` 新字段 `inflections: [{period, flow, kind}]`，`StarCurve` 在这些月画标记 + tooltip。
- **✅ 已落地**：纯核心 `lib/workflows/recompute/inflections.ts`（`detectInflections`：K=3 × 6 月滚动中位数 + `ABS_FLOOR=500` + 取 top-3，最高月标 `kind:"peak"`）；entity step 计算并写入 `inflections`（空则不写）；Zod 契约 `Inflection` + `RepoEntity.inflections` optional（旧数据仍 parse）；`StarCurve` 渲染三级色标记点 + `<title>` tooltip（零 JS）。离线 parity 经 `IGNORE` 跳过该新字段；单测 11 例（算法 7 + entity 2 + 契约 2），tsc + `next build` 绿。拐点数据将在下次 recompute 发布后填充。

### v0.2 §4 可分享卡片 ✅ 已实现

- **现状**：每页 og:image 已修（repo 页自定义卡、其余站点卡，v0.1 已做）。
- **✅ 已落地**：① 榜单 OG 卡——`app/rankings/[year]/[period]/opengraph-image.tsx`（月/周）+ `[year]/opengraph-image.tsx`（年）动态生成"该期 top3"卡，共享 `lib/og-card.tsx`（`next/og`，石墨灰+金、stars 内联 SVG），并接进各页 `pageMeta.ogImage`；② `app/_explore/ShareButton.tsx`（复制链接 + X 分享 intent，7 语 `share.*` chrome i18n），接进 repo / 榜单月周 / 年页。`next build` 绿；本地 smoke：两张 OG 卡 200 `image/png`、页面 `og:image` 指向卡、ShareButton 入 SSR。

### v0.2 §5 多 repo 对比（简版） 🚧 进行中

- **目标**：把多个已收录 repo（≥1 万星那 5,261 个）的 star 曲线**叠在一张图**上比较增长。一个 `/compare` 页，要对比的 repo 放在 URL 里（`/compare?repos=facebook/react,vuejs/vue`）→ URL 即状态、链接可分享。明确**只做简版**：可对比集 = 已收录的 ≥1 万星 repo；任意 repo / ≥100 星下钻属 v0.3（DB 阻塞）。
- **为什么守住 v0.1/v0.2 全部硬约束**：曲线数据每个 repo 早已存在（`entity/repo/<id>.json` 的 `curve.monthly = [period, adds, total_end]`）——**零新 recompute 产物、零 DB、零新外部依赖**。只新增一个与 `/search-index` 同构的**瘦服务端路由** `/repo-curve?id=`：服务端经发布指针读版本化 entity、返回精简曲线、CDN s-maxage 缓存（Blob 仍服务端、可回滚）；浏览器按需抓几个小 JSON 在前端叠加。选择器**复用**已有搜索索引（`lib/search/core`）。
- **归一化两模式**（用户定）：**绝对值**（各自累计星数，共享 y 轴）+ 可切换**对齐到 10k**（x 轴换成「各自破 1 万星后第 N 个月」，同起点比增长轨迹/速度，仅用已有 `milestones.crossed_10k`）。不加 log 轴（避免复杂）。上限叠 **5** 个。
- **三入口**（用户定，全做）：① 导航栏 `/compare` 链接 + 该页自带多选搜索器；② repo 页「加入对比」按钮 → `/compare?repos=owner/name`；③ 导航 `SearchBox` 每条结果加「+对比」勾选 + 底部「对比 N 个 →」（行点击仍跳 repo 页）。
- **建造顺序**：①瘦路由 `/repo-curve` + 契约 `lib/contracts/compare.ts` + 数据访问 → ②纯核心 `lib/compare/core.ts`（URL repos 解析/序列化、两种归一化、配色；bun 单测）→ ③`CompareCurve` 组件（多线 + 图例 + 共享 y 轴 + 对齐切换）→ ④`/compare` 页壳 + 多选择器 → ⑤三入口接线 → ⑥7 语 `compare.*` chrome i18n + 测试/build/提交。
- **SEO**：`/compare`（无参）为可索引落地页（介绍工具）；带 `?repos=` 参数页 `noindex`（避免组合 URL 抓取爆炸）、canonical 指向 `/compare`。
- **离线 parity 不受影响**：无新数据视图产物（`/repo-curve` 是 entity 的瘦投影，非独立 Blob 文件），recompute parity 集合不变。

## v0.3 — 下钻与对比（DB 阻塞，需先拍板选型）

≥100 star 下钻（46 万 repo）、多 repo 任意对比、主题/语言聚类、语义检索——**都装不进当前 JSON shard 模型**（46 万 × 历史太大，且需任意筛选/聚合/向量查询），必须引入分析型数据层；这与「Vercel-first、零外部账单、运行时零引擎」**有直接张力**，需要一次架构决策：

| 选项 | 说明 | 张力 |
|---|---|---|
| **Tinybird（托管 ClickHouse）** | 分析查询强、roadmap 既定选项 | 外部账单（违反"零散落账单"）；运行时要查它（违反"纯静态"）——需重新界定 |
| **Vercel Postgres / Neon** | Vercel 生态内 | 关系库扛分析型聚合（46 万 × 时序）吃力 |
| **继续 JSON + 预算更多视图** | 不引 DB | 46 万 repo 的任意筛选/对比组合爆炸，预算不出来 |
| **ClickHouse 自建 / 公共实例** | 便宜 | 运维成本、可靠性（架构文档已评估过不可行） |

**建议**：v0.2 先不碰下钻；v0.3 启动前**专门过一次这个 DB 选型决策**（可做选型对比 + POC）。决策前下钻/语义检索保持"未实现"。**多 repo 对比**：简版（对比已有 ≥10k repo 的曲线）已在 **v0.2 §5 开工**（见上）；任意 repo（含 ≥100 星长尾）对比需 v0.3 DB。
