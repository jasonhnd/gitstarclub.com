# gitstarclub SEO 设计

## Scope

本文定义每个页面类型的 SEO 规则（`title` / `description` / `canonical` / `robots`）、sitemap 分片结构、按需 ISR 在 SEO 语境下的语义，以及内链策略。

> SSG 的核心价值是**可被搜索引擎收录、可分享**。目标流量（百万–千万/天）主要来自搜索引擎长尾
> （如 `langchain star history`、`github trending 2024`、`vercel github stars`、`anthropic org star ranking`）。
> **SEO 不是加分项，是目标成立的前提**——本站没有品牌词流量、没有社交裂变引擎,唯一的规模化获客是「每一页都精确命中一条长尾查询」。
>
> 关联文档：渲染 / 页面分层 / ISR 见 [ARCHITECTURE.md](./ARCHITECTURE.md)；页面 / URL / i18n / 调性 / 配色见 [PRODUCT.md](./PRODUCT.md)；
> 域名拓扑 / Blob / 环境变量见 [OPS.md](./OPS.md)。技术事实基于 **Next.js 16.2.6**（App Router + Metadata API）。
>
> i18n 口径：canonical URL 语言中立。无 `gsc_lang` cookie 时默认 SEO / 用户语言为英文；ja、zh、zh-TW、ko、es、fr 是页内 UI 偏好，通过下拉切换。这些语言变体不创建独立 URL，也不产生 `hreflang` 互指。

---

## 0. 核心原则（先读这条）

1. **每页 = 一条长尾落地页**：标题里必须有真实搜索词（`star history`、`trending`、年份、repo / org 名）。页面不是"装饰展示数据"，是"回答一个具体查询"。
2. **长尾走按需 ISR，但仍是全量服务端 HTML**：历史 / repo / org 页不在 deploy 构建，首访时由 ISR 生成——但生成出来的是**完整服务端渲染 HTML**，对爬虫与预渲染 SSG 无差别可索引（见 §3）。
3. **sitemap 是长尾的唯一发现入口**：按需 ISR 页没有"自然外链"喂给爬虫，**必须靠 sitemap 枚举全部 URL**，否则爬虫既发现不了、也永远触发不了它们的生成。sitemap 与内链共同承担「让爬虫走遍全站」。
4. **预览环境一律 `noindex`**：测试环境跑在同一 Vercel 项目的 Preview deployment（见 [OPS.md](./OPS.md) 部署拓扑）——预览**绝不能被收录**，否则 `*.vercel.app` / `pre.gitstarclub.com` 抢占品牌词、造成重复内容与域名归属混乱（见 §11）。
5. **性能即排名因子**：零客户端 JS + HTML < 20KB 的 SSG 天然满足 Core Web Vitals（见 §12）。

---

## 1. 收录目标与页面清单

> ⚠️ **页面集（page-surface）是工作默认值**；标注 `待定 PRODUCT` 的条目是产品取舍，可能调整，但**数据层已全部预算就绪**（见 ARCHITECTURE 数据模型），且长尾走按需 ISR ⇒ "成页"成本极低、不占 build 预算，所以 page-surface 可放开。

### 1.1 页面类型矩阵

| 页面类型 | URL 模式 | 渲染层 | 规模（单语言） | 收录优先级 |
|---|---|---|---|---|
| 首页 | `/` | 核心（deploy 构建） | 1 | 最高 |
| 年度页 | `/rankings/2024` | 当年核心 / 历史按需 ISR | ~11 | 高 |
| 月度页 | `/rankings/2024/10` | 当月核心 / 历史按需 ISR | ~132 | 高 |
| Repo 详情页 | `/:owner/:name` | 按需 ISR | ~5,261 | 中（长尾主力） |
| **Org 详情页** | `/o/:login` | 按需 ISR | ~1,000s（含 User+Org owner） | 中（长尾主力） |
| **全时榜** | `/rankings` | 核心（deploy 构建） | 1（+ 切片 待定） | 高 |
| 关于页 | `/about` | 核心 | 1 | 低（但需收录） |
| 周页 | `/rankings/YYYY/W##` | 当周核心 / 历史按需 ISR | ~570 | 中 |
| **脉搏页** | `/pulse` | 核心（deploy 构建，每日刷新） | 1 | 高（"最新动态"入口） |
| 对比页 | `/compare` | 核心（deploy 构建，静态壳） | 1 | 中（工具页） |

> **单语言收录**：语言是页内 `gsc_lang` cookie 偏好、不进 URL（见 §10），URL 语言中立单一 ⇒ 收录目标 URL 数 = 上表单语言合计，不乘语言数。

### 1.2 榜单矩阵（数据层全覆盖，成页是 PRODUCT 取舍）

榜单 = **{周 / 月 / 年 / 全时} × {repo / org} × {flow=新增 / stock=总量}**，全部已在 pipeline 预算成 JSON（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据模型）。**呈现方式**：

| 维度 | 默认呈现 | 独立成页？ |
|---|---|---|
| **周榜**（week × repo/org × flow/stock） | **独立周页 `/rankings/YYYY/W##`** + 月/年页内周摘要 section（链到周页） | 已独立成页 |
| **月榜 / 年榜**（month/year × …） | 月度页 / 年度页主体 | 已独立成页 |
| **Org 榜**（org 维度） | Org 详情页 `/o/:login` + 各 period 页内 org section | Org 详情页已独立 |
| **全时榜**（all-time × repo/org × stock） | **独立页 `/rankings`** | 已独立成页 |

> 这套矩阵比旧设计的 ~5,400 页（纯 repo 月度编年史）**多得多**：org 页可能数千、全时榜独立、周榜可能独立（均为语言中立单一 URL，不乘语言数）。**sitemap 分片数学必须按此新规模重算**（见 §4）。

### 1.3 收录目标量级（估算）

| 维度 | 首页 | 年 | 月 | repo | org | rankings + about + compare | 上表小计 |
|---|---|---|---|---|---|---|---|
| URL 数（语言中立） | 1 | ~11 | ~132 | ~5,261 | ~1,500（估） | ~3 | **~6,900** |

> URL 语言中立单一、不乘语言数（见 §10）。上表小计 ~6,900 **未含周页与 `/pulse`**；加上独立周页 +~570 再加 `/pulse` + `/compare` ⇒ **当前约 6,900、规划 ~7,500 URL，sitemap 按 ~7,500 规划**。具体数随 org 白名单（含 User owner）浮动。

---

## 2. 规范：标题 / 描述 / canonical 模板（每页类型逐一给例）

**全局约定**：

- `metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL)`（见 [OPS.md](./OPS.md)，生产 = `https://gitstarclub.com`），所有相对 URL 据此解析为绝对 URL。
- 根 `app/layout.tsx` 设 `title.template = '%s · GitStarClub'` + `title.default = 'GitStarClub — A Chronicle of Open Source'`；各页用 `title`（字符串）或 `title.absolute`（首页用 absolute，避免重复后缀）。各页 metadata 由 `web/lib/seo.ts` 的 `pageMeta(...)` 工具统一构造（注入 `canonical` / `openGraph.url` / `twitter.images` / 默认 OG card）。
- 根 layout 还根据 `SITE_INDEXABLE` 全局发 `robots: { index, follow }`：默认 `false`（预发期 noindex），见 §5 / §11。
- **每页 canonical 指向自身规范 URL**（语言中立单一 URL：`/rankings/2024/10` 的 canonical 就是它自己，**无语言前缀、不发 hreflang**——语言是页内 cookie 偏好，见 §10）。
- 标题含**真实搜索词**：`star history` / `trending` / 年份 / repo / org 名 / `ranking`。描述 ≤ 155 字符、含数字与具体实体、首句即价值。

> Next.js 16 实现：静态页用 `export const metadata`；依赖 `params` 的动态页用 `export async function generateMetadata({ params })`（`params` 是 Promise，需 `await`）。用 React `cache()` 包装 JSON 视图读取，让 `generateMetadata` 与页面 body **共享同一次数据读取**（去重）。

### 2.1 首页 `/`

实际实现（`web/app/page.tsx`，经 `pageMeta(...)` 工具构造，`absoluteTitle: true` 跳过站点后缀模板）：

