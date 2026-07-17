---
owner: SEO
status: active
last_reviewed: 2026-07-17
source_of_truth_for:
  - per-page SEO templates
  - sitemap structure
  - robots and noindex policy
  - internal linking
  - i18n SEO posture
---

# gitstarclub SEO 设计

## Scope

本文定义每个页面类型的 SEO 规则（`title` / `description` / `canonical` / `robots`）、sitemap 分片结构、按需 ISR 在 SEO 语境下的语义，以及内链策略。生成式答案引擎引用策略、答案胶囊、FAQ / Dataset schema、AI crawler hygiene、IndexNow 与 GEO 度量见 [GEO.md](./GEO.md)。

> SSG 的核心价值是**可被搜索引擎收录、可分享**。目标流量（百万–千万/天）主要来自搜索引擎长尾
> （如 `langchain star history`、`github trending 2024`、`vercel github stars`、`anthropic org star ranking`）。
> **SEO 不是加分项，是目标成立的前提**——本站没有品牌词流量、没有社交裂变引擎,唯一的规模化获客是「每一页都精确命中一条长尾查询」。
>
> 关联文档：渲染 / 页面分层 / ISR 见 [ARCHITECTURE.md](./ARCHITECTURE.md)；页面 / URL / i18n / 调性 / 配色见 [PRODUCT.md](./PRODUCT.md)；
> 域名拓扑 / Blob / 环境变量见 [OPS.md](./OPS.md)。技术事实基于 **Next.js 16.2.10**（App Router + Metadata API）。
> AI answer-engine citation strategy is owned by [GEO.md](./GEO.md); this document stays focused on classic search crawl, canonical, metadata, sitemap, and internal-link mechanics.
> Performance targets are owned by [TESTING.md](./TESTING.md); the issue #25 measured Lighthouse / Core Web Vitals baseline is supporting evidence in [perf/CWV-25.md](./perf/CWV-25.md).
>
> i18n rollout 口径：服务器端多语言 URL 已落地（见 [I18N.md](./I18N.md)）。English 保持无前缀，ja/zh/zh-TW/ko/es/fr 使用前缀 URL；页面正文、metadata、canonical、`hreflang` / `x-default`、sitemap 与语言切换导航都按 route locale 输出。`gsc_lang` cookie 仅保留为 middleware / `/api/lang` 的偏好重定向信号，不参与页面渲染。

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
| Repo 详情页 | `/:owner/:name` | 按需 ISR | 5,300+（the tracked set） | 中（长尾主力） |
| **Org 详情页** | `/o/:login` | 按需 ISR | ~1,000s（含 User+Org owner） | 中（长尾主力） |
| **全时榜** | `/rankings` | 核心（deploy 构建） | 1（+ 切片 待定） | 高 |
| 关于页 | `/about` | 核心 | 1 | 低（但需收录） |
| 周页 | `/rankings/YYYY/W##` | 当周核心 / 历史按需 ISR | ~570 | 中 |
| **脉搏页** | `/pulse` | 核心（deploy 构建，每日刷新） | 1 | 高（"最新动态"入口） |
| 分类页 | `/categories/...` | 核心入口 + priority language 预渲染 + 公开 category 按需 ISR | 有界，随 registry | 中 |
| 对比页 | `/compare` | 核心（deploy 构建，静态壳） | 1 | 中（工具页） |

> **locale 收录模型**：上表规模是基础 canonical path 基数。English 使用无前缀 URL；每个非默认 locale 生成同一组前缀 URL（见 §10），因此收录目标 URL 数约为基础 path 数 × 7。

### 1.2 榜单矩阵（数据层全覆盖，成页是 PRODUCT 取舍）

榜单 = **{周 / 月 / 年 / 全时} × {repo / org} × {flow=新增 / stock=总量}**，全部已在 pipeline 预算成 JSON（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据模型）。**呈现方式**：

| 维度 | 默认呈现 | 独立成页？ |
|---|---|---|
| **周榜**（week × repo/org × flow/stock） | **独立周页 `/rankings/YYYY/W##`** + 月/年页内周摘要 section（链到周页） | 已独立成页 |
| **月榜 / 年榜**（month/year × …） | 月度页 / 年度页主体 | 已独立成页 |
| **Org 榜**（org 维度） | Org 详情页 `/o/:login` + 各 period 页内 org section | Org 详情页已独立 |
| **全时榜**（all-time × repo/org × stock） | **独立页 `/rankings`** | 已独立成页 |

> 这套矩阵比旧设计的 ~5,400 页（纯 repo 月度编年史）**多得多**：org 页可能数千、全时榜独立、周榜独立。分片数学先按基础 canonical path 基数估算，再乘以 7 个 locale URL（见 §4 / §10）。

### 1.3 收录目标量级（估算）

| 维度 | 首页 | 年 | 月 | repo | org | rankings + about + compare | 上表小计 |
|---|---|---|---|---|---|---|---|
| 基础 canonical path 数 | 1 | ~11 | ~132 | 5,300+（the tracked set） | ~1,500（估） | ~3 | **~6,900** |

> 上表小计 ~6,900 是基础 canonical path 基数，**未含周页、`/pulse`、owner 索引分页、category 分页**；加上这些可爬入口后，当前每个 locale sitemap 约按 **~10k URL** 规划，总可收录 URL 约为该基础 path 清单 × 7。具体数随 org 白名单（含 User owner）与 category count 浮动。

---

## 2. 规范：标题 / 描述 / canonical 模板（每页类型逐一给例）

**全局约定**：

- `metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL)`（见 [OPS.md](./OPS.md)，生产 = `https://gitstarclub.com`），所有相对 URL 据此解析为绝对 URL。
- 共享 `web/app/_shell/RootShell.tsx` 与两个 route-group layout 设置站点 metadata 基础；各页用 `title`（字符串）或 `title.absolute`（首页用 absolute，避免重复后缀）。各页 metadata 由 `web/lib/seo.ts` 的 `pageMeta(...)` 工具统一构造（注入 `canonical` / `openGraph.url` / `twitter.images` / 默认 OG card）。
- 根 layout 还根据 `SITE_INDEXABLE` 全局发 `robots: { index, follow }`：默认 `false`（预发期 noindex），见 §5 / §11。
- **每页 canonical 指向当前 locale 自身规范 URL**：English 保持无前缀，非默认 locale 使用前缀；`pageMeta()` 统一输出 `hreflang` / `x-default` alternate（见 §10）。
- 标题含**真实搜索词**：`star history` / `trending` / 年份 / repo / org 名 / `ranking`。描述 ≤ 155 字符、含数字与具体实体、首句即价值。

> Next.js 16 实现：静态页用 `export const metadata`；依赖 `params` 的动态页用 `export async function generateMetadata({ params })`（`params` 是 Promise，需 `await`）。用 React `cache()` 包装 JSON 视图读取，让 `generateMetadata` 与页面 body **共享同一次数据读取**（去重）。

### 2.1 首页 `/`

