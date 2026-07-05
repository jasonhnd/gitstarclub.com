---
owner: Product requirements
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - Product baseline, scope, constraints, repo counts, and view counts
related_docs:
  - ./ARCHITECTURE.md
  - ./PRODUCT.md
  - ./ROADMAP.md
---

# gitstarclub 需求基准

## Scope

本文是产品需求的**单一基准**——定义"做什么"。所有结构性争议、新功能立项、口径调整都先回到这里对齐。"怎么做"分散在各层文档：架构 [ARCHITECTURE](./ARCHITECTURE.md)、数据运维 [VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)、契约 [DATA-CONTRACTS](./DATA-CONTRACTS.md)、bootstrap 流水线 [PIPELINE](./PIPELINE.md)、排名口径 [RANKING](./RANKING.md)、前端 [FRONTEND](./FRONTEND.md)、设计系统 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md)、SEO [SEO](./SEO.md)、运维 [OPS](./OPS.md)、测试 [TESTING](./TESTING.md)；UX 导航叙事见 [INFORMATION-ARCHITECTURE](./INFORMATION-ARCHITECTURE.md)。未做的功能与受阻决策见 [ROADMAP.md](./ROADMAP.md)。

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

- [ ] 任意历史周期可回看，数据冻结精确。
- [ ] `/pulse` 当天反映"谁在涨 / 老项目复活"。
- [ ] repo/org/周/全时/脉搏 各页可达、SEO 友好、七种 UI 语言（English 无前缀，非默认 locale 使用有前缀 URL）。
- [ ] 排名矩阵全维度正确（含 org、flow/stock、增速、新晋）。
- [ ] 运行时纯静态扛 10M/天；回填仅一次性 $10、日常零外部账单。