| 字段 | 值 |
|---|---|
| title | `Open Source Pulse & GitHub Star History · GitStarClub`（`absolute`，不附加 `· gitstarclub` 后缀） |
| description | `See the current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub projects, plus all-time star rankings.` |
| canonical | `/` |

- 含词：`Open Source Pulse`、`GitHub Star History`、`fastest-rising`、`star rankings`。

### 2.2 年度页 `/rankings/2024`

实际实现（`web/app/rankings/[year]/page.tsx`）：

| 字段 | 模板（以 2024 为例） |
|---|---|
| title | `2024 GitHub Star Rankings — Yearly Movers` |
| description | `The 2024 ranking of GitHub repositories by stars gained, with month-by-month history.` |
| canonical | `/rankings/2024` |
| ogImage | `/rankings/2024/opengraph-image`（路由内置 OG card） |

```ts
export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return pageMeta({
    title: `${year} GitHub Star Rankings — Yearly Movers`,
    description: `The ${year} ranking of GitHub repositories by stars gained, with month-by-month history.`,
    path: `/rankings/${year}`,
    locale: "en",
    ogImage: `/rankings/${year}/opengraph-image`,
  });
}
```

> 模板目前固定不携带年度 TOP3 / newcomer 数等动态字段——长尾页的 description 是参数化模板，避免在 `generateMetadata` 里加额外 JSON 读取。后续若想注入"Top: …"等动态片段，再叠加 `getYearView()` 读取。

### 2.3 月度页 / 周页 `/rankings/2024/10` · `/rankings/2024/W41`

实际实现（`web/app/rankings/[year]/[period]/page.tsx`，`[period]` 段同时承载月与周，由 `^W(\d{1,2})$/i` 分流）：

| 字段 | 模板（2024-10） | 模板（2024-W41） |
|---|---|---|
| title | `October 2024 GitHub Star Rankings` | `2024 Week 41 GitHub Star Rankings` |
| description | `GitHub repositories ranked by stars gained in October 2024.` | `GitHub repositories ranked by stars gained in 2024 Week 41.` |
| canonical | `/rankings/2024/10` | `/rankings/2024/W41` |
| ogImage | `/rankings/2024/10/opengraph-image` | `/rankings/2024/W41/opengraph-image` |

```ts
export async function generateMetadata({ params }: { params: Promise<{ year: string; period: string }> }): Promise<Metadata> {
  const { year, period } = await params;
  const week = /^W(\d{1,2})$/i.exec(period);
  const label = week ? `${year} Week ${Number(week[1])}` : `${monthLabel("en", Number(period), "long")} ${year}`;
  return pageMeta({
    title: `${label} GitHub Star Rankings`,
    description: `GitHub repositories ranked by stars gained in ${label}.`,
    path: `/rankings/${year}/${period}`,
    locale: "en",
    ogImage: `/rankings/${year}/${period}/opengraph-image`,
  });
}
```

- 含词：月份英文全称（`October 2024`）/ 周编号（`2024 Week 41`）、`GitHub Star Rankings`。**月份用英文全称**（搜索量高于数字 `2024/10`）。
- 周榜为**独立页**（`/rankings/YYYY/W##`），月页内不再内嵌周 section。月页 / 年页通过内链指向周页（见 §9）。

### 2.4 Repo 详情页 `/:owner/:name`

实际实现（`web/app/[owner]/[name]/page.tsx`）：

| 字段 | 模板（`anthropics/claude-code`，已找到 entity） |
|---|---|
| title | `anthropics/claude-code — Star History & Timeline` |
| description | `Star history for anthropics/claude-code: 98,432 stars. Growth curve, milestones (10k/50k/100k dates), monthly star gains, and ranking history.` |
| canonical | `/anthropics/claude-code` |
| ogImage | `/anthropics/claude-code/opengraph-image`（按 repo 现场绘制曲线 + 数字 + repo 名） |

```ts
export async function generateMetadata({ params }: { params: Promise<{ owner: string; name: string }> }): Promise<Metadata> {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  const repo = id !== undefined ? await getRepoEntity(id) : null;
  // 找不到时仍返回 metadata（描述用 fullName 兜底）；body 里再 notFound()（见 §3.2）
  if (!repo) return pageMeta({ title: `${fullName} — Star History`, description: `GitHub star history for ${fullName}.`, path: `/${fullName}`, locale: "en" });
  return pageMeta({
    title: `${repo.full_name} — Star History & Timeline`,
    description: `Star history for ${repo.full_name}: ${repo.current_stars.toLocaleString()} stars. Growth curve, milestones (10k/50k/100k dates), monthly star gains, and ranking history.`,
    path: `/${repo.full_name}`,
    locale: "en",
    ogImage: `/${repo.full_name}/opengraph-image`,
  });
}
```

- **repo 名是最强搜索词**：用户直接搜 `<repo> star history`。title 把 `owner/name` 放最前。
- `current_stars` 用 `toLocaleString()` 加千分逗号（无 "as of" 日期——目前不在 description 里硬编日期，避免冷月每日刷描述）。
- **改名 / 迁移**：URL 用当前 `full_name`；旧 URL 做 **301**（见 [PRODUCT.md](./PRODUCT.md) repo 身份）→ canonical 永远指向当前规范 URL，避免重复内容。
- **未知 repo**：`generateMetadata` 返回兜底 meta（`title = '<fullName> — Star History'`），页面 body 调 `notFound()` 触发 404 UI + 状态码（见 §3.2）。

### 2.5 Org 详情页 `/o/:login`

实际实现（`web/app/o/[login]/page.tsx`，按 `owner_type` 切换 `Organization` / `Developer`）：

| 字段 | 模板（`vercel`，`owner_type=Organization`） | 模板（`tj`，`owner_type=User`） |
|---|---|---|
| title | `vercel — GitHub Organization Star Ranking & History` | `tj — GitHub Developer Star Ranking & History` |
| description | `vercel on GitHub: combined star history across 12 tracked ≥10k-star repos — 538,910 total stars, top projects, and all-time ranking.` | `tj on GitHub: combined star history across 4 tracked ≥10k-star repos — 79,830 total stars, top projects, and all-time ranking.` |
| canonical | `/o/vercel` | `/o/tj` |

```ts
export async function generateMetadata({ params }: { params: Promise<{ login: string }> }): Promise<Metadata> {
  const { login: raw } = await params;
  const login = decodeURIComponent(raw);
  const org = await getOrgEntity(login);
  // 未知 login 时仍返回兜底 meta；页面 body 再 notFound()
  if (!org) return pageMeta({ title: `${login} — GitHub Star Ranking`, description: `GitHub star history for ${login}.`, path: `/o/${login}`, locale: "en" });
  const kind = org.owner_type === "Organization" ? "Organization" : "Developer";
  return pageMeta({
    title: `${org.login} — GitHub ${kind} Star Ranking & History`,
    description: `${org.login} on GitHub: combined star history across ${org.repo_count} tracked ≥10k-star repos — ${org.current_stars_sum.toLocaleString()} total stars, top projects, and all-time ranking.`,
    path: `/o/${org.login}`,
    locale: "en",
  });
}
```

- 含词：org `login`、`Organization` / `Developer`（按 `owner_type` 切词）、`Star Ranking`、`History`。owner 含 **User 与 Organization 两类**（见 ARCHITECTURE「org 维度」）。
- 口径诚实：`tracked ≥10k-star repos` 明确说"被追踪的 ≥10k 仓库"（幸存者偏差，About 页注明）——描述不宣称"全部仓库"。
- 不设 `ogImage`，沿用站点默认 OG card（见 §13）。

### 2.6 全时榜 `/rankings`

实际实现（`web/app/rankings/page.tsx`，静态 + 每日 revalidate）：

| 字段 | 值 |
|---|---|
| title | `All-Time GitHub Star Rankings — Most-Starred Repos & Orgs` |
| description | `The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across 11 years.` |
| canonical | `/rankings` |

```ts
export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "All-Time GitHub Star Rankings — Most-Starred Repos & Orgs",
    description: "The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across 11 years.",
    path: "/rankings",
    locale: "en",
  });
}
```

- 若派生切片（如 `/rankings?metric=org` 或 `/rankings/org`）**待定 PRODUCT**；**canonical 去重见 §7**（避免 repo / org 两视图互为重复内容）。

### 2.7 关于页 `/about`

