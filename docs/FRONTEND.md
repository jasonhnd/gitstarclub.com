# gitstarclub 前端设计（Next.js 16 Web 应用）

> **前端层的唯一真相源**——把 [REQUIREMENTS](./REQUIREMENTS.md)（做什么）、[ARCHITECTURE](./ARCHITECTURE.md)（页面分层 / ISR / 节奏）、[DATA-CONTRACTS](./DATA-CONTRACTS.md)（消费的 JSON 视图 schema）、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md)（M3E token / 组件 / 动效）落到 `web/` 这个 **Next.js 16 App Router** 应用的**路由 / 渲染配置 / 数据消费 / 组件 / i18n**。
> SEO 元数据 / sitemap / canonical 细节见 [SEO.md](./SEO.md)；Route Handler 与公开 JSON endpoint 契约见 [API.md](./API.md)；Blob 布局 / 环境变量 / 部署拓扑见 [OPS.md](./OPS.md)。
> 技术事实基于 **Next.js 16.2.6 · React 19.2 · TypeScript 6 · Tailwind 4 · Zod 4 · 包管理器 bun**（见 `web/package.json`）。

---

## Scope

本文档描述 `web/` 应用（Next.js 16 App Router）的**路由树、组件目录、数据访问层、i18n 架构与渲染策略**,面向需要扩展或维护前端的工程师。

不在本文覆盖范围:JSON 视图 schema 与契约语义见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md);Route Handler / 公开 JSON endpoint 的 method、auth、params、response、cache、status codes 见 [API.md](./API.md);M3E token / 调色板 / 动效曲线等设计系统细节见 [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md);SEO 元数据与 sitemap 细节见 [SEO.md](./SEO.md);Blob 布局与部署拓扑见 [OPS.md](./OPS.md)。

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

> 渲染层定义见 §2。English canonical URL 保持无前缀；ja/zh/zh-TW/ko/es/fr 使用 locale 前缀并与 English 互发 `hreflang` / `x-default`。下表列出 English 无前缀路径；非默认 locale 通过 `(localized)/[locale]` 路由组复用同一 canonical path（例如 `/ja/rankings`、`/fr/facebook/react`）。旧 `/trending` 与旧 `/{year}` 这类**历史路径形态**已从路由树删除，不做形态兼容重定向。但 repo 改名是另一回事：repo 页对改名旧 slug **发 308 永久重定向**到当前 `full_name`（见 §2.3 / §3.2 alias 机制），这与「不做兼容重定向」不矛盾——前者指消失的路径形态，后者指仍在追踪的 repo 换了名字。

| 页 | URL | 文件（相对 `web/app/`） | 渲染层 | `generateStaticParams` |
|---|---|---|---|---|
| 首页 | `/` | `page.tsx` | 核心 Pulse | — |
| **脉搏页** | `/pulse` | `pulse/page.tsx` | 核心（每日 revalidate，事件驱动） | — |
| **总榜** | `/rankings` | `rankings/page.tsx` | 核心（每日 revalidate） | — |
| 年榜 | `/rankings/[year]` | `rankings/[year]/page.tsx` | 当年核心 / 历史按需 ISR | 当前年 |
| 月榜 | `/rankings/[year]/[month]` | `rankings/[year]/[period]/page.tsx` | 当月核心 / 历史按需 ISR | 当前月 |
| 周榜 | `/rankings/[year]/W[week]` | `rankings/[year]/[period]/page.tsx` | 当周 mover / 过去周冻结 | `[]`（长尾） |
| repo 页 | `/[owner]/[name]` | `[owner]/[name]/page.tsx` | 按需 ISR（`revalidate=86400`，mover 当日 `revalidatePath`） | `[]`（长尾） |
| **org 索引** | `/o`、`/o/page/[page]` | `o/page.tsx`、`o/page/[page]/page.tsx` | 组织目录 ISR（`revalidate=3600`） | org 页数 |
| **org 页** | `/o/[login]` | `o/[login]/page.tsx` | 按需 ISR（`revalidate=false`，mover 当日刷新） | `[]`（长尾） |
| **对比页** | `/compare` | `compare/page.tsx` + `compare/CompareClient.tsx` | 静态壳（`force-static`），客户端读 `?repos=` + 取曲线 | — |
| 关于 | `/about` | `about/page.tsx` | 核心 | — |
| **分类索引** | `/categories` | `categories/page.tsx` | `revalidate=86400` ISR | — |
| **分类维度** | `/categories/[dimension]` | `categories/[dimension]/page.tsx` | `revalidate=86400` ISR，`dynamicParams=true` | 各维度名 |
| **分类详情** | `/categories/[dimension]/[slug]`、`/categories/[dimension]/[slug]/page/[page]` | `categories/[dimension]/[slug]/page.tsx`、`categories/[dimension]/[slug]/page/[page]/page.tsx` | `revalidate=86400` ISR，`dynamicParams=true` | 公开分类 + 分类页数 |

**路由处理器（route handlers）**：下表只保留前端路由树定位；endpoint contract（method / auth / params / response / cache / status codes）由 [API.md](./API.md) 统一维护。

| 路径 | 文件 | 用途 |
|---|---|---|
| `/api/cron/daily` | `api/cron/daily/route.ts` | 每日 live overlay（`current_month.json` + `hot-snapshot.json`） |
| `/api/cron/weekly` | `api/cron/weekly/route.ts` | 每周 live overlay refresh |
| `/api/workflows/refresh/start` | `api/workflows/refresh/start/route.ts` | 触发 L3 全量重算 Workflow |
| `/api/lang` | `api/lang/route.ts` | 直接访问时的语言 cookie 后备入口 |
| `/search-index` | `search-index/route.ts` | 客户端搜索索引端点 |
| `/repo-curve` | `repo-curve/route.ts` | 对比页瘦路由（按 id 投影 entity 曲线） |

OG 图路由（`opengraph-image.tsx`，next/og 动态渲染）：
- 站点级 `/opengraph-image`（`app/opengraph-image.tsx`，`web/lib/og-card.tsx`）
- repo 页 `/[owner]/[name]/opengraph-image`（`[owner]/[name]/opengraph-image.tsx`）
- 年榜 `/rankings/[year]/opengraph-image`（`rankings/[year]/opengraph-image.tsx`）
- 月/周榜 `/rankings/[year]/[period]/opengraph-image`（`rankings/[year]/[period]/opengraph-image.tsx`）
四类 OG 路由均 `revalidate=86400`，对齐每日 live cron；生成路径只读 Blob JSON，不触发运行时引擎。

