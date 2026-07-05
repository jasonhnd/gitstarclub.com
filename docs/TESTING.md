# gitstarclub 测试策略

> 精简的、决策导向的测试策略。核心原则：**数据正确性就是产品本身**——历史精度是卖点，错的数据比难看的页面更致命。
> 因此测试金字塔不是常规倒三角：**pipeline / 数据质量测试是地基**，视觉 / a11y / E2E 在其上。架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，产品见 [PRODUCT.md](./PRODUCT.md)。

## Scope

## Current Automation

GitHub Actions is committed at `.github/workflows/ci.yml`. On PRs and `main` pushes it runs, from `web/`, `bun run lint`, `bunx tsc --noEmit -p tsconfig.json`, and `bun run test`. PR tests set `SEO_LIVE_BASE=""` so the network-dependent live SEO suite stays out of the deterministic CI gate.

Dependency audit is also a PR gate. CI runs `bun run audit:deps` in both `web/` and `pipeline/`, and that script is `bun audit --audit-level=high`; new high-severity advisories must be fixed by upgrading the direct dependency or documented as a temporary exception before merge. Moderate and low advisories are reviewed during dependency maintenance, but they do not fail CI unless the advisory affects a production server-side path or is escalated by maintainers.

Temporary dependency-audit overrides live in the affected package manifest, next to the lockfile they protect. As of this policy, `web/package.json` pins `undici` above the high-advisory floor while `workflow` still ships a vulnerable transitive pin, and pins `piscina` to the first fixed 4.x release while `@swc/cli` has not released an updated dependency range. `find-up@7` is a compatibility pin, not a security exception: it keeps Vercel Bun resolving the ESM package required by `workflow` builders while eslint keeps its own compatible nested `find-up@5`.

The visual, a11y, E2E, performance, and cross-browser sections below remain target coverage until their Playwright/Lighthouse/browser tooling is added. They should not be treated as current PR blockers.

本文档描述本项目的测试金字塔：**Zod 契约测试**、纯核心逻辑的**单元测试**、**集成测试**（recompute parity、live overlay）、**端到端冒烟测试**，以及 workflow 中的**校验闸门**(validation gates)。在新增任何 feature 或改动任何 contract 之前请先阅读本文档,确保改动落在既有的测试边界内。

## 测试取向(先定调)

| 取向 | 决定 | 理由 |
|---|---|---|
| 真数据 > mock | 聚合 / 排名 / schema 测试**直接跑真 Parquet 子集 + 真 JSON 产物**，能用真数据就不 mock | 本产品 bug 几乎都藏在"真实数据的脏边角"（取消 star、改名、突刺、空月），mock 永远测不到 |
| 结构 | **AAA**（Arrange-Act-Assert）三段式 | 数据测试断言密集，AAA 让"造数据 / 算 / 校验"边界清晰 |
| 命名 | 描述行为，不描述函数名 | 如 `org 总量等于其成员 repo 总量之和`、`周窗口跨月不丢日`，失败即文档 |
| 哲学 | 视觉回归**补充**而非替代逻辑覆盖 | 截图能抓"看起来错了"，抓不到"flow 求和少算一天"——后者靠单测 |

## 覆盖目标

- **逻辑代码 ≥ 80%**（聚合 / 排名 / 窗口 / 锚定 / schema / i18n 路由——即 `pipeline/` 与 `web/lib/` 的纯函数）。这是项目硬线。
- **视觉回归**不计入覆盖率数字，是独立信号层（见 §2）。
- 不为零客户端 JS 的纯展示 SVG 组件强凑单测覆盖——它们的信号在视觉回归里，单测它们的 markup 既脆又低价值。

---

## 1. Pipeline / 数据质量测试（最重要）

数据在数据层（bootstrap / Vercel Workflow）被聚合成 JSON 视图，**一旦发布给 16k 静态页就无法运行时修正**。所以这一层是重兵把守区，分五类：聚合数学、schema 校验、sanity 不变量、golden file、发布闸门（§1.5）。

### 1.1 聚合 + 排名数学（单测，真数据子集）

针对聚合预算逻辑的纯函数 / 或直接对产出断言。**用一小份真切片**（Parquet 子集 + 同源 canonical JSON shard，5–10 个知名 repo、跨 2–3 年）当 fixture，避免合成数据掩盖真实边界；并据此做 §1.5 的「shard 纯 JS 重算 == DuckDB 重算」等价对拍。