实际实现（`web/app/about/page.tsx`）：

| 字段 | 值 |
|---|---|
| title | `About — Data Sources & Methodology`（站点后缀 ` · gitstarclub` 由 root layout 的 `title.template` 自动追加，最终为 `About — Data Sources & Methodology · gitstarclub`） |
| description | `How GitStarClub charts GitHub star history: data from GH Archive & GitHub API, gross vs net stars, the ≥10k whitelist, and known caveats.` |
| canonical | `/about` |

```ts
export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "About — Data Sources & Methodology",
    description:
      "How GitStarClub charts GitHub star history: data from GH Archive & GitHub API, gross vs net stars, the ≥10k whitelist, and known caveats.",
    path: "/about",
    locale: "en",
  });
}
```

- 收录但低优先级；承载**数据口径与署名**（GH Archive / GitHub API），是 E-E-A-T 信号（透明度）。

> **标题长度**：控制在 ~60 字符可见区内（含后缀会被 Google 截断时，前置真实搜索词保证关键信息不被截掉——这就是 repo / org 名放最前的原因）。

### 2.8 对比页 `/compare`

实际实现（`web/app/compare/page.tsx`，`export const dynamic = "force-static"`，全量静态壳 + 客户端读 `?repos=` 渲染）：

| 字段 | 值 |
|---|---|
| title | 源码传入 `'Compare GitHub Star History'`；根 layout 的 `title.template = '%s · GitStarClub'` 追加品牌 → 最终 `<title>` = `Compare GitHub Star History · GitStarClub` |
| description | `Overlay the star-history curves of any tracked repositories (≥10k stars) on one chart — absolute or aligned from 10k.` |
| canonical | `/compare`（**始终**指向无参版本，参数页通过 canonical 折回） |

```ts
export const dynamic = "force-static";
export function generateMetadata(): Metadata {
  return pageMeta({
    title: "Compare GitHub Star History · gitstarclub",
    description:
      "Overlay the star-history curves of any tracked repositories (≥10k stars) on one chart — absolute or aligned from 10k.",
    path: "/compare",
    locale: "en",
  });
}
```

- **去重策略：仅靠 canonical**：`/compare` 是 `force-static` 静态壳，所有 `?repos=...` 排列**共用同一份 HTML**（参数完全由客户端读 URL 解析），`<head>` 里只声明 `canonical: /compare`。
- **`noindex` 不实施**：先前设计里"带参版本 `noindex`"需要按请求读 `searchParams` → 把页面退化为 dynamic SSR；本站为了保留 CDN 静态命中，**没有**在带参时输出 `robots: { index: false }` meta。
- **依赖 canonical 收敛**：Googlebot / Bingbot 对 canonical 标签的合并去重历史上非常可靠——所有 `?repos=...` 命中应被折回 `/compare` 作为唯一 indexable 表面；如果将来 Search Console 收录报告显示带参 URL 仍被独立索引，再升级为 `dynamic = "force-dynamic"` 路径以发 `noindex`。
- sitemap **只列** `/compare`，不枚举 `?repos=...` 组合。

---

## 3. 按需 ISR 的 SEO 语义（本站最关键的 SEO 细节）

> chrome 翻译在客户端（`i18n/client.tsx`）执行，服务端只出默认英文静态 / ISR 页；构建路由表为 `○`（静态）/ `●`（按需 ISR），不存在 `ƒ`（force-dynamic）。见 [FRONTEND.md](./FRONTEND.md) §2.5（渲染模式：静态基底 + 客户端译 chrome）。**对 SEO 的关键含义**：输出的是**完整可索引 HTML**（§3.1a），且 ISR 持久缓存 / CDN 共同扛量。

**渲染模型**（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 页面分层）：deploy 只构建**小核心**（首页 / 当年 / 当月 / 全时榜，语言中立 ~数十页）；历史 / repo / org 页是**按需 ISR**——`dynamicParams = true` 且 `generateStaticParams` 返回空（或仅当年/当月）⇒ 不在 deploy 构建，首访时生成、存入 Vercel 持久 ISR store，后续命中缓存。

### 3.1 四条必须落实的 SEO 含义

| # | 含义 | 落实 |
|---|---|---|
| (a) | **ISR 页仍是完整服务端 HTML ⇒ 完全可爬可索引** | 内容页零客户端 JS、图表服务端 SVG；爬虫首次抓取即拿到全量 HTML，与预渲染 SSG **无差别**。**不依赖客户端 JS 渲染正文**。 |
| (b) | **sitemap 必须枚举全部这些 URL** | 否则爬虫**发现不了**长尾页、也就**永不触发**其生成。sitemap 是按需 ISR 长尾的**唯一发现入口**（见 §4）。内链是补充（见 §9）。 |
| (c) | **deploy 后 ISR store 重置 ⇒ 首个爬虫/访客命中触发重生**（可接受） | 重生一次是轻量 Function（读 KB 级 JSON 视图，不碰 Parquet/引擎）；百万–千万/天流量下冷启动占比可忽略。**deploy 频率低**（仅代码/结构变更），数据更新走 `revalidatePath` 不重置（见 ARCHITECTURE / OPS）。 |
| (d) | **状态码必须正确 + `lastModified` 稳定** | 见 §3.2 / §3.3。 |

### 3.2 状态码（爬虫信号正确性）

- **合法 param → 200**：`generateMetadata` / 页面正常渲染。
- **未知 param → 404**：`getRepoEntity` / `getOrgEntity` 查不到 → 调 `notFound()`（Next.js 返回 404 + not-found UI）。**绝不能给未知 repo/org 返回 200 软 404**（Google 会判"软 404"、浪费抓取预算、污染收录）。
- **改名旧 URL → 301**：永久重定向到当前 `full_name`（见 [PRODUCT.md](./PRODUCT.md)）。

```ts
// 按需 ISR 段配置（repo / org / 历史年月）
export const dynamicParams = true            // 默认值；未列入 generateStaticParams 的 param 首访生成
export async function generateStaticParams() {
  return []                                  // 长尾：不在 deploy 构建，全部按需生成
}
// 注意：返回 [] 要求 cacheComponents 关闭（开启时空数组会 build 报错，见 §3.4）
```

> 核心页（首页/当年/当月/全时榜）则在各自段 `generateStaticParams` 返回**具体 param**（当年、当月、`/rankings`），deploy 时预渲染。

### 3.3 `lastModified` 规则（同时用于 sitemap 与潜在 HTTP 头）

**目标态**（分片实施后，见 §4.4）：

| 页面 | `lastModified` 取值 | 稳定性 |
|---|---|---|
| 历史年 / 历史月（已折叠进 canonical shard） | 该期数据**最后被重算的日期**（仅 Vercel Workflow 重算并发布新版本时才变）→ 实质**固定** | 高（爬虫据此降频复抓） |
| 当年 / 当月 / 首页 / 全时榜 | **最近一次每日同步时间**（`hot-snapshot` 写入时刻 / UTC 日） | 每日变（爬虫据此勤复抓） |
| repo / org 详情 | 该实体**最近有数据变动的日期**（当月在榜→每日级；早已沉寂→固定在最后活跃月） | 视活跃度 |

- **稳定性原则**：历史页 `lastModified` **不可每次 build 抖动**（否则爬虫误判全站每日全变、浪费预算）。取值来自**数据视图里的确定性字段**（pipeline 写入的 `updated_at` / 期末日），不是 `new Date()`。
- 与 §4 sitemap 的 `lastModified` 同源（同一字段），保证 sitemap 与页面声明一致。

**当前态（已知偏离）**：`web/app/sitemap.ts` 当前是单一扁平 sitemap，**全站共用一个 `lastModified`**（`meta.backfilled_at` 或回退 `new Date()`，见 §4.2）——历史月页和沉寂 repo 都会跟着这个值动。这与上表「历史页应稳定」相违，目前可容忍（URL 规模仅 ~7k、`meta` 命中率高），但**切分片时必须按上表逐 URL 取实体级日期**。

### 3.4 配置要点（与 ARCHITECTURE 对齐）

