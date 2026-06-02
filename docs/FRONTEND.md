# gitstarclub 前端设计（Next.js 16 Web 应用）

> **前端层的唯一真相源**——把 [REQUIREMENTS](./REQUIREMENTS.md)（做什么）、[ARCHITECTURE](./ARCHITECTURE.md)（页面分层 / ISR / 节奏）、[DATA-CONTRACTS](./DATA-CONTRACTS.md)（消费的 JSON 视图 schema）、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md)（M3E token / 组件 / 动效）落到 `web/` 这个 **Next.js 16 App Router** 应用的**路由 / 渲染配置 / 数据消费 / 组件 / i18n**。
> SEO 元数据 / sitemap / canonical 细节见 [SEO.md](./SEO.md)；Blob 布局 / 环境变量 / 部署拓扑见 [OPS.md](./OPS.md)。
> 技术事实基于 **Next.js 16.2.6 · React 19.2 · TypeScript 6 · Tailwind 4 · Zod 4 · 包管理器 bun**（见 `web/package.json`）。
>
> **本文区分「已建」与「待加」**：现有 `web/app` 已有 Pulse 首页、Pulse、Rankings、Rankings 历史页、repo、org、about + `_explore/` 组件（Chrome / RankingList / Heatmap / StarCurve）+ `components/ThemeToggle` + `globals.css` / `layout.tsx` / `template.tsx`。本文描述**现状**并标注**要补什么**，**不发明与仓库冲突的结构**。与文档/需求冲突处用 ⚠️ 显式标注（汇总见 §9）。

---

## 0. 设计原则（先读这条）

| # | 原则 | 落地约束 |
|---|---|---|
| 1 | **RSC 默认、零客户端 JS 优先** | 内容页全是 Server Component；图表服务端渲染 SVG/DOM；动效纯 CSS。唯一允许的客户端 JS 见 §4。 |
| 2 | **build 只读 JSON、运行时零引擎、不感知 Workflow** | 页面 body 与 `generateMetadata` 只 `fetch` 预算好的 JSON 视图（Vercel Blob），**绝不**在 build / 请求路径加载 Parquet / DuckDB / 原生模块，也**不知道** Vercel Workflow 存在——数据怎么产出（bootstrap / cron / Workflow）对页面透明，页面只读最终 JSON（见 [ARCHITECTURE](./ARCHITECTURE.md)、[VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md)）。 |
| 3 | **页面分层 ↔ Next 配置一一对应** | 核心页 deploy 构建；长尾页按需 ISR；mover/pulse 每日 `revalidatePath`；历史冻结。这是本文的核心，见 §2。 |
| 4 | **token 驱动、不写死调色板** | 组件用 Tailwind 工具类引用 `globals.css` 的 M3E 运行时变量（`bg-primary-container`、`text-on-surface-variant`…），主题切换即时生效（见 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §接入 Tailwind 4）。 |
| 5 | **数据语言中立** | i18n 只翻译 UI chrome / 导航 / 标签 / meta；repo 名、描述、语言、topic、数字保留原文（见 §7、[PRODUCT](./PRODUCT.md) i18n）。 |

---

## 1. 路由（App Router）

### 1.1 路由总表（页面 ↔ 文件 ↔ 渲染层）

> 渲染层定义见 §2。站内 canonical URL 全部带语言前缀；旧 `/trending` 与旧 `/{year}` 历史路径已从路由树删除，不做兼容重定向。

| 页 | URL | 文件（相对 `web/app/`） | 状态 | 渲染层 | `generateStaticParams` |
|---|---|---|---|---|---|
| 首页 | `/` | `page.tsx` | ✅ 已建 | 核心 Pulse | — |
| **脉搏页** | `/pulse` | `pulse/page.tsx` | ✅ 已建 | 核心（每日 revalidate，事件驱动） | — |
| **总榜** | `/rankings` | `rankings/page.tsx` | ✅ 已建 | 核心（每日 revalidate） | — |
| 年榜 | `/rankings/[year]` | `rankings/[year]/page.tsx` | ✅ 已建 | 当年核心 / 历史按需 ISR | 当前年 |
| 月榜 | `/rankings/[year]/[month]` | `rankings/[year]/[period]/page.tsx` | ✅ 已建 | 当月核心 / 历史按需 ISR | 当前月 |
| 周榜 | `/rankings/[year]/W[week]` | `rankings/[year]/[period]/page.tsx` | ✅ 已建 | 当周 mover / 过去周冻结 | `[]`（长尾） |
| repo 页 | `/[owner]/[name]` | `[owner]/[name]/page.tsx` | ✅ 已建 | 按需 ISR（mover 当日刷新） | `[]`（长尾） |
| **org 页** | `/o/[login]` | `o/[login]/page.tsx` | ✅ 已建 | 按需 ISR（mover 当日刷新） | `[]`（长尾） |
| 关于 | `/about` | `about/page.tsx` | ✅ 已建 | 核心 | — |

