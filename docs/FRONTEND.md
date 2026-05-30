# gitstarclub 前端设计（Next.js 16 Web 应用）

> **前端层的唯一真相源**——把 [REQUIREMENTS](./REQUIREMENTS.md)（做什么）、[ARCHITECTURE](./ARCHITECTURE.md)（页面分层 / ISR / 节奏）、[DATA-CONTRACTS](./DATA-CONTRACTS.md)（消费的 JSON 视图 schema）、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md)（M3E token / 组件 / 动效）落到 `web/` 这个 **Next.js 16 App Router** 应用的**路由 / 渲染配置 / 数据消费 / 组件 / i18n**。
> SEO 元数据 / sitemap / hreflang 细节见 [SEO.md](./SEO.md)；Blob 布局 / 环境变量 / 部署拓扑见 [OPS.md](./OPS.md)。
> 技术事实基于 **Next.js 16.2.6 · React 19.2 · TypeScript 6 · Tailwind 4 · Zod 4 · 包管理器 bun**（见 `web/package.json`）。
>
> **本文区分「已建」与「待加」**：现有 `web/app` 已有 home / year / month / repo / about 五类页 + `_explore/` 组件（Chrome / RankingList / Heatmap / StarCurve）+ `components/ThemeToggle` + `globals.css` / `layout.tsx` / `template.tsx`。本文描述**现状**并标注**要补什么**，**不发明与仓库冲突的结构**。与文档/需求冲突处用 ⚠️ 显式标注（汇总见 §9）。

---

## 0. 设计原则（先读这条）

| # | 原则 | 落地约束 |
|---|---|---|
| 1 | **RSC 默认、零客户端 JS 优先** | 内容页全是 Server Component；图表服务端渲染 SVG/DOM；动效纯 CSS。唯一允许的客户端 JS 见 §4。 |
| 2 | **build 只读 JSON、运行时零引擎** | 页面 body 与 `generateMetadata` 只 `fetch` pipeline 预算好的 JSON 视图（Vercel Blob），**绝不**在 build / 请求路径加载 Parquet / DuckDB / 原生模块（见 [ARCHITECTURE](./ARCHITECTURE.md)）。 |
| 3 | **页面分层 ↔ Next 配置一一对应** | 核心页 deploy 构建；长尾页按需 ISR；mover/pulse 每日 `revalidatePath`；历史冻结。这是本文的核心，见 §2。 |
| 4 | **token 驱动、不写死调色板** | 组件用 Tailwind 工具类引用 `globals.css` 的 M3E 运行时变量（`bg-primary-container`、`text-on-surface-variant`…），主题切换即时生效（见 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §接入 Tailwind 4）。 |
| 5 | **数据语言中立** | i18n 只翻译 UI chrome / 导航 / 标签 / meta；repo 名、描述、语言、topic、数字保留原文（见 §7、[PRODUCT](./PRODUCT.md) i18n）。 |

---

## 1. 路由（App Router）

### 1.1 路由总表（页面 ↔ 文件 ↔ 渲染层）

> 渲染层定义见 §2。`week`/`org`/`rankings`/`trending` 与 i18n 是**待加**段；标 ✅ 的是 `web/app` 现有文件。

| 页 | URL | 文件（相对 `web/app/`） | 状态 | 渲染层 | `generateStaticParams` |
|---|---|---|---|---|---|
| 首页 | `/` | `page.tsx` | ✅ 已建 | 核心 | — |
| 年页 | `/[year]` | `[year]/page.tsx` | ✅ 已建 | 当年核心 / 历史按需 ISR | ⚠️ 现返回全部年（见 §9-A） |
| 月页 | `/[year]/[month]` | `[year]/[period]/page.tsx` | ✅ 已建 | 当月核心 / 历史按需 ISR | 当月 only（§9-A 已收敛） |
| **周页** | `/[year]/W[week]` | `[year]/[period]/page.tsx`（同段） | ✅ 已建 | 当周 mover / 过去周冻结（按需 ISR） | `[]`（长尾） |
| repo 页 | `/r/[owner]/[name]` | `r/[owner]/[name]/page.tsx` | ✅ 已建 | 按需 ISR（mover 当日刷新） | `[]`（§9-A 已收敛） |
| **org 页** | `/o/[login]` | `o/[login]/page.tsx` | ✅ 已建 | 按需 ISR（mover 当日刷新） | `[]`（长尾） |
| **全时榜** | `/rankings` | `rankings/page.tsx` | ✅ 已建 | 核心（deploy 构建 + 每日 revalidate） | —（单页） |
| **脉搏页** | `/trending` | `trending/page.tsx` | ✅ 已建 | 核心（每日 revalidate，事件驱动） | —（单页） |
| 关于 | `/about` | `about/page.tsx` | ✅ 已建 | 核心 | — |

**周页是独立页**（不是月/年页内的 section）——REQUIREMENTS §3 明确"`/YYYY/W##` 独立页；当周活、过去周冻结"。URL 用字面量 `W` + ISO 周号（与 DATA-CONTRACTS `period = YYYY-Www` 对齐），如 `/2024/W42`。