- **`cacheComponents` 关闭**：开启会改变 `dynamicParams` / 空数组语义（空 `generateStaticParams` 会 build 报错，需占位 param——与我们"长尾全按需"冲突）。MVP **保持关闭**。
- 长尾段 `revalidate = false`：不做时间轮询失效，仅靠 Vercel Workflow 重算发布后的 `revalidatePath` 定点失效（base 数据视图仅 Workflow 发布新版本时才变）。
- **热集 ISR 只读 KB 级 `hot-snapshot.json`**：绝不在请求路径加载 Parquet / DuckDB / 引擎（见 ARCHITECTURE）。
- **Streaming metadata**：Next.js 16 对**可执行 JS 的爬虫**（如 Googlebot）会把 `generateMetadata` 流式注入 DOM、Google 能正确解析；对 **HTML-limited 爬虫**（`facebookexternalhit` / `Slackbot` / `Bingbot` / `Twitterbot`）则**阻塞渲染、把 meta 放进 `<head>`**。我们的 `generateMetadata` 不依赖运行时数据（只读已预算 JSON），可被预渲染进初始 HTML，**社交抓取与搜索引擎都拿得到完整 head**。无需改 `htmlLimitedBots`。

---

## 4. sitemap：当前单文件 flat 实现（~7k URL）+ 未来分片预留

> **Sitemap 协议硬限**：单文件 ≤ **50,000 URL** 且 ≤ **50MB（未压缩）**。当前 ~7,500 个语言中立 URL **单文件塞得下**，故先用**单一扁平 sitemap**；待 URL 规模逼近 5 万时再切到 `generateSitemaps()` 分片（见 §4.3）。

### 4.1 当前实现（单一 flat sitemap）

实际代码（`web/app/sitemap.ts`，全文）：

```ts
import type { MetadataRoute } from "next";
import { getReposLookup, getOrgsLookup, getMeta } from "@/lib/data";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const FIRST_YEAR = 2015;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [repos, orgs, meta] = await Promise.all([getReposLookup(), getOrgsLookup(), getMeta()]);
  const lastModified = meta?.backfilled_at ? new Date(meta.backfilled_at) : new Date();
  const now = new Date();
  const curYear = now.getUTCFullYear();

  const paths: string[] = ["", "/pulse", "/rankings", "/about"]; // "" = home
  for (let y = FIRST_YEAR; y <= curYear; y++) {
    paths.push(`/rankings/${y}`);
    const lastMonth = y === curYear ? now.getUTCMonth() + 1 : 12;
    for (let m = 1; m <= lastMonth; m++) paths.push(`/rankings/${y}/${m}`);
  }
  if (repos) for (const e of Object.values(repos)) paths.push(`/${e.full_name}`);
  if (orgs) for (const login of Object.keys(orgs)) paths.push(`/o/${login}`);

  return paths.map((p) => ({ url: `${BASE}${p}`, lastModified }));
}
```

特征：

- **单一 `export default`**，无 `generateSitemaps()`、无分片；产物路径 `/sitemap.xml` 直接列出全部 URL。
- 覆盖路径：首页 `/`、`/pulse`、`/rankings`、`/about`，每年 `/rankings/YYYY`，每年每月 `/rankings/YYYY/MM`，所有 repo `/{owner}/{name}`，所有 org `/o/{login}`。
- **未在 sitemap**：周页 `/rankings/YYYY/W##`、`/compare`、`/about` 之外的工具页——周页待加入（详见 §4.5 已知缺口）。

### 4.2 `lastModified` 的当前取值（已知限制）

```ts
const lastModified = meta?.backfilled_at ? new Date(meta.backfilled_at) : new Date();
return paths.map((p) => ({ url: `${BASE}${p}`, lastModified }));
```

- **全站共用一个 `lastModified`**：所有 URL 都标同一个日期，要么是 `meta.backfilled_at`（Vercel Workflow 最近一次全量重算时间戳）要么——若 meta 缺失——**回退到 `new Date()`**。
- **回退到 `new Date()` 会按每次 build 抖动**：这违反 §3.3 / §4.4 「历史页 `lastModified` 必须稳定」的原则——若 `meta` 读取失败或 redeploy 频率过高，sitemap 会让 Googlebot 误判全站每日全变。
- **目前可容忍的理由**：URL 规模仅 ~7k，Googlebot 抓取预算消化得起；且 `meta.backfilled_at` 在正常 path 下会命中（pipeline 输出必带 meta），抖动只在异常路径出现。
- **何时必须收紧**：①URL 规模逼近 50k 需要切分片时；②Search Console 出现「Discovered – currently not indexed」激增，疑似浪费抓取预算时——届时按 §4.3 / §4.4 实现分片 + 每片自己的 `lastModified` 取自 `entity.json` 的实体级最后变动日。

### 4.3 未来分片结构（规模逼近 50k 时再实现）

Next.js 16 `app/.../sitemap.ts` 的 `generateSitemaps()` 返回 `[{ id }]`，分片产物 URL 为 **`/<route>/sitemap/<id>.xml`**（v16：`id` 在默认导出里是 Promise，需 `await props.id`）。规划：

```
/sitemap.xml                          # sitemap index（Next.js 自动聚合下列分片）
  /sitemap/pages.xml                  # 静态/核心：首页 + 全时榜 + about + /pulse + /compare
  /year/sitemap/0.xml                 # 年度页
  /month/sitemap/0.xml                # 月度页
  /r/sitemap/0.xml … /r/sitemap/N.xml # repo：每片 ≤5 万
  /o/sitemap/0.xml … /o/sitemap/M.xml # org
  /week/sitemap/0.xml                 # 独立周页
```

```ts
// app/r/sitemap.ts —— repo 分片示例（未来）
import type { MetadataRoute } from "next";

const PER = 50_000;
const BASE = process.env.NEXT_PUBLIC_SITE_URL!;

export async function generateSitemaps() {
  const total = await countRepos();
  const shards = Math.ceil(total / PER);
  return Array.from({ length: shards }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  const repos = await getRepoSlice(id * PER, PER);
  return repos.map((r) => ({
    url: `${BASE}/${r.full_name}`,
    lastModified: r.updatedAt,
    changeFrequency: r.active ? "daily" : "yearly",
    priority: r.active ? 0.7 : 0.4,
  }));
}
```

### 4.4 分片实施时的 `lastModified` / `changeFrequency` / `priority` 规则

| 分片 | lastModified | changeFrequency | priority |
|---|---|---|---|
| pages（首页/全时榜） | 最近每日同步时间 | `daily` | 1.0 / 0.9 |
| year（当年） | 最近同步 | `daily` | 0.8 |
| year（历史） | 期末固定日 | `yearly` | 0.6 |
| month（当月） | 最近同步 | `daily` | 0.8 |
| month（历史） | 当月末固定日 | `monthly` | 0.6 |
| repo（在榜活跃） | 实体最近变动日 | `weekly`~`daily` | 0.7 |
| repo（沉寂） | 最后活跃月 | `yearly` | 0.4 |
| org | 同 repo 逻辑 | `weekly`/`yearly` | 0.6 / 0.4 |
| about | 文案变更日 | `yearly` | 0.3 |

- **不输出语言 alternate**：每个 `<url>` 仅一条语言中立 `<loc>`，**不含 `alternates.languages`、不发 `hreflang` / `x-default`**——语言是页内 `gsc_lang` cookie 偏好、无语言变体 URL（见 §10）。
- **sitemap 自身是 Route Handler、默认被缓存**：除非用 request-time API。我们的 sitemap 只读已预算 JSON，可被静态缓存；数据由 Vercel Workflow 重算发布后，经 `revalidatePath` / 部署刷新即可。
- **priority/changeFrequency 是弱信号**：Google 基本忽略 `priority`，`changeFrequency` 仅作提示；**真正决定复抓的是 `lastModified` + 实际内容变化**——所以 §3.3 的稳定性最关键。

### 4.5 当前 sitemap 的已知缺口

| 项 | 现状 | 影响 | 处理 |
|---|---|---|---|
| 周页 `/rankings/YYYY/W##` | 未枚举 | 周页只能靠 §9 内链发现；新建周页可能漏抓 | 加 `for (week of 1..lastWeek) paths.push(\`/rankings/${y}/W${pad(w)}\`)`，或独立 `app/week/sitemap.ts` |
| `/compare` | 未枚举 | 工具页 | 加 `paths.push("/compare")` |
| 全局 `lastModified` 共用 | 单一值 | 历史月 / 沉寂 repo 的 `lastModified` 会跟着全站抖动 | 切分片后逐 URL 用实体级日期（`entity.json.updated_at` / 期末日） |
| `meta` 缺失回退 `new Date()` | 异常路径 | sitemap 会按每 build 抖动 | 兜底改为固定日期（如 `BUILD_TIME` 或上次 deploy 时间，从 `process.env.VERCEL_GIT_COMMIT_SHA` 派生），或 hard-fail（让缺 meta 的 build 失败） |