**周榜是独立页面**，但归入总榜路径下：`/rankings/YYYY/W##`。月榜和周榜共用 `[period]` 段，在页面里按 `W` 前缀分流；旧的 `/{lang}/YYYY` 与 `/{lang}/YYYY/MM` 不再存在。

### 1.2 i18n（页内偏好，不进 URL）

需求：默认英文，并提供 en / ja / zh / zh-TW / ko / es / fr 七种 UI 语言（[REQUIREMENTS](./REQUIREMENTS.md) §9、[PRODUCT](./PRODUCT.md) i18n、[SEO](./SEO.md) §10）。✅ **已改为页内语言偏好**：URL 不包含语言段，repo URL 可与 GitHub 结构一致。

**已落地**：

```
app/
  layout.tsx                 # 读取 gsc_lang cookie，设置 <html lang>，渲染 Footer
  page.tsx  pulse/page.tsx
  [owner]/[name]/page.tsx    # GitHub 风格 repo URL
  o/[login]/page.tsx
  rankings/page.tsx  rankings/[year]/page.tsx  rankings/[year]/[period]/page.tsx
  about/page.tsx
  api/lang/route.ts          # 直接访问时的语言 cookie 后备入口
  robots.ts  sitemap.ts  manifest.ts  api/   # 根级特殊路由，无需 layout
```

要点（实测后修正）：

- **URL canonical 单一化**：`/facebook/react` 是唯一 repo URL；不再有 `/en/r/facebook/react` / `/zh/r/facebook/react`。
- **语言偏好**：默认英文；`LanguageSwitcher` 显示当前语言，其它语言在下拉菜单中。客户端直接写入 `gsc_lang` cookie 并 `router.refresh()` 当前 RSC 视图，URL 不变；`/api/lang` 保留为直接访问时的安全后备入口。
- **缓存取舍**：读取 cookie 会让页面按请求渲染，但 JSON 数据仍走 `fetch`/`cache()`；换来 URL 与 GitHub 一致、无多语言重复 URL。
- **SEO 取舍**：canonical 不带语言，也不再发 `hreflang` 矩阵；默认 SEO 文案以英文为主，语言切换是用户体验功能。
- **手写字典**：`web/lib/i18n/`（en/ja/zh/zh-TW/ko/es/fr + `getDictionary`），不引第三方 i18n 库；数据字段不翻译。

---

## 2. 页面分层 ↔ Next.js 16 配置（核心）

这是把 [ARCHITECTURE](./ARCHITECTURE.md)「页面分层与重建节奏」与 [REQUIREMENTS](./REQUIREMENTS.md) §6「新鲜度模型（报社比喻）」落成**具体 Next 段配置**的一节。

### 2.1 四层心智模型（对齐新鲜度模型）

| 层 | 页面 | 新鲜度（REQUIREMENTS §6） | Next 机制 |
|---|---|---|---|
| **核心** | `/` · `/pulse` · `/rankings` · 当年/当月的 `/rankings/...` | 头版：每日换 | 每日 cron `revalidatePath`；页面按语言 cookie 请求渲染 |
| **长尾** | 历史年/月 · **周** · repo · org（~16k+） | 编年史：冻结 / 标 as-of | **按需 ISR**：`dynamicParams=true` + 空 `generateStaticParams` + `revalidate=false`，首访生成、持久缓存 |
| **mover** | 在 mover 集里的 repo/org + `/pulse` | 脉搏：事件驱动，只刷"在动的那一小撮" | 每周/每日 cron 对其 `revalidatePath` 定点失效 → 下次访问再生 |
| **历史** | 已折叠入 Parquet 的过去周期 | 旧报纸：永不重印 | 纯静态命中 CDN；数据不变 = 不 revalidate |

> 关键：**长尾页"成页"极便宜**（懒生成、不占 build 预算）——所以周页 / org 页独立成页不受 45min build 上限约束（[ARCHITECTURE](./ARCHITECTURE.md) 渲染分层）。

### 2.2 段配置速查（每类页面贴什么）

**核心页（Pulse / Rankings / 当年 / 当月）** —— deploy 构建具体 param：

```ts
// 例：app/rankings/[year]/page.tsx（当年走核心，历史走 ISR — 同一文件、混合）
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
// 例：app/[owner]/[name]/page.tsx
export const dynamicParams = true            // 默认值；空列表 + 此项 = 全部按需生成
export async function generateStaticParams() {
  return []                                  // ⚠️ 现有 repo 页返回全部 repo（见 §9-A），应改成 []
}
export const revalidate = false              // 仅靠 cron 定点失效（每周重算 / mover 当日刷新）
```

