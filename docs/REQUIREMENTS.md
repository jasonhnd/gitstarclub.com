# gitstarclub 需求基准

## Scope

本文是产品需求的**单一基准**——定义"做什么"。所有结构性争议、新功能立项、口径调整都先回到这里对齐。"怎么做"分散在各层文档：架构 [ARCHITECTURE](./ARCHITECTURE.md)、数据运维 [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)、契约 [DATA-CONTRACTS](./DATA-CONTRACTS.md)、bootstrap 流水线 [PIPELINE](./PIPELINE.md)、排名口径 [RANKING](./RANKING.md)、前端 [FRONTEND](./FRONTEND.md)、设计系统 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md)、SEO [SEO](./SEO.md)、运维 [OPS](./OPS.md)、测试 [TESTING](./TESTING.md)；UX 导航叙事见 [INFORMATION-ARCHITECTURE](./INFORMATION-ARCHITECTURE.md)。未做的功能与受阻决策见 [ROADMAP.md](./ROADMAP.md)。

## 0. 需求 ID / 优先级 / 追踪矩阵

Requirement ID 是跨 BRD/PRD/FSD/UX/测试追踪的稳定键。新增或调整核心能力时先在本节登记 ID、优先级、user story 与验收口径，再把同一 ID 引到产品、前端、数据契约和测试文档。

### 0.1 核心需求目录

| ID | Priority | User story | Testable acceptance criteria | Owning docs / implementation / tests |
|---|---|---|---|---|
| `REQ-CHRONICLE-001` | P0 | As a developer or researcher, I want year/month/week/repo/org/all-time history pages, so that I can replay GitHub star history from stable snapshots. | Valid historical URLs return `200`, canonical to themselves, read values from the same `views/<version>` rank/heatmap/entity views, and completed periods do not change after daily cron. See `P0-AC1`, `P0-AC3`. | Requirements §3/§6; Product core pages; Frontend §1/§2; Data Contracts §2.3/§2.5-§2.7; Testing §1/§4. |
| `REQ-PULSE-001` | P0 | As a returning visitor, I want today's and this week's movers plus revival/spike signals, so that I can see what is changing now. | `/` and `/pulse` use the latest successful `hot-snapshot.json` / `current_month.json`, daily cron records success in `ops/sync-runs.json`, and locale pulse URLs render the same data freshness. See `P0-AC2`, `P0-AC3`. | Requirements §3/§6; Product `/pulse` and home; Frontend `PulseView` and cron refresh; Data Contracts §2.8-§2.10; Testing §1.5 and live-refresh tests. |
| `REQ-RANKING-001` | P0 | As a reader comparing projects or organizations, I want a consistent ranking matrix and derived growth/new lists, so that every leaderboard has a clear metric and scope. | Week/month/year/all-time rank files exist for repo/org flow/stock where required; derived month/year repo `growth` and `new` files obey floor, dedupe, sort, rank-continuity, and top-N rules. See `P0-AC4`. | Requirements §4; Product ranking definitions; Frontend ranking pages; Data Contracts §2.3-§2.4; Testing §1.1-§1.5. |
| `REQ-I18N-001` | P0 | As a non-English visitor, I want locale-specific URLs, metadata, and chrome, so that search engines and readers get the correct language without changing data fields. | English uses unprefixed canonical URLs; ja/zh/zh-TW/ko/es/fr use prefixed canonical URLs; `<html lang>`, `hreflang`, sitemap entries, metadata, and language switcher links agree. See `P0-AC3`. | Requirements §9; Product i18n; Frontend §1.2/§7; Data fields remain language-neutral; Testing §4.1 and i18n/SEO tests. |
| `REQ-DATAOPS-001` | P0 | As an operator, I want recurring data jobs to run inside Vercel with validation gates, so that production does not depend on local machines or unpublished data. | Daily/weekly cron and refresh Workflow are scheduled in `web/vercel.json`; recurring jobs write live artifacts and workflow validation artifacts; only `ok=true` cuts `views/latest.json`; production recurring paths do not require GCP, DuckDB, or Parquet. See `P0-AC6`. | Requirements §8/§8a/§11; Architecture and Vercel Data Operations; Frontend cron routes; Data Contracts §2.11-§2.13; Testing §1.5. |
| `REQ-PERF-001` | P0 | As a high-volume reader, I want static, low-JS pages with explicit performance budgets, so that the site can serve CDN-scale traffic. | Key pages meet CWV targets, content HTML stays under 20KB, content pages avoid non-whitelisted client JS, and repeat requests hit CDN/ISR instead of GitHub/API/database/workflow paths. See `P0-AC5`. | Requirements §7; Product visual stance; Frontend §2/§4; Testing §5 and planned browser/render gates. |
| `REQ-SEARCH-001` | P1 | As a visitor who knows a repo name, I want global search in the top chrome, so that I can jump directly to tracked repositories and add results to comparison. | First focus lazy-loads versioned `search/index.json`; prefix/fuzzy search is star-weighted; results link to `/{owner}/{name}`; selected rows can create `/compare?repos=...`; no `/search?q=` page is required. | Requirements §3; Product discovery entry; Frontend `SearchBox` / `/search-index`; Data Contracts §2.14; Testing §1.6. |
| `REQ-COMPARE-001` | P1 | As a reader comparing multiple projects, I want a shareable multi-repo compare URL, so that I can inspect growth curves side by side. | `/compare?repos=a/b,c/d` restores state from the URL, allows up to 5 indexed >=10k-star repos, fetches slim curves through `/repo-curve`, and supports absolute plus aligned-to-10k modes. | Requirements §3; Product compare tool; Frontend compare route/client; Data Contracts §2.15; compare tests. |
| `REQ-CATEGORY-001` | P1 | As a reader exploring ecosystems, I want category browsing by language/ecosystem/domain/type/owner/maturity, so that I can discover ranked repos by dimension. | `/categories`, dimension pages, detail pages, and paginated detail routes are registry-driven, only expose public categories, render server-side lists, and emit matching `ItemList` JSON-LD. | Requirements §3; Product URL structure; Frontend §11; Data Contracts §2.4a; category tests. |