**周榜是独立页面**，但归入总榜路径下：`/rankings/YYYY/W##`。月榜和周榜共用 `[period]` 段，在页面里按 `W` 前缀分流；旧的 `/{lang}/YYYY` 与 `/{lang}/YYYY/MM` 不再存在。

### 1.2 i18n（locale URL + 服务端渲染）

需求：默认英文，并提供 en / ja / zh / zh-TW / ko / es / fr 七种 UI 语言（[REQUIREMENTS](./REQUIREMENTS.md) §9、[PRODUCT](./PRODUCT.md) i18n、[SEO](./SEO.md) §10）。English 使用无前缀 URL；非默认 locale 使用前缀 URL。repo URL 仍保留 GitHub 风格 canonical path，只在非默认 locale 前加语言段：`/facebook/react`、`/ja/facebook/react`、`/fr/facebook/react`。

**路由文件布局**：

```text
app/
  _shell/RootShell.tsx       # 两个 root layout 共享：fonts/global CSS/theme init/body/Footer
  _localized/*.tsx           # route-locale 共享页面实现
  (en)/
    layout.tsx               # English 无前缀根布局，<html lang="en">
    page.tsx  pulse/page.tsx
    [owner]/[name]/page.tsx  # GitHub 风格 repo URL
    o/page.tsx  o/page/[page]/page.tsx  o/[login]/page.tsx
    rankings/page.tsx  rankings/[year]/page.tsx  rankings/[year]/[period]/page.tsx
    about/page.tsx  privacy/page.tsx  categories/**  compare/page.tsx
  (localized)/[locale]/
    layout.tsx               # 非默认 locale 根布局，<html lang={toHreflang(locale)}>
    page.tsx  pulse/page.tsx
    [owner]/[name]/page.tsx  # /ja/facebook/react 等 locale-prefixed repo URL
    o/**  rankings/**  categories/**  compare/page.tsx  about/page.tsx  privacy/page.tsx
  api/lang/route.ts          # 兼容入口：写 gsc_lang 后重定向到 locale URL
  search-index/route.ts      # 客户端搜索索引端点（contract 见 API.md）
  compare/page.tsx           # 多 repo 对比页：静态壳 + 客户端读 URL ?repos= → 取曲线 → CompareCurve；带参 noindex
  repo-curve/route.ts        # 对比瘦路由（contract 见 API.md）
  robots.ts  sitemap.ts  manifest.ts  api/   # 根级特殊路由，无需 layout
```

要点：

- **URL canonical 按 locale 自规范化**：`/facebook/react` 是 English URL；`/ja/facebook/react`、`/zh-TW/facebook/react` 等是对应 locale 的规范 URL；`/en/*` 不是规范形态，middleware 永久重定向到无前缀 English。
- **渲染模式见 §2.5**（route locale → server dictionary → localized HTML；长尾仍按需 ISR）。
- **i18n 实现细节见 §7**（手写字典、路由组选择 `<html lang>`、LanguageSwitcher 以 `<a>` 导航、`gsc_lang` 只作 middleware/API 偏好重定向信号）；数据字段不翻译。

---

## 2. 页面分层 ↔ Next.js 16 配置（核心）

这是把 [ARCHITECTURE](./ARCHITECTURE.md)「页面分层与重建节奏」与 [REQUIREMENTS](./REQUIREMENTS.md) §6「新鲜度模型（报社比喻）」落成**具体 Next 段配置**的一节。

### 2.1 四层心智模型（对齐新鲜度模型）

| 层 | 页面 | 新鲜度（REQUIREMENTS §6） | Next 机制 |
|---|---|---|---|
| **核心** | `/` · `/pulse` · `/rankings` · 当年/当月的 `/rankings/...`（非默认 locale 为对应前缀 URL） | 头版：每日换 | 每日 cron `revalidatePath`；核心 locale 页面静态/ISR 预渲染，chrome 服务端本地化，只有搜索/语言/主题等叶子控件水合 |
| **长尾** | 历史年/月 · **周** · repo · org（~16k+）· 分类 | 编年史：冻结 / 标 as-of | **按需 ISR**：`dynamicParams=true` + 空（或注册表派生）`generateStaticParams`，首访生成、持久缓存。`revalidate` 按页分裂（见下脚注），均叠加 cron `revalidatePath` 定点失效 |
| **mover** | 在 mover 集里的 repo/org + `/pulse` | 脉搏：事件驱动，只刷"在动的那一小撮" | 每周/每日 cron 对其 `revalidatePath` 定点失效 → 下次访问再生 |
| **历史** | 已折叠入 Parquet 的过去周期 | 旧报纸：永不重印 | 纯静态命中 CDN；数据不变 = 不 revalidate |

> 关键：**长尾页"成页"极便宜**（懒生成、不占 build 预算）——所以周页 / org 页独立成页不受 45min build 上限约束（[ARCHITECTURE](./ARCHITECTURE.md) 渲染分层）。
>
> **长尾 `revalidate` 不是一刀切 `false`**（按文件分裂，以代码为准）：
> - **repo `/[owner]/[name]`** = `86400`（`page.tsx:22`）——首访生成 + 每 1 天后台再生，叠加 mover 当日 `revalidatePath`。
> - **org 索引 `/o` / `/o/page/[page]`** = `3600`——提供可爬的 owner 目录层，按 `lookup/orgs.json` 页数预渲染。
> - **org `/o/[login]`** = `false`（`page.tsx:19`）——纯靠 cron 定点失效，不做时间轮询。
> - **分类 `/categories*`** = `86400`——新发布的注册表分类无需重新部署即可在 1 天内出现；分类详情 page 2+ 通过 `/categories/[dimension]/[slug]/page/[page]` 自规范化。
> - 历史年/月/周仍走 §2.2「核心页」混合文件里的 `revalidate=false` 段（当年/当月预渲染、历史按需）。

### 2.2 段配置速查（每类页面贴什么）