---

## 5. robots.txt

用 Next.js 16 `app/robots.ts` 生成（`MetadataRoute.Robots`）。**实际机制：环境变量 `SITE_INDEXABLE` 总开关**——不分主机，按 env 决定是否放开收录。预发期（teaser 占域名、私有 preview deployment 跑 web 应用）即便 host 是生产域名，只要 `SITE_INDEXABLE` 未设也返回 `Disallow: /`，launch 当天才翻牌：

```ts
// app/robots.ts （实际实现，简化）
import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const indexable = process.env.SITE_INDEXABLE === "1";

export default function robots(): MetadataRoute.Robots {
  if (!indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
```

输出（launch 后，`SITE_INDEXABLE=1` 已置位）：

```txt
User-Agent: *
Allow: /
Disallow: /api/

Sitemap: https://gitstarclub.com/sitemap.xml
Host: https://gitstarclub.com
```

输出（pre-launch，`SITE_INDEXABLE` 未设或非 `"1"`）：

```txt
User-Agent: *
Disallow: /
```

- **总开关 = 环境变量、不看 host**：这是与早期设计的关键差异。原始设想是 `isProductionHost()` 按 host / `VERCEL_ENV` 自动判定，但实际实现选了更稳健的 **launch flag**：预发阶段即便生产域名的 Preview deployment（web 应用）也会噤声，避免抢先于 teaser 暴露。
- **launch 翻牌流程**：①Vercel 项目 production 环境加 `SITE_INDEXABLE=1`②redeploy（不需要改代码）③`robots.txt` 立即放开 + sitemap 暴露 + 根 layout 的全局 `robots: { index: true, follow: true }` 一起翻牌。
- **不屏蔽任何内容页**：~7,500 长尾页（语言中立单一 URL）全要被抓；爬虫预算靠 §3.3 稳定 `lastModified` + §9 内链结构 + sitemap 分片共同消化。
- **屏蔽 `/api/`**：cron / 内部 route 不该被抓（真正防线是 `CRON_SECRET` 鉴权，见 [OPS.md](./OPS.md)；robots 只是减少噪声）。
- **`/search-index`（顶级 JSON 端点）故意放行**：它是全站搜索的版本化索引（`search/index.json`），经发布指针由 Route Handler 服务、带 `s-maxage` 走 CDN，被搜索框首次聚焦时懒加载。`robots.ts` 只 `Disallow: /api/`、不屏蔽它（CDN JSON、非内容页、对 SEO 无害）。若需拦爬虫抓这个 JSON，在 `robots.ts` 加 `/search-index` 到 Disallow 即可。
- **Preview deployment 的处理**：Preview 默认就 `SITE_INDEXABLE` 未设 → `Disallow: /`；再叠加 root layout 的 `robots: { index: false, follow: false }` meta（同一总开关驱动），共防一处。Preview 还需在 Vercel 项目设 Deployment Protection（PRIVATE），见 §11。
- `host` 字段声明规范主机（少数爬虫用作镜像归并提示）。

---

## 6. JSON-LD 结构化数据（schema.org，每页类型逐一）

> 目的：①Google 富结果（面包屑、站内搜索框、数据集卡片）；②给 LLM / AI Overviews 喂结构化事实（star 时间序列、排名），抢 AI 答案位。用 `<script type="application/ld+json">` 注入（服务端渲染进 HTML，非客户端）。**所有页面都带 `BreadcrumbList`**。

### 6.1 首页：`WebSite`（仅首页，不在根 layout）

**实际实现**：`WebSite` JSON-LD **只在首页 `/` 注入**，通过 `PulseView` 组件的 `includeWebsiteLd` prop 控制（`web/app/page.tsx` 传 `includeWebsiteLd`；`web/app/pulse/PulseView.tsx` 内 `{includeWebsiteLd && <JsonLd data={webSiteLd(...)}/>}`）。**根 layout 不注入** `WebSite`——历史 / repo / org / `/rankings` 等其它页面没有 `WebSite` ld，只各自挂自己的 `CollectionPage` / `SoftwareSourceCode` / `Organization` / `Dataset` 等。

```jsonc
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "gitstarclub",
  "url": "https://gitstarclub.com/",
  "description": "A chronicle of GitHub star history across 11 years."
  // 不输出 potentialAction / SearchAction：搜索是客户端 combobox、直达
  // /{owner}/{name}，无规范结果页 URL 可供 SearchAction 广告（见下注）
}
```

> 全站搜索是**导航栏客户端 combobox**（首次聚焦懒加载 `search/index.json` + MiniSearch，命中直达 `/{owner}/{name}`），**没有 `/search?q=` 结果页 URL**。`SearchAction` 的 `urlTemplate` 必须指向一个可返回结果列表的规范页面——本站没有，故 `potentialAction` / `SearchAction` **不输出**（绝不广告一个指向不存在页面的 urlTemplate）。`WebSite` 本体只在首页输出（Google 的 site-name 信号通常依赖首页的 `WebSite` ld）。若未来新增 `/search` 结果页，再补 `SearchAction`。