- **flow（∑delta）**：窗口内每日 delta 求和 == 该窗口榜单数值；含 delta 为负（取消 star）的月份仍正确
- **stock 累计 + 锚定**：累加到窗口末的总量；终点须**锚定 GraphQL `current_stars`**（gross 曲线终点 ≠ 当前总数时，以 GraphQL 为权威，见 ARCHITECTURE「数据校验/对账」）
- **窗口边界**：
  - 周不整除月——`周窗口跨月边界不重不漏`
  - 月 / 年边界：闰年 2 月、跨年 12→1、月末 28/29/30/31 天
  - 全时 = 2015-01 起点到当期，不早于 seam 也不漏起点月
- **org 聚合**：按 `owner` 分组求和（含 User 与 Organization 两类 `owner_type`）== 其成员 repo 之和

```ts
// 示意，非实际测试代码
test('周排名窗口跨月不丢日', () => {
  // Arrange: 真切片中一个横跨 9/29–10/05 的 ISO 周
  // Act:    取该周 flow 榜单
  // Assert: 榜值 == 该 repo 这 7 天 delta 之和（含跨月两段）
});
```

### 1.2 JSON 视图 schema 校验（Zod）

所有 `rank/* · entity/* · heatmap/* · lookup/*` 与活尾 `current_month.json` / `hot-snapshot.json` 都有 **Zod schema**，pipeline 产出后立即校验，build 读取前再校验一次（fail-fast，脏 JSON 绝不进 build）。

- 字段类型 / 必填 / 枚举（`owner_type ∈ {User, Org}`、`metric ∈ {flow, stock}`、`window ∈ {week,month,year,all-time}`）
- 引用完整性：榜单里每个 `repo_id` 在 `lookup/repos.json` 有对应条目
- Zod schema 即 build 读 JSON 的 TS 类型来源（single source of truth，避免 schema 与类型漂移）
- **实现**：`web/scripts/validate-views.ts`（`bun scripts/validate-views.ts` 全量校验 `pipeline/data/views/**` 对契约，失败非零退出）。bootstrap precompute 全部产物跑 Zod 契约校验,期望 0 失败；这与离线 parity 是两个不同指标——**离线 parity 测试**比对生成的视图与 DuckDB 重算结果逐字节一致（`web/lib/integration/recompute.test.ts`），勿混淆文件契约校验与字节对拍。**Workflow 的 `validate` step 复用同一套 Zod 契约校验 `views/<run_id>/**`**（§1.5，**抽样关键视图**而非全量逐文件），逻辑同源、只换运行位置。

### 1.3 Sanity 不变量（数据级断言，对全量产物跑）

这些是"数据物理定律"，对**每次 pipeline 全量输出**断言，任一违反即 CI 失败、阻断 deploy：

| 不变量 | 阈值 / 规则 |
|---|---|
| stock 总量非负 | 任意 repo / org 任意窗口末累计 ≥ 0 |
| 日 delta 在合理界 | 单日新增不超过 sane 上限（如历史单日峰值的 N 倍）；net 允许为负但有下界 |
| 排名列表长度 | top-N JSON 恰为 N 条（或全集 < N 时为全集），无重复 `repo_id` |
| 排名有序 | 按对应 metric 严格降序 |
| org == ∑members | 每个 org 各窗口总量 == 其成员 repo 之和（容差 0） |
| 漂移检查 | `按 adds 累加总数` vs GraphQL `current_stars` 漂移 ≤ 阈值（如 2%）；超阈记 `total_drift_pct` 并以 GraphQL 重锚（见 ARCHITECTURE） |
| seam 连续性 | gross→net 接缝日（`meta.seam_date`）前后曲线无断裂 / 无重复计日 |

### 1.4 Golden file（已知 repo 的已知里程碑）

挑几个**事实公开可查**的知名 repo 作回归基准，把它们的关键节点固化成 golden 快照；pipeline 改动后比对，防止重构悄悄改变历史口径。

- 例：某著名 repo 突破 10k / 50k / 100k 的**精确月份**与当时排名
- 例：某 AI 项目某个爆发月的 flow 排名位次
- golden 值人工核对一次后冻结；变更须显式 review（防"测试跟着 bug 一起改"）

> golden file 测的是"历史不该变"；§1.1 测的是"算法该对"。两者互补：前者抓回归，后者抓逻辑。

