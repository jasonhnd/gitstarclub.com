---
owner: product-requirements
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - product baseline
  - requirement IDs
  - requirements acceptance criteria
---

# gitstarclub 需求基准

## Scope

本文是产品需求的**单一基准**——定义"做什么"。所有结构性争议、新功能立项、口径调整都先回到这里对齐。"怎么做"分散在各层文档：架构 [ARCHITECTURE](./ARCHITECTURE.md)、数据运维 [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)、契约 [DATA-CONTRACTS](./DATA-CONTRACTS.md)、bootstrap 流水线 [PIPELINE](./PIPELINE.md)、排名口径 [RANKING](./RANKING.md)、前端 [FRONTEND](./FRONTEND.md)、设计系统 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md)、SEO [SEO](./SEO.md)、运维 [OPS](./OPS.md)、测试 [TESTING](./TESTING.md)；UX 导航叙事见 [INFORMATION-ARCHITECTURE](./INFORMATION-ARCHITECTURE.md)。未做的功能与受阻决策见 [ROADMAP.md](./ROADMAP.md)。

## 0. Requirement catalog and traceability

Stable IDs are used across product, frontend, data-contract, roadmap, and testing docs. P0 requirements must have a user story and an observable acceptance signal before implementation work is considered complete.

| ID | Priority | Capability | User story | Testable acceptance signal |
|---|---|---|---|---|
| `REQ-STATIC-001` | P0 | Static-read runtime | As an operator, I want request paths to read only published JSON views so that traffic can be served from Vercel without a runtime database or analytics engine. | `cd web && bun run build` succeeds with `BLOB_BASE_URL`; app code reads through `web/lib/data/*`; no runtime DuckDB/ClickHouse/Postgres dependency is introduced. |
| `REQ-RANKING-001` | P0 | Time-indexed ranking pages | As a reader, I want year, month, week, and all-time rankings so that I can browse GitHub star history by period. | Representative URLs `/rankings`, `/rankings/2024`, `/rankings/2024/10`, and `/rankings/2024/W42` return 200 for known data; `bun test lib/workflows/recompute/ranks.test.ts lib/workflows/recompute/windows.test.ts` passes. |
| `REQ-ENTITY-001` | P0 | Repo and owner detail pages | As a reader, I want repo and owner pages so that I can inspect a project or owner across its star history. | Known tracked repo and owner URLs such as `/:owner/:name` and `/o/:login` render from entity views; entity contract tests pass under `bun test lib/contracts/contracts.test.ts`. |
| `REQ-PULSE-001` | P0 | Current pulse surfaces | As a returning reader, I want `/` and `/pulse` to show current movers so that I can see what is changing now. | `/` and `/pulse` render from `hot-snapshot.json` and current rank/live views; daily/weekly cron runbooks in OPS define the data freshness check. |
| `REQ-SEO-001` | P0 | Crawlable, canonical, multilingual pages | As a search visitor, I want canonical indexable pages with locale alternates so that search and answer engines can discover the right page. | `bun test lib/integration/seo.test.ts` passes against the live default origin, or an explicit `SEO_LIVE_BASE`; sitemap/canonical implementation remains aligned with SEO and FRONTEND. |
| `REQ-COMPARE-001` | P1 | Tracked-set compare | As a reader comparing known projects, I want `/compare?repos=a/b,c/d` to overlay up to five tracked ≥10k-star repositories so that I can compare growth without a database-backed query surface. | `/compare` remains a static shell; `bun test lib/compare/core.test.ts lib/compare/conclusions.test.ts` passes; arbitrary repo compare remains deferred in ROADMAP. |
| `REQ-CATEGORY-001` | P1 | Category browsing | As a reader, I want deterministic category pages so that I can browse tracked repos by language, ecosystem, domain, and owner kind. | `/categories`, `/categories/language`, and public category detail URLs render from registry/assignment views; `bun test lib/categories/rules.test.ts lib/workflows/recompute/categories.test.ts` passes. |
| `REQ-I18N-001` | P1 | Seven-locale UI chrome | As a non-English reader, I want locale-prefixed pages and UI chrome in my language while repo data stays source-language neutral. | English URLs are unprefixed; `ja`, `zh`, `zh-TW`, `ko`, `es`, and `fr` use locale prefixes; route locale drives `<html lang>`, canonical, and `hreflang` per SEO/FRONTEND. |

Traceability:

| ID | REQUIREMENTS section | PRODUCT | FRONTEND / DATA-CONTRACTS | TESTING |
|---|---|---|---|---|
| `REQ-STATIC-001` | §7, §8, §8a, §11 | Scope and data-honesty posture | FRONTEND §2, DATA-CONTRACTS §2, VERCEL-DATA-OPERATIONS | Current build/typecheck gate; Workflow validate gate |
| `REQ-RANKING-001` | §3, §4 | 核心页面; 排名矩阵与榜单定义 | FRONTEND §1.1, DATA-CONTRACTS rank views | `ranks.test.ts`, `windows.test.ts`, contract tests |
| `REQ-ENTITY-001` | §3, §5 | Repo 详情页; Org 详情页; Repo 身份与改名 | FRONTEND §1.1, §6.4; DATA-CONTRACTS entity views | contract tests, entity recompute tests |
| `REQ-PULSE-001` | §1, §3, §6 | 首页; 脉搏页 | FRONTEND §2.4; DATA-CONTRACTS live/hot snapshot | cron runbooks, live-view validation |
| `REQ-SEO-001` | §3, §9 | URL 结构; 多语言 | FRONTEND §7; SEO; I18N | SEO integration tests against the default live origin or explicit `SEO_LIVE_BASE` |
| `REQ-COMPARE-001` | §3 | 对比工具: `/compare` | FRONTEND compare route and `repo-curve`; DATA-CONTRACTS §2.15 | compare core/conclusion tests |
| `REQ-CATEGORY-001` | §3 | Discovery/navigation references | FRONTEND §11; DATA-CONTRACTS category views | category rules/recompute tests |
| `REQ-I18N-001` | §3, §9 | 多语言（i18n） | FRONTEND §7; SEO §10; I18N | locale URL checks; target E2E in TESTING |

## 1. 产品定位（两副面孔）

- **编年史面**：回看「哪些项目在某周期上涨」。已完成周期 = **冻结、精确、可回溯**。产品主体。
- **脉搏面**：看「此刻谁在涨 / 爆发」，尤其 **老项目突然苏醒**。**时效敏感**，是回访与传播引擎。
- 差异化：vs GitHub Trending（只当下）/ star-history（单 repo）/ gitstar-ranking（只当前总榜）——可回溯 + 结构化 + 有脉搏。
- 来访：长尾搜索为主（`X star history`、`github trending 2024`、`谁在涨`）。

## 2. 数据集范围

- 白名单 = 当前 star ≥ **10,000** 的公开 repo（bootstrap ≈5,248 @2026-05 实测 → 当前约 5,302；每周浮动）。每周刷新；新晋者补历史；跌出者保留历史、停止轮询。
- 时间 **2015-01 至今**（2015 前 watch≠star、schema 不稳）。
- 维度：**repo + org**（org = 按 owner 聚合，含 User 与 Organization 两类）。

## 3. 页面（page-surface）

| 页 | URL | 要点 |
|---|---|---|
| 首页 | `/` | 年份脊柱 · 本月聚焦 · **此刻在涨区** · 历史上的今天 |
| 年页 | `/rankings/YYYY` | 年榜 · 12 月热力 · 新晋 |
| 月页 | `/rankings/YYYY/MM` | 月榜(repo+org × flow+stock) · 增速 · 新晋 · 日热力 · 上下月对比 |
| 周页 | `/rankings/YYYY/W##` | **独立页**；当周活、过去周冻结 |
| repo 页 | `/:owner/:name` | 曲线 · 里程碑 · 月度表 |
| org 页 | `/o/:login` | 合计曲线 · 成员 · 名次 |
| 全时榜 | `/rankings` | 当前总量 repo / org TOP |
| 分类浏览 | `/categories` · `/categories/:dimension` · `/categories/:dimension/:slug` | 按 语言/生态/领域/类型/owner/成熟度 多维下钻 |
| 脉搏页 | `/pulse` | 今日/本周大涨 + 复活/突刺 |
| 关于 | `/about` | 数据口径声明 |

- English URL 保持无前缀；非默认 locale 使用有前缀 URL，metadata / canonical / sitemap / hreflang 按 route locale 输出（当前 SEO 口径见 [SEO.md](./SEO.md) §10；架构见 [I18N.md](./I18N.md)）。
- 月/年页 **repo 榜与 org 榜并列**展示。
- **导航栏全站搜索**：顶栏 chrome 客户端 combobox，首次聚焦懒加载版本化 `search/index.json` + MiniSearch（zero 后端、走 CDN），typo 容错 + 按 stars 加权，直达 `/{owner}/{name}`；「按名字直达」入口，无 `/search?q=` 结果页。
- **多 repo 对比 (`REQ-COMPARE-001`)**：`/compare` 静态壳 + URL 携带 `?repos=a/b,c/d`，前端按需取版本化曲线、叠图比较；归一化两模式（绝对值 / 对齐到破万）；上限 5 个；可对比集 = 已收录的 ≥1 万星 repo。任意 repo / ≥100 星下钻属未来工作，见 [ROADMAP.md](./ROADMAP.md)。