### 6.2 首页：`WebSite` + `Dataset`（站点级数据集）

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "GitHub Star History (≥10k repos, 2015–present)",
  "description": "Daily star deltas and cumulative star history for 5,261 GitHub repositories with ≥10,000 stars, since 2015.",
  "url": "https://gitstarclub.com/",
  "temporalCoverage": "2015-01-01/..",
  "creator": { "@type": "Organization", "name": "gitstarclub" },
  "isBasedOn": "https://www.gharchive.org/",   // 署名（见 ARCHITECTURE 合规）
  "license": "https://docs.github.com/site-policy"
}
```

### 6.3 Repo 详情页：`SoftwareSourceCode` + `Dataset` + `BreadcrumbList`

```jsonc
[
  {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "name": "claude-code",
    "codeRepository": "https://github.com/anthropics/claude-code",
    "author": { "@type": "Organization", "name": "anthropics" },
    "programmingLanguage": "TypeScript",
    "url": "https://gitstarclub.com/anthropics/claude-code"
  },
  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "Star history for anthropics/claude-code",
    "description": "Daily and cumulative GitHub star counts for anthropics/claude-code since its first tracked date.",
    "variableMeasured": "GitHub stars",
    "temporalCoverage": "2024-02-01/..",
    "isBasedOn": "https://www.gharchive.org/"
  },
  { "@type": "BreadcrumbList", "...": "见 6.7" }
]
```

> repo 的 star 时间序列是本站独家结构化资产 → `Dataset` 让它对"数据型查询"与 AI 答案更可见。`SoftwareSourceCode` 关联 GitHub 源、`author` 关联 org 实体。

### 6.4 Org 详情页：`Organization` + `ItemList` + `BreadcrumbList`

```jsonc
[
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "vercel",
    "url": "https://gitstarclub.com/o/vercel",
    "sameAs": ["https://github.com/vercel"]
  },
  {
    "@context": "https://schema.org",
    "@type": "ItemList",                 // 该 org 的 top repo 列表
    "name": "Top repositories by vercel",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "url": "https://gitstarclub.com/vercel/next.js", "name": "vercel/next.js" }
    ]
  }
]
```

> 个人 owner（`owner_type=User`）用 `@type: Person` 替代 `Organization`（按数据切换）。

### 6.5 月度页 / 年度页：`CollectionPage` + `ItemList`（×N 榜单）+ `BreadcrumbList`

```jsonc
[
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "Top GitHub Repos in October 2024",
    "url": "https://gitstarclub.com/rankings/2024/10",
    "datePublished": "2024-11-01",
    "dateModified": "2024-11-01",        // 历史页固定；当月页 = 最近同步
    "isPartOf": { "@type": "CollectionPage", "name": "GitHub Stars in 2024", "url": "https://gitstarclub.com/rankings/2024" }
  },
  {
    "@context": "https://schema.org",
    "@type": "ItemList",                 // 「当月新增 TOP」榜
    "name": "Top repos by new stars in October 2024",
    "numberOfItems": 20,
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "url": "https://gitstarclub.com/anthropics/claude-code", "name": "anthropics/claude-code" }
    ]
  }
  // 可再为「增速 TOP」「新晋」「周榜 section」各输出一个 ItemList
]
```

> 月/年页用 **`CollectionPage` + 多个 `ItemList`**：月/年页本质是"策展的实体集合 + 榜单"，比 `Article` 更贴切（`Article` 适合后续叙事段落，届时可叠加）。保留 `datePublished` / `dateModified`。

### 6.6 全时榜 `/rankings`：`CollectionPage` + `ItemList`（repo 榜 + org 榜）

- 两个 `ItemList`（all-time repo by stock、all-time org by stock），各列 top-N `ListItem`，指向对应 repo/org 详情页（强化 §9 内链）。

### 6.7 全站面包屑：`BreadcrumbList`

```jsonc
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://gitstarclub.com/" },
    { "@type": "ListItem", "position": 2, "name": "2024", "item": "https://gitstarclub.com/rankings/2024" },
    { "@type": "ListItem", "position": 3, "name": "October 2024", "item": "https://gitstarclub.com/rankings/2024/10" }
  ]
}
```

| 页面 | 面包屑路径 |
|---|---|
| 月度页 | Home → 年 → 月 |
| 年度页 | Home → 年 |
| repo 页 | Home → Rankings →（owner）→ repo，或 Home → repo（取实现简单路径，至少 Home→repo） |
| org 页 | Home → Rankings → org |
| 全时榜 | Home → Rankings |

> 面包屑同时是 §9 内链网的一部分（每个层级是真实可点链接），降低爬虫深度。

---

## 7. canonical 去重策略（重叠榜单视图）

榜单矩阵存在**多视图指向同一组实体**的重复内容风险，规则：

| 风险场景 | 策略 |
|---|---|
| 同一榜单的「周 section」既在月页又在年页出现 | 周榜默认**不独立成页**（无独立 URL ⇒ 无重复 URL）；若 §1 周页独立，则月/年页内的周 section 仅作摘要 + 链接到周页，**周页 canonical 指自身**，月/年页**不** canonical 到周页。 |
| `/rankings` 的 repo 视图 vs org 视图（若做成 `?metric=` / 子路径） | **二选一为规范**：要么单页内并列展示（一个 URL，无重复）；要么 `/rankings`（repo，规范）+ `/rankings/org`（org，**canonical 指自身**，因内容确实不同）。**绝不**让 `?sort=`、`?period=` 等纯排序/筛选 query 产生可索引的重复 URL —— 这类 URL 一律 canonical 回无参数规范页。 |
| repo 改名产生的新旧 URL | 旧 URL **301** → 新 URL；canonical 永远当前 `full_name`（见 §2.4 / [PRODUCT.md](./PRODUCT.md)）。 |
| 语言版本 | **无语言变体 URL**：语言是页内 `gsc_lang` cookie 偏好、不进 URL，不涉跨语言 canonical、不发 hreflang（见 §10）。 |
| 尾部斜杠 / 大小写 | 统一**无尾斜杠 + owner/name 保留 GitHub 原始大小写**；其余形式 301 到规范形。 |

> 原则：**一个内容、一个规范 URL**。query 参数视图（排序/筛选/分页除外）全部 canonical 回规范页；真正内容不同的视图（org vs repo、不同 period）各自 canonical 到自身。

---

## 8. 分页（长榜单的 rel / canonical）

全时榜 / 年度 TOP 等长列表若分页：

- **MVP 首选「单页 + 服务端渲染足够长的列表」**（如 top 100），**不分页** ⇒ 无分页 SEO 复杂度，且零客户端 JS 下也无"加载更多"。这是默认。
- 若确需分页（如 org 全量列表）：
  - 各分页 `?page=2` **canonical 指向自身**（不是 canonical 回第 1 页——Google 已弃用 `rel=next/prev` 作为索引信号，且 canonical 回首页会丢失深页内容）。
  - 可选保留 `<link rel="next">` / `<link rel="prev">`（弱提示，无害）。
  - 分页页 `robots: index,follow`（让深页实体链接被发现）；但**首页（page=1）才是该列表的规范入口**，分页页标题加 ` — Page 2` 区分、避免标题重复。
  - **分页 URL 也要进 sitemap**（否则深页实体发现不了）。

> 由于本站长尾主力是 repo/org **详情页**（每个独立 URL、由榜单内链 + sitemap 双重发现），榜单页是否分页对收录影响小——**优先不分页**。

---

## 9. 内链图（爬虫消化 ~7,500 页的关键，配合 sitemap）

> 目标：**任意页 ≤ 3 跳可达**；按需 ISR 页除 sitemap 外还能被内链发现 / 触发生成。内链是"爬虫预算的导流"，sitemap 是"全量清单"，两者缺一不可。

```
首页 /
 ├─ 年份脊柱（2015…当前）──────────────→ 各年度页 /rankings/YYYY （1 跳到任意年）
 ├─ 本月聚焦 TOP / 增速 ────────────────→ repo 详情页 /:owner/:name （1 跳到热门 repo）
 ├─ 历史上的今天（里程碑）──────────────→ repo / 对应月度页
 └─ 全时榜入口 ─────────────────────────→ /rankings

年度页 /rankings/YYYY
 ├─ 12 个月份格子 ─────────────────────→ 月度页 /rankings/YYYY/MM （1 跳到任意月）
 ├─ 年度 TOP 50 行（repo 名）───────────→ repo 详情页 /:owner/:name
 ├─ 年度 org section（若有）────────────→ org 详情页 /o/..
 └─ 上下年导航 ← YYYY-1 | YYYY+1 →       （年脊柱横向连通）

月度页 /rankings/YYYY/MM
 ├─ 三大榜单每行 repo 名 ───────────────→ repo 详情页 /:owner/:name
 ├─ 周榜 section 每行 ──────────────────→ repo / org
 ├─ 上下月导航 ← 上月 | 下月 → ↑ 年度页   （月链横向 + 纵向连通）
 └─ org 维度行（若有）──────────────────→ org 详情页 /o/..

repo 详情页 /:owner/:name
 ├─ 里程碑（破 10k/50k/100k）───────────→ 对应月度页锚点 /rankings/YYYY/MM#..
 ├─ 月度表现表（近 N 月，每行）──────────→ 对应月度页
 ├─ owner 链接 ─────────────────────────→ org 详情页 /o/owner    （repo↔org 互链）
 └─ 名次史 ─────────────────────────────→ 对应 period 页

org 详情页 /o/login
 ├─ top repo 列表（每行）───────────────→ repo 详情页 /login/:name （org→repo）
 ├─ 月度 org 表现 ──────────────────────→ 对应月度页
 └─ 全时 org 名次 ──────────────────────→ /rankings

全时榜 /rankings
 ├─ repo 榜每行 ────────────────────────→ repo 详情页
 └─ org 榜每行 ─────────────────────────→ org 详情页