> ⚠️ **路由消歧（已落地）**：月页 `/[year]/[month]` 与周页 `/[year]/W[week]` 都在 `/[year]/` 下一段。**实测 Next 16 不允许 `[month]` 与 `W[week]` 两个同级动态目录并存——会互相冲突、两条路由都 404。** 故合并为**单一动态段** `[year]/[period]/page.tsx`：在页面里按字面量前缀分流——`/^W\d+$/` → 周视图，否则按数字 1–12 → 月视图（越界 `notFound()`）。`/2024/42`（42>12）落到月视图守卫 → 404。年页/repo 里的月链接仍写 `/${y}/${m}`。

### 1.2 i18n 路由（en 根 / `/ja` / `/zh`）

需求：英文在根（`x-default`），日文 `/ja`、中文 `/zh`（[REQUIREMENTS](./REQUIREMENTS.md) §9、[PRODUCT](./PRODUCT.md) i18n、[SEO](./SEO.md) §10）。⚠️ **现状未做任何 i18n**——`layout.tsx` 硬编码 `lang="en"`，无 locale 段。

**推荐落地（en 无前缀的可选 catch-all locale 段）**：

```
app/
  layout.tsx                 # 根 layout（<html> 不在此定 lang，交给下层；或保留 en 默认）
  [[...locale]]/             # 可选 catch-all：匹配 ""（en 根）、"ja"、"zh"
    layout.tsx               # 读 locale → 注入 <html lang> + 字典 Provider（RSC，无客户端 JS）
    page.tsx                 # 首页（迁自现 app/page.tsx）
    [year]/page.tsx
    [year]/[month]/page.tsx
    [year]/W[week]/page.tsx
    r/[owner]/[name]/page.tsx
    o/[login]/page.tsx
    rankings/page.tsx
    trending/page.tsx
    about/page.tsx
```

要点（决策）：

- **en 无前缀**：英文落在根（`/2024/10`），`/ja/2024/10`、`/zh/2024/10` 为另两语。用**可选 catch-all** `[[...locale]]` 让一套页面文件同时服务三语，避免复制三份目录。`generateStaticParams` 在此段产出 `[{locale:[]},{locale:['ja']},{locale:['zh']}]` 的核心组合。
- **`<html lang>` 下移**：当前 `lang="en"` 在根 `layout.tsx`（`web/app/layout.tsx:76`）。i18n 后由 locale 段 layout 按 `locale` 设 `lang`（en/ja/zh），根 layout 只保留全局 `<head>` 脚本与字体变量。
- **不引入 i18n 库**：MVP 三语、文案量小，用**手写字典**（见 §7）+ RSC 读取即可，不上 `next-intl` / `next-i18next`（符合"零客户端 JS"与最小依赖；与 ARCHITECTURE「MVP 不使用」清单一致）。
- **校验 locale**：未知前缀（非 `ja`/`zh` 且非空）→ `notFound()`，避免 `/xx/2024` 软 200。
- **中间件**：MVP **不需要** `middleware.ts` 做 locale 协商（不自动按 `Accept-Language` 重定向——会破坏静态缓存且制造重复内容风险）。语言切换靠 UI 中显式链接（footer/app bar 的语言切换）。

> 备选：Next 16 `i18n` 配置 + 子路径——但其与 App Router 的静态导出 / hreflang 自指控制不如 `[[...locale]]` 段直观可控，故选段方案。

---

## 2. 页面分层 ↔ Next.js 16 配置（核心）

这是把 [ARCHITECTURE](./ARCHITECTURE.md)「页面分层与重建节奏」与 [REQUIREMENTS](./REQUIREMENTS.md) §6「新鲜度模型（报社比喻）」落成**具体 Next 段配置**的一节。

### 2.1 四层心智模型（对齐新鲜度模型）

| 层 | 页面 | 新鲜度（REQUIREMENTS §6） | Next 机制 |
|---|---|---|---|
| **核心** | `/` · 当年 `/[当前年]` · 当月 · `/rankings` · `/trending`（×3 语言，~数十页） | 头版：每日换 | **deploy 时 SSG**（`generateStaticParams` 返回当期/单页） + 每日 cron `revalidatePath` |
| **长尾** | 历史年/月 · **周** · repo · org（~16k+） | 编年史：冻结 / 标 as-of | **按需 ISR**：`dynamicParams=true` + 空 `generateStaticParams` + `revalidate=false`，首访生成、持久缓存 |
| **mover** | 在 mover 集里的 repo/org + `/trending` | 脉搏：事件驱动，只刷"在动的那一小撮" | 每周/每日 cron 对其 `revalidatePath` 定点失效 → 下次访问再生 |
| **历史** | 已折叠入 Parquet 的过去周期 | 旧报纸：永不重印 | 纯静态命中 CDN；数据不变 = 不 revalidate |

> 关键：**长尾页"成页"极便宜**（懒生成、不占 build 预算）——所以周页 / org 页独立成页不受 45min build 上限约束（[ARCHITECTURE](./ARCHITECTURE.md) 渲染分层）。

### 2.2 段配置速查（每类页面贴什么）