**核心页（Pulse / Rankings / 当年 / 当月）** —— deploy 构建具体 param：

```ts
// 例：app/rankings/[year]/page.tsx（当年走核心，历史走 ISR — 同一文件、混合）
export const dynamicParams = true            // 未列入的历史年 → 首访按需生成
export async function generateStaticParams() {
  // 只预渲染「当前年」；历史年留给按需 ISR
  const Y = new Date().getUTCFullYear()
  return [{ year: String(Y) }]               // locale 由 (en) / (localized)/[locale] 路由组选择；不在这里交叉生成
}
export const revalidate = false              // 不轮询；每日 cron 用 revalidatePath 刷当年
```

**长尾页（repo / org / 周 / 历史年月）** —— 不在 deploy 构建：

```ts
// 例：app/o/[login]/page.tsx（org 页 revalidate=false 的范式）
export const dynamicParams = true            // 默认值；空列表 + 此项 = 全部按需生成
export async function generateStaticParams() {
  return []                                  // repo/org 页返回 [] → 全部按需 ISR
}
export const revalidate = false              // org：仅靠 cron 定点失效（每周重算 / mover 当日刷新）
// 注意：repo 页（app/[owner]/[name]/page.tsx）相同的 [] + dynamicParams，但 revalidate=86400
// （首访生成后每 1 天后台再生 + cron 定点失效叠加），与 org 的 false 不同——见 §2.1 长尾行脚注。
```

**全时榜 / 脉搏（单页、每日新鲜）**：

```ts
// 例：app/pulse/page.tsx
export const revalidate = false              // 不靠时间轮询
// Vercel cron 写 hot-snapshot.json / 当前周月 rank 后 revalidatePath('/pulse')
```

### 2.3 `next.config.ts`：必须的全局开关

分层模型需在 `web/next.config.ts` 显式声明：

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 关键：cacheComponents 必须保持「关闭」——开启会禁用 dynamicParams，
  // 并使空 generateStaticParams() 在 build 报错（与「长尾全按需」冲突）。
  // 见 ARCHITECTURE 页面分层 §配置要点 / SEO §3.4。默认即关,勿误开。
};