```

**关键边（必须实现）**：

| 边 | 作用 |
|---|---|
| 年份脊柱（首页 → 各年） | 全部年页 1 跳可达 |
| 月份格子（年 → 各月） | 任意月 ≤ 2 跳 |
| 榜单行 → 实体（repo/org） | 长尾详情页被发现 + 触发 ISR；**这是 repo/org 页的主发现路径** |
| 里程碑 / 月度表 → 月度页 | repo 页反哺月页、形成网状回环 |
| repo ↔ org 互链（owner 字段） | org 页被 repo 页发现，反之亦然 |
| prev/next（上下月、上下年） | 时间轴横向连通、降低孤岛 |
| 面包屑（§6.7） | 每页向上回链，纵向连通 |

- **深度核对**：首页→年（1）→月（2）→repo（3）= 3 跳；首页→全时榜（1）→repo（2）；首页→热门 repo（1）→owner org（2）。**全站 ≤ 3 跳**达成。
- **孤岛风险**：早已沉寂、从未进入任何近期榜单的 repo —— 靠 ①sitemap 枚举（必达）②其历史所在月页的榜单行（历史月页也在 sitemap）双重兜底。

---

## 10. 多语言策略（页内 cookie 偏好，非 URL 多语言 SEO）

> **语言是页内偏好（`gsc_lang` cookie），不进 URL、不发 hreflang**——这是产品决定（GitHub 风格单一 URL，见 [FRONTEND.md](./FRONTEND.md) §7 / §1.2），与本文顶部 i18n 口径一致。

| 维度 | 规则 |
|---|---|
| URL | **语言中立、单一 URL**（`/rankings/2024/10`、`/owner/name`）；**无 `/ja`、`/zh` 语言前缀** |
| canonical | 指自身的语言中立 URL；**不发 hreflang / `alternates.languages`**（没有语言变体 URL 可互指） |
| SEO 语言 | **英文**为默认 SEO / 用户语言（无 cookie 时）；meta / OG 文案为英文 |
| 其它语言 | en/ja/zh/zh-TW/ko/es/fr 是**页内 UI 偏好**（下拉切换，写 cookie + 客户端换 chrome，见 [FRONTEND.md](./FRONTEND.md) §7 + §2.5 静态基底 + 客户端译 chrome）；**不创建独立 URL、不影响收录** |
| 翻译范围 | UI chrome / 导航 / 年度标签 / About / 面包屑名；**不翻译** repo 名 / 描述 / 语言 / topic / 数字（数据语言中立） |
| og:locale | 默认 `en_US`；语言切换由客户端调整，不影响 canonical |

---

## 11. 预览环境 noindex（生产 / 测试域名的硬约束）

> 背景：生产与测试合并在同一 Vercel 项目，测试域名指向 Preview deployment（部署拓扑 / 域名见 [OPS.md](./OPS.md)）。SEO 硬约束：测试环境必须保持 private/noindex。

**实际实现：单一环境变量 `SITE_INDEXABLE` 控制所有三条 SEO 噤声防线**（不按 host 判定）：

| 防线 | 实现 |
|---|---|
| **robots.txt 全站禁抓** | `SITE_INDEXABLE !== "1"` → `app/robots.ts` 返回 `User-Agent: *` + `Disallow: /`（见 §5） |
| **每页 meta `noindex`** | 同一 flag 驱动 root layout 的 `robots: { index: indexable, follow: indexable }`，覆盖全站；未设时所有页 `<meta name="robots" content="noindex,nofollow">` |
| **sitemap 不外发** | `Disallow: /` 时也不向 robots 写 `Sitemap:` 行，进一步降低被发现的概率（sitemap 路由本身仍可访问，但没有 robots 广告） |
| **预览保持 PRIVATE** | Vercel 项目预览部署设为非公开（Deployment Protection），从源头不可被匿名爬虫访问 |
| **canonical 不外泄** | Preview 的 `NEXT_PUBLIC_SITE_URL` 仍指生产域名 ⇒ 即便 meta 误放出，canonical 也指向生产、不让 `*.vercel.app` / `pre.gitstarclub.com` 成规范 URL |

代码（`web/app/layout.tsx`）：

```ts
const indexable = process.env.SITE_INDEXABLE === "1";
export const metadata: Metadata = {
  // ...
  robots: { index: indexable, follow: indexable },
};
```

**为什么不用主机检测**：早期设计想用 `isProductionHost()`（host / `VERCEL_ENV`）自动判定，但 launch 前后 teaser 与 web 应用要共享生产域名的过渡期，host 判定容易在不该开放时翻牌；env flag 显式、可控、单一翻牌点。

- **launch 当天翻牌**：①Vercel 项目 production 环境加 `SITE_INDEXABLE=1`②redeploy（不需要改代码）③robots 恢复 `Allow: /` + meta `noindex` 消失 + sitemap 在 robots 里被广告。
- **切换日检查清单**：alias 切到 web 应用 + `SITE_INDEXABLE=1` 部署完成后确认 ①`/robots.txt` 返回 `Allow: /` + `Sitemap:` 行 ②任意页面 `<meta name="robots">` 不再含 `noindex` ③`/sitemap.xml` 可访问 ④teaser 退役、其部署不再持有生产域名（避免两部署争域名）。
- **绝不**在预览期向 Search Console 提交预览 URL / sitemap。
- **风险**：半成品被收录会污染品牌词、产生重复内容、且生产切换后需大量「移除过时网址」清理——预防成本远低于补救。

---

## 12. 性能即 SEO（Core Web Vitals 作排名因子）

> 内容页为 `○` 静态 / `●` 按需 ISR（chrome i18n 在客户端，见 [FRONTEND.md](./FRONTEND.md) §2.5 静态基底 + 客户端译 chrome），TTFB / 缓存走纯静态 / ISR 命中；正文零客户端 JS、HTML 体积控制在阈值内。

SSG + 零客户端 JS + HTML < 20KB 天然满足（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 性能策略 + 用户 web/performance 规则）：

| 指标 | 目标 | 本站达成方式 |
|---|---|---|
| **LCP** | < 1.5s（优于 Google「good」2.5s 阈） | 静态 HTML 走 Edge CDN + 预加载 hero 字体；无客户端 JS 渲染阻塞 |
| **CLS** | < 0.05 | 图表 SVG 尺寸固定（`width`/`height` 显式）、字体 metric override（避免 FOUT 位移） |
| **INP** | 极低 / 近 0 | 内容页几乎无 JS，无长任务 |
| **FCP** | < 1.0s | 内联关键 CSS、字体子集化 woff2（Plus Jakarta Sans 子集 ~30KB） |
| **TTFB** | 低 | 99.99% 命中边缘缓存；ISR 冷启动仅读 KB JSON（见 §3） |

- **图片**：OG 图预生成存 Blob（见 §13）、不消耗 Function；页内若有图一律显式尺寸 + `loading=lazy`（below-fold）。
- **字体**：最多两家族（Plus Jakarta Sans + Geist Mono）、`font-display: swap`、子集化、仅 preload 关键权重。
- **缓存头**：历史页 `Cache-Control: s-maxage=86400, stale-while-revalidate`（见 ARCHITECTURE）。
- **移动优先索引**：Google 用移动版索引——SSG 响应式、无移动专属阻断；确保移动视口 meta（Next.js 默认注入）与触控可达。

> CWV 是**真实排名因子**（Page Experience），且本站零 JS 架构使其几乎"免费"达标——这是相对动态 dashboard 竞品的结构性优势，应在内容相关性之外作为护城河维护（持续用 Speed Insights 监控，见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。

---

## 13. OG / 社交卡片（石墨灰 + 星金）

> 配色为「石墨灰 + 星金」（见 [PRODUCT.md](./PRODUCT.md) 配色）。

**生成与存储**（见 [ARCHITECTURE.md](./ARCHITECTURE.md) / [OPS.md](./OPS.md)）：

- 每页一张 OG 图（1200×630），用 **`@vercel/og`（`next/og` 的 `ImageResponse`，底层 Satori + resvg）** 生成。
- **不在运行时 Function 出图、也不在每次 build 出图**：仅在**数据变化时（pipeline 侧）增量**生成变化页的 OG → 存 **Vercel Blob**（`blob://og/...`）。历史页 OG 永不重生成。
- 页面 meta 的 `openGraph.images` / `twitter.images` 指向 **Blob 上的绝对 URL**（不走 Next.js 动态 OG route）。
- 字体：**Plus Jakarta Sans（标题）+ Geist Mono（数字 / repo 名）**，与站点一致。
- 配色：surface = 冷石墨灰中性底；accent = 星金（`primary-fixed-dim #ffba3b` 用于 ★ / 峰值 / 数字高亮）。明色卡为主（社交流多浅色背景下更醒目）。

> 注意：Satori 仅支持 flexbox + CSS 子集（**不支持 `display: grid`**），OG 模板用 flex 布局。

### 13.1 每页 OG 内容模板

