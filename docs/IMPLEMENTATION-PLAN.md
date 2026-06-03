# gitstarclub 实现计划（构建顺序）

> 从"文档齐全"到"逐模块开工"的桥。按**依赖顺序**给里程碑，每个含产出、依赖、验收。需求基准见 [REQUIREMENTS](./REQUIREMENTS.md)，各层细节见对应文档。
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
> **状态**：◐ 本机 bootstrap 已跑过——`whitelist`→`extract`→`rollup`→`precompute` 已产出全套 JSON 视图并过 Zod 校验（[TESTING §1.2](./TESTING.md)：12,615 文件 0 失败）。`star_daily_gross/*.parquet`、`whitelist.json` 在 `pipeline/data/`。**上传/线上接入以 Vercel 实况为准**（页面已读 `@/lib/data`，说明 Blob 已有产物）。

按 [PIPELINE §1](./PIPELINE.md)：
1. `whitelist`：Search `stars:>=10000` 自适应分桶 → `whitelist.json`（≈5,248）。
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
- 🚧 **v0.2 叙事与发现（[V0.2-DESIGN](./V0.2-DESIGN.md)）已启动**：§1 **全站搜索 ✅ 已上线并线上验证**（recompute 派生 `search/index.json` 5,261 repo + `/search-index` CDN 路由 + 客户端 MiniSearch）；拐点检测 / 分享卡片补全 / LLM 月度叙事**待做**；≥100★下钻 / 任意 repo 对比 / 聚类 / 语义检索属 v0.3，**阻塞于 DB 选型决策**。