## 4. 排名

- 矩阵 **{周 / 月 / 年 / 全时} × {repo / org} × {flow 新增 / stock 总量}**。
- 派生：**增速**（flow ÷ 期初 stock，floor 期初 ≥ 20k）；**新晋**（stock 首次 ≥ 10k）。
- 排重：新晋不进增速。边界：flow 可负、平手二级排序(stock→id)、无数据不入榜。
- 口径细节见 [RANKING.md](./RANKING.md)。

## 5. 数据来源与口径

- **历史回填（一次性）**：BigQuery 查 GH Archive WatchEvent（含稳定 `repo.id`），~$10。（免费方案 ClickHouse 公共实例 1000 行上限、自建 4–12TB 均已评估排除。）
- **日常监测**：GitHub GraphQL 每日批量查 `current_stars`（约 5,302 repo，`ceil(5302/100)=54` 查询，**< 1 MB / 秒级 / ~1% 额度**）→ diff 出 net 日增。
- **元数据**：GraphQL（owner + owner_type、language、topics、createdAt、current_stars、isArchived）。
- **口径**：历史 = gross（GH Archive 无取消事件）/ 上线后 = net（含取消，可负）；**seam** 分界。**`current_stars` 是唯一必须精确的数**；历史 stock = gross 累加 × 锚定因子 `d` 对齐到 current_stars（估算，标 as-of；`d >= 0` 且可 `> 1`）。

## 6. 新鲜度模型 ⭐（核心）

**比喻：报社**。过去的报纸（历史）印好归档、**永不重印**；今天的头版（"现在在涨"）每天换；来了大新闻（老项目突然爆）登头版 + 更新它那一页，但**绝不重印整个报库**。

- **编年史（历史周期 + 稳定实体）**：冻结 / 标 **"as of 日期"**；零 churn。
- **脉搏 = 新鲜度跟着"运动"走（事件驱动）**：每日 poll 全量 → 算每个 repo 日增 → **只刷新"显著在动的那一小撮"+「现在在涨」页**；其余一律不动。
- **每天刷新集 = 下面三类的并集（通常几十~几百个）**：
  1. **今日涨幅前 ~50**。
  2. **爆发/复活**：今日涨幅 ≥ 其近 90 天日均的 **5×** 且 当日净增 ≥ **200**。
  3. **破里程碑**：今日跨 10k / 50k / 100k。
  > 数字（50 / 5× / 200）是可调旋钮，上线后按真实数据校准。
- 老项目爆发 → 进刷新集 → 当天上 `/pulse` + 它的 repo 页当天刷新（曲线立刻显示这波）。
- **不全量刷长尾页**（当前约 5,302 repo，含 org/周期页上限留 ~16k 余量；全量刷会毁静态/贵）、**不一律冻结**（错过爆发）。

## 7. 渲染 / 扛量

- SSG-first；内容页**零客户端 JS**（图表服务端 SVG）；HTML < 20KB。
- 页面分层：**核心**(deploy 构建,小集) / **长尾**(按需 ISR,持久 store) / **mover**(每日事件驱动刷新) / **历史**(冻结)。
- 扛 **100万–1000万/天**；热路径纯静态走 CDN、零 Function；Vercel build **45min 上限** ⇒ 不全量 build。
- CWV：LCP<2.5s · INP<200ms · CLS<0.1。

## 8. 数据形式 / pipeline

- 生产 canonical = **JSON shard**（per-repo 月/周 rollup + 站点日总量 + repo 维度，Vercel 可重算）；服务 = 预算好的 **JSON 视图**（build / 运行时只读）。bootstrap 形态是 Parquet 事实表（归档）。
- 引擎（BigQuery/DuckDB）**只在一次性 bootstrap**；**生产 recurring 重算（历史/元数据/全量）走 Vercel Workflow，纯 JS + JSON shard、无引擎**；**build / cron / 运行时零引擎、零原生模块**。
- 每日 / 每周 live cron JSON-only；全量重算 + 发布 + 回滚 + 折叠 + GC 走 Vercel Workflow。详见 [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)、[DATA-CONTRACTS](./DATA-CONTRACTS.md)、[PIPELINE](./PIPELINE.md)。

## 8a. 非功能需求：生产不依赖本地计算 ⭐

- **所有 recurring 数据作业在 Vercel 触发、运行、记录**（Cron / Function / Workflow）；本机 `pipeline/backfill` 仅作一次性 bootstrap / 历史归档 / 紧急人工工具，**不在日常运营路径**。
- 单 Function 受 800s / 4GB / bundle 250MB / 响应体 4.5MB 限——**全量重算必须 Workflow 分片**，大文件走 Blob 直链。
- 新晋 repo 历史**默认保守**（从发现日追踪、标 `tracked_since`），不为补历史引入 GCP 作为 recurring 依赖（取舍见 [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md) §6）。