| 页面 | OG 图内容（1200×630，flex 布局） | 文案搜索词对齐 |
|---|---|---|
| 首页 | 大标题「GitHub Star History」+ 年份脊柱缩略（2015→now 金色条）+ 「~5,261 repos · 11 years」 | star history |
| 年度页 | 「GitHub 2024」特大字 + 年度 TOP 3 repo 名（金色）+ 全年新增星数 | github 2024 trending |
| 月度页 | 「Oct 2024」+ 当月 TOP 3 repo + 缩略日历热力图（金色深浅）+ 新晋数 | top github repos october 2024 |
| Repo 页 | `owner/name`（等宽大字）+ star 曲线缩略（金线）+ 当前 star 数 + 里程碑点 | <repo> star history |
| Org 页 | `login` + org 累计星数 + top repo 名 + org 排名 badge | <org> github stars |
| 全时榜 | 「All-Time GitHub Star Rankings」+ TOP 5 repo 缩略条 | most starred github repos |

- **Twitter card**：`summary_large_image`；`twitter.title` / `twitter.description` 复用各页 meta；`twitter.images` 指 Blob OG URL。
- **Open Graph 全套**：`og:title` / `og:description` / `og:url`（canonical）/ `og:type`（首页/榜单 `website`，月/年页可 `article` 配 `publishedTime`/`modifiedTime`）/ `og:image`（+ `width:1200` `height:630` `alt`）/ `og:locale`（按语言，见 §10）/ `og:site_name = gitstarclub`。
- **alt 文本**：OG 图 `og:image:alt` 描述内容（如 "Star history chart for anthropics/claude-code"）——a11y + 部分平台展示。

---

## 14. Search Console 运维

> 生产域名切换到 web 应用**之后**才操作（预览期绝不提交，见 §11）。

| 任务 | 操作 | 频率 |
|---|---|---|
| 验证站点 | GSC 加 `gitstarclub.com`（DNS 或 `metadata.verification.google` meta）；语言中立单一 URL，无需覆盖语言路径 | 一次 |
| 提交 sitemap | 提交 `https://gitstarclub.com/sitemap.xml`（index）；GSC 自动发现各分片 | 切换后 + 分片结构变更时 |
| 监控收录率 | Coverage / Pages 报告：盯 ①Discovered–not indexed（长尾未抓 → 检查内链/lastModified）②Crawled–not indexed（内容薄 → 加强页面价值）③Excluded by noindex（预览残留 → 清理） | 每周 |
| **ISR 冷启动考量** | GSC 抓取首个 URL 会触发该页 ISR 生成（首抓 TTFB 略高、属正常）；**关注首抓后是否 200 + 内容完整**，而非冷启动延迟本身 | 抽查 |
| ~~hreflang 报告~~ | 不适用：语言中立单一 URL、不发 hreflang（见 §10）；无 International Targeting 需监控 | — |
| URL Inspection | 抽查 repo / org / 历史月页：实时抓取看渲染后 HTML 是否含正文 + JSON-LD（验证 §3a 可索引性） | 抽查 |
| 富结果监控 | Rich Results：Breadcrumb / Dataset 是否有效；用 [Rich Results Test](https://search.google.com/test/rich-results) 验 JSON-LD | 上线 + 变更 schema 时 |
| 移除过时网址 | 若预览曾误被收录：Removals 工具临时移除 + 修 noindex | 仅事故时 |
| Core Web Vitals 报告 | GSC CWV 报告 + Vercel Speed Insights 双看（见 §12） | 每月 |

- **抓取预算**：~7,500 个语言中立 URL 对 Googlebot 不算大，但**新站权重低 → 抓取慢**。加速：①sitemap 分片 + 准确 `lastModified`②强内链（§9）③核心页（首页/年/全时榜）先建权重，再靠内链把权重导给长尾。
- **索引节奏预期**：长尾 repo/org 页可能数周–数月才逐步收录；优先确保**高价值长尾**（热门 repo、近年月份）被内链 + sitemap 优先暴露。

---

## 15. 验收清单

**收录基础设施**

- [ ] **当前**：`app/sitemap.ts` 为单一扁平 `export default`，列出首页 / `/pulse` / `/rankings` / `/about` + 全部年月 + 全部 repo + 全部 org；`/sitemap.xml` 可访问（§4.1）
- [ ] **当前已知偏离**：全站共用 `meta.backfilled_at` 作 `lastModified`，缺 meta 时回退 `new Date()`——URL 规模 ~7k 下可容忍，分片实施时按 §4.4 收紧
- [ ] **未来分片切换条件**：URL 规模逼近 50k 或 GSC 出现抓取预算浪费 → 切到 `generateSitemaps()` + 每片各自 `lastModified`（§4.3 / §4.4）
- [ ] sitemap 每个 `<url>` 仅一条语言中立 `<loc>`，**无语言 alternate**（不含 `alternates.languages` / `hreflang` / `x-default`，见 §10）
- [ ] `app/robots.ts`：`SITE_INDEXABLE=1` 时输出 `Allow: /` + `Disallow: /api/` + Sitemap + Host；**未设置时全站 `Disallow: /`**（§5 / §11）
- [ ] 已知缺口：周页 `/rankings/YYYY/W##` 与 `/compare` 未在 sitemap 中（§4.5）
- [ ] 收录目标量级按 ~7,500 个语言中立 URL 规划（含 org / rankings，不乘语言数，见 §10）

**每页元数据**

- [ ] 每页唯一 `title` / `description` / `canonical`，标题含真实搜索词（star history / trending / 年份 / repo / org 名）
- [ ] `metadataBase` 设为生产域名，相对 URL 正确解析为绝对 URL
- [ ] canonical 指**语言中立单一 URL**；**不发 hreflang / `alternates.languages`**（语言是页内 cookie 偏好，见 §10）
- [ ] `og:type` 月/年页可带 published/modified time（og:locale 默认 `en_US`）

**按需 ISR 可索引性（§3）**

- [ ] 长尾段 `dynamicParams = true` + `generateStaticParams` 返回 `[]`；核心段返回具体 param
- [ ] **未知 repo/org param → `notFound()`（404）**，不返回软 200；改名旧 URL → 301
- [ ] `cacheComponents` 关闭；长尾 `revalidate = false`
- [ ] URL Inspection 抽查：ISR 页首抓返回 200 + 完整服务端 HTML（含正文 + JSON-LD），不依赖客户端 JS

**结构化数据（§6）**

- [ ] 首页 `WebSite`（**仅首页，不在根 layout**；不含 `SearchAction`：搜索是客户端 combobox、无结果页 URL，见 §6.1）+ 首页 `Dataset`
- [ ] repo 页 `SoftwareSourceCode` + `Dataset`；org 页 `Organization`/`Person` + `ItemList`
- [ ] 月/年页 `CollectionPage` + 各榜 `ItemList`；全时榜 `CollectionPage` + repo/org `ItemList`
- [ ] **每页 `BreadcrumbList`**；全部通过 Google Rich Results 测试

**去重与分页（§7 / §8）**

- [ ] 排序/筛选 query 视图 canonical 回规范页；内容不同的视图（org vs repo、不同 period）各 canonical 自身
- [ ] 长榜单优先不分页（top-N 单页）；若分页则各页 canonical 自身 + 进 sitemap

**内链（§9）**

- [ ] 年份脊柱 / 月份格子 / 榜单行→实体 / repo↔org 互链 / prev-next / 面包屑 全部实现
- [ ] 全站任意页 ≤ 3 跳可达；沉寂 repo 有 sitemap + 历史月页双兜底

**OG / 社交（§13）**

- [ ] 每页 OG 图（pipeline 增量生成、存 Blob、**石墨灰+星金**、Plus Jakarta Sans+Geist Mono）
- [ ] meta 指向 Blob OG 绝对 URL；Twitter `summary_large_image` + OG 全套 + alt

**性能（§12）**

- [ ] LCP < 1.5s / CLS < 0.05 / INP 近 0（Speed Insights + GSC CWV 双验）
- [ ] HTML < 20KB、零客户端 JS（内容页）、字体子集化

**预览隔离（§11）**

- [ ] 预览期 robots `Disallow: /` + meta `noindex` + PRIVATE 部署三重保险
- [ ] 切换日检查：生产恢复 `Allow: /`、noindex 消失、teaser 退域名、sitemap 可访问

**Search Console（§14）**

- [ ] 生产切换后验证站点 + 提交 sitemap index
- [ ] 监控收录率（Discovered/Crawled not indexed）、富结果、CWV（**无 hreflang 项**，语言中立单一 URL，见 §10）
- [ ] 预览期**绝不**向 GSC 提交任何 URL/sitemap