### 0.2 Cross-document traceability

| Requirement ID | REQUIREMENTS source | PRODUCT mapping | FRONTEND / DATA-CONTRACTS mapping | TESTING mapping |
|---|---|---|---|---|
| `REQ-CHRONICLE-001` | §3 page surfaces, §6 freshness model | Core pages: home, year, month, week, repo, org, all-time | FRONTEND §1.1 routes and §2 layering; DATA-CONTRACTS §2.3/§2.5-§2.7 | `P0-AC1`, `P0-AC3`; TESTING §1.1, §1.5, §4 |
| `REQ-PULSE-001` | §3 `/pulse`, §6 mover refresh | Home + `/pulse` current movers | FRONTEND `PulseView`, cron revalidation; DATA-CONTRACTS §2.8-§2.10 | `P0-AC2`, `P0-AC3`; TESTING §1.5, live-refresh tests |
| `REQ-RANKING-001` | §4 ranking matrix | Ranking matrix and derived list definitions | FRONTEND ranking pages; DATA-CONTRACTS §2.3-§2.4 | `P0-AC4`; TESTING §1.1-§1.5 |
| `REQ-I18N-001` | §9 SEO / i18n | Multilingual product stance | FRONTEND §1.2/§7; data fields stay language-neutral | `P0-AC3`; TESTING §4.1 |
| `REQ-DATAOPS-001` | §8/§8a/§11 production data operations | Data freshness and honesty stance | FRONTEND cron/workflow routes; DATA-CONTRACTS §2.11-§2.13 | `P0-AC6`; TESTING §1.5 |
| `REQ-PERF-001` | §7 rendering / traffic | Static, low-JS reading experience | FRONTEND §2/§4; DATA-CONTRACTS budgeted JSON views | `P0-AC5`; TESTING §5 |
| `REQ-SEARCH-001` | §3 global search | Discovery entry: global search | FRONTEND `SearchBox` and `/search-index`; DATA-CONTRACTS §2.14 | TESTING §1.6 |
| `REQ-COMPARE-001` | §3 multi-repo compare | Compare tool `/compare` | FRONTEND compare route/client and `/repo-curve`; DATA-CONTRACTS §2.15 | compare tests and planned E2E |
| `REQ-CATEGORY-001` | §3 category browsing | URL structure and category entry points | FRONTEND §11; DATA-CONTRACTS §2.4a | category recompute/rules tests |

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
- **多 repo 对比**：`/compare` 静态壳 + URL 携带 `?repos=a/b,c/d`，前端按需取版本化曲线、叠图比较；归一化两模式（绝对值 / 对齐到破万）；上限 5 个；可对比集 = 已收录的 ≥1 万星 repo。任意 repo / ≥100 星下钻属未来工作，见 [ROADMAP.md](./ROADMAP.md)。

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