实际实现（`web/app/(en)/page.tsx` + `web/app/_localized/pulse.tsx`，经 `pageMeta(...)` 工具构造，`absoluteTitle: true` 跳过站点后缀模板；Pulse title/description 副本来自 `web/lib/site-copy.ts`）：

| 字段 | 值 |
|---|---|
| title | `Open Source Pulse & GitHub Star History · GitStarClub`（`absolute`，不附加 `· GitStarClub` 后缀） |
| description | `See the current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub projects, plus all-time star rankings.` |
| canonical | `/` |

- 含词：`Open Source Pulse`、`GitHub Star History`、`fastest-rising`、`star rankings`。

### 2.1a 脉搏页 `/pulse`

实际实现（`web/app/(en)/pulse/page.tsx` + `web/app/_localized/pulse.tsx`，`export const revalidate = false`，与首页复用同一 view，但**不带** `includeWebsiteLd` ⇒ 无 `WebSite` JSON-LD，见 §6.1；title/description 副本来自 `web/lib/site-copy.ts`）：

| 字段 | 值 |
|---|---|
| title | `Open Source Pulse & GitHub Star History`（非 `absolute` ⇒ root layout 追加 `· GitStarClub` → 最终 `Open Source Pulse & GitHub Star History · GitStarClub`） |
| description | `See the current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub projects, plus all-time star rankings.` |
| canonical | `/pulse` |

```ts
export const revalidate = false;
export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: PULSE_META_TITLE,
    description: PULSE_META_DESCRIPTION,
    path: "/pulse",
    locale: "en",
  });
}
```

- 含词：`Open Source Pulse`、`Weekly` / `Monthly` / `Yearly`、`GitHub Movers`、`fastest-rising`。
- 作为「最新动态」入口（§1 收录优先级「高」）；不设 `ogImage` ⇒ 回退站点默认 OG card（见 §13）。
- 已在 sitemap 中（§4.1 覆盖 `/pulse`）。

### 2.2 年度页 `/rankings/2024`

实际实现（`web/app/(en)/rankings/[year]/page.tsx` + `web/app/_localized/ranking-detail.tsx`）：

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

实际实现（`web/app/(en)/rankings/[year]/[period]/page.tsx` + `web/app/_localized/ranking-detail.tsx`，`[period]` 段同时承载月与周，由 `^W(\d{1,2})$/i` 分流）：

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

实际实现（English adapter `web/app/(en)/[locale]/[owner]/page.tsx`、localized adapter `web/app/(localized)/[locale]/[owner]/[name]/page.tsx`、共享 `web/app/_localized/repo.tsx`）：