**核心页（当年 / 当月 / rankings / trending）** —— deploy 构建具体 param：

```ts
// 例：app/[[...locale]]/[year]/page.tsx（当年走核心，历史走 ISR — 同一文件、混合）
export const dynamicParams = true            // 未列入的历史年 → 首访按需生成
export async function generateStaticParams() {
  // 只预渲染「当前年」×3 语言；历史年留给按需 ISR
  const Y = new Date().getUTCFullYear()
  return [{ year: String(Y) }]               // locale 由上层段笛卡尔展开
}
export const revalidate = false              // 不轮询；每日 cron 用 revalidatePath 刷当年
```

**长尾页（repo / org / 周 / 历史年月）** —— 不在 deploy 构建：

```ts
// 例：app/[[...locale]]/r/[owner]/[name]/page.tsx
export const dynamicParams = true            // 默认值；空列表 + 此项 = 全部按需生成
export async function generateStaticParams() {
  return []                                  // ⚠️ 现有 repo 页返回全部 repo（见 §9-A），应改成 []
}
export const revalidate = false              // 仅靠 cron 定点失效（每周重算 / mover 当日刷新）
```

**全时榜 / 脉搏（单页、每日新鲜）**：

```ts
// 例：app/[[...locale]]/trending/page.tsx
export const revalidate = false              // 不靠时间轮询
// 每日 cron 写 hot-snapshot.json 后 revalidatePath('/trending') + 三语前缀
```

### 2.3 `next.config.ts`：必须的全局开关

⚠️ 现状 `web/next.config.ts` 为空壳（无任何配置）。落地分层模型需显式声明：

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ⚠️ 关键：cacheComponents 必须保持「关闭」——开启会禁用 dynamicParams，
  // 并使空 generateStaticParams() 在 build 报错（与「长尾全按需」冲突）。
  // 见 ARCHITECTURE 页面分层 §配置要点 / SEO §3.4。MVP 不开启（默认即关，勿误开）。

  // 长尾改名 301（见 PRODUCT「repo 身份」/ SEO §7）——旧 full_name → 当前 full_name
  // 量大时用动态 redirect（middleware 或 route），此处仅示意静态条目位置
  async redirects() {
    return [
      // { source: '/r/old-owner/old-name', destination: '/r/new-owner/new-name', permanent: true },
    ];
  },
};