### 1.5 Workflow 发布闸门 / staging 校验 / 回滚

> **数据校验的"最后闸门"位于 Vercel Workflow 内的 `validate` step**——对 `views/<run_id>/**` 跑**抽样断言**，**通过才切 `views/latest.json` 指针**（实现 `web/lib/workflows/steps/validate.ts`、契约见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)）。

**当前实际断言的不变量**（与 §1.3 完整清单的差距见下表）：

| 断言 | 检查内容 |
|---|---|
| `meta.json` | `seam_date` 存在 |
| 全时 stock 总榜 | repo/org all-time rank 均读 schema；`items` 非空、`rank[0]==1`、`value` 非递增；rank 从 1 连续、无重复 rank、无重复 `id/login` |
| `lookup/repos.json` | 条目数 ≥ 1000（防止下游 join 表崩塌） |
| rank 引用完整性 | staging all-time rank item 的 repo `id` 必须在 `lookup/repos.json`；org `login` 必须在 `lookup/orgs.json` |
| `meta.folded_through` | 相对上一发布版本不倒退（month/week 单调） |
| `lookup/aliases.json` | 别名完整性：无 dangling（每个别名 id 仍在 `lookup/repos.json` 内）、无 live-shadow（别名旧名不得撞当前某 repo 的 `full_name`）、alias count 不小于上一发布版本 |
| `canonical/v2/repos/*` `d` 因子 | warning 级报告：统计 `d > 2` 的 repo 数和最大值，写入 `d_factor_*` invariants，不进入 `failures` |
| `search/index.json` | `count` ≥ 1000 且 `count == repos.length`（防止索引漂移） |
| `categories/registry.json` | 非空；至少一个 `public` 分类 |
| `categories/assignments.json` | 条目数 ≥ 1000；每 repo `language`/`language_family` 各 ≥1、`owner_kind` 恰 1；无 unknown 分类引用（assignment 里每个分类 id 在 registry 内） |
| `lookup/categories.json` | 非空 |
| 抽样 category-rank | 取首个 public 分类的 `rank/category/<dim>/<slug>/all-time/repo/stock.json`，其每个 item 都已在 assignments 中归入该分类 |
| 头部 repo entity | 全时榜 #1 的 `entity/repo/<id>.json` 的 `curve.monthly` 非空 |
| 上一年 heatmap | `heatmap/year/<Y-1>.json` 可读、字段齐 |

| 测试 | 在哪跑 | 断言 | 失败动作 |
|---|---|---|---|
| **staging 校验闸门** | Workflow `validate` step（Vercel） | 上表全部抽样断言（含 alias 完整性 + category 套件），对 `views/<run_id>/**` | `ok=false` → **不切指针**；线上仍是上一版；staging 版本保留供排查；写 `ops/workflows/<run_id>/validation.json` |
| **canonical shard 等价性** | 单测（CI）+ Workflow step | 「JSON shard 纯 JS 聚合」结果 == 「bootstrap DuckDB 同口径」结果（容差 0）；DuckDB parity 只作为 `folded_through <= seam` 的 legacy 等价对拍,不是 post-seam oracle | CI 阻断 / step error |
| **发布指针原子性** | 集成测试 | 切指针前后读侧拿到的版本自洽；切到一半的请求拿旧版（不拿半发布） | CI 阻断 |
| **回滚可逆** | 集成测试 | 把 `views/latest.json.version` 指回 `prev_version` 后，读侧立即拿回上一版；`views/<prev>` 仍在 | CI 阻断 |
| **step 幂等** | 单测 | 同 `(run_id, shard)` 重跑 step → 覆盖同一份产物，不重复累加（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §8） | CI 阻断 |

- **fixture**：§1.1 的真切片同样导出成 **canonical JSON shard fixture**（与 Parquet 切片同源），单测「shard 重算」与「DuckDB 重算」对拍。
- **隔离**：Workflow 校验只读 staging、不碰 `live/*` 活尾；活尾校验仍由每日/每周 cron 后置（见下「节奏」）。
- **当前 gap**（未在 validate step 中执行，留作未来工作）：org `stock == ∑members` 等价、monthly ↔ recent-daily seam 连续、`total_drift_pct` 阈值、全量历史 period 文件集合完整性——这些不变量记录在 §1.3 但**目前不阻断发布**，仅作 §1.1/§1.4 测试目标。

