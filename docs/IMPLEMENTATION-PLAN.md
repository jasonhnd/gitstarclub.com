# gitstarclub 实现计划（构建顺序）

> 从"文档齐全"到"逐模块开工"的桥。按**依赖顺序**给里程碑，每个含产出、依赖、验收。需求基准见 [REQUIREMENTS](./REQUIREMENTS.md)，各层细节见对应文档。
> 原则：先立**契约**（类型即真相）→ 再出**真实数据** → 再让 web 接真实数据 → 扩页型 → 接 cron → SEO/上线。

## 依赖图

```
M0 契约/脚手架
   └─ M1 回填出真实数据（一次性）
        └─ M2 web 接真实数据（替占位）
             ├─ M3 新页型（org/全时/周/trending）
             └─ M4 每日/每周 cron
                  └─ M5 SEO / i18n / PWA / 上线
```

---

## M0 — 契约与脚手架（先于一切）

- **Zod 契约** `web/lib/contracts/`：把 [DATA-CONTRACTS](./DATA-CONTRACTS.md) 落成可校验 schema + 推导类型（**本仓已写初版**）。这是 pipeline 产出与 web 读取的唯一类型来源。
- **pipeline 脚手架** `pipeline/`：`package.json`（`@duckdb/node-api`、`@vercel/blob`；运行用 node/全 Node 环境）、`lib/github.mjs`（Search 自适应分桶 + GraphQL 批量）。
- **验收**：`tsc --noEmit` 过；契约覆盖所有视图；github 客户端能跑通一次小查询。

## M1 — 回填出真实数据（一次性，本机/全 Node）

按 [PIPELINE §1](./PIPELINE.md)：
1. `whitelist`：Search `stars:>=10000` 自适应分桶 → `whitelist.json`（≈5,248）。
2. `extract`：BigQuery **先 dry-run 确认 ~$10**，再跑 WatchEvent→(repo.id, day, gross) → 导出 Parquet。
3. `metadata`：GraphQL → owner+type / lang / topics / createdAt / current_stars。
4. `rollup`（DuckDB）→ `star_daily.parquet` + 里程碑（cumsum 跨阈首日）+ daily_totals。
5. `precompute`（DuckDB）→ 全部 JSON 视图，**逐一过 Zod 校验**（脏数据不发布）。
6. `upload` → Vercel Blob（put 节流 <75/s）。
- **依赖**：M0。
- **验收**：Blob 上有全套真实 JSON、Zod + sanity（[TESTING §1](./TESTING.md)）全过；抽查 vue/react 等知名 repo 曲线/里程碑合理。

## M2 — web 接真实数据（把原型从占位切到真实）

按 [FRONTEND §3 + §9 A–I](./FRONTEND.md)：
- `web/lib/data/`：fetch Blob + Zod parse + `cache()`；lookup-join。
- 处置 §9：**A** 长尾 `generateStaticParams` 返回 `[]` + 按需 ISR；**B** 未知 param → `notFound()`；**D** 曲线容忍非单调；**E/F** 去硬编码 `lang`/`metadataBase`；移除占位 `_explore/data.ts`。
- 四个核心页（首页/年/月/repo）渲染真实 JSON。
- **依赖**：M1（要真实 JSON）。
- **验收**：核心页真实数据、正文零客户端 JS、`notFound` 正确、`cacheComponents` 关闭、长尾按需 ISR 生效。

## M3 — 新页型

- `/o/:login`（org）、`/rankings`（全时）、`/YYYY/W##`（周，独立）、`/trending`（脉搏）。
- 月/年页加 **org 榜 + flow/stock 并列**（[PRODUCT](./PRODUCT.md)、[RANKING](./RANKING.md)）。
- **依赖**：M2（复用数据层 + 组件）。
- **验收**：各页可达、复用契约、SEO meta/canonical 就位。

## M4 — 每日 / 每周 cron

按 [PIPELINE §2–3](./PIPELINE.md) + [ARCHITECTURE 页面分层](./ARCHITECTURE.md)：
- `web/app/api/cron/daily`：CRON_SECRET 校验 → GraphQL current_stars → net 日增 → 更新 `current_month.json` → **挑 mover 集** → 重算 `hot-snapshot.json` + `/trending` → `revalidatePath`（核心热集 + mover repo/org 页）。
- `web/app/api/cron/weekly`：白名单 diff → 新晋回填 → 折叠当月 → 重算受影响视图 → revalidate。
- **此处现场定**（文档最薄两块）：① 当期增量聚合的 **YTD-base**（存哪/每月更新）；② mover 的 **90 天基线**数据源（每日 cron JSON-only，需备一份滚动基线）。
- **依赖**：M2/M3。
- **验收**：cron 幂等；mover 当天上 `/trending` + 其页刷新；漂移告警。

## M5 — SEO / i18n / PWA / 上线

按 [SEO](./SEO.md) + [OPS](./OPS.md)：
- sitemap 分片 + robots + 每页 OG（`@vercel/og`→Blob）+ hreflang；i18n 字典 + 三语 + 年度标签内容；PWA（已决保留，DESIGN-SYSTEM 例外③）。
- 部署：web 应用预览 noindex → 功能完整后**切生产域名**（teaser 退役）。
- **验收**：[SEO 验收清单](./SEO.md) + CWV 达标 + Search Console 收录。

---

## 测试（贯穿，见 [TESTING](./TESTING.md)）
- M1：Zod schema + sanity 不变量（CI 阻断脏数据）。
- M2+：视觉回归（明暗×断点）、a11y、E2E 导航、零 JS / HTML<20KB 断言。

## 当前进度
- ✅ M0 契约（`web/lib/contracts/` 初版已写）。
- ⏳ 待续：M0 pipeline 脚手架 → M1…