## 9. SEO / i18n

- 每页 = 长尾落地页（标题含真实搜索词）；sitemap 使用 index + per-locale XML，English 无前缀、非默认 locale 有前缀 URL 与 hreflang（**权威 URL 规模见 [SEO.md](./SEO.md)** §1.3 / §10）；schema.org（Dataset/ItemList/Organization/BreadcrumbList…）；OG 图（石墨灰+金，build 生成）；预览站 noindex。详见 [SEO.md](./SEO.md)。

## 10. 设计调性

- **M3 Expressive**；**冷石墨灰 surface + 金"星"accent**；Plus Jakarta Sans + Geist Mono；**手写 token + Tailwind 4**（不用 @material/web）；明暗双模式；CSS 弹簧 / 跨文档 View Transitions 零 JS。详见 [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)。

## 11. 部署 / 约束

- **单一 Vercel 项目**：`zkscio/gitstarclub.com` 承载 Production 与 Preview；生产域名为 `gitstarclub.com` / `www.gitstarclub.com`，测试域名为 `pre.gitstarclub.com`（private/noindex）。
- **Vercel-first / 避免散落账单**（BigQuery 仅一次性 ~$10 为唯一例外）。
- 时区：存 UTC、显示 UTC + JST。Cron 鉴权 + 幂等 + 监控 + 回滚见 [OPS.md](./OPS.md)。

## 12. 合规

- GH Archive 署名；遵守 GitHub ToS / 限额；仅展示公开 repo 公开数据。
- About 页声明口径：gross/net seam、幸存者偏差、2015 起点、as-of、锚定估算。

---

## 验收（需求层面）

| Requirement | Observable pass/fail signal | Validation reference |
|---|---|---|
| `REQ-STATIC-001` | `cd web && bun run build` succeeds with `BLOB_BASE_URL` set; request-path code does not import runtime analytical engines or database clients. | ARCHITECTURE hard constraints; FRONTEND §2; local build command |
| `REQ-RANKING-001` | Representative ranking URLs return 200 for known published periods: `/rankings`, `/rankings/2024`, `/rankings/2024/10`, `/rankings/2024/W42`; rank rows are ordered by the documented metric and tie-breaks. | `bun test lib/workflows/recompute/ranks.test.ts lib/workflows/recompute/windows.test.ts`; RANKING |
| `REQ-ENTITY-001` | Known tracked repo and owner URLs render from entity views, e.g. `/:owner/:name` and `/o/:login`; unknown entities 404 or redirect according to alias rules. | `bun test lib/contracts/contracts.test.ts lib/workflows/recompute/entities.test.ts`; FRONTEND §1.1 |
| `REQ-PULSE-001` | `/` and `/pulse` render current mover sections from `hot-snapshot.json`; after daily/weekly cron, live-view validation confirms current-period artifacts are present. | OPS daily cron runbook; `web/scripts/validate-live-views.ts` when running live checks |
| `REQ-SEO-001` | English canonical URLs are unprefixed; non-default locales such as `/ja/rankings/2024/10` emit locale-specific canonical/hreflang metadata; sitemap includes eligible route families. | SEO; FRONTEND §7; `bun test lib/integration/seo.test.ts` |
| `REQ-COMPARE-001` | `/compare?repos=facebook/react,vuejs/vue` accepts only tracked-set repo slugs, caps selection at five, and supports absolute and 10k-aligned modes; arbitrary untracked repo compare remains deferred. | `bun test lib/compare/core.test.ts lib/compare/conclusions.test.ts`; ROADMAP arbitrary-repo compare |
| `REQ-CATEGORY-001` | `/categories`, `/categories/language`, and a public `/categories/:dimension/:slug` page render from category registry/assignment views and expose canonical links. | `bun test lib/categories/rules.test.ts lib/workflows/recompute/categories.test.ts`; CATEGORIES |
| `REQ-I18N-001` | Route locale controls `<html lang>`, chrome copy, canonical, and `hreflang`; repo names, topics, languages, and numeric data remain source-language neutral. | FRONTEND §7; SEO §10; target E2E in TESTING |
| Documentation hygiene | All docs under `docs/` expose owner/status/last-reviewed metadata and all Markdown code fences have info strings. | `cd web && bun run docs:check` |

Reviewer checklist:

- [ ] P0 requirement rows above have a passing command, automated test, Workflow gate, or documented manual runbook step.
- [ ] Target-state checks are not described as current automation unless the script or CI job exists.
- [ ] Deferred scope uses `ROADMAP.md` references instead of vague "out of scope" language.