### 1.6 全站搜索测试

`search/index.json` 与客户端 MiniSearch 检索单独成测：

- `web/lib/search/core.test.ts`：MiniSearch 装配（prefix / fuzzy 0.2 typo 容错 / 按 stars 加权 `starBoost`，热门 repo 置顶）。
- `web/lib/workflows/recompute/entities.test.ts` 的 `searchIndex` 用例：recompute 从 `repos` 维度派生索引（条目数、字段、描述截断）。
- contracts `SearchIndex` / `SearchDoc` schema 契约测试（`web/lib/contracts/search.ts`）。
- 全套测试通过 `bun test lib/` 一次性运行（**当前规模：424 tests / 28 files**，作新鲜度锚点）。

> **别名与分类相关测试**（覆盖上文 §1.5 闸门里的 alias/category 断言对应逻辑）：
> - `web/lib/workflows/recompute/aliases.test.ts`：alias-map 构建（并集保留的 `renames.json` 增量 → 当前 id）。
> - `web/lib/workflows/recompute/categories.test.ts`：分类产物派生（registry / assignments / lookup / all-time category rank、public 资格、curated 绕过 `minimum_repo_count`）。
> - `web/lib/categories/rules.test.ts`：确定性分类规则（slug 归一、language-family 映射、topic/keyword 规则）。

- **parity 跳过 / 边界**：`web/lib/integration/recompute.test.ts` 经 `NO_DISK_REF` 跳过 `search/index.json`（派生视图，DuckDB 无参照可对拍），与 live-artifact 跳过并列——其余视图仍逐字节对拍。该 DuckDB disk reference 只在 `folded_through <= seam` 时是等价参照;post-seam 公式由 `web/lib/integration/post-seam-oracle.test.ts` 的合成夹具断言 `round(cumGross@seam * d) + Σ(post-seam net)`。

---

## 2. 视觉回归（高信号——这是个"看的"站）

整站是服务端渲染 SVG + 零客户端 JS 的视觉 SSG，截图差分信号极高。用 **Playwright 截图**。

- **断点**：320 / 768 / 1024 / 1440（对齐 web 测试规则）
- **双主题**：light + dark **都截**（M3E 明暗双模式都是一等公民，不能只测一套）
- **关键页**（每页 × 4 断点 × 2 主题）：
  - 首页：**年份脊柱**（bar 宽度 = 全年新增、年度标签）
  - 月度页 `/rankings/2024/10`：**日历热力图** + 三个核心榜单（新增 / 增速 / 新晋）
  - 年度页 `/rankings/2024`：12 月份格子热力图 + 年度 TOP
  - Repo 详情页 `/:owner/:name`：**全历史 star 曲线** + 里程碑标注
  - org 页（路由待 PRODUCT 定，见 ARCHITECTURE）：org 维度曲线 + 成员榜
  - 全时总榜页
- 截图针对**固定数据快照**（用 §1 的真切片 fixture build 一份确定性站点），避免每日数据变动导致截图漂移
- 基准图入库；diff 超阈人工 review（数据更新引起的合理变化批准后更新基准）

---

## 3. 无障碍（a11y）

对齐 ARCHITECTURE「无障碍」节，自动 + 手动结合：

- **自动 axe 检查**：在关键页（首页 / 年 / 月 / repo）跑 axe-core，零 critical/serious 违规
- **键盘导航**：所有内链可 Tab 聚焦、Tab 顺序合理、**focus 态可见**（M3 focus ring）；无键盘陷阱
- **prefers-reduced-motion**：开启时 View Transitions / 弹簧动效降级或关闭（动效纯 CSS，须验证媒体查询确实生效）
- **对比度 WCAG AA**：明暗双主题下文本 / on-* 角色对 surface 均达 AA（M3 tone 映射保证，但要断言验证）
- **SVG 图表可达**：star 曲线 / 热力图带 `<title>` + `aria-label`，并有**视觉隐藏的数据表 fallback**（screen reader 能读到数值，不只是"一张图"）

---

## 4. E2E 关键流程

验证**网状内链**真的连通（SEO 与产品都依赖它，见 SEO.md「内链策略」）。用 Playwright，断言导航而非像素。