export default nextConfig;
```

| 开关 | 取值 | 理由 |
|---|---|---|
| `cacheComponents` | **关闭（不设/false）** | 开启禁用 `dynamicParams`、空 `generateStaticParams` 会 build 报错（[ARCHITECTURE](./ARCHITECTURE.md) / [SEO](./SEO.md) §3.4）。 |
| `dynamicParams`（段级） | `true` | 长尾首访生成；未知 param 则 `notFound()`（404，见 [SEO](./SEO.md) §3.2）。 |
| `revalidate`（段级） | `false` | 不做时间轮询；数据变更全靠 cron `revalidatePath` 定点失效。 |
| `redirects()` | repo 改名 301 | canonical 永远指当前 `full_name`（[SEO](./SEO.md) §7）。 |

### 2.4 数据变更如何到达页面（无 deploy）

- **每日 cron**（`/api/cron/daily`，[OPS](./OPS.md) §Cron）：写 `current_month.json` + `hot-snapshot.json` → `revalidatePath` 核心热集（首页 / 当年 / 当月 / rankings / trending，×3 语言）+ mover 集的 repo/org 页。
- **每周 cron**：重算受影响 JSON 视图 → 对变更页 `revalidatePath`（**非 16k 全量 build**）。
- **deploy**：仅代码/结构变更触发；会重置 ISR store，长尾首访冷生成一次（10M/天下可忽略，见 [ARCHITECTURE](./ARCHITECTURE.md)）。

> ⚠️ **`revalidatePath` 需要 mutable route handler（`/api/cron/*`）**——现有 app 尚无 `app/api/` 目录，属待加（与 OPS Cron 章节配套）。

---

## 3. 数据消费（页面如何读 JSON 视图）

### 3.1 现状 vs 目标

⚠️ 现有所有页面从 `web/app/_explore/data.ts` 读**占位数据**（同步、内存、`pseudo()` 造的假数）。data.ts 头部已自述 "Placeholder data … the data layer isn't built yet"。真实数据层落地后，要把 `_explore/data.ts` 换成**读 Blob 上的 JSON 视图**的数据访问层。

### 3.2 数据访问层（建议落在 `web/lib/`）

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 规定 Zod schema 放 `web/lib/contracts/`（⚠️ 该目录尚不存在，待建）。建议结构：

```
web/lib/
  contracts/        # 每个 JSON 产物一个 Zod schema（单一类型事实源）
    rank.ts         # rank/{window}/{period}/{dim}/{metric}.json
    entity.ts       # entity/repo/{id}.json · entity/org/{login}.json
    heatmap.ts      # heatmap/{year|month}/{period}.json
    lookup.ts       # lookup/repos.json · lookup/orgs.json
    snapshot.ts     # current_month.json · hot-snapshot.json
    meta.ts         # meta.json（schema_ver 校验）
  data/             # 读取器（fetch Blob + schema.parse + React cache 去重）
    blob.ts         # 拼 Blob 直链 URL（读 NEXT_PUBLIC_* / 见 OPS Blob 布局）
    rank.ts  entity.ts  heatmap.ts  lookup.ts  snapshot.ts
```

**读取器三要素**（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 + [SEO](./SEO.md) §2）：

```ts
import { cache } from "react";
import { RepoEntitySchema } from "@/lib/contracts/entity";

// React cache(): 同一请求内，generateMetadata 与页面 body 共享同一次读取（去重）
export const getRepoEntity = cache(async (id: number) => {
  const url = blobUrl(`entity/repo/${id}.json`);      // 见 OPS Blob 布局
  const res = await fetch(url, { /* 核心页可加 next:{revalidate:false} */ });
  if (res.status === 404) return null;                 // 未知 → 页面调 notFound()（404）
  return RepoEntitySchema.parse(await res.json());     // 类型从 Zod 推导，不另写 interface
});
```

- **build/运行时只 `fetch` + `parse`**——不聚合、不带引擎（[ARCHITECTURE](./ARCHITECTURE.md) 渲染策略）。
- **未知 param → `notFound()`**（404，禁软 200，见 [SEO](./SEO.md) §3.2）。现有 `r/[owner]/[name]/page.tsx` 用 `repoDetail()` 兜底返回 `REPOS[0]`，⚠️ 真实层须改为查不到即 `notFound()`（见 §9-B）。

### 3.3 每页读哪些视图（页面 ↔ JSON 契约映射）

| 页面 | 主要读取 | 说明 |
|---|---|---|
| 首页 `/` | `hot-snapshot.json`（`home`：`year_spine` / `current_month_top` / `on_this_day`） | 热集 ISR 只读 KB 级快照，**绝不**加载大文件（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.9） |
| 年页（当年） | `hot-snapshot.json`（`current_year`） + `heatmap/year/{Y}.json`（12 月格） | 当年走热快照 |
| 年页（历史） | `rank/year/{Y}/{repo,org}/{flow,stock}.json` + `heatmap/year/{Y}.json` | 冻结视图 |
| 月页（当月） | `hot-snapshot.json`（`current_month`） + `heatmap/month/{period}.json`（合并 `current_month.json` 进行中日） | 进行中当月日总量来自活尾 |
| 月页（历史） | `rank/month/{period}/{repo,org}/{flow,stock}.json` + `heatmap/month/{period}.json` | 三大榜 + 日热力 |
| 周页 | `rank/week/{period}/{repo,org}/{flow,stock}.json`（当周合并活尾） | 独立页 |
| repo 页 | `entity/repo/{id}.json`（`curve`/`milestones`/`monthly_table`/`rank_history`） | mover 当日刷新（curve 含 `recent_daily`） |
| org 页 | `entity/org/{login}.json`（`members`/`curve`/`rank_history`） | 成员聚合曲线 |
| 全时榜 `/rankings` | `rank/all-time/{repo,org}/stock.json`（或 `hot-snapshot.all_time`） | repo 榜 + org 榜并列 |
| 脉搏 `/trending` | `hot-snapshot.json`（mover 集：今日/本周大涨 + 复活/突刺） | 每日 cron 重写 |
| 全部榜单页 | + `lookup/repos.json` / `lookup/orgs.json` | **lookup-join**，见 §3.4 |

### 3.4 lookup-join 模式（榜单只存 id，build join 出展示字段）

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §全局约定 + §2.1/2.2：排行榜 JSON **只存 `id`/`login` + 数值**，不内嵌名字/语言。build 读 `lookup/*` join 出展示字段：

```ts
// 渲染月榜：rank 文件给 id+value，lookup 给 owner/name/lang
const rank = await getRank("month", "2024-10", "repo", "flow"); // items: [{rank,id,value,prev_rank}]
const lookup = await getRepoLookup();                            // { [id]: {owner,name,full_name,language,...} }
const rows = rank.items.map(it => ({ ...it, ...lookup[String(it.id)] }));
```

好处（[DATA-CONTRACTS](./DATA-CONTRACTS.md)）：榜单文件保持小、repo 改名只需更新 lookup（不动每张榜）。⚠️ 现有 `RankingList`/`RankingRow` 直接吃内嵌了 `owner/name/lang/total` 的 `RepoRow`（来自占位 data.ts），真实层接入时入参形状改为 "rank item + lookup join 后" 的对象（见 §6 组件契约映射）。

### 3.5 缓存一致性

- **每日更新的视图**（`current_month.json` / `hot-snapshot.json`）读取时带 `?v=<date>` cache-bust，规避 Blob 同路径覆盖最长 60s 传播窗口（[OPS](./OPS.md) §Blob 缓存传播）。
- `meta.schema_ver`：build 启动校验版本匹配，不符 fail-fast（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §3）。

---

## 4. 零客户端 JS 内容页

### 4.1 图表 = 服务端渲染 SVG / DOM

内容页 **0 客户端 JS**（[REQUIREMENTS](./REQUIREMENTS.md) §7、[ARCHITECTURE](./ARCHITECTURE.md) 性能策略、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §零客户端 JS 约束）。所有图表服务端出 markup、动效纯 CSS：

| 图表 | 组件（`web/app/_explore/`） | 形态 | 动效（CSS，reduced-motion 钉终态） |
|---|---|---|---|
| Star 曲线 | ✅ `StarCurve.tsx` | 服务端 SVG `<path>`（line + area gradient）+ 里程碑金点 + mono 年份轴 | `.curve-line` `stroke-dashoffset` 描绘 + `.curve-area` 淡入 |
| 日历/月热力图 | ✅ `Heatmap.tsx` | DOM 网格 + `color-mix` 强度（冷灰→亮金，非 GitHub 绿） | `animate-rise` stagger |
| 年份脊柱（首页） | ✅ inline in `page.tsx`（`.spine-bar-y`） | DOM 柱，高度 `--h=gained/max` | `grow-y` 弹簧生长 |
| 月度脊柱（年页） | ✅ inline in `[year]/page.tsx`（`.spine-bar`） | DOM 条，宽度 `--w` | `grow` 弹簧生长 |
| 榜单条 | ✅ `RankingList.tsx` | 有序列表 + 右对齐 mono 指标 | `animate-rise` stagger |
| **年脊柱组件化**（建议） | 待加 `_explore/YearSpine.tsx` | 把首页 inline 脊柱抽成组件（供首页/trending 复用） | 同上 |

> 现有 SVG/DOM 图表都已是 RSC（无 `"use client"`），符合约束。新增 org 合计曲线复用 `StarCurve`（`entity/org` 的 `curve` 形状同 repo）。

### 4.2 允许的客户端 JS（三处例外）

[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 规定**三处明确例外**：防闪烁内联脚本、主题切换按钮、**PWA SW 注册**（`RegisterSW.tsx` + `manifest.ts`，挂在根 `layout.tsx:85`）。三者都极小、不渲染正文内容。

| 客户端 JS | 文件 | 性质 | 是否符合 DESIGN-SYSTEM |
|---|---|---|---|
| 防 FOUC 主题脚本 | `layout.tsx:67`（内联 `themeInit`） | paint 前读 `localStorage.theme` 设 `data-theme` + `theme-color` | ✅ 明确例外 |
| 主题切换按钮 | `components/ThemeToggle.tsx`（`"use client"`） | 写 `data-theme` + `localStorage` + 同步 `meta[theme-color]`；图标 CSS 显隐 | ✅ 明确例外 |
| **Service Worker 注册 (PWA)** | `_explore/RegisterSW.tsx`（`"use client"`） | 注册 `/sw.js`（失败静默）+ `manifest.ts` | ✅ 明确例外③（PWA standalone，已写入 DESIGN-SYSTEM） |

- 这些都极小且不渲染内容页正文 → 不破坏「正文零客户端 JS、爬虫拿全量 HTML」（[SEO](./SEO.md) §3a）。
- `<html suppressHydrationWarning>`（`layout.tsx:77`）配合主题脚本，避免 hydration 警告。

---

## 5. 动效

全部纯 CSS、零 JS（[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §动效），token 已落在 `web/app/globals.css`：

| 动效 | 实现（globals.css） | 备注 |
|---|---|---|
| **跨文档页面转场** | `@view-transition { navigation: auto; }`（`globals.css:246`） | 纯 CSS 零 JS；浏览器不支持时无害降级 |
| 路由淡入 | `template.tsx` 重挂载 + `.page-enter`（`--animate-page`，`globals.css:214`） | template 每次导航重挂、CSS 动画自然重放 |
| 入场 rise | `--animate-rise`（`rise` keyframe，`globals.css:151/157`）+ `animation-delay` stagger | 标题 / 榜单行 / 热力格 |
| 弹簧 | `--ease-spring`（CSS `linear()` 预计算关键点，`globals.css:115`） | bar 生长 / hover 抬升 / active 回弹 |
| emphasized 缓动 | `--ease-emphasized`（`cubic-bezier(0.2,0,0,1)`，`globals.css:114`） | 主题/颜色过渡、淡入 |
| 曲线绘制 | `.curve-line` / `.curve-area`（`globals.css:233/239`） | `stroke-dashoffset` 描绘 + 面积淡入 |
| 状态脉冲 | `--animate-status`（`status-pulse`，`globals.css:153/173`） | `/trending` 的"在涨"状态点 |

**reduced-motion 兜底（强制，已落地 `globals.css:258`）**：全局关 animation/transition，并把动画终态钉死（`.spine-bar` 直接 `scaleX(var(--w))`、`.curve-line` `stroke-dashoffset:0`、`.curve-area` `opacity:1`），保证无动效时布局与终态正确。新增组件的入场动画**必须**在此块补对应终态钉死。

> 弹簧曲线关键点 build 期预计算（[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 落地清单）——现 `globals.css` 是手写快照，生成器落地后替换。

---

## 6. 组件架构

### 6.1 现有组件清单（`web/app`）

| 组件 | 文件 | 类型 | 角色 |
|---|---|---|---|
| 顶栏 Top App Bar | `_explore/Chrome.tsx` | RSC | sticky 毛玻璃栏：logo（金★ + wordmark）+ 可选 tag pill + About 链接 + ThemeToggle |
| 榜单 RankingList | `_explore/RankingList.tsx` | RSC | 有序列表，`variant: "gained"|"rate"|"crossed"`；行 = 金色名次 + mono repo 名 + 语言 pill + 右对齐指标；整行 `<Link>`→repo 页 |
| 热力图 Heatmap | `_explore/Heatmap.tsx` | RSC | DOM 网格 + `color-mix` 强度；可选 `href` 包 `<Link>`；`square`/`columns` 控日历布局 |
| Star 曲线 StarCurve | `_explore/StarCurve.tsx` | RSC | 服务端 SVG 面积图 + 里程碑金点 + `role="img"` + aria-label |
| 主题切换 ThemeToggle | `components/ThemeToggle.tsx` | **Client** | 唯一交互按钮（见 §4.2） |
| 页面转场 Template | `template.tsx` | RSC | 重挂载淡入容器 |
| SW 注册 RegisterSW | `_explore/RegisterSW.tsx` | **Client** | PWA（见 §4.2 / §9-C） |
| 占位数据 | `_explore/data.ts` | 模块 | ⚠️ 占位，真实层替换（见 §3） |

> 现有页面里**面包屑 / 上下页导航 / 脊柱 / 页脚**是**内联**在各 page.tsx（如 `[year]/page.tsx` 的 `NavArrow`、`page.tsx` 的脊柱）。随页面增多建议抽成共享组件（见 §6.3）。

### 6.2 server-by-default 原则

- 一切默认 RSC；只有 `ThemeToggle`（必需交互）与 `RegisterSW`（PWA）带 `"use client"`。
- 新增页面（周/org/rankings/trending）**全用 RSC** + 复用上述组件；任何"看似要 JS"的交互先查 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §零客户端 JS 约束表是否有纯 CSS/服务端解法，否则需重新设计而非引入 client JS。

### 6.3 待加的共享组件（随页面扩张）

| 组件 | 用途 | 复用 |
|---|---|---|
| `Breadcrumbs` | Home→年→月 / Home→Rankings→org 等（[SEO](./SEO.md) §6.7） | 全页；同时承载 `BreadcrumbList` JSON-LD |
| `PrevNext`（抽 `NavArrow`/`MonthArrow`） | 上下月 / 上下年 / 上下周（永远在顶部，[PRODUCT](./PRODUCT.md)） | 年/月/周页 |
| `EntityCard` | repo/org 卡片（榜单外的实体展示，如 trending） | trending / rankings |
| `Footer` | `border-t` + on-surface-variant + 构建时间戳（UTC+JST）+ **语言切换** | layout（i18n 语言切换落点） |
| `YearSpine` | 首页 inline 脊柱抽组件 | 首页 / trending |
| `LangSwitcher` | en/ja/zh 切换（纯 `<Link>`，无 client JS） | Footer / app bar |

### 6.4 组件 ↔ JSON 契约映射（真实层接入时的入参形状）

| 组件 | 当前入参（占位） | 真实层入参（DATA-CONTRACTS） |
|---|---|---|
| `RankingList` | `RepoRow[]`（内嵌 owner/name/lang/total/gained） | `rank.items`（`{rank,id,value,prev_rank}`）**join** `lookup/*` 后的行（见 §3.4）；`prev_rank` 驱动 ↑↓/进出 TOP |
| `StarCurve` | `{label,total}[]` + `Milestone[]` | `entity/repo.curve.monthly`（`[period,adds,total_end]`）取 `total_end` 为 `total`；`milestones` 来自 `entity.milestones`；尾部接 `curve.recent_daily` |
| `Heatmap` | `{label,gained}[]` + max | `heatmap/{scope}/{period}.cells`（`[date|period, 总量]`）；当月合并 `current_month.json.daily_totals` |
| 脊柱（YearSpine） | `YEARS`（占位） | `hot-snapshot.home.year_spine`（`[year, 总量]`） |

> ⚠️ `entity/repo.curve.recent_daily` 可为负（取消 star，[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5）；`StarCurve` 现假设单调累计（占位 data.ts 强制 `total` 非降）。真实曲线尾部 net 段可能回落，组件 y 轴/area 计算需容忍非单调（见 §9-D）。

---

## 7. i18n 实现

### 7.1 翻译边界（[PRODUCT](./PRODUCT.md) i18n / [SEO](./SEO.md) §10）

| 翻译 | 不翻译（数据语言中立） |
|---|---|
| UI chrome（顶栏 / 按钮 / 标签）、导航、年度标签、About 正文、**meta + OG 文案**、面包屑名 | repo 名、owner/org login、描述、语言、topic、**所有数字** |

> 这条直接决定字典只覆盖"界面词"，不碰任何来自 JSON 视图的数据字段。

### 7.2 字典（手写、RSC 读取）

```
web/lib/i18n/
  dictionaries/
    en.ts   ja.ts   zh.ts        # UI chrome 文案键值
  index.ts                       # getDictionary(locale) — 服务端读取，无客户端 JS
```

```ts
// web/lib/i18n/index.ts（示意）
const dicts = { en: () => import("./dictionaries/en"), ja: () => import("./dictionaries/ja"), zh: () => import("./dictionaries/zh") } as const;
export type Locale = keyof typeof dicts;
export const getDictionary = async (l: Locale) => (await dicts[l]()).default;
```

- locale 段 layout 读 `getDictionary(locale)` → 以 props 下传给 RSC 子树（**不需要 Context / 客户端 Provider**——全 RSC）。
- 现有 chrome 文案现是英文硬编码（如 `Chrome.tsx` 的 "About"、`page.tsx` 的 "This month so far"）。i18n 后这些改读字典键。
- ⚠️ 现有页面有大量内联英文文案（年页 "all years" / "The spine" / "Top movers of {year}"、月页榜单标题等）——i18n 时需逐一抽到字典。

### 7.3 hreflang / canonical（Metadata API）

[SEO](./SEO.md) §10 矩阵：各语言 canonical **指自身**，hreflang 三语**双向自指** + `x-default`（en）。用 Next 16 Metadata API `alternates`：

```ts
// 统一构造（en 同时充当 x-default）；BASE = process.env.NEXT_PUBLIC_SITE_URL
function altLanguages(path: string) {            // path 形如 "/2024/10"（无 locale 前缀）
  return { en: `${BASE}${path}`, ja: `${BASE}/ja${path}`, zh: `${BASE}/zh${path}`, "x-default": `${BASE}${path}` };
}
// 各页 generateMetadata：
return {
  alternates: { canonical: `${BASE}${localePrefix}${path}`, languages: altLanguages(path) },
  // openGraph.locale 按语言：en_US / ja_JP / zh_CN；alternateLocale 列另两种
};
```

- ⚠️ 现状 `layout.tsx` 的 metadata 只有 `alternates.canonical:"/"`，无 `languages`——i18n 落地时补全（细节与 sitemap `alternates.languages` 同源，见 [SEO](./SEO.md) §4.1/§10）。
- `metadataBase`（`layout.tsx:21` 现硬编码 `https://gitstarclub.com`）应改读 `NEXT_PUBLIC_SITE_URL`（[OPS](./OPS.md) 环境变量 / [SEO](./SEO.md) §2）以适配预览/生产。

---

## 8. 与现有 app 的具体接点（实现起步清单）

> 把上面落到"动现有哪些文件"。**本文是 spec，不写应用代码**；以下是接入顺序建议。

1. **数据层**：建 `web/lib/contracts/`（Zod，[DATA-CONTRACTS](./DATA-CONTRACTS.md) §4）+ `web/lib/data/`（fetch Blob + parse + `cache()`）→ 逐页把 `_explore/data.ts` 占位换成真实读取器；删除/收敛 `data.ts`。
2. **段配置**：现有 `[year]` / `[year]/[month]` / `r/[owner]/[name]` 的 `generateStaticParams` 从"返回全部"改为"当期/空数组"（§2.2、§9-A）；repo/org/月/年的未知 param 改 `notFound()`（§9-B）。
3. **`next.config.ts`**：显式注释 `cacheComponents` 关闭 + 预留 `redirects()`（§2.3）。
4. **新页面**：加 `[year]/W[week]`、`o/[login]`、`rankings`、`trending`（全 RSC，复用组件）。
5. **i18n**：引入 `[[...locale]]` 段，下移 `<html lang>`，建字典，补 `alternates.languages`（§7）。
6. **SEO 配套**：`app/sitemap.ts`（`generateSitemaps()` 分片）、`app/robots.ts`、各页 `generateMetadata`、JSON-LD（[SEO](./SEO.md) §4/§5/§6）。
7. **cron route**：`app/api/cron/daily` · `app/api/cron/weekly`（`revalidatePath` + `CRON_SECRET` 鉴权，[OPS](./OPS.md) §Cron）。
8. **共享组件**：抽 `Breadcrumbs` / `PrevNext` / `Footer` / `YearSpine` / `LangSwitcher`（§6.3）。

---

## 9. 与文档/需求的冲突与待决项（⚠️ 汇总）

> 现有 `web/app` 是 **M3E UI/UX 探索原型**（`data.ts` 自述占位），多处与"生产分层/数据契约"模型有意或暂时不一致。这里逐条列出，供实现时对齐。

| # | 冲突/缺口 | 现状 | 文档要求 | 处置 |
|---|---|---|---|---|
| **A** | **长尾页 `generateStaticParams` 返回全部** | `[year]`（全部年）、`[year]/[month]`（全部年×12 月）、`r/[owner]/[name]`（全部 REPOS）都在 build 预渲染 | 长尾应**空 `generateStaticParams` + 按需 ISR**；仅当年/当月留核心（[ARCHITECTURE](./ARCHITECTURE.md) 分层、[SEO](./SEO.md) §3） | 真实层接入时改：当年/当月返回当期；历史年月 + 全部 repo/org/周 返回 `[]` |
| **B** | **未知 param 软兜底而非 404** | `repoDetail()` 查不到回 `REPOS[0]`（200）；月页/年页有 `notFound()` 但 repo 页无 | 未知 repo/org → `notFound()`（404），禁软 200（[SEO](./SEO.md) §3.2） | 真实读取器查不到即 `notFound()` |
| **C** | **第三处客户端 JS（PWA）** | `RegisterSW.tsx`（`"use client"`，注册 SW）+ `manifest.ts` | DESIGN-SYSTEM 原仅列两处例外 | ✅ **已决：保留 PWA**，已在 DESIGN-SYSTEM 补为例外③（保留 RegisterSW/manifest/sw.js） |
| **D** | **StarCurve 假设单调累计** | 占位 data 强制 `total` 非降；轴/area 按单增算 | `entity/repo.curve.recent_daily` net 可负，尾部可能回落（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5） | 真实接入时让 y 轴/area 容忍非单调；`max` 取序列实际最大值 |
| **E** | **无 i18n / `lang` 硬编码** | `layout.tsx` `lang="en"`，无 locale 段/字典/hreflang | en 根 + `/ja` + `/zh` + hreflang 自指（[PRODUCT](./PRODUCT.md)/[SEO](./SEO.md) §10） | 见 §1.2 / §7 |
| **F** | **`metadataBase` 硬编码** | `layout.tsx:21` 写死 `https://gitstarclub.com` | 应读 `NEXT_PUBLIC_SITE_URL`（预览/生产切换，[OPS](./OPS.md)/[SEO](./SEO.md) §2） | 改读环境变量 |
| **G** | **缺 sitemap/robots/cron/og 路由** | `app/` 无 `sitemap.ts`/`robots.ts`/`api/`/动态 OG | SEO/OPS 要求齐备（[SEO](./SEO.md)/[OPS](./OPS.md)） | 待加（§8） |
| **H** | **repo 页 "synced" 时间写死** | `r/[owner]/[name]/page.tsx:45` 硬编码 `synced 2026-05-29 · 14:30 JST` | as-of 应来自数据（`fetched_at`/`updated`），UTC+JST 双显示（[ARCHITECTURE](./ARCHITECTURE.md) 时区） | 真实层取 `entity`/`current_stars` 的 as-of 字段 |
| **I** | **`_explore/` 命名** | 组件在 `app/_explore/`（`_` 前缀 = private folder，不成路由段） | 设计系统组件清单引用 `_explore/` + `components/` | 沿用现状（`_explore` 私有目录合理）；新共享组件可继续放 `_explore/` 或提升到 `components/` |

> 处置原则：**原型先用占位跑通 M3E 观感是合理的**；上述差异是"原型→生产"的已知 TODO，不是设计错误。落地数据层时按本表逐条收敛即可。

---

## 10. 落地核对清单（前端层）

**路由**
- [ ] 周页 `/[year]/W[week]` 独立、与 `[month]` 消歧（字面量 `W` 前缀 + month 守卫）
- [ ] org `/o/[login]`、全时榜 `/rankings`、脉搏 `/trending` 已加（全 RSC）
- [ ] i18n `[[...locale]]` 段：en 根 / `/ja` / `/zh`；未知 locale → `notFound()`；无自动重定向中间件

**分层 ↔ 配置**
- [ ] `cacheComponents` 保持关闭（`next.config.ts` 注释说明）
- [ ] 核心段（当年/当月/rankings/trending×3 语言）`generateStaticParams` 返回当期/单页
- [ ] 长尾段（历史年月/周/repo/org）`dynamicParams=true` + 空 `generateStaticParams` + `revalidate=false`
- [ ] 数据变更靠 cron `revalidatePath`，无全量 build；`app/api/cron/*` 带 `CRON_SECRET` 鉴权

**数据消费**
- [ ] `web/lib/contracts/`（Zod）+ `web/lib/data/`（fetch+parse+`cache()`）替换 `_explore/data.ts`
- [ ] 榜单走 lookup-join（rank item + `lookup/*`）；未知 param → `notFound()`
- [ ] 每日视图读取带 `?v=<date>` cache-bust；`meta.schema_ver` 启动校验

**零客户端 JS**
- [ ] 内容页正文 0 client JS；图表服务端 SVG/DOM；仅主题切换 + PWA SW（已决保留为例外③）带 `"use client"`
- [ ] 新增入场动画在 `prefers-reduced-motion` 块补终态钉死

**i18n**
- [ ] 字典覆盖全部 UI chrome（抽离现有内联英文）；数据字段不翻译
- [ ] 各页 `alternates.canonical` 指自身 + `alternates.languages`（en/ja/zh + x-default）；`og:locale` 按语言
- [ ] `metadataBase` 改读 `NEXT_PUBLIC_SITE_URL`

**冲突收敛（§9）**
- [ ] A–I 逐条处置（长尾 ISR / 404 / PWA 例外文档 / 非单调曲线 / i18n / metadataBase / SEO 路由 / as-of 时间）