export default nextConfig;
```

| 开关 | 取值 | 理由 |
|---|---|---|
| `cacheComponents` | **关闭（不设/false）** | 开启禁用 `dynamicParams`、空 `generateStaticParams` 会 build 报错（[ARCHITECTURE](./ARCHITECTURE.md) / [SEO](./SEO.md) §3.4）。 |
| `dynamicParams`（段级） | `true` | 长尾首访生成；未知 param 则 `notFound()`（404，见 [SEO](./SEO.md) §3.2）。 |
| `revalidate`（段级） | `false` | 不做时间轮询；数据变更全靠 cron `revalidatePath` 定点失效。 |
| repo 改名重定向 | 路由层（非 next.config） | repo 页据 `lookup/aliases.json` 对改名旧 slug 发 `permanentRedirect`（308）到当前 `full_name`；canonical 永远指当前名（[SEO](./SEO.md) §7）。 |

### 2.4 数据变更如何到达页面（无 deploy）

- **每日 cron**（`/api/cron/daily`，[API](./API.md) / [OPS](./OPS.md) §Cron）：写 `current_month.json` + `hot-snapshot.json` + `live/rank/*` 当前月/当前周覆盖层 + `live/heatmap/*` 当月覆盖层 → `revalidatePath` 核心热集（首页 / pulse / rankings / 当年 / 当月 / 当前周）。
- **每周 cron**（`/api/cron/weekly`，[API](./API.md)）：同样在 Vercel 内做 live refresh，保证周榜和月榜即使没有全量历史重算也不会断档；全量历史刷新另走 Vercel Workflow 分片，不做 16k 全量 build。
- **deploy**：仅代码/结构变更触发；会重置 ISR store，长尾首访冷生成一次（见 [ARCHITECTURE](./ARCHITECTURE.md)）。

> `app/api/cron/daily` 与 `app/api/cron/weekly` 通过 `revalidatePath` + `CRON_SECRET` 鉴权刷新热集。

### 2.5 渲染模式：route locale + 服务端本地化 HTML

页面 BODY 与 chrome（顶栏 / 页脚 / 面包屑标签 / 区段标题）都由 route locale 决定：English 无前缀路由渲染英文 HTML，非默认 locale 前缀路由渲染对应语言 HTML。`gsc_lang` cookie 不参与页面渲染，只在 middleware 和 `/api/lang` 中作为偏好重定向信号。整棵路由树继续命中静态 / ISR 缓存（核心页 SSG、长尾按需 ISR），不进入按请求 SSR。

**实现要点**：

- `web/app/(en)/layout.tsx`：English 无前缀 root layout，调用 `RootShell lang="en"`。
- `web/app/(localized)/[locale]/layout.tsx`：验证非默认 locale，加载对应 dictionary，调用 `RootShell lang={toHreflang(locale)}`。
- `web/app/_shell/RootShell.tsx`：两套 root layout 共享的 HTML/body 壳；只保留 theme init script，不再需要 `LANG_INIT_SCRIPT`。
- `web/app/_localized/*`：共享服务端页面实现，接收 route locale / dictionary / canonical path 后渲染 localized chrome、metadata、JSON-LD 与确定性文案。
- `Chrome.tsx` / `Footer.tsx` / `Breadcrumbs.tsx` 为服务端组件；`SearchBox`、`LanguageSwitcher`、`ThemeToggle` 是顶栏内的最小 client islands，其中 `LanguageSwitcher` 只生成 locale URL 链接。
- 各页（`page.tsx` / `pulse` / `rankings*` / `about` / repo / org / category）：不读 cookie；repo/org 用 `generateStaticParams() => []` 转按需 ISR。
- `web/lib/i18n/server.ts`：**弃用**——读 cookie 会破坏静态;保留仅供非页面服务端上下文,勿在 page/layout 调用。

**构建路由表**（`cd web && bun run build`）：

| 路由 | 渲染层 |
|---|---|
| `/` · `/pulse` · `/rankings` · `/about` | `○` 静态 |
| `/rankings/[year]` · `/rankings/[year]/[period]` | `●` SSG（当年/当月预渲染 + 其余按需） |
| `/[owner]/[name]` · `/o/[login]` | `●` SSG（`[]` + `dynamicParams` → 全部按需 ISR） |

- SSR/静态输出**完整可索引 HTML**（当前 route locale 的 chrome 与正文进入初始 HTML，SEO §3a 不受影响），数据语言中立。
- 取舍依据：每页约 95% 是语言中立数据,仅少量 chrome 字符串需要翻译 → route-locale 服务端渲染 + 按需 ISR 同时保住**静态 CDN 扛量 + GitHub 风格 canonical path**；metadata、sitemap、正文、middleware 与语言切换导航已经统一到 locale URL / hreflang 架构。

---

## 3. 数据消费（页面如何读 JSON 视图）

### 3.1 数据来源

页面全部从 `@/lib/data` 读 Blob 上的真实 JSON 视图(`fetch` + Zod parse + React `cache()`)。所有内容页(`rankings/**`/`[owner]/[name]`/`o/[login]`/`categories/**` 等)均 import `@/lib/data`;首页 `page.tsx` 与 `pulse/page.tsx` 经共享的 `PulseView` 间接读取(故不直接 import)。

### 3.2 数据访问层（`web/lib/`）

[DATA-CONTRACTS](./DATA-CONTRACTS.md) §4 的 Zod schema 位于 `web/lib/contracts/`,读取器位于 `web/lib/data/`。结构按产物族归并,非每产物一文件:

```text
web/lib/
  contracts/        # Zod schema（单一类型事实源），barrel = index.ts
    common.ts       # 共享/枚举/rank/heatmap/meta 等基础 schema
    lookup.ts  entity.ts  live.ts  canonical.ts  categories.ts
    compare.ts  search.ts  workflow.ts
  data/             # 读取器（fetch Blob + schema.parse + React cache 去重），barrel = index.ts
    source.ts       # readView：拼 Blob 直链 URL + fetch + parse（见 OPS Blob 布局）
    lookup.ts  rank.ts  entity.ts  heatmap.ts  snapshot.ts  meta.ts
    search.ts  compare.ts  categories.ts  watermark.ts
  search/           # 客户端检索纯核心（MiniSearch 配置 + 查询；SearchBox 懒加载到 Web Worker）
    core.ts
```

> rank/heatmap/meta 的 schema 收进 `common.ts`,readers 按 rank/heatmap/snapshot/meta 分文件。

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
- **未知 param → `notFound()`**（404，禁软 200，见 [SEO](./SEO.md) §3.2）。`[owner]/[name]/page.tsx` 先 `getRepoIdByFullName()` 查 id；查不到再查 `lookup/aliases.json`（`getAliasMap`），命中改名别名则 `permanentRedirect`（308）到当前 `full_name`；仍无则 `notFound()`，再 `getRepoEntity(id)`、为空再 `notFound()`。

### 3.3 每页读哪些视图（页面 ↔ JSON 契约映射）

| 页面 | 主要读取 | 说明 |
|---|---|---|
| 首页 `/` | `hot-snapshot.json`（`home`：`year_spine` / `current_month_top` / `on_this_day`） | 热集 ISR 只读 KB 级快照，**绝不**加载大文件（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.9） |
| 年页（当年） | `hot-snapshot.json`（`current_year`） + `heatmap/year/{Y}.json`（12 月格） | 当年走热快照 |
| 年榜（历史） | `rank/year/{Y}/{repo,org}/{flow,stock}.json` + `heatmap/year/{Y}.json` | 冻结视图 |
| 月榜（当月） | `live/rank/month/{period}/repo/{flow,stock}.json` + `live/heatmap/month/{period}.json`，缺失时回退基础 `rank/*` / `heatmap/*` | 当月 live 视图来自 Vercel cron 活尾 |
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

好处（[DATA-CONTRACTS](./DATA-CONTRACTS.md)）：榜单文件保持小、repo 改名只需更新 lookup（不动每张榜）。`web/lib/data/rank.ts` 的 `joinRepoRank`/`joinOrgRank` 把 `rank.items`（`{rank,id,value,prev_rank}`）与 `lookup/*` join 出展示字段后喂给 `RankingList`。

### 3.5 缓存一致性

- **每日更新的视图**（`current_month.json` / `hot-snapshot.json`）读取时带 `?v=<date>` cache-bust，规避 Blob 同路径覆盖最长 60s 传播窗口（[OPS](./OPS.md) §Blob 缓存传播）。
- `meta.schema_ver`：build 启动校验版本匹配，不符 fail-fast（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §3）。
- **base 视图版本指针**：base `rank/*` / `entity/*` / `heatmap/*` 通过「先读 `views/latest.json` 指针解析版本前缀，再读该前缀下视图」消费（[VERCEL-DATA-OPERATIONS](./VERCEL-DATA-OPERATIONS.md) §4.1/§7）。默认读侧指针 TTL 为 3600 秒；repo / categories / OG 等 1 天 ISR 路由使用 daily base 读取入口（86400 秒），避免 `views/latest.json` fetch 把 route TTL 降到 1h；sitemap 作为特殊爬虫入口也使用 86400 秒 TTL。这一步**封装在 `web/lib/data/`**，组件入参形状不变、**对页面透明**；「live 优先、回退 base」语义保留（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.11）。

---

## 4. 零客户端 JS 内容页

### 4.1 图表 = 服务端渲染 SVG / DOM

内容页 **0 客户端 JS**（[REQUIREMENTS](./REQUIREMENTS.md) §7、[ARCHITECTURE](./ARCHITECTURE.md) 性能策略、[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §零客户端 JS 约束）。所有图表服务端出 markup、动效纯 CSS：

| 图表 | 组件（`web/app/_explore/`） | 形态 | 动效（CSS，reduced-motion 钉终态） |
|---|---|---|---|
| Star 曲线 | `StarCurve.tsx` | 服务端 SVG `<path>`（line + area gradient）+ 里程碑金点 + mono 年份轴 | `.curve-line` `stroke-dashoffset` 描绘 + `.curve-area` 淡入 |
| 日历/月热力图 | `Heatmap.tsx` | DOM 网格 + `color-mix` 强度（冷灰→亮金，非 GitHub 绿） | `animate-rise` stagger |
| 年份脊柱（首页） | inline in `page.tsx`（`.spine-bar-y`） | DOM 柱，高度 `--h=gained/max` | `grow-y` 弹簧生长 |
| 月度脊柱（年榜） | inline in `rankings/[year]/page.tsx`（`.spine-bar`） | DOM 条，宽度 `--w` | `grow` 弹簧生长 |
| 榜单条 | `RankingList.tsx` | 有序列表 + 右对齐 mono 指标 | `animate-rise` stagger |

> SVG/DOM 图表均为 RSC（无 `"use client"`），符合约束。org 合计曲线复用 `StarCurve`（`entity/org` 的 `curve` 形状同 repo）。`YearSpine` 抽组件供首页/pulse 复用是可选优化项。

### 4.2 允许的客户端 JS（三处例外）

[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 规定明确例外：防闪烁内联脚本（theme + lang）、主题切换按钮、PWA SW 注册（`RegisterSW.tsx` + `manifest.ts`）。这些都极小、不渲染正文内容。

| 客户端 JS | 文件 | 性质 | DESIGN-SYSTEM 例外 |
|---|---|---|---|
| 防 FOUC 主题脚本 | `layout.tsx`：`themeInit` const `:56`，内联 `<script dangerouslySetInnerHTML>` `:67` | paint 前读 `localStorage.theme` 设 `data-theme` + `theme-color` | ① |
| 主题切换按钮 | `components/ThemeToggle.tsx`（`"use client"`） | 写 `data-theme` + `localStorage` + 同步 `meta[theme-color]`；图标 CSS 显隐 | ② |
| Service Worker 注册 (PWA) | `_explore/RegisterSW.tsx`（`"use client"`） | 注册 `/sw.js`（失败静默）+ `manifest.ts` | ③（PWA standalone） |

- 这些都极小且不渲染内容页正文 → 不破坏「正文零客户端 JS、爬虫拿全量 HTML」（[SEO](./SEO.md) §3a）。
- `<html suppressHydrationWarning>`（`layout.tsx:65`）配合主题脚本，避免 hydration 警告。

---

## 5. 动效

全部纯 CSS、零 JS（[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) §动效），token 已落在 `web/app/globals.css`：

| 动效 | 实现（globals.css） | 备注 |
|---|---|---|
| **跨文档页面转场** | `@view-transition { navigation: auto; }`（`globals.css:263`） | 纯 CSS 零 JS；浏览器不支持时无害降级 |
| 路由淡入 | `template.tsx` 重挂载 + `.page-enter`（`globals.css:231`，`--animate-page` `:171`） | template 每次导航重挂、CSS 动画自然重放 |
| 入场 rise | `--animate-rise`（`:168`）+ `rise` keyframe（`:174`）+ `animation-delay` stagger | 标题 / 榜单行 / 热力格 |
| 弹簧 | `--ease-spring`（CSS `linear()` 预计算关键点，`globals.css:132`） | bar 生长 / hover 抬升 / active 回弹 |
| emphasized 缓动 | `--ease-emphasized`（`cubic-bezier(0.2,0,0,1)`，`globals.css:131`） | 主题/颜色过渡、淡入 |
| 曲线绘制 | `.curve-line`（`:250`）/ `.curve-area`（`:256`） | `stroke-dashoffset` 描绘 + 面积淡入 |
| 状态脉冲 | `--animate-status`（`:170`）/ `status-pulse` keyframe（`:190`） | `/pulse` 的"在涨"状态点 |

**reduced-motion 兜底（强制，`globals.css:275`）**：全局关 animation/transition，并把动画终态钉死（`.spine-bar` 直接 `scaleX(var(--w))`、`.curve-line` `stroke-dashoffset:0`、`.curve-area` `opacity:1`），保证无动效时布局与终态正确。新增组件的入场动画**必须**在此块补对应终态钉死。

> 弹簧曲线关键点 build 期预计算（[DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 落地清单）——现 `globals.css` 是手写快照，生成器落地后替换。

---

## 6. 组件架构

### 6.1 现有组件清单（`web/app`）

| 组件 | 文件 | 类型 | 角色 |
|---|---|---|---|
| 顶栏 Top App Bar | `_explore/Chrome.tsx` | RSC + islands | sticky 毛玻璃栏：logo（金★ + wordmark）+ 可选 tag pill + 搜索框（SearchBox）+ 导航（Pulse / Rankings · Categories `md+` · Compare `sm+` · About `sm+`）+ 语言/主题切换；Chrome 壳服务端渲染，SearchBox/LanguageSwitcher/ThemeToggle 水合 |
| 全站搜索 SearchBox | `_explore/SearchBox.tsx` | **Client island** | 导航栏搜索框；首次聚焦懒加载 `/search-index`，description 在 route 层截短，MiniSearch 建索引和查询在 Web Worker 内执行（prefix/fuzzy 0.2/按 stars 加权）；键盘 ↑↓/Enter/Esc + combobox a11y；placeholder/空态由服务端 Chrome 传默认语言 label。每条结果带「+对比」勾选 + 底部「对比 N 个 →」跳 `/compare?repos=...`（行点击仍跳 repo） |
| 分享 ShareButton | `_explore/ShareButton.tsx` | **Client** | 复制链接 + X 分享 intent；7 语 `share.*` chrome i18n；接 repo / 榜单月周 / 年页。榜单页另有动态 OG 卡（`rankings/[year]/[period]/opengraph-image.tsx` + `[year]/opengraph-image.tsx`，共享 `lib/og-card.tsx`） |
| 月度叙事 Narrative | `_explore/Narrative.tsx` | RSC | 月榜顶部 7 语叙事；服务端一次渲染各 locale 文本，由 `html[lang]` CSS 显示当前语言。文案由月页**渲染时**用确定性模板（`lib/narrative.ts`）从榜单数据现拼——**无 AI / 无产物** |
| 榜单 RankingList | `_explore/RankingList.tsx` | RSC | 有序列表，`variant: "gained"|"rate"|"crossed"`；行 = 金色名次 + mono repo 名 + 语言/计数 pill + 右对齐指标；整行 `<Link>`→repo 页；总榜双栏使用固定行高和单行截断，保证相同条数时两边高度一致 |
| 热力图 Heatmap | `_explore/Heatmap.tsx` | RSC | DOM 网格 + `color-mix` 强度；可选 `href` 包 `<Link>`；`square`/`columns` 控日历布局 |
| Star 曲线 StarCurve | `_explore/StarCurve.tsx` | RSC | 服务端 SVG 面积图 + 里程碑金点 + 拐点标记点（三级色点 + `<title>` tooltip，零 JS）+ `role="img"` + aria-label |
| 对比曲线 CompareCurve | `_explore/CompareCurve.tsx` | **Client** | 多条折线叠图 + 图例（色块+full_name+星数）+ 共享 y 轴 + **absolute↔对齐到 10k 切换**；纯核心归一化在 `lib/compare/core.ts` |
| 面包屑 Breadcrumbs | `_explore/Breadcrumbs.tsx` | RSC | 默认语言服务端渲染；Home→年→月 / Home→owner→repo 等 + `BreadcrumbList` JSON-LD（[SEO](./SEO.md)） |
| 结构化数据 JsonLd | `_explore/JsonLd.tsx` | RSC | 注入 `application/ld+json`（配 `@/lib/jsonld` 的 `CollectionPage` / `ItemList` / 实体 builder） |
| 页脚 Footer | `_explore/Footer.tsx` | RSC + island | 默认语言服务端渲染；构建时间戳 + LanguageSwitcher 语言小岛 |
| Pulse 视图 PulseView | `pulse/PulseView.tsx` | RSC | 首页与 `/pulse` 共享主体：本周/本月/本年脉搏、全时巨头桥接、"历史上的今天"。可选 `includeWebsiteLd` 注入 `WebSite` JSON-LD（仅首页用） |
| 对比客户端 CompareClient | `compare/CompareClient.tsx` | **Client** | `/compare` 页内交互层：读 URL `?repos=` → 复用搜索索引映射 id → 并发 fetch `/repo-curve` → 渲染 `CompareCurve`；多选搜索器（基于 `lib/search/core`） + chip 移除 + URL `router.replace` 同步 |
| OG 图渲染（站点 / repo / 月+周 / 年） | `opengraph-image.tsx` × 4 | RSC（next/og） | 动态生成 1200×630 PNG；`revalidate=86400`，共享 `lib/og-card.tsx`（石墨灰+金、stars 内联 SVG） |
| 主题切换 ThemeToggle | `components/ThemeToggle.tsx` | **Client** | 交互按钮（见 §4.2） |
| 语言切换 LanguageSwitcher | `components/LanguageSwitcher.tsx` | **Client** | 根据当前 route locale 与 canonical path 生成 locale URL `<a>` 链接；导航后服务端返回对应语言 HTML（§7） |
| 页面转场 Template | `template.tsx` | RSC | 重挂载淡入容器 |
| SW 注册 RegisterSW | `_explore/RegisterSW.tsx` | **Client** | PWA（见 §4.2） |

> 面包屑 / 页脚 / 语言切换为共享组件；上下页导航 / 脊柱部分仍内联在各 page.tsx（见 §6.3）。

### 6.2 server-by-default 原则

- **内容主体永远 RSC**：rank lists、heatmaps、repo 主体、org 主体、星曲线（StarCurve）等承载数据的图与表全部服务端渲染、零客户端 JS。
- **客户端组件仅限交互小岛**：SearchBox / ShareButton / CompareCurve+CompareClient / ThemeToggle / LanguageSwitcher / RegisterSW。Chrome / Footer / Breadcrumbs / `<T>` 已服务端化；Narrative 是服务端组件，用 `html[lang]` CSS 在已渲染的 locale 文本间切换。完整清单与判定规则见 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) "客户端 JS 例外清单"。
- 新增页面前先确认所选交互无法纯 CSS / 服务端实现，再引入 client component；最低限度不能让内容主体（rank list / heatmap / star curve）变 client。

### 6.3 共享组件目录

| 组件 | 位置 | 用途 / 复用 |
|---|---|---|
| `Breadcrumbs` | `_explore/` | Home→年→月 / Home→owner→repo（[SEO](./SEO.md) §6.7） |
| `Footer` | `_explore/` | 页脚导航 + 语言切换落点 |
| `layout-tokens.ts` | `_explore/` | 共享页面横向 gutter：`PAD_X = px-[clamp(1.25rem,5vw,2.5rem)]`，对齐 [DESIGN-SYSTEM](./DESIGN-SYSTEM.md) 锁定基线 |
| `LanguageSwitcher` | `components/` | 当前语言 + 下拉切其它语言；en/ja/zh/zh-TW/ko/es/fr；每项是对应 locale URL 的普通链接 |
| `JsonLd` | `_explore/` | 注入 `CollectionPage`、`ItemList`、repo/org 实体等 JSON-LD |
| `PrevNext`（`NavArrow`/`MonthArrow`） | 内联 | 上下月 / 上下年 / 上下周（年/月/周页）—— 可抽组件 |
| `EntityCard` | 内联 | repo/org 卡片（pulse / rankings）—— 可抽组件 |
| `YearSpine` | 内联 | 首页脊柱（首页 / pulse）—— 可抽组件 |

### 6.4 组件 ↔ JSON 契约映射

| 组件 | 入参来源（DATA-CONTRACTS） |
|---|---|
| `RankingList` | `rank.items`（`{rank,id,value,prev_rank}`）**join** `lookup/*` 后的行（见 §3.4）；`prev_rank` 驱动 ↑↓/进出 TOP |
| `StarCurve` | `entity/repo.curve.monthly`（`[period,adds,total_end]`）取 `total_end` 为 `total`；`milestones` 只读 `entity/repo.milestones.crossed_10k/50k/100k` 的冻结精确日期，150k+ 等无冻结字段的阈值不从曲线反推；`inflections` 来自 `entity.inflections`（period→monthIndex 映射）；尾部接 `curve.recent_daily` |
| `CompareCurve` | 客户端从 `/repo-curve?id=` 并发取（[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.15）；`points=[period,total]` 画线，`crossed_10k` 供「对齐到 10k」x 轴重映；归一化/配色在 `lib/compare/core.ts` |
| `Heatmap` | `heatmap/{scope}/{period}.cells`（`[date|period, 总量]`）；当月合并 `current_month.json.daily_totals` |
| 脊柱（YearSpine） | `hot-snapshot.home.year_spine`（`[year, 总量]`） |

> ⚠️ `entity/repo.curve.recent_daily` 可为负（取消 star，[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5）；`StarCurve` 取 `curve.monthly.total_end`（累计）作 `total`，仍按单增假设画轴/area——真实曲线尾部 net 段回落时需确认渲染正确；`max` 应取序列实际最大值。

---

## 7. i18n 实现

### 7.1 翻译边界（[PRODUCT](./PRODUCT.md) i18n / [SEO](./SEO.md) §10）

| 翻译 | 不翻译（数据语言中立） |
|---|---|
| UI chrome（顶栏 / 按钮 / 标签）、导航、年度标签、About 正文、**meta + OG 文案**、面包屑名 | repo 名、owner/org login、描述、语言、topic、**所有数字** |

> 这条直接决定字典只覆盖"界面词"，不碰任何来自 JSON 视图的数据字段。

### 7.2 字典（手写；route locale 服务端选择）

```text
web/lib/i18n/
  dictionaries/
    en.ts   ja.ts   zh.ts   zh-tw.ts   ko.ts   es.ts   fr.ts
  index.ts                       # getDictionary(locale) — 懒加载字典
  client.tsx                     # server-safe fallback helper；页面应优先使用 route dictionary
  client-runtime.tsx             # "use client" I18nProvider / useDict / useChrome（仅交互工具兜底，不包内容页）
  server.ts                      # ⚠️ 弃用：getPreferredDictionary 读 cookie 会破坏静态；勿在 page/layout 调用
```

```ts
// web/lib/i18n/index.ts（示意）
const dicts = { en, ja, zh, "zh-TW": zhTw, ko, es, fr } as const;
export type Locale = keyof typeof dicts;
export const getDictionary = async (l: Locale) => (await dicts[l]()).default;
```

- `(en)/layout.tsx` 与 `(localized)/[locale]/layout.tsx` 选择 `<html lang>` 并把 route locale / dictionary 传入共享 shell；页面和 chrome 不读 cookie。
- chrome 文本节点使用 route dictionary；`Chrome`/`Footer`/`Breadcrumbs` 接收 locale 与 dictionary 后服务端渲染当前语言。Pulse 页面文案走 `nav.pulse` / `pulse.*`，避免旧“trending”命名继续混淆编辑语义。**数据**（数字/日期/repo 名）语言无关，按源数据服务端渲染进静态 / ISR HTML。
- 客户端 i18n resolver 缺键时先回退英文 `en[path]`，只有英文也缺失或路径指向对象节点时才返回原始 path，避免局部字典漏项直接暴露给用户。
- `LanguageSwitcher` 展示当前 route locale，下拉项是对应 locale URL 的 `<a>` 链接；不写 cookie、不派发 `gsc:localechange`、不在客户端翻译当前页。`/api/lang` 仍保留为兼容入口：写 `gsc_lang` 后重定向到 locale URL。
- SEO title/description、JSON-LD、FAQ、面包屑与确定性 narrative 随 route locale 由服务端选择；canonical 指当前 locale 自身 URL，`hreflang` / `x-default` 由 `pageMeta()` 输出。

### 7.3 canonical / hreflang（Metadata API）

服务器端多语言 URL 已落地：调用 `pageMeta()` 时传入 locale、无语言前缀的 canonical path、localized title / description；helper 负责生成当前 locale canonical、`og:url`、`og:locale` 与完整 `hreflang` 矩阵（含 `x-default` -> English 无前缀 URL）。页面正文、metadata、sitemap 与语言切换导航都以 locale URL 为准。

```ts
return pageMeta({
  locale,
  path: "/rankings",
  title,
  description,
});
```

- `metadataBase` 读 `NEXT_PUBLIC_SITE_URL`（[OPS](./OPS.md) 环境变量 / [SEO](./SEO.md) §2）以适配预览/生产。

---

## 8. 与现有 app 的具体接点

> 把上面落到"动现有哪些文件"。**本文是 spec，不写应用代码**。

1. **数据层**：`web/lib/contracts/`（Zod）+ `web/lib/data/`（fetch Blob + parse + `cache()`）是页面读 JSON 视图的唯一入口。
2. **段配置**：`rankings/[year]`/`[period]` 预渲染当前年/月 + `dynamicParams`;repo/org `generateStaticParams() => []` 转按需 ISR;未知 param `notFound()`。
3. **middleware / `next.config.ts`**：middleware 负责 `/en/*` 规范化与 cookie/header 偏好重定向；`next.config.ts` 不做旧路径形态兼容重定向。
4. **页面**：`(en)` 与 `(localized)/[locale]` 两套路由组调用 `_localized/*` 共享实现，覆盖 `pulse`/`rankings`/`rankings/[year]`/`[period]`/`[owner]/[name]`/`o/[login]`/`categories`/`compare`。
5. **i18n**：route-locale 服务端渲染（机制见 §7，渲染模式见 §2.5）。
6. **SEO 配套**：`app/sitemap.xml/route.ts`、`app/sitemap-*.xml/route.ts`、`app/robots.ts`、各页 `generateMetadata`、JSON-LD。
7. **cron route**：`app/api/cron/{daily,weekly}`（`revalidatePath` + `CRON_SECRET`）；endpoint contract 见 [API.md](./API.md)。
8. **共享组件 / token helper**：`Breadcrumbs`/`Footer`/`LanguageSwitcher`/`JsonLd` 抽成共享组件；页面横向 padding 统一经 `_explore/layout-tokens.ts` 的 `PAD_X` 使用锁定基线 clamp 值；`PrevNext`/`EntityCard`/`YearSpine` 仍内联（§6.3）。

---

## 9. 当前已知开口

| # | 项目 | 当前状态 |
|---|---|---|
| **D** | **StarCurve 非单调曲线渲染** | `entity/repo.curve.recent_daily` 可为负（取消 star,[DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.5）;`StarCurve` 取 `curve.monthly.total_end` 累计作 `total`,需确认曲线尾部回落时 y 轴/area 渲染正确（`max` 取序列实际最大值） |
| **I** | **`_explore/` 命名** | 组件位于 `app/_explore/`（Next.js private folder 约定）,沿用现状 |

---

## 10. 不变量核对清单（前端层）

**路由**
- 周榜 `/rankings/[year]/W[week]` 独立、与月榜共用 `[period]` 并按 `W` 前缀消歧
- org `/o/[login]`、repo `/[owner]/[name]`、总榜 `/rankings`、脉搏 `/pulse`
- i18n URL：English 无前缀；ja/zh/zh-TW/ko/es/fr 使用前缀 URL；`/en/*` 308 到无前缀 English；支持完整 `hreflang` / `x-default` 矩阵

**分层 ↔ 配置**
- `cacheComponents` 保持关闭（`next.config.ts` 注释说明）
- `rankings/[year]`/`[period]` 用 `generateStaticParams` 预渲染当年/当月 + `dynamicParams`
- 数据变更靠 cron `revalidatePath`；`app/api/cron/{daily,weekly}` 带 `CRON_SECRET` 鉴权
- 渲染模式：route locale + 服务端本地化 HTML（§2.5）→ 构建路由表保持 `○` 静态 / `●` SSG 按需 ISR

**数据消费**
- `web/lib/contracts/`（Zod）+ `web/lib/data/`（fetch+parse+`cache()`）是页面读 JSON 视图的唯一入口
- 榜单走 lookup-join（rank item + `lookup/*`）；未知 param → `notFound()`
- 每日视图读取带 `?v=<date>` cache-bust；`meta.schema_ver` 启动校验

**零客户端 JS**
- 内容页**数据正文与 chrome 壳**服务端渲染（图表服务端 SVG/DOM）；只允许明确交互小岛水合：SearchBox、ShareButton、ThemeToggle、LanguageSwitcher、RegisterSW，以及 `/compare` 的 CompareClient/CompareCurve
- 新增入场动画在 `prefers-reduced-motion` 块补终态钉死

**i18n**
- 手写字典 `web/lib/i18n/`（en/ja/zh/zh-TW/ko/es/fr）；数据字段不翻译
- chrome 按 route locale 服务端渲染：页面传入 dictionary；`i18n/client-runtime.tsx` 仅供真正 client 工具兜底；`i18n/server.ts` 弃用
- 各页 `pageMeta()` 以无语言前缀 canonical path 为输入，输出当前 locale canonical 与完整 `alternates.languages`
- `metadataBase` 读 `NEXT_PUBLIC_SITE_URL`

---

## 11. Category Routes

Phase 2 category browsing is implemented in `web/app/categories/`.

Routes:

- `/categories` renders the registry-driven category index.
- `/categories/[dimension]` renders one dimension index, such as
  `/categories/language`.
- `/categories/[dimension]/[slug]` renders a category detail page. Static params
  include priority language slugs plus any public category found in the
  published registry; `dynamicParams = true` keeps future public registry
  categories addressable.
- `/categories/[dimension]/[slug]/page/[page]` renders page 2+ of large
  categories from `categories/assignments.json` + `lookup/repos.json`. Page 1
  stays canonical at `/categories/[dimension]/[slug]`.

Data and rendering:

- `web/app/categories/category-page-data.ts` owns route helpers, fallback
  registry construction, public-category filtering, pagination path helpers,
  and static params.
- Category pages read `categories/registry.json`,
  `categories/assignments.json`,
  `rank/category/<dimension>/<slug>/all-time/repo/stock.json`, and
  `lookup/repos.json` through `web/lib/data/categories.ts`.
- The `/categories` index groups public categories by registry dimension rather
  than hard-coding only languages.
- The category index, dimension pages, and detail pages use 86400-second ISR so a
  newly published registry can appear without a full redeploy while avoiding
  minute-by-minute background regeneration.
- The chrome nav exposes `/categories` through the localized `nav.categories`
  dictionary entry.
- Category index, dimension pages, and category detail pages emit server-rendered
  `ItemList` JSON-LD from the same rows that are visible in HTML. Detail page N
  offsets `position` by the pagination start rank.
- Category detail pages with more than one page expose a visible "Browse all"
  pagination anchor and related same-dimension category links.

## 12. SEO Link Surfaces

The SEO link graph is server-rendered and deterministic; it does not add client
JavaScript.

- Repo pages include a compact link hub after the summary area. It links to the
  owner org page, public category pages for the repo, and up to six related
  repositories chosen deterministically: same owner first, then same primary
  language, sorted by stars and `full_name`.
- Year, month, and week ranking detail pages keep their top slices but expose a
  "Complete ranking" anchor to the full server-rendered rank list on the same
  page.
- `/rankings`, ranking detail pages, category list pages, category detail pages,
  and `/o` owner index pages emit `ItemList` JSON-LD from the server rows.
- The footer links `/categories` and `/o` from every page so crawler entry points
  for category and owner directories are not limited to the top app bar.

## 13. Responsive Behavior

- `Chrome.tsx` is still a Server Component. Mobile primary navigation is a
  native `<details>/<summary>` disclosure, so it adds no new client JavaScript.
  Below `sm`, Pulse / Rankings / Categories / Compare / About are reachable from
  that disclosure with a 44px trigger. At `sm+`, desktop inline navigation keeps
  the existing breakpoints: Pulse and Rankings visible, Compare/About visible
  from `sm`, Categories visible from `md`.
- The mobile chrome row uses a compact four-column layout for SearchBox,
  language, theme, and menu controls. `LanguageSwitcher` keeps its full language
  label from `sm` and uses a 44px locale-code trigger below `sm`.
- `Heatmap.tsx` keeps the DOM grid and brand `color-mix` ramp, but caps columns
  responsively for readability: up to 8 columns on narrow 320px phones, up to 10
  columns from 375px, and the caller-provided column count again from `md`.
- `RankingList.tsx` constrains row, rank, owner, and metric widths on narrow
  screens so long repository names truncate inside the row instead of widening
  the page.
- Repo recent rows on `/[owner]/[name]` are single-column on narrow screens and
  return to the three-column month/rank/adds layout from `sm`.
- `manifest.ts` has a single static Web App Manifest `theme_color`; browser
  chrome follows light/dark through `layout.tsx` `viewport.themeColor` media
  entries and the runtime `ThemeToggle` meta update.