- **导航图贯通**：首页 → 年度页 → 月度页 → repo 页 → org 页 → 全时榜，任意页 3 跳内可达
- **上下期导航**：月度页 `← 9月 | 11月 →`、年度页 `← 2023 | 2025 →` 永远在顶部且跳对
- **里程碑链接 → 月度页锚点**：repo 页里程碑点击落到对应月份的正确锚点
- **榜单行 → 实体页**：榜单里 repo 名 → repo 页；org 名 → org 页

### 4.1 i18n locale URL、语言下拉与 cookie 重定向

- 无 `gsc_lang` cookie 访问 `/`、`/pulse`、`/rankings` 时应渲染 English；带非默认 `Accept-Language` 首访 `/` 时 middleware 可 307 到对应 locale root。
- 语言切换器显示当前 route locale，展开后列出 `en`、`ja`、`zh`、`zh-TW`、`ko`、`es`、`fr`；每一项都是普通 `<a>` 链接。
- 从 English 点击 Japanese 应导航到 `/ja/...`；从 `/ja/...` 点击 English 应导航回无前缀 URL；从任一非英文语言都必须能切回 English。
- `LanguageSwitcher` 不写 `gsc_lang`、不派发 `gsc:localechange`、不靠客户端刷新当前 RSC 视图；导航后由服务端返回对应语言 HTML。
- `/api/lang?lang=fr&next=/rankings` 作为兼容入口应写入 `gsc_lang=fr` 并重定向到 `/fr/rankings`；`next=//evil.example` 必须回退到站内安全路径，防止开放重定向。
- 带 `gsc_lang=ja` 访问未加前缀的页面导航（如 `/rankings`）应 307 到 `/ja/rankings`；显式 locale URL（如 `/fr/rankings`）必须优先于 cookie。
- Service worker 不得缓存 HTML 导航或 `/api/*` 响应；middleware / `/api/lang` 的重定向不能被旧 HTML 缓存污染。
- 切换语言后 `<html lang>`、UI 文案、canonical 与 `hreflang` alternate 应与 route locale 一致；repo 名、语言、topic、数字等数据字段不得被翻译。
- **locale URL × 数据语言中立**：应测 `/`、`/ja`、`/rankings/2024/10`、`/zh-TW/rankings/2024/10`、`/:owner/:name`、`/fr/:owner/:name` 均返回 200（合法实体前提下），UI chrome 按 route locale 翻译，repo 名/语言/topic/数字等数据字段保持源数据形式。
- 用确定性等待（等元素 / URL），**不用 timeout 硬等**，避免 flaky

---

## 5. 性能（Core Web Vitals + 零 JS 红线）

对齐 ARCHITECTURE「性能策略」。Lighthouse / CWV 跑在代表性页面（首页 + 一个 repo 页 + 一个月度页）。

| 指标 | 目标 |
|---|---|
| LCP | < 2.5s |
| INP | < 200ms |
| CLS | < 0.1 |
| FCP | < 1.5s |

**结构性硬断言**（比 Lighthouse 评分更可靠，纳入 CI 阻断）：

- **内容页零客户端 JS**：bundle 检查——除一小段内联主题切换脚本外，content 页不得 ship 任何客户端 JS chunk。这是架构红线，回归即 fail
- **HTML < 20KB**：关键页渲染后 HTML 体积上限断言（直接降 bandwidth，见 ARCHITECTURE「Bandwidth 防御阶梯」）
- **字体子集**：Plus Jakarta Sans 子集 woff2 ≤ ~30KB；只预加载真正关键的一档 weight
- **图表尺寸固定**：SVG 有显式宽高，防 CLS

---

## 6. 跨浏览器

Playwright 三引擎跑关键页，重点是**渐进增强的降级路径**：

- **Chrome / Firefox / Safari**（chromium / firefox / webkit）
- 验证：滚动、纯 CSS 弹簧动效、**View Transitions fallback**（不支持的浏览器须优雅降级为无转场，不报错、不白屏）
- 因内容页零 JS，跨浏览器风险面小，主要盯 CSS 新特性（`backdrop-filter` 毛玻璃、`linear()` 弹簧曲线、跨文档 View Transitions）的回退

---

## 在哪里跑 + 节奏

> **两道闸门别混淆**：①**Workflow `validate` step**（生产数据重算后）只跑 §1.2 Zod + §1.3 sanity，**读 staging `views/<run_id>/**`**，不过则不切指针——它**不渲染页面**，所以视觉/a11y/E2E/perf/跨浏览器**不在这道闸门**。②**部署前 CI**（代码变更触发 deploy 前）跑视觉/a11y/E2E/perf/跨浏览器等渲染级门禁。