本节只放可观察的通过 / 失败信号；战略判断保留在上文。P0 项必须能由 PR CI、Vercel Workflow 闸门，或明确的人工 runbook 复核。

- [ ] **P0-AC1 [`REQ-CHRONICLE-001`] 历史周期可回看且已收口周期冻结。** Given 一个读取 `views/latest.json` 的 Preview/Production deployment，When reviewer 请求 `GET https://pre.gitstarclub.com/rankings/2024`、`/rankings/2024/10`、`/rankings/2024/W41`，Then 每个有效历史周期返回 `200`，canonical 指向自身 URL，页面值来自同版本 `views/<version>/rank/**` / `heatmap/**` 产物；每日 cron 完成后再次请求同一 2024 历史周期，榜单数值不得改变。验证入口：`.github/workflows/ci.yml`（`web/` 下 `bun run lint`、`bunx tsc --noEmit -p tsconfig.json`、`BLOB_BASE_URL=https://blob.example.com bun run test`），重点测试 `web/lib/workflows/recompute/windows.test.ts`、`web/lib/workflows/steps/fold.test.ts`、`web/lib/integration/week-fold.test.ts`、`web/lib/integration/seam-fold.test.ts`、`web/lib/data/watermark.test.ts`；生产发布前还必须通过 Workflow `validate` step（`web/lib/workflows/steps/validate.ts`）。
- [ ] **P0-AC2 [`REQ-PULSE-001`] `/pulse` 在每日 cron 后反映当前 movers。** Given UTC 日期 `<D>` 的 daily cron 已完成，When reviewer 请求 `GET https://pre.gitstarclub.com/pulse` 与 `GET https://pre.gitstarclub.com/ja/pulse`，Then 均返回 `200`，页面使用与 `hot-snapshot.json` / `current_month.json` 相同的 `<D>` 或最新成功 run 数据，`ops/sync-runs.json` 记录最近一次 daily run 为成功，且 `current_month.json` 包含 `<D>` 的 per-repo delta；若 `<D>` 缺失或 snapshot 旧于最近成功 run，则失败。验证入口：OPS「Daily cron 实跑 runbook」第 4 步（`cd web && bun scripts/validate-live-views.ts --bust <UTC day>`）和 `web/lib/cron/live-refresh.test.ts`。
- [ ] **P0-AC3 [`REQ-CHRONICLE-001`, `REQ-PULSE-001`, `REQ-I18N-001`] 核心页面、SEO 与 7 语言 URL 矩阵可验证。** Given `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com`，When reviewer 请求 English URLs `/`、`/pulse`、`/rankings`、`/rankings/2024`、`/rankings/2024/10`、`/rankings/2024/W41`、`/categories`、`/compare`、`/about`、`/react/react`、`/o/vercel`，以及 locale samples `/ja`、`/zh/rankings/2024/10`、`/zh-TW/rankings/2024/10`、`/ko/pulse`、`/es/rankings`、`/fr/react/react`，Then 已收录实体 / 周期返回 `200`；English canonical 不带 locale 前缀；非默认 locale canonical 带前缀；`<html lang>` 与 route locale 一致；`hreflang` 精确包含 `x-default`、`en`、`ja`、`zh-CN`、`zh-TW`、`ko`、`es`、`fr`；sitemap 分片包含这些 canonical URL。验证入口：`web/lib/i18n/routing.test.ts`、`web/lib/i18n/middleware.test.ts`、`web/lib/seo.test.ts`、`web/lib/sitemap.test.ts`、`web/lib/integration/seo.test.ts`，统一由 `cd web && bun run test` 覆盖。
- [ ] **P0-AC4 [`REQ-RANKING-001`] 排名矩阵和派生榜文件形状正确。** Given canonical JSON shard fixture 或 Workflow staging 版本，When recompute 完成，Then 必须存在并通过 schema：`rank/week/2024-W41/{repo,org}/{flow,stock}.json`、`rank/month/2024-10/{repo,org}/{flow,stock}.json`、`rank/year/2024/{repo,org}/{flow,stock}.json`、`rank/all-time/{repo,org}/stock.json`；派生 repo 榜只要求 month/year：`rank/month/2024-10/repo/{growth,new}.json`、`rank/year/2024/repo/{growth,new}.json`。每个 rank item 必须只有 `id` 或 `login` 之一，rank 从 1 连续、无重复实体、按 metric 与 tie-break 降序，top-N 不超过 100；growth 必须满足期初 stock ≥ 20,000 且 flow > 0，new 必须来自冻结的 `crossed_10k`。验证入口：`web/lib/workflows/recompute/ranks.test.ts`、`web/lib/workflows/recompute/windows.test.ts`、`web/lib/contracts/contracts.test.ts`、`web/lib/integration/recompute.test.ts`、Workflow `validate` step。
- [ ] **P0-AC5 [`REQ-PERF-001`] 静态读取、性能阈值与 10M/day 假设有可复核证据。** Given Preview/Production deployment 已 warm up，When reviewer 对 `/`、`/rankings/2024/10`、`/react/react` 跑 Lighthouse / Web Vitals 与 `curl` body-size smoke，Then LCP < 2.5s、INP < 200ms、CLS < 0.1、FCP < 1.5s；内容页 HTML < 20KB；内容页不加载非白名单客户端 JS；第二次请求由 CDN / ISR cache 命中或 stale-while-revalidate，不在请求路径触发 GitHub API、DuckDB、BigQuery、数据库或 Workflow。验证入口：`docs/TESTING.md` §5 的性能 / 零 JS runbook；自动化落地前，PR 必须附对应 Preview 报告或说明未触及渲染性能面。
- [ ] **P0-AC6 [`REQ-DATAOPS-001`] recurring 数据运营只走 Vercel，且发布闸门可阻断坏数据。** Given daily/weekly cron 与 weekly Workflow 调度，When reviewer 检查 Vercel logs 与 Blob ops artifacts，Then `/api/cron/daily`、`/api/cron/weekly`、`/api/workflows/refresh/start` 均由 `web/vercel.json` 调度；daily/weekly run 写入 `current_month.json`、`hot-snapshot.json`、`live/*`、`ops/sync-runs.json`；Workflow 写入 `ops/workflows/<run_id>/validation.json`，只有 `ok=true` 才切 `views/latest.json`；Production / Preview recurring 环境不得依赖 `GOOGLE_APPLICATION_CREDENTIALS`、`GCP_PROJECT_ID`、DuckDB 或 Parquet。验证入口：OPS「Cron 调度」「Daily cron 实跑 runbook」「Vercel Workflow runbook」，`web/lib/cron/live-refresh.test.ts`、`web/lib/workflows/steps/validate.test.ts`、`web/lib/workflows/steps/week-dates.test.ts`。