**全时榜 / 脉搏（单页、每日新鲜）**：

```ts
// 例：app/pulse/page.tsx
export const revalidate = false              // 不靠时间轮询
// Vercel cron 写 hot-snapshot.json / 当前周月 rank 后 revalidatePath('/pulse')
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
      // { source: '/old-owner/old-name', destination: '/new-owner/new-name', permanent: true },
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

- **每日 cron**（`/api/cron/daily`，[OPS](./OPS.md) §Cron）：写 `current_month.json` + `hot-snapshot.json` + `live/rank/*` 当前月/当前周覆盖层 + `live/heatmap/*` 当月覆盖层 → `revalidatePath` 核心热集（首页 / pulse / rankings / 当年 / 当月 / 当前周）。
- **每周 cron**（`/api/cron/weekly`）：同样在 Vercel 内做 live refresh，保证周榜和月榜即使没有全量历史重算也不会断档；全量历史刷新另走 Vercel Workflow 分片，不做 16k 全量 build。
- **deploy**：仅代码/结构变更触发；会重置 ISR store，长尾首访冷生成一次（见 [ARCHITECTURE](./ARCHITECTURE.md)）。

> ✅ `app/api/cron/daily` 与 `app/api/cron/weekly` 已落地（`revalidatePath` + `CRON_SECRET` 鉴权）。

### 2.5 ⚠️ 当前渲染现实：`force-dynamic`（与 SSG/ISR 模型的分歧，§9-J）

> **现状与上面 §2.1–2.4 的 SSG/ISR 蓝图不一致,如实记录(证据可核查)**:
> - `web/app/layout.tsx:19` → `export const dynamic = "force-dynamic";`（根 layout 显式强制动态）
> - `web/app/layout.tsx:61` → 根 layout 体内 `await getPreferredDictionary()` → `web/lib/i18n/server.ts:5` 调 `(await cookies()).get(LANG_COOKIE)`——**读 cookie 是 Dynamic API,本身就把整棵路由树打成按请求渲染**
> - `web/app/[owner]/[name]/page.tsx:17`、`web/app/o/[login]/page.tsx:17` → 也各自 `force-dynamic`
>
> **后果**:每个请求跑一次 Server Function(SSR),不命中 CDN 静态文件,与 [ARCHITECTURE](./ARCHITECTURE.md)「永不触达 Function / 热路径 0 Function / 完全 SSG」直接冲突。

- **仍成立**:内容页"零客户端 JS"、SSR 输出**完整可索引 HTML**(SEO §3a 不受影响)——force-dynamic 改的是"在哪渲染",不是"客户端有没有 JS"。
- **不符**:"build 预生成静态 / 命中边缘缓存 / 热路径零 Function / 完全 SSG / 按需 ISR 持久缓存"。成本上 10M/天 ≈ 千万次 Function/天,与纯静态命中 CDN 的扛量模型完全不同。
- **✅ 已决——目标 = C「静态基底 + 客户端译 chrome」**(取代早前三选项的"未决"):服务端只用**默认英文**静态渲染(render 路径**不读 cookie**);导航/标签/面包屑/About 这层薄 chrome 在**客户端**按 `localStorage`/cookie 切换。理由:每页 ~95% 是语言中立数据,只有几十个 chrome 字符串要翻;C 同时保住 **静态 CDN 扛量 + GitHub 风格 URL + 页内切语言**,且吻合已定的 SEO 口径(语言中立 canonical、英文默认、不发 hreflang,见 [SEO](./SEO.md) i18n 注)。
  - 否决 A(接受动态→放弃扛量)、B(i18n 回 URL 段→推翻 GitHub 风格 URL §9-E)。
- **时序**:当前 noindex 预览期(`layout.tsx:17` `SITE_INDEXABLE` 未开),放量问题未发生 ⇒ **不必今天重写**;**上线/放量前实现 C**:把 `getPreferredDictionary()` 移出服务端 render → 去掉 layout 与那两页的 `force-dynamic` → 客户端水合 chrome → 在 Vercel 核对页面回到 static/ISR(构建输出 static vs ƒ、响应头命中 CDN)。属代码活,待"继续做代码"再开。

---

## 3. 数据消费（页面如何读 JSON 视图）

### 3.1 现状（✅ 已接真实数据层，占位已移除）

✅ **占位 `_explore/data.ts` 已删除**；现有页面全部从 `@/lib/data` 读 Blob 上的真实 JSON 视图(`fetch` + Zod parse + React `cache()`)。8 个页面文件(`page`/`pulse`/`rankings/**`/`[owner]/[name]`/`o/[login]` 等)均 import `@/lib/data`,无一再用占位。

### 3.2 数据访问层（已落地 `web/lib/`）

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 的 Zod schema 已建于 `web/lib/contracts/`,读取器已建于 `web/lib/data/`。**实际结构**(与下方早期"建议结构"略有出入——按产物族归并,非每产物一文件):

```
web/lib/
  contracts/        # Zod schema（单一类型事实源），barrel = index.ts
    common.ts       # 共享/枚举/rank/heatmap/meta 等基础 schema
    lookup.ts  entity.ts  live.ts
  data/             # 读取器（fetch Blob + schema.parse + React cache 去重），barrel = index.ts
    source.ts       # readView：拼 Blob 直链 URL + fetch + parse（见 OPS Blob 布局）
    lookup.ts  rank.ts  entity.ts  heatmap.ts  snapshot.ts  meta.ts  write.ts
```

> 早期"每产物一个 schema 文件"的建议结构(rank.ts/heatmap.ts/snapshot.ts/meta.ts 分离)未严格采用;实际把 rank/heatmap/meta 的 schema 收进 `common.ts`,readers 仍按 rank/heatmap/snapshot/meta 分文件。契约语义不变。

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

- **运行时只 `fetch` + `parse`**——不聚合、不带引擎（[ARCHITECTURE](./ARCHITECTURE.md) 渲染策略）。
- **未知 param → `notFound()`**（404，禁软 200，见 [SEO](./SEO.md) §3.2）。✅ 已落地：`[owner]/[name]/page.tsx` 先 `getRepoIdByFullName()` 查 id、查不到 `notFound()`，再 `getRepoEntity(id)`、为空再 `notFound()`（§9-B 已收敛）。

### 3.3 每页读哪些视图（页面 ↔ JSON 契约映射）

| 页面 | 主要读取 | 说明 |
|---|---|---|
| 首页 `/` | `hot-snapshot.json`（`home`：`year_spine` / `current_month_top` / `on_this_day`） | 热集 ISR 只读 KB 级快照，**绝不**加载大文件（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.9） |
| 年页（当年） | `hot-snapshot.json`（`current_year`） + `heatmap/year/{Y}.json`（12 月格） | 当年走热快照 |
| 年榜（历史） | `rank/year/{Y}/{repo,org}/{flow,stock}.json` + `heatmap/year/{Y}.json` | 冻结视图 |
| 月榜（当月） | `live/rank/month/{period}/repo/{flow,stock}.json` + `live/heatmap/month/{period}.json`，缺失时回退基础 `rank/*` / `heatmap/*` | 进行中当月来自 Vercel cron 活尾 |
| 月榜（历史） | `rank/month/{period}/{repo,org}/{flow,stock}.json` + `heatmap/month/{period}.json` | 三大榜 + 日热力 |
| 周榜 | 当前周优先 `live/rank/week/{period}/repo/flow.json`，历史周读基础 `rank/week/*` | 独立页 |
| repo 页 | `entity/repo/{id}.json`（`curve`/`milestones`/`monthly_table`/`rank_history`） | mover 当日刷新（curve 含 `recent_daily`） |
| org 页 | `entity/org/{login}.json`（`members`/`curve`/`rank_history`） | 成员聚合曲线 |
| 全时榜 `/rankings` | `rank/all-time/{repo,org}/stock.json`（或 `hot-snapshot.all_time`） | repo 榜 + org 榜并列 |
| 脉搏 `/pulse` | `hot-snapshot.json` + 当前周 `live/rank/week/<current>/repo/flow.json` | 每日/每周 Vercel cron 重写 |
| 全部榜单页 | + `lookup/repos.json` / `lookup/orgs.json` | **lookup-join**，见 §3.4 |

### 3.4 lookup-join 模式（榜单只存 id，build join 出展示字段）

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §全局约定 + §2.1/2.2：排行榜 JSON **只存 `id`/`login` + 数值**，不内嵌名字/语言。build 读 `lookup/*` join 出展示字段：

```ts
// 渲染月榜：rank 文件给 id+value，lookup 给 owner/name/lang
const rank = await getRank("month", "2024-10", "repo", "flow"); // items: [{rank,id,value,prev_rank}]
const lookup = await getRepoLookup();                            // { [id]: {owner,name,full_name,language,...} }
const rows = rank.items.map(it => ({ ...it, ...lookup[String(it.id)] }));
```

好处（[DATA-CONTRACTS](./DATA-CONTRACTS.md)）：榜单文件保持小、repo 改名只需更新 lookup（不动每张榜）。✅ 现行：`web/lib/data/rank.ts` 的 `joinRepoRank`/`joinOrgRank` 把 `rank.items`（`{rank,id,value,prev_rank}`）与 `lookup/*` join 出展示字段后喂给 `RankingList`（早期占位版曾内嵌 `owner/name/lang/total`，已弃）。

### 3.5 缓存一致性

- **每日更新的视图**（`current_month.json` / `hot-snapshot.json`）读取时带 `?v=<date>` cache-bust，规避 Blob 同路径覆盖最长 60s 传播窗口（[OPS](./OPS.md) §Blob 缓存传播）。
- `meta.schema_ver`：build 启动校验版本匹配，不符 fail-fast（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §3）。
- **base 视图版本指针（Workflow 落地后）**：base `rank/*` / `entity/*` / `heatmap/*` 改为「先读 `views/latest.json` 指针解析版本前缀，再读该前缀下视图」（[VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md) §4.1/§7）。这一步**封装在 `web/lib/data/`**，组件入参形状不变、**对页面透明**；现有「live 优先、回退 base」语义保留（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.11）。

---

## 4. 零客户端 JS 内容页

### 4.1 图表 = 服务端渲染 SVG / DOM

内容页 **0 客户端 JS**（[REQUIREMENTS](./REQUIREMENTS.md) §7、[ARCHITECTURE](./ARCHITECTURE.md) 性能策略、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §零客户端 JS 约束）。所有图表服务端出 markup、动效纯 CSS：

| 图表 | 组件（`web/app/_explore/`） | 形态 | 动效（CSS，reduced-motion 钉终态） |
|---|---|---|---|
| Star 曲线 | ✅ `StarCurve.tsx` | 服务端 SVG `<path>`（line + area gradient）+ 里程碑金点 + mono 年份轴 | `.curve-line` `stroke-dashoffset` 描绘 + `.curve-area` 淡入 |
| 日历/月热力图 | ✅ `Heatmap.tsx` | DOM 网格 + `color-mix` 强度（冷灰→亮金，非 GitHub 绿） | `animate-rise` stagger |
| 年份脊柱（首页） | ✅ inline in `page.tsx`（`.spine-bar-y`） | DOM 柱，高度 `--h=gained/max` | `grow-y` 弹簧生长 |
| 月度脊柱（年榜） | ✅ inline in `rankings/[year]/page.tsx`（`.spine-bar`） | DOM 条，宽度 `--w` | `grow` 弹簧生长 |
| 榜单条 | ✅ `RankingList.tsx` | 有序列表 + 右对齐 mono 指标 | `animate-rise` stagger |
| **年脊柱组件化**（建议） | 待加 `_explore/YearSpine.tsx` | 把首页 inline 脊柱抽成组件（供首页/pulse 复用） | 同上 |

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
| 状态脉冲 | `--animate-status`（`status-pulse`，`globals.css:153/173`） | `/pulse` 的"在涨"状态点 |

**reduced-motion 兜底（强制，已落地 `globals.css:258`）**：全局关 animation/transition，并把动画终态钉死（`.spine-bar` 直接 `scaleX(var(--w))`、`.curve-line` `stroke-dashoffset:0`、`.curve-area` `opacity:1`），保证无动效时布局与终态正确。新增组件的入场动画**必须**在此块补对应终态钉死。

> 弹簧曲线关键点 build 期预计算（[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 落地清单）——现 `globals.css` 是手写快照，生成器落地后替换。

---

## 6. 组件架构

### 6.1 现有组件清单（`web/app`）

| 组件 | 文件 | 类型 | 角色 |
|---|---|---|---|
| 顶栏 Top App Bar | `_explore/Chrome.tsx` | RSC | sticky 毛玻璃栏：logo（金★ + wordmark）+ 可选 tag pill + About 链接 + ThemeToggle |
| 榜单 RankingList | `_explore/RankingList.tsx` | RSC | 有序列表，`variant: "gained"|"rate"|"crossed"`；行 = 金色名次 + mono repo 名 + 语言/计数 pill + 右对齐指标；整行 `<Link>`→repo 页；总榜双栏使用固定行高和单行截断，保证相同条数时两边高度一致 |
| 热力图 Heatmap | `_explore/Heatmap.tsx` | RSC | DOM 网格 + `color-mix` 强度；可选 `href` 包 `<Link>`；`square`/`columns` 控日历布局 |
| Star 曲线 StarCurve | `_explore/StarCurve.tsx` | RSC | 服务端 SVG 面积图 + 里程碑金点 + `role="img"` + aria-label |
| 面包屑 Breadcrumbs | `_explore/Breadcrumbs.tsx` | RSC | ✅ 已建：Home→年→月 / Home→owner→repo 等（[SEO](./SEO.md) §6.7） |
| 结构化数据 JsonLd | `_explore/JsonLd.tsx` | RSC | ✅ 已建：注入 `application/ld+json`（配 `@/lib/jsonld`） |
| 页脚 Footer | `_explore/Footer.tsx` | RSC | ✅ 已建：构建时间戳 + 语言切换落点 |
| 主题切换 ThemeToggle | `components/ThemeToggle.tsx` | **Client** | 交互按钮（见 §4.2） |
| 语言切换 LanguageSwitcher | `components/LanguageSwitcher.tsx` | **Client** | ✅ 已建：写 `gsc_lang` cookie + `router.refresh()`（§7） |
| 页面转场 Template | `template.tsx` | RSC | 重挂载淡入容器 |
| SW 注册 RegisterSW | `_explore/RegisterSW.tsx` | **Client** | PWA（见 §4.2 / §9-C） |

> ✅ 占位 `_explore/data.ts` 已删除（页面读 `@/lib/data`，见 §3.1）。面包屑 / 页脚 / 语言切换已抽成共享组件；**上下页导航 / 脊柱** 仍部分内联在各 page.tsx（见 §6.3 剩余待抽项）。

### 6.2 server-by-default 原则

- 一切默认 RSC；只有 `ThemeToggle`（必需交互）与 `RegisterSW`（PWA）带 `"use client"`。
- 新增页面（周/org/rankings/pulse）**全用 RSC** + 复用上述组件；任何"看似要 JS"的交互先查 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §零客户端 JS 约束表是否有纯 CSS/服务端解法，否则需重新设计而非引入 client JS。

### 6.3 共享组件（✅ 已建 / ⏳ 仍待抽）

| 组件 | 状态 | 用途 / 复用 |
|---|---|---|
| `Breadcrumbs` | ✅ 已建（`_explore/`） | Home→年→月 / Home→owner→repo（[SEO](./SEO.md) §6.7） |
| `Footer` | ✅ 已建（`_explore/`） | 构建时间戳（UTC+JST）+ 语言切换落点 |
| `LanguageSwitcher` | ✅ 已建（`components/`） | 当前语言 + 下拉切其它语言；en/ja/zh/zh-TW/ko/es/fr；写 cookie + `router.refresh()` |
| `JsonLd` | ✅ 已建（`_explore/`） | 注入 `BreadcrumbList`/`Dataset` 等 JSON-LD |
| `PrevNext`（`NavArrow`/`MonthArrow`） | ⏳ 仍内联 | 上下月 / 上下年 / 上下周（年/月/周页） |
| `EntityCard` | ⏳ 待加 | repo/org 卡片（pulse / rankings） |
| `YearSpine` | ⏳ 仍内联 | 首页脊柱抽组件（首页 / pulse） |

### 6.4 组件 ↔ JSON 契约映射（✅ 现已用真实层入参）

> 占位已移除;下表"真实层入参"列即**当前实际**入参,"早期占位"列仅作迁移留痕。

| 组件 | 早期占位入参（已弃） | 真实层入参（DATA-CONTRACTS，现行） |
|---|---|---|
| `RankingList` | `RepoRow[]`（内嵌 owner/name/lang/total/gained） | `rank.items`（`{rank,id,value,prev_rank}`）**join** `lookup/*` 后的行（见 §3.4）；`prev_rank` 驱动 ↑↓/进出 TOP |
| `StarCurve` | `{label,total}[]` + `Milestone[]` | `entity/repo.curve.monthly`（`[period,adds,total_end]`）取 `total_end` 为 `total`；`milestones` 来自 `entity.milestones`；尾部接 `curve.recent_daily` |
| `Heatmap` | `{label,gained}[]` + max | `heatmap/{scope}/{period}.cells`（`[date|period, 总量]`）；当月合并 `current_month.json.daily_totals` |
| 脊柱（YearSpine） | `YEARS`（占位） | `hot-snapshot.home.year_spine`（`[year, 总量]`） |

> ⚠️ `entity/repo.curve.recent_daily` 可为负（取消 star，[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5）；真实数据已流入,但 `StarCurve` 取 `curve.monthly` 的 `total_end`(累计)作 `total`、可能仍按单增假设画轴/area——**真实曲线尾部 net 段回落时需验证渲染正确**（§9-D ⏳ 待验证），`max` 应取序列实际最大值。

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
    en.ts   ja.ts   zh.ts   zh-tw.ts   ko.ts   es.ts   fr.ts
  index.ts                       # getDictionary(locale) — 服务端读取，无客户端 JS
```

```ts
// web/lib/i18n/index.ts（示意）
const dicts = { en, ja, zh, "zh-TW": zhTw, ko, es, fr } as const;
export type Locale = keyof typeof dicts;
export const getDictionary = async (l: Locale) => (await dicts[l]()).default;
```

- 根 `layout.tsx` 读取 `gsc_lang` cookie → `getDictionary(locale)` → Footer / 页面子树使用同一语言。
- `LanguageSwitcher` 默认英文，使用下拉菜单切换其它语言；客户端写 `gsc_lang` cookie 后刷新当前 RSC 视图，不会改变 canonical URL。`/api/lang` 仍保留为直接访问后备。
- 现有少量 SEO title/description 仍以英文为主，这是单一 canonical URL 的刻意取舍。

### 7.3 canonical（Metadata API）

语言不再是 URL 维度，所以不发 `hreflang` 矩阵。每页只声明无语言前缀的 canonical：

```ts
return {
  alternates: { canonical: path },
  openGraph: { url: path },
};
```

- `metadataBase` 读 `NEXT_PUBLIC_SITE_URL`（[OPS](./OPS.md) 环境变量 / [SEO](./SEO.md) §2）以适配预览/生产。

---

## 8. 与现有 app 的具体接点（实现起步清单）

> 把上面落到"动现有哪些文件"。**本文是 spec，不写应用代码**；以下是接入顺序建议。

> 多数项已落地;下表保留为"接点 + 现状"。剩余开口集中在 §9-J(渲染模式)与 §6.3 ⏳ 组件。

1. ✅ **数据层**：`web/lib/contracts/`（Zod）+ `web/lib/data/`（fetch Blob + parse + `cache()`）已是页面读 JSON 视图的唯一入口。
2. ✅/◐ **段配置**：`rankings/[year]`/`[period]` 预渲染当前年/月 + `dynamicParams`;未知 param `notFound()` 已落地（§9-B）。⚠️ 但 repo/org/layout 用 `force-dynamic`,实际非 ISR（§9-J）。
3. ✅ **`next.config.ts`**：无语言前缀跳转、无旧路径兼容重定向。
4. ✅ **页面**：`pulse`/`rankings`/`rankings/[year]`/`[period]`/`[owner]/[name]`/`o/[login]` 已落地。
5. ✅ **i18n**：`gsc_lang` cookie + 页内切换，URL 无语言段（§7）——但这是 §9-J `force-dynamic` 的根因。
6. ✅ **SEO 配套**：`app/sitemap.ts`、`app/robots.ts`、各页 `generateMetadata`、JSON-LD 已建。
7. ✅ **cron route**：`app/api/cron/{daily,weekly}`（`revalidatePath` + `CRON_SECRET`）。
8. ◐ **共享组件**：`Breadcrumbs`/`Footer`/`LanguageSwitcher`/`JsonLd` ✅ 已抽;`PrevNext`/`EntityCard`/`YearSpine` ⏳ 仍内联（§6.3）。

---

## 9. 与文档/需求的冲突与待决项（⚠️ 汇总）

> 现有 `web/app` **已接真实数据层**(占位移除)。早期"原型→生产"的多数差异已收敛;但 **i18n 改为 cookie 偏好后,根 `layout.tsx` 变成 `force-dynamic`**,引出一个与 SSG/ISR 模型的**当前实质分歧(见 J)**。逐条状态如下。

| # | 冲突/缺口 | 现状 | 文档要求 | 处置 |
|---|---|---|---|---|
| **A** | **长尾页预渲染范围** | `rankings/[year]`/`[period]` 用 `generateStaticParams` 预渲染当前年/月 + `dynamicParams`;repo/org 无 `generateStaticParams` | 长尾按需生成;仅当年/当月留核心（[ARCHITECTURE](./ARCHITECTURE.md) 分层、[SEO](./SEO.md) §3） | ◐ 参数侧已收敛;但渲染缓存被 J(`force-dynamic`)覆盖,**实际非 ISR 持久缓存** |
| **B** | **未知 param 软兜底而非 404** | — | 未知 repo/org → `notFound()`（404），禁软 200（[SEO](./SEO.md) §3.2） | ✅ **已收敛**：`[owner]/[name]` 先查 id 不到即 `notFound()`,再查 entity 为空再 `notFound()` |
| **C** | **第三处客户端 JS（PWA）** | `RegisterSW.tsx`（`"use client"`）+ `manifest.ts` | DESIGN-SYSTEM 原仅列两处例外 | ✅ **已决：保留 PWA**（DESIGN-SYSTEM 例外③） |
| **D** | **StarCurve 假设单调累计** | 真实 `curve.recent_daily` net 可负、尾部可能回落 | y 轴/area 须容忍非单调（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5） | ⏳ **待验证**：真实数据已流入,需确认曲线尾部回落时渲染正确 |
| **E** | **i18n URL 形态** | URL 不带语言段；`gsc_lang` cookie 决定 UI 语言 | repo URL 与 GitHub 一致 | ✅ 已决：页内语言偏好，canonical 单一 |
| **F** | **metadataBase** | `layout.tsx` 读 `NEXT_PUBLIC_SITE_URL`，默认 `https://gitstarclub.com` | 环境变量切换（[OPS](./OPS.md)/[SEO](./SEO.md) §2） | ✅ 已落地 |
| **G** | **sitemap/robots/cron/og 路由** | `app/` 已有 `sitemap.ts`/`robots.ts`/`api/cron/{daily,weekly}`/OG | SEO/OPS 要求齐备 | ✅ 已落地 |
| **H** | **repo 页 "synced" 时间写死** | — | as-of 应来自数据 | ✅ **已收敛**：现 repo 页不再硬编码 synced 时间 |
| **I** | **`_explore/` 命名** | 组件在 `app/_explore/`（private folder） | — | 沿用现状（合理） |
| **J** | **渲染模式 = `force-dynamic`,非 SSG/ISR** ⚠️ | `layout.tsx:19` `dynamic="force-dynamic"` + `layout.tsx:61` 读 `getPreferredDictionary()`→`i18n/server.ts:5` `cookies()`;`[owner]/[name]:17`、`o/[login]:17` 同样 force-dynamic ⇒ 每请求一次 Function SSR | ARCHITECTURE/SEO 假设 **SSG-first + 按需 ISR + 边缘 CDN 纯静态扛 10M/天、热路径零 Function** | ✅ **已决：目标 = C「静态基底 + 客户端译 chrome」**——服务端只出默认英文静态页(不读 cookie)、客户端水合 chrome。保住 静态扛量 + GitHub URL + 页内切语言,吻合已定 SEO 口径。否决 A(接受动态)/B(i18n 回 URL 段)。当前 force-dynamic 是**预览期临时**,**上线前实现 C**(代码活)。详见 §2.5 |

> 处置原则：早期占位差异(B/E/F/G/H)**已收敛**;A/D 收尾验证;**J 已定目标=C**(§2.5),实现待"继续做代码"。

---

## 10. 落地核对清单（前端层）

**路由**
- [x] 周榜 `/rankings/[year]/W[week]` 独立、与月榜共用 `[period]` 并按 `W` 前缀消歧
- [x] org `/o/[login]`、repo `/[owner]/[name]`、总榜 `/rankings`、脉搏 `/pulse` 已加（全 RSC）
- [x] i18n 页内切换：`gsc_lang` cookie；URL 不带语言前缀；支持 en/ja/zh/zh-TW/ko/es/fr

**分层 ↔ 配置**
- [ ] `cacheComponents` 保持关闭（`next.config.ts` 注释说明）
- [x] `rankings/[year]`/`[period]` 用 `generateStaticParams` 预渲染当年/当月 + `dynamicParams`
- [x] 数据变更靠 cron `revalidatePath`；`app/api/cron/{daily,weekly}` 带 `CRON_SECRET` 鉴权
- [ ] ⚠️ **渲染模式待决（§9-J）**：当前根 layout `force-dynamic`(cookie i18n),实际非 ISR 持久缓存——与 SSG 扛量模型冲突,需架构决策

**数据消费**
- [x] `web/lib/contracts/`（Zod）+ `web/lib/data/`（fetch+parse+`cache()`）已替换占位 `_explore/data.ts`（已删除）
- [x] 榜单走 lookup-join（rank item + `lookup/*`）；未知 param → `notFound()`
- [ ] 每日视图读取带 `?v=<date>` cache-bust；`meta.schema_ver` 启动校验（核对落地）

**零客户端 JS**
- [ ] 内容页正文 0 client JS；图表服务端 SVG/DOM；仅主题切换 + 语言切换 + PWA SW 带 `"use client"`
- [ ] 新增入场动画在 `prefers-reduced-motion` 块补终态钉死

**i18n**
- [x] 手写字典 `web/lib/i18n/`（en/ja/zh/zh-TW/ko/es/fr）；数据字段不翻译
- [x] 各页 `alternates.canonical` 指无语言前缀 canonical；不发 `alternates.languages`
- [x] `metadataBase` 读 `NEXT_PUBLIC_SITE_URL`

**冲突收敛（§9）**
- [x] B/E/F/G/H 已收敛；C 已决（PWA 例外③）
- [ ] A/D 收尾验证（A 受 J 影响、D 非单调曲线渲染）
- [ ] **J（force-dynamic vs SSG）架构级决策** ⬅ 当前最大开口