| 测试 | 本地 | CI（PR） | Workflow `validate`（数据重算后，读 staging） | 部署前 CI（deploy 前） |
|---|---|---|---|---|
| 1.1 聚合 / 排名单测 | 是，快、随时 | 是，必过 | — | 是 |
| 1.2 Zod schema 校验 | 是 | 是 | 是，产出即校验，脏 JSON 不切指针 | 是，build 读取前 |
| 1.3 sanity 不变量 | 可选 | 是，对产物跑 | 是，**不过不切指针** | 是 |
| 1.4 golden file | 是 | 是 | — | 是 |
| 1.5 shard 等价 / 发布 / 回滚 | 是 | 是 | 是，staging 校验 + 指针闸门 | — |
| 2. 视觉回归 | 选改动页 | 是，关键页全跑 | —（不渲染页面） | 是 |
| 3. a11y（axe + 键盘） | 选改动页 | 是 | —（不渲染页面） | 是 |
| 4. E2E 导航 / i18n | 选改动流 | 是 | —（不渲染页面） | 是 |
| 5. 性能 / 零 JS bundle | 零 JS 检查随时 | 是，零 JS + HTML 体积阻断；Lighthouse 报告 | —（不渲染页面） | 是 |
| 6. 跨浏览器 | 偶尔 | 是，关键页 | —（不渲染页面） | 是 |

**节奏要点**：

- **CI（每 PR）**：1.x 全套 + 2/3/4/5/6 在关键页跑。逻辑测试是门禁，必过；视觉 diff 与 Lighthouse 出报告供 review。
- **Publish gate（Workflow `validate` step）**：生产全量重算把产物写到 `views/<run_id>/**`（version=run_id）后，对该版本跑 §1.2/1.3 Zod + sanity，任一不变量违反即**不切 `views/latest.json` 指针**（线上仍上一版）——防脏数据进生产的最后闸门，运行于 Vercel Workflow 内（§1.5）。实现：`web/lib/workflows/steps/validate.ts`，闸门验证不锚定 `current_stars`（stock 曲线 seam-anchored、stars 为实时，二者刻意不相等）。
- **每日 / 每周 cron**：不触发 deploy，但 cron 写 `current_month.json` / `hot-snapshot.json` / `live/*` 后，对活尾跑 §1.2 schema + §1.3 漂移/非负 sanity（秒级），异常告警（Sentry）而非静默。
- **本地**：改聚合逻辑先跑 1.x；改组件先跑相关页的视觉 + a11y。遵循「改动靠 Vercel 预览确认」——视觉 / 性能以预览部署为准，不依赖本地 dev。

## 验收清单

- [ ] 聚合 / 排名单测覆盖 flow / stock+锚定 / 周月年全时边界 / org 求和，跑真切片（Parquet 子集 + 同源 JSON shard）
- [ ] 全部 JSON 视图有 Zod schema，产出 + build 读取双校验
- [ ] sanity 不变量（非负 / delta 界 / 榜长序 / org==∑members / 漂移 / seam）对全量产物跑，阻断发布
- [ ] staging 校验闸门：不过不切 `views/latest.json` 指针；shard 等价对拍、发布/回滚可逆（§1.5）
- [ ] golden file 覆盖 ≥3 个知名 repo 的里程碑与排名，值已人工核对冻结
- [ ] 视觉回归：关键页 × 4 断点 × 明暗双主题，基准入库
- [ ] axe 零 critical；键盘可达 + focus 可见；reduced-motion 生效；AA 对比；SVG 有 title/aria + 数据表 fallback
- [ ] E2E：导航图 3 跳贯通、上下期导航、里程碑锚点、榜单跳转、i18n locale URL 导航（`<html lang>` / canonical / hreflang / chrome 翻译一致）
- [ ] 内容页零客户端 JS（bundle 断言）+ HTML < 20KB + 字体子集 ≤ ~30KB
- [ ] CWV 达标（LCP<2.5s / INP<200ms / CLS<0.1 / FCP<1.5s）
- [ ] 跨浏览器关键页通过，View Transitions 优雅降级
- [ ] 逻辑代码覆盖率 ≥ 80%