| 字段 | 模板（`anthropics/claude-code`，已找到 entity） |
|---|---|
| title | `anthropics/claude-code — Star History & Timeline` |
| description | `Star history for anthropics/claude-code: 98,432 stars. Growth curve, exact 10k/50k/100k milestones, monthly star gains, and ranking history.` |
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
    description: `Star history for ${repo.full_name}: ${repo.current_stars.toLocaleString()} stars. Growth curve, exact 10k/50k/100k milestones, monthly star gains, and ranking history.`,
    path: `/${repo.full_name}`,
    locale: "en",
    ogImage: `/${repo.full_name}/opengraph-image`,
  });
}
```

- **repo 名是最强搜索词**：用户直接搜 `<repo> star history`。title 把 `owner/name` 放最前。
- `current_stars` 用 `toLocaleString()` 加千分逗号（无 "as of" 日期——目前不在 description 里硬编日期，避免冷月每日刷描述）。
- **改名 / 迁移**：URL 用当前 `full_name`；旧 URL 做 **308 永久重定向**（见 [PRODUCT.md](./PRODUCT.md) repo 身份）→ canonical 永远指向当前规范 URL，避免重复内容。
- **未知 repo**：`generateMetadata` 返回兜底 meta（`title = '<fullName> — Star History'`），页面 body 调 `notFound()` 触发 404 UI + 状态码（见 §3.2）。

### 2.5 Org 详情页 `/o/:login`

实际实现（`web/app/(en)/o/[login]/page.tsx` + `web/app/_localized/org.tsx`，按 `owner_type` 切换 `Organization` / `Developer`）：

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

实际实现（`web/app/(en)/rankings/page.tsx` + `web/app/_localized/rankings.tsx`，静态 + 每日 revalidate）：

| 字段 | 值 |
|---|---|
| title | `All-Time GitHub Star Rankings — Most-Starred Repos & Orgs` |
| description | `The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across ${trackedYears} years.` |
| canonical | `/rankings` |

```ts
export async function generateMetadata(): Promise<Metadata> {
  const trackedYears = currentUtcPeriods().year - FIRST_YEAR + 1;
  return pageMeta({
    title: "All-Time GitHub Star Rankings — Most-Starred Repos & Orgs",
    description: `The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across ${trackedYears} years.`,
    path: "/rankings",
    locale: "en",
  });
}
```

- 若派生切片（如 `/rankings?metric=org` 或 `/rankings/org`）**待定 PRODUCT**；**canonical 去重见 §7**（避免 repo / org 两视图互为重复内容）。

### 2.7 关于页 `/about`

实际实现（`web/app/(en)/about/page.tsx` + `web/app/_localized/about.tsx`）：

| 字段 | 值 |
|---|---|
| title | `About — Data Sources & Methodology`（站点后缀 ` · GitStarClub` 由 root layout 的 `title.template` 自动追加，最终为 `About — Data Sources & Methodology · GitStarClub`） |
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

### 2.7a 分类页 `/categories/...`

实际实现（`web/app/categories/`，registry-driven static/ISR pages）：

| 字段 | 值 |
|---|---|
| title | `/categories` 为 `GitHub Repository Categories`；详情页为 `<Category> GitHub Repository Rankings` |
| description | 说明按 language / ecosystem / domain / project type / owner kind / maturity 浏览 tracked repositories |
| canonical | `/categories`、`/categories/[dimension]`、`/categories/[dimension]/[slug]` 各自指向自身规范 URL；分类详情 page 2+ 指向 `/categories/[dimension]/[slug]/page/[page]` 自身 |
| JSON-LD | `CollectionPage`，URL 使用规范路径 |

```ts
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() {
  return publicCategoryStaticParams(await getCategoryRegistry());
}
```

- `/categories`、公开维度页、公开 category 详情页与详情分页页进入 sitemap。
- 详情页预渲染 priority language slugs 加公开 registry category；分页页按 category count 预渲染 page 2+，`dynamicParams = true` 保持后续公开 registry category 可按需生成。
- 不公开或低量 category 不应返回 200；页面逻辑通过 registry `public` 标记决定是否 `notFound()`。

### 2.8 对比页 `/compare`

实际实现（`web/app/(en)/compare/page.tsx` + `web/app/_localized/compare.tsx`，`export const dynamic = "force-static"`，全量静态壳 + 客户端读 `?repos=` 渲染）：

| 字段 | 值 |
|---|---|
| title | 源码传入 `'Compare GitHub Star History'`；根 layout 的 `title.template = '%s · GitStarClub'` 追加品牌 → 最终 `<title>` = `Compare GitHub Star History · GitStarClub` |
| description | `Overlay the star-history curves of any tracked repositories (≥10k stars) on one chart — absolute or aligned from 10k.` |
| canonical | `/compare`（**始终**指向无参版本，参数页通过 canonical 折回） |

```ts
export const dynamic = "force-static";
export function generateMetadata(): Metadata {
  return pageMeta({
    title: "Compare GitHub Star History",
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

> UI chrome 与页面正文按 route locale 服务端渲染，构建路由表保持 `○`（静态）/ `●`（按需 ISR），不存在 `ƒ`（force-dynamic）。见 [FRONTEND.md](./FRONTEND.md) §2.5（渲染模式：route locale + 服务端本地化 HTML）。**对 SEO 的关键含义**：每个 locale URL 输出对应语言的**完整可索引 HTML**（§3.1a），且 ISR 持久缓存 / CDN 共同扛量。

**渲染模型**（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 页面分层）：deploy 只构建**小核心**（首页 / 当年 / 当月 / 全时榜，以及对应 locale 的热表面）；历史 / repo / org 页是**按需 ISR**——`dynamicParams = true` 且 `generateStaticParams` 返回空（或仅当年/当月）⇒ 不在 deploy 全量构建，首访时按 route locale 生成、存入 Vercel 持久 ISR store，后续命中缓存。

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
- **改名旧 URL → 308 永久重定向**：永久重定向到当前 `full_name`（见 [PRODUCT.md](./PRODUCT.md)）（repo 路由据 `lookup/aliases.json` 实现，见 [FRONTEND.md](./FRONTEND.md)）。

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

**当前态**：sitemap 已改为 `/sitemap.xml` index + 7 个 per-locale XML route handlers；`lastModified` 仍按 URL 类型从真实数据日期派生（见 §4.2）：历史年/月/周取对应期末日并以发布数据时间封顶，category 路径取 registry `generated_at`，repo / org / 核心页取当前发布视图的 `meta.backfilled_at` / `meta.generated_at`。当前 lookup 契约没有 repo/org 实体级 `updated_at`，所以 repo/org 尚不能表达「该实体最后活跃日」；未来若在契约中增加该字段，再收紧到实体级日期。

### 3.4 配置要点（与 ARCHITECTURE 对齐）

- **`cacheComponents` 关闭**：开启会改变 `dynamicParams` / 空数组语义（空 `generateStaticParams` 会 build 报错，需占位 param——与我们"长尾全按需"冲突）。MVP **保持关闭**。
- 长尾段 `revalidate = false`：不做时间轮询失效，仅靠 Vercel Workflow 重算发布后的 `revalidatePath` 定点失效（base 数据视图仅 Workflow 发布新版本时才变）。
- **热集 ISR 只读 KB 级 `hot-snapshot.json`**：绝不在请求路径加载 Parquet / DuckDB / 引擎（见 ARCHITECTURE）。
- **Streaming metadata**：Next.js 16 对**可执行 JS 的爬虫**（如 Googlebot）会把 `generateMetadata` 流式注入 DOM、Google 能正确解析；对 **HTML-limited 爬虫**（`facebookexternalhit` / `Slackbot` / `Bingbot` / `Twitterbot`）则**阻塞渲染、把 meta 放进 `<head>`**。我们的 `generateMetadata` 不依赖运行时数据（只读已预算 JSON），可被预渲染进初始 HTML，**社交抓取与搜索引擎都拿得到完整 head**。无需改 `htmlLimitedBots`。

---

## 4. sitemap：sitemap index + per-locale XML（每个 locale 约 ~10k URL）

> **Sitemap 协议硬限**：单文件 ≤ **50,000 URL** 且 ≤ **50MB（未压缩）**。当前 sitemap 按 locale 拆成 7 个文件；每个 locale 文件约 ~10k URL，低于单文件上限，总 URL 量约为基础 canonical path 数 × 7。

### 4.1 当前实现（显式 XML route handlers）

实际入口：

```txt
/sitemap.xml       -> web/app/sitemap.xml/route.ts
/sitemap-en.xml    -> web/app/sitemap-en.xml/route.ts
/sitemap-ja.xml    -> web/app/sitemap-ja.xml/route.ts
/sitemap-zh.xml    -> web/app/sitemap-zh.xml/route.ts
/sitemap-zh-TW.xml -> web/app/sitemap-zh-TW.xml/route.ts
/sitemap-ko.xml    -> web/app/sitemap-ko.xml/route.ts
/sitemap-es.xml    -> web/app/sitemap-es.xml/route.ts
/sitemap-fr.xml    -> web/app/sitemap-fr.xml/route.ts
```

特征：

- `/sitemap.xml` 是 sitemap index，列出 7 个 locale sitemap 文件。
- 每个 locale sitemap 枚举同一组 canonical paths：English 输出无前缀 URL，非默认 locale 输出 `/ja`、`/zh`、`/zh-TW`、`/ko`、`/es`、`/fr` 前缀 URL。
- 每个 `<url>` 都带完整 `xhtml:link rel="alternate"` 集合，包含自身、其它 locale，以及 `x-default` -> English 无前缀 URL。
- 覆盖路径：首页 `/`、`/pulse`、`/rankings`、`/compare`、`/categories`、`/about`，每年 `/rankings/YYYY`，每年每月 `/rankings/YYYY/MM`，有效 ISO 周页 `/rankings/YYYY/W##`，所有 repo `/{owner}/{name}`，`/o` 组织索引与 `/o/page/[page]`，所有 org `/o/{login}`，以及 `lookup/categories.json` 标出的公开 category 路径和 category 分页路径；显式 `sitemap: false` 的 category 不枚举。
- 路径枚举、locale URL、alternate、`lastModified`、`changeFrequency`、`priority` 与 XML serialization 都集中在 `web/lib/sitemap.ts`；route handler 数据读取在 `web/lib/sitemap-routes.ts`，读取缓存为 86400 秒。

### 4.2 `lastModified` 的当前取值

```ts
return paths.map((p) => ({
  url: `${BASE}${p}`,
  lastModified: sitemapLastModified(p, { meta, categories }),
  changeFrequency: sitemapChangeFrequency(p),
  priority: sitemapPriority(p),
}));
```

- **基础数据日期**：`resolveSitemapLastModified(meta)` 仍解析 `meta.backfilled_at`（bootstrap）→ `meta.generated_at`（versioned workflow meta）→ 固定 fallback `2026-06-04T00:00:00.000Z`。fallback 只用于异常路径，正常发布使用真实 meta 时间。
- **rank 历史页**：`/rankings/YYYY`、`/rankings/YYYY/MM`、`/rankings/YYYY/W##` 取该年 / 月 / ISO 周期末日，并用基础数据日期封顶，避免未来期或尚未发布的数据日期进入 sitemap。
- **category 路径**：`/categories*` 取 `lookup/categories.json` 的 `generated_at`；缺失或无效时回退基础数据日期。
- **repo / org / 核心页**：当前 lookup 与 entity 契约没有暴露实体级 `updated_at`，所以这些 URL 使用当前发布视图的基础数据日期；这是比硬编码 fallback 更准确的真实发布数据日期，但不是最后活跃日。
- **不回退到 `new Date()`**：缺 meta 或时间戳无效时也使用固定 fallback，避免每次 build 抖动并误导爬虫判断全站变化。

### 4.3 未来分片结构（规模逼近 50k 时再实现）

Next.js 16 `app/.../sitemap.ts` 的 `generateSitemaps()` 返回 `[{ id }]`，分片产物 URL 为 **`/<route>/sitemap/<id>.xml`**（v16：`id` 在默认导出里是 Promise，需 `await props.id`）。规划：

```text
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

- **输出 locale alternate**：每个 `<url>` 都包含完整 `xhtml:link rel="alternate"` 矩阵；`x-default` 永远指向 English 无前缀 URL（见 §10 与 [I18N.md](./I18N.md)）。
- **sitemap 自身是 Route Handler、默认被缓存**：除非用 request-time API。我们的 sitemap 只读已预算 JSON，可被静态缓存；数据由 Vercel Workflow 重算发布后，经 `revalidatePath` / 部署刷新即可。
- **priority/changeFrequency 是弱信号**：Google 基本忽略 `priority`，`changeFrequency` 仅作提示；**真正决定复抓的是 `lastModified` + 实际内容变化**——所以 §3.3 的稳定性最关键。

### 4.5 当前 sitemap 的已知缺口

| 项 | 现状 | 影响 | 处理 |
|---|---|---|---|
| repo / org 实体级活跃日期 | lookup 契约未暴露 | repo/org 仍只能用发布数据日期，不能表达最后活跃日 | 若 GSC 显示抓取预算浪费，再在数据契约中增加实体级 `updated_at` 并接入 sitemap |
| `meta` 缺失或时间戳无效 | 异常路径 | 已使用固定 fallback，避免 sitemap 按每 build 抖动 | 若 GSC 显示 fallback 过旧影响发现，再改为 hard-fail 或显式 env 日期 |

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
- **不屏蔽任何内容页**：每个 locale 约 ~10k URL 全要被抓；爬虫预算靠 §3.3 稳定 `lastModified` + §9 内链结构 + per-locale sitemap 分片共同消化。
- **屏蔽 `/api/`**：cron / 内部 route 不该被抓（真正防线是 `CRON_SECRET` 鉴权，见 [OPS.md](./OPS.md)；robots 只是减少噪声）。
- **`/search-index`、`/repo-curve`（顶级 JSON 端点）故意放行**：均不在 `/api/` 下，故 `Disallow: /api/` 不覆盖它们。两者的 endpoint contract 见 [API.md](./API.md)；`robots.ts` 只 `Disallow: /api/`、不屏蔽这两者（CDN JSON、非内容页、对 SEO 无害）。若需拦爬虫抓这些 JSON，在 `robots.ts` 把 `/search-index`、`/repo-curve` 加到 Disallow 即可。
- **Preview deployment 的处理**：Preview 默认就 `SITE_INDEXABLE` 未设 → `Disallow: /`；再叠加 root layout 的 `robots: { index: false, follow: false }` meta（同一总开关驱动），共防一处。Preview 还需在 Vercel 项目设 Deployment Protection（PRIVATE），见 §11。
- `host` 字段声明规范主机（少数爬虫用作镜像归并提示）。

---

## 6. JSON-LD 结构化数据（schema.org，每页类型逐一）

> 目的：①Google 富结果（主要是面包屑）；②给 LLM / AI Overviews 喂结构化事实（repo star 数 / 站点描述），抢 AI 答案位。用 `<script type="application/ld+json">` 注入（服务端渲染进 HTML，非客户端）。
>
> **Current implementation source of truth is `web/lib/jsonld.ts`**: `webSiteLd` (home `WebSite`), `siteOrganizationLd` (site `Organization`), `repoLd` (repo `SoftwareSourceCode` + star `interactionStatistic`), `orgLd` (owner `Organization` / `Person`), `collectionLd` (ranking/category/org-index `CollectionPage`), `itemListLd` (rankings / categories / org index `ItemList`), `datasetLd` / `datasetRef` (Dataset JSON-LD), and `faqPageLd` (visible FAQ schema). `BreadcrumbList` **does not live inside those builders**; `Breadcrumbs.tsx` emits it separately (see §6.7). `SearchAction` is still intentionally omitted because the site has no canonical `/search?q=` results page.

### 6.1 首页：`WebSite`（仅首页，不在根 layout）

**实际实现**：`WebSite` JSON-LD **只在首页 `/` 注入**，通过共享 `web/app/_localized/pulse.tsx` 的 `includeWebsiteLd` prop 控制；`web/app/(en)/page.tsx` 传入该标记，`/pulse` 不传。**根 layout 不注入** `WebSite`——历史 / repo / org / `/rankings` 等其它页面没有 `WebSite` ld，只各自挂自己的 `CollectionPage` / `SoftwareSourceCode` / `Organization` / `Person`（见 §6.3–6.6）。

实际输出（`web/lib/jsonld.ts` 的 `webSiteLd(locale, path)`）：

```jsonc
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "GitStarClub",
  "url": "https://gitstarclub.com/",      // abs(path)，首页 path = "/"
  "inLanguage": "en",                      // route locale（见 §10）
  "description": "GitHub star history & trends across 5,300+ repositories with ≥10k stars."
  // 不输出 potentialAction / SearchAction：搜索是客户端 combobox、直达
  // /{owner}/{name}，无规范结果页 URL 可供 SearchAction 广告（见下注）
}
```

> 全站搜索是**导航栏客户端 combobox**（首次聚焦懒加载 `search/index.json` + MiniSearch，命中直达 `/{owner}/{name}`），**没有 `/search?q=` 结果页 URL**。`SearchAction` 的 `urlTemplate` 必须指向一个可返回结果列表的规范页面——本站没有，故 `potentialAction` / `SearchAction` **不输出**（绝不广告一个指向不存在页面的 urlTemplate）。`WebSite` 本体只在首页输出（Google 的 site-name 信号通常依赖首页的 `WebSite` ld）。若未来新增 `/search` 结果页，再补 `SearchAction`。

### 6.2 Home page: `Dataset`

Current implementation: the home page now emits Dataset JSON-LD through `datasetLd(...)` in `PulseView`, alongside the home `WebSite` schema. `webSiteLd(...)` links to the page Dataset with `about: datasetRef("/")`, and the Dataset carries `creator`, `publisher`, `license`, `isAccessibleForFree`, `variableMeasured`, `measurementTechnique`, and optional `dateModified` from real Blob metadata. The `/pulse` page uses the same component with `/pulse` as the Dataset path.

Dataset enrichment details, including future `DataDownload` `distribution` entries and `temporalCoverage`, are owned by [GEO.md §11](./GEO.md#11-geo-deepening-round). SEO keeps ownership of classic crawl, canonical, metadata, sitemap, and internal-link mechanics.

### 6.3 Repo 详情页：`SoftwareSourceCode` + `BreadcrumbList`

实际输出（`web/lib/jsonld.ts` 的 `repoLd(repo, path, locale)`）——`@type` 为 **`SoftwareSourceCode`**，**不输出 `Dataset`、不输出 `temporalCoverage`**；star 数通过 **`interactionStatistic`（`InteractionCounter`）** 表达：

```jsonc
{
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "name": "anthropics/claude-code",                       // repo.full_name（完整带 owner）
  "url": "https://gitstarclub.com/anthropics/claude-code",
  "codeRepository": "https://github.com/anthropics/claude-code",
  "sameAs": ["https://github.com/anthropics/claude-code"], // 数组；repo.homepage_url 存在时追加
  "inLanguage": "en",                                      // locale
  "programmingLanguage": ["TypeScript"],                   // 仅当非空时输出（剔除 "Unknown"）
  "description": "...",                                     // 仅当 repo.description 存在时输出
  "dateCreated": "2024-02-01T00:00:00Z",                   // repo.created_at，仅当存在时输出
  "interactionStatistic": {
    "@type": "InteractionCounter",
    "interactionType": "https://schema.org/LikeAction",
    "userInteractionCount": 98432                          // repo.current_stars（star 数）
  }
}
```

> repo 页的结构化主体是 `SoftwareSourceCode`：`codeRepository` 关联 GitHub 源，`sameAs` 数组始终包含 GitHub repo URL，并可包含 repo entity JSON 中已有的 `homepage_url`；`programmingLanguage` / `description` / `dateCreated` 为条件字段，star 数走 `interactionStatistic` 的 `InteractionCounter`（`LikeAction`）。**没有独立的 `author` 节点**（owner 关系靠 `full_name` 与 §9 内链）。repo 页另由 `Breadcrumbs.tsx` 单独输出 `BreadcrumbList`（见 §6.7）。

### 6.4 Org 详情页：`Organization` / `Person` + `BreadcrumbList`

实际输出（`web/lib/jsonld.ts` 的 `orgLd(org, path, locale)`）——按 `owner_type` 在 `Organization` / `Person` 间切换，**不输出 `ItemList`**：

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Organization",                  // owner_type==="Organization" → Organization，否则 Person
  "name": "vercel",                          // org.login
  "url": "https://gitstarclub.com/o/vercel",
  "sameAs": ["https://github.com/vercel"],   // 数组；GitHub owner URL 必有，approved registry 可追加
  "inLanguage": "en"                         // locale
}
```

> 个人 owner（`owner_type=User`）用 `@type: Person` 替代 `Organization`（按数据切换）。`sameAs` 只从 GitHub owner URL 与 `web/lib/jsonld.ts` 中的 approved static registry 生成，不抓取外部 profile。该 org 的 top repo 列表**不以 `ItemList` 结构化输出**，靠页面正文行 + §9 内链被发现。org 页另由 `Breadcrumbs.tsx` 输出 `BreadcrumbList`。

### 6.5 月度页 / 年度页：`CollectionPage` + `ItemList` + `BreadcrumbList`

实际输出（`web/lib/jsonld.ts` 的 `collectionLd(name, path, locale)`）——`CollectionPage` 仍只保留三字段，**不输出 `datePublished` / `dateModified` / `isPartOf`**：

```jsonc
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "October 2024 GitHub Star Rankings",   // 调用方传入的 name
  "url": "https://gitstarclub.com/rankings/2024/10",
  "inLanguage": "en"                              // locale
}
```

> 月/年/周页同时用 `itemListLd(...)` 输出与正文榜单同源的 `ItemList`。年页和月/周页先展示顶部切片，并在同页提供 `#complete-ranking` 完整榜单锚点；`ItemList` 使用完整服务端 rank 行，`position` 与正文排名一致。`collectionLd` 不带任何日期字段，因此历史页与当月页的结构化数据无 `dateModified` 抖动问题。月/年页另由 `Breadcrumbs.tsx` 输出 `BreadcrumbList`（Home → 年 →〔月〕）。

### 6.6 全时榜 `/rankings`：`CollectionPage` + `ItemList`

- 复用 `collectionLd(...)` 输出单个 `CollectionPage`（`name` / `url` / `inLanguage`）。
- 同页输出两个 `ItemList`：repo 全时榜 `/{owner}/{name}`，org 全时榜 `/o/{login}`。两者都来自已渲染的服务端行，不引入客户端计算。
- category index、category dimension、category detail/page N、org index/page N 也用 `itemListLd(...)` 描述当前列表项；category detail 的 `startPosition` 与分页排名偏移一致。

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
| repo 改名产生的新旧 URL | 旧 URL **308** → 新 URL；canonical 永远当前 `full_name`（见 §2.4 / [PRODUCT.md](./PRODUCT.md)）。 |
| 语言版本 | English 无前缀，非默认 locale 使用前缀 URL；同一 canonical path 的所有 locale URL 通过 hreflang 互指，`x-default` 指 English。 |
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

## 9. 内链图（爬虫消化 ~10k 页的关键，配合 sitemap）

> 目标：**任意页 ≤ 3 跳可达**；按需 ISR 页除 sitemap 外还能被内链发现 / 触发生成。内链是"爬虫预算的导流"，sitemap 是"全量清单"，两者缺一不可。

```text
首页 /
 ├─ 年份脊柱（2015…当前）──────────────→ 各年度页 /rankings/YYYY （1 跳到任意年）
 ├─ 本月聚焦 TOP / 增速 ────────────────→ repo 详情页 /:owner/:name （1 跳到热门 repo）
 ├─ 历史上的今天（里程碑）──────────────→ repo / 对应月度页
 ├─ 全时榜入口 ─────────────────────────→ /rankings
 └─ Footer ─────────────────────────────→ /categories / /o

年度页 /rankings/YYYY
 ├─ 12 个月份格子 ─────────────────────→ 月度页 /rankings/YYYY/MM （1 跳到任意月）
 ├─ 年度 TOP 行（repo 名）──────────────→ repo 详情页 /:owner/:name
 └─ Complete ranking 锚点 ─────────────→ 同页完整榜单

月度页 /rankings/YYYY/MM
 ├─ 三大榜单每行 repo 名 ───────────────→ repo 详情页 /:owner/:name
 └─ Complete ranking 锚点 ─────────────→ 同页完整 flow 榜单

repo 详情页 /:owner/:name
 ├─ 里程碑（每 50k stars）──────────────→ 对应月度页锚点 /rankings/YYYY/MM#..
 ├─ 月度表现表（近 N 月，每行）──────────→ 对应月度页
 ├─ owner 链接 ─────────────────────────→ org 详情页 /o/owner    （repo↔org 互链）
 ├─ category links ─────────────────────→ 所属 language / topic category
 ├─ related repositories ───────────────→ 同 owner 或同主语言 repo
 └─ 名次史 ─────────────────────────────→ 对应 period 页

org 详情页 /o/login
 ├─ top repo 列表（每行）───────────────→ repo 详情页 /login/:name （org→repo）
 ├─ 月度 org 表现 ──────────────────────→ 对应月度页
 └─ 全时 org 名次 ──────────────────────→ /rankings

org 索引 /o 与 /o/page/N
 ├─ 每行 owner ─────────────────────────→ org 详情页 /o/login
 └─ prev/next + 页码 ───────────────────→ 全部 owner 分页

全时榜 /rankings
 ├─ repo 榜每行 ────────────────────────→ repo 详情页
 └─ org 榜每行 ─────────────────────────→ org 详情页

分类详情 /categories/dimension/slug
 ├─ 每行 repo ──────────────────────────→ repo 详情页
 ├─ prev/next + 页码 ───────────────────→ 分类深分页
 ├─ Browse all 锚点 ────────────────────→ 同页 pagination
 └─ related categories ────────────────→ 同维度其他分类
```

**关键边（必须实现）**：

| 边 | 作用 |
|---|---|
| 年份脊柱（首页 → 各年） | 全部年页 1 跳可达 |
| 月份格子（年 → 各月） | 任意月 ≤ 2 跳 |
| 榜单行 → 实体（repo/org） | 长尾详情页被发现 + 触发 ISR；**这是 repo/org 页的主发现路径** |
| 里程碑 / 月度表 → 月度页 | repo 页反哺月页、形成网状回环 |
| repo ↔ org 互链（owner 字段） | org 页被 repo 页发现，反之亦然 |
| repo → category / related repositories | repo 长尾反哺主题页与同类 repo，减少单纯 sitemap 发现 |
| `/o` 分页索引 → org | 所有 owner 至少有一条可爬站内入链，降低 sitemap-only 孤岛 |
| 分类详情分页 → repo | category 第 101+ 成员获得主题枢纽页入链，page 1 canonical 不被破坏 |
| rankings 完整榜单锚点 | 年/月/周 detail 页顶部切片之外的 rank 行也可被同页发现 |
| Footer → `/categories` / `/o` | 全站每页提供分类与 owner 目录入口 |
| prev/next（上下月、上下年） | 时间轴横向连通、降低孤岛 |
| 面包屑（§6.7） | 每页向上回链，纵向连通 |

- **深度核对**：首页→年（1）→月（2）→repo（3）= 3 跳；首页→全时榜（1）→repo（2）；首页→热门 repo（1）→owner org（2）；任意页→Footer `/o`（1）→任意 org（2+分页）；任意页→Footer `/categories`（1）→分类（2）→分类分页 repo（3+分页）。核心长尾入口达成。
- **孤岛风险**：早已沉寂、从未进入任何近期榜单的 repo/org —— 靠 ①sitemap 枚举（必达）②历史 rank 完整榜单 ③`/o` owner 索引 ④category 详情分页 ⑤repo related hub 五层兜底。

---

## 10. 多语言策略（locale URL / hreflang / sitemap）

> 服务器端多语言 URL 已落地：English 无前缀，非默认 locale 有前缀 URL；页面正文、metadata、middleware、语言切换导航、canonical、hreflang 与 sitemap 已统一到这套 route-locale 架构。`gsc_lang` cookie 仅保留为 middleware / `/api/lang` 的偏好重定向信号。

| 维度 | 规则 |
|---|---|
| URL | English 保持无前缀（`/rankings/2024/10`、`/owner/name`）；非默认 locale 使用前缀（`/ja/rankings`、`/zh-TW/owner/name`） |
| canonical | 指当前 locale 自身规范 URL；`x-default` 指 English 无前缀 URL |
| SEO 语言 | English 是默认 / `x-default`；非默认 locale URL 的页面正文、meta / OG 文案、JSON-LD `inLanguage` 与 chrome 由 route dictionary 服务端输出；JSON-LD 页面 URL、Dataset `@id`、BreadcrumbList 与内部 ItemList 子项都使用当前 locale 的规范 URL，外部 identity / 下载 URL 保持语言中立 |
| 其它语言 | en/ja/zh/zh-TW/ko/es/fr 有独立 URL 与 hreflang alternate；同一 canonical path 的所有 locale URL 互指 |
| 翻译范围 | UI chrome / 导航 / 年度标签 / About / 面包屑名 / 确定性 Narrative；**不翻译** repo 名 / 描述 / 语言 / topic / 数值本身（数据语言中立），但可见数字与日期按 active locale 格式化。产品功能名 **GitStarClub Pulse** / **GitStarClub Compare** 作为品牌名不翻译 |
| og:locale | 由 `web/lib/i18n/routing.ts` 映射：`en_US`、`ja_JP`、`zh_CN`、`zh_TW`、`ko_KR`、`es_ES`、`fr_FR` |

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

代码（`web/app/_shell/RootShell.tsx`）：

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

> 内容页为 `○` 静态 / `●` 按需 ISR（route locale 服务端本地化 HTML，见 [FRONTEND.md](./FRONTEND.md) §2.5），TTFB / 缓存走纯静态 / ISR 命中；正文零客户端 JS、HTML 体积控制在阈值内。

SSG + 零客户端 JS + HTML < 20KB 天然满足（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 性能策略 + 用户 web/performance 规则）：

| 指标 | 目标 | 本站达成方式 |
|---|---|---|
| **LCP** | < 1.5s（优于 Google「good」2.5s 阈） | 静态 HTML 走 Edge CDN + 预加载 hero 字体；无客户端 JS 渲染阻塞 |
| **CLS** | < 0.05 | 图表 SVG 尺寸固定（`width`/`height` 显式）、字体 metric override（避免 FOUT 位移） |
| **INP** | 极低 / 近 0 | 内容页几乎无 JS，无长任务 |
| **FCP** | < 1.0s | 内联关键 CSS、字体子集化 woff2（Plus Jakarta Sans 子集 ~30KB） |
| **TTFB** | 低 | 99.99% 命中边缘缓存；ISR 冷启动仅读 KB JSON（见 §3） |

- **图片**：OG 图由 `next/og` 路由现绘 + ISR / CDN 缓存（见 §13），命中后不重复消耗 Function；页内若有图一律显式尺寸 + `loading=lazy`（below-fold）。
- **字体**：最多两家族（Plus Jakarta Sans + Geist Mono）、`font-display: swap`、子集化；仅 preload 正文 Plus Jakarta，Geist Mono 延后加载。
- **缓存头**：历史页 `Cache-Control: s-maxage=86400, stale-while-revalidate`（见 ARCHITECTURE）。
- **移动优先索引**：Google 用移动版索引——SSG 响应式、无移动专属阻断；确保移动视口 meta（Next.js 默认注入）与触控可达。

> CWV 是**真实排名因子**（Page Experience），且本站零 JS 架构使其几乎"免费"达标——这是相对动态 dashboard 竞品的结构性优势，应在内容相关性之外作为护城河维护（持续用 Speed Insights 监控，见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。

---

## 13. OG / 社交卡片（石墨灰 + 星金）

> 配色为「石墨灰 + 星金」（见 [PRODUCT.md](./PRODUCT.md) 配色）。

**生成与存储**（见 [ARCHITECTURE.md](./ARCHITECTURE.md) / [OPS.md](./OPS.md)）：

- OG 图（1200×630）用 **`next/og` 的 `ImageResponse`（底层 Satori + resvg）** 生成，承载在 **`opengraph-image.tsx` 文件约定的 Route Handler** 里；4 个现有 OG route 均导出 `revalidate=86400`。
- **没有 Blob 支撑的 OG pipeline**：卡片不在 pipeline 侧增量生成、也不存 Vercel Blob（`blob://og/...`），更不在每次 build 全量出图。它们在**请求 / ISR 时按路由现绘**，随路由段一起进 Vercel 持久 ISR store + CDN 缓存，后续命中即取缓存（与正文页同一缓存模型，见 §3）。
- 页面 meta 的注入由 `web/lib/seo.ts` 的 `pageMeta(...)` 统一完成：`openGraph.images` / `twitter.images` 设为 `opts.ogImage ?? "/opengraph-image"`，即一个**路由路径**（`<route>/opengraph-image` 或站点默认 `/opengraph-image`），经 `metadataBase` 解析为绝对 URL——**不是 Blob URL，也不绕过 Next.js 动态 OG route**（恰恰相反，正是走这个 route）。注意：`pageMeta` 显式传 `images` 是为了不让自定义 `openGraph` 覆盖文件约定卡片时把它吞掉。
- 字体：当前用 **`next/og` 默认字体**（★ 用内联 SVG `<path>` 绘制，因默认字体无 ★ 字形）；尚未接入 Plus Jakarta Sans / Geist Mono 子集。
- 配色（见 `web/lib/og-theme.ts`）：surface = 石墨灰深底 `#121316`；文字走 `on-surface #e3e2e6` / `on-surface-variant #c3c7cf` / `outline #8d9199`；accent = 星金（★ / 数字高亮用 `primary-fixed-dim #ffba3b`）。当前为**深色卡**。

> 注意：Satori 仅支持 flexbox + CSS 子集（**不支持 `display: grid`**），OG 模板用 flex 布局。

### 13.1 已实现的 OG 卡片（4 张；其余页回退站点卡）

> **现状：只实现 4 张卡片**，分别由 4 个 `opengraph-image.tsx` 路由产出。Org 页与全时榜 `/rankings` **不设自定义 `ogImage`** ⇒ `pageMeta` 回退到站点默认 `/opengraph-image`（站点卡），**没有专属卡**。早期设计列出的 6 张每页卡（含 org、全时榜专属）**未全部落地**。

| 页面 | OG 卡片 | 实现位置 | 内容（1200×630，flex 布局） | 文案搜索词对齐 |
|---|---|---|---|---|
| 站点默认 / 首页 / `/pulse` | **站点卡** | `web/app/opengraph-image.tsx`（`revalidate=86400`） | `GitStarClub.com` 大标题 + 「A chronicle of open source — more than a decade of GitHub star history across 5,300+ projects.」 | star history |
| Repo 页 | **repo 卡** | `web/app/(en)/[locale]/[owner]/opengraph-image.tsx`（`revalidate=86400`） | `owner/name` 大字 + 当前 star 数（`fmtStars`）+ 主语言（按 repo 现场读取，未知 repo 仅出名） | <repo> star history |
| 年度页 | **排名卡** | `web/app/(en)/rankings/[year]/opengraph-image.tsx`（`revalidate=86400`，共用 `og-card.tsx` 的 `rankingCard`） | 「<Year>」特大字 + 当年 stars-gained TOP 3 repo（金色 + `+N`） | github <year> trending |
| 月度页 / 周页 | **排名卡** | `web/app/(en)/rankings/[year]/[period]/opengraph-image.tsx`（`revalidate=86400`，共用 `rankingCard`，按 `^W(\d+)$` 分流月/周） | 「<Month Year>」/「<Year> · Week N」+ 该期 stars-gained TOP 3 | top github repos october 2024 |
| Org 页 | **（回退站点卡）** | 无专属路由（`pageMeta` 不传 `ogImage`） | 同站点卡 | <org> github stars |
| 全时榜 `/rankings` | **（回退站点卡）** | 无专属路由（`pageMeta` 不传 `ogImage`） | 同站点卡 | most starred github repos |

- **Twitter card**：`pageMeta` 设 `twitter.card = "summary_large_image"`；`twitter.title` / `twitter.description` / `twitter.images` 复用各页 meta 与上述卡片路由。
- **Open Graph**：`pageMeta` 输出 `og:title` / `og:description` / `og:url`（canonical）/ `og:image`（指卡片路由）/ `og:locale`。`og:type`（`website` vs `article`+published/modified time）与 `og:site_name` 由根 `app/layout.tsx` 的 metadata 统一提供，未在 `pageMeta` 内逐页设。
- **alt 文本**：各 `opengraph-image.tsx` 导出 `alt`（站点卡 `GitStarClub.com — A Chronicle of Open Source`；repo 卡 `GitHub star history`；排名卡 `GitHub star rankings`）。
- **静态 fallback 资产**：`assets/og.html` / `assets/icon.html` 是唯一渲染源，字体从锁定的 Next 依赖本地读取，不访问外部字体服务。先在 `web/` 执行 `bunx playwright install chromium`，再于根目录执行 `bun run assets:render`；该命令使用仓库锁定的 Playwright Chromium 生成 `assets/{og, favicon, apple-touch-icon}.png` 并同步 `web/public/`。`bun run assets:check` 会重新渲染并校验 1200×630 / 64×64 / 180×180 尺寸、源图漂移、缺失文件及 deployed-copy 字节漂移；提交前需人工查看三张生成图。`build.mjs` 也通过同一同步函数维护 Next 部署目录与被忽略的 legacy teaser `public/`。wordmark 与计数需保持 `GitStarClub.com` / `5,300+`，避免与动态 `opengraph-image.tsx` 分叉。

---

## 14. Search Console 运维

> 生产域名切换到 web 应用**之后**才操作（预览期绝不提交，见 §11）。

| 任务 | 操作 | 频率 |
|---|---|---|
| 验证站点 | GSC 加 `gitstarclub.com`（DNS 或 `metadata.verification.google` meta）；sitemap index 会发现各 locale sitemap | 一次 |
| 提交 sitemap | 提交 `https://gitstarclub.com/sitemap.xml`（index）；GSC 自动发现各分片 | 切换后 + 分片结构变更时 |
| 监控收录率 | Coverage / Pages 报告：盯 ①Discovered–not indexed（长尾未抓 → 检查内链/lastModified）②Crawled–not indexed（内容薄 → 加强页面价值）③Excluded by noindex（预览残留 → 清理） | 每周 |
| **ISR 冷启动考量** | GSC 抓取首个 URL 会触发该页 ISR 生成（首抓 TTFB 略高、属正常）；**关注首抓后是否 200 + 内容完整**，而非冷启动延迟本身 | 抽查 |
| hreflang 抽查 | 抽查 sitemap XML 与代表页 head：`x-default` 指 English，无前缀 English 与各 locale URL 互指 | Launch + locale changes |
| URL Inspection | 抽查 repo / org / 历史月页：实时抓取看渲染后 HTML 是否含正文 + JSON-LD（验证 §3a 可索引性） | 抽查 |
| Rich result monitoring | Validate Breadcrumb, visible-list `ItemList`, and shipped Dataset JSON-LD where applicable (see §6); use [Rich Results Test](https://search.google.com/test/rich-results) for JSON-LD smoke checks. | Launch + schema changes |
| 移除过时网址 | 若预览曾误被收录：Removals 工具临时移除 + 修 noindex | 仅事故时 |
| Core Web Vitals 报告 | GSC CWV 报告 + Vercel Speed Insights 双看（见 §12） | 每月 |

- **抓取预算**：每个 locale sitemap 约 ~10k URL，单文件低于 50k；总 URL 约 7 倍基础 canonical path 清单，需靠准确 `lastModified`、强内链（§9）与核心页权重传导消化长尾。
- **索引节奏预期**：长尾 repo/org 页可能数周–数月才逐步收录；优先确保**高价值长尾**（热门 repo、近年月份）被内链 + sitemap 优先暴露。

---

## 15. 验收清单

**收录基础设施**

- [ ] **当前**：`/sitemap.xml` 为 sitemap index，per-locale XML route handlers 列出首页 / `/pulse` / `/rankings` / `/compare` / `/categories` / `/about` + 全部年月 + 有效 ISO 周页 + 全部 repo + `/o` owner 索引分页 + 全部 org + 公开 category 路径与分页；各 locale sitemap 可访问（§4.1）
- [ ] sitemap `lastModified` 按 URL 类型从真实数据日期派生：rank 历史页用期末日封顶、category 用 registry `generated_at`、repo/org/core 用发布 meta；不使用 `new Date()` 抖动
- [ ] sitemap 每个 locale 文件低于 50k URL；若单 locale URL 规模逼近 50k 或 GSC 出现抓取预算浪费，再按实体类型继续分片（§4.3 / §4.4）
- [ ] sitemap 每个 `<url>` 含完整 locale alternate set（`x-default`、`en`、`ja`、`zh-CN`、`zh-TW`、`ko`、`es`、`fr`）
- [ ] `app/robots.ts`：`SITE_INDEXABLE=1` 时输出 `Allow: /` + `Disallow: /api/` + Sitemap + Host；**未设置时全站 `Disallow: /`**（§5 / §11）
- [x] 周页 `/rankings/YYYY/W##` 与 `/compare` 已在 sitemap 中（§4.1）
- [x] `/o` owner 索引分页、分类入口、公开 category 路径与 category 分页已在 sitemap 中（§4.1）
- [ ] 收录目标量级按每 locale ~10k URL、总计约 7 倍基础 canonical path 规划（含 org / rankings / owner 索引分页 / category 分页，见 §10）

**每页元数据**

- [ ] 每页唯一 `title` / `description` / `canonical`，标题含真实搜索词（star history / trending / 年份 / repo / org 名）
- [ ] `metadataBase` 设为生产域名，相对 URL 正确解析为绝对 URL
- [ ] canonical 指当前 locale 的规范 URL；`alternates.languages` 含完整 hreflang set，`x-default` 指 English 无前缀 URL（见 §10）
- [ ] `og:type` 月/年页可带 published/modified time（og:locale 默认 `en_US`）

**按需 ISR 可索引性（§3）**

- [ ] 长尾段 `dynamicParams = true` + `generateStaticParams` 返回 `[]`；核心段返回具体 param
- [ ] **未知 repo/org param → `notFound()`（404）**，不返回软 200；改名旧 URL → 308
- [ ] `cacheComponents` 关闭；长尾 `revalidate = false`
- [ ] URL Inspection 抽查：ISR 页首抓返回 200 + 完整服务端 HTML（含正文 + JSON-LD），不依赖客户端 JS

**结构化数据（§6）**

- [ ] 首页 `WebSite`（**仅首页，不在根 layout**；含 `name`/`url`/`inLanguage`/`description`；不含 `SearchAction`）+ home Dataset JSON-LD from `datasetLd(...)`（见 §6.1 / §6.2）
- [ ] repo 页 `SoftwareSourceCode` + `interactionStatistic`（`InteractionCounter` / star 数），**不含 `Dataset` / `temporalCoverage`**；org 详情页 `Organization`/`Person`
- [ ] 月/年/周页、全时榜、category 列表页、org 索引页均有 `CollectionPage`；列表页另输出同源 `ItemList`，但 `CollectionPage` 不含 `datePublished`/`dateModified`/`isPartOf`
- [ ] **每页 `BreadcrumbList` 由 `Breadcrumbs.tsx` 单独输出**（不在 `jsonld.ts` 5 个 builder 内）；全部通过 Google Rich Results 测试

**去重与分页（§7 / §8）**

- [ ] 排序/筛选 query 视图 canonical 回规范页；内容不同的视图（org vs repo、不同 period）各 canonical 自身
- [ ] 长榜单优先不分页（top-N 单页）；category 深分页和 owner 索引分页各页 canonical 自身 + 进 sitemap

**内链（§9）**

- [ ] 年份脊柱 / 月份格子 / 榜单行→实体 / repo↔org 互链 / repo→category/related / rankings 完整榜单锚点 / category 分页 / footer 目录入口 / 面包屑 全部实现
- [ ] 全站任意页 ≤ 3 跳可达；沉寂 repo 有 sitemap + 历史 rank 完整榜单 + category 深分页兜底

**OG / 社交（§13）**

- [ ] 4 张 OG 卡片（站点 / repo / 年 / 月·周）由 `opengraph-image.tsx` 路由现绘 + ISR/CDN 缓存（**石墨灰深底 `#121316` + 星金 `#ffba3b`**、当前 `next/og` 默认字体）；org 页与全时榜回退站点卡
- [ ] `pageMeta` 把 `og:image` / `twitter.images` 指向卡片路由（`<route>/opengraph-image` 或 `/opengraph-image`，经 `metadataBase` 解析）；Twitter `summary_large_image` + alt

**性能（§12）**

- [ ] LCP < 1.5s / CLS < 0.05 / INP 近 0（Speed Insights + GSC CWV 双验）
- [ ] HTML < 20KB、零客户端 JS（内容页）、字体子集化

**预览隔离（§11）**

- [ ] 预览期 robots `Disallow: /` + meta `noindex` + PRIVATE 部署三重保险
- [ ] 切换日检查：生产恢复 `Allow: /`、noindex 消失、teaser 退域名、sitemap 可访问

**Search Console（§14）**

- [ ] 生产切换后验证站点 + 提交 sitemap index
- [ ] 监控收录率（Discovered/Crawled not indexed）、富结果、CWV 与 hreflang 诊断（locale URL / `x-default` 见 §10）
- [ ] 预览期**绝不**向 GSC 提交任何 URL/sitemap
