# gitstarclub SEO 设计

> SSG 的核心价值是可被搜索引擎收录、可分享。10M/天流量主要来自搜索引擎长尾
> （如 "langchain star history"、"github trending 2024"）。SEO 不是加分项，是目标成立的前提。

## 收录目标

全部 ~5,400 页（× 3 语言 = ~16,200 个 URL）都应被索引。每页是一个独立的、有内容价值的落地页。

## sitemap

页面量大，sitemap 必须分片：

```
/sitemap.xml                 # sitemap index
  /sitemaps/pages.xml        # 首页 / 年度 / 月度（~144 条）
  /sitemaps/repos-1.xml      # repo 页分片（每片 ≤ 5万条，单片足够）
```

- Next.js `app/sitemap.ts` 动态生成；超过单文件 5万 URL 上限时用 `generateSitemaps()` 分片
- 每条带 `lastModified`：历史月份固定、当月与首页为最近同步时间
- 多语言用 `<xhtml:link rel="alternate" hreflang="...">` 标注互译

## robots.txt

```
User-agent: *
Allow: /
Sitemap: https://gitstarclub.com/sitemap.xml
```

- 不屏蔽任何内容页；爬虫预算靠站点结构和内链消化
- 屏蔽 `/api/`

## 每页 meta

| 页面 | title 模式 | description |
|---|---|---|
| 首页 | `gitstarclub — A Chronicle of Open Source` | 站点一句话介绍 |
| 年度页 | `GitHub Stars in 2024 — gitstarclub` | 该年 top 项目摘要 |
| 月度页 | `Top GitHub Repos in October 2024 — gitstarclub` | 当月 top 3 + 数据摘要 |
| Repo 页 | `anthropic/claude-code — Star History & Timeline` | 描述 + 当前 star + 关键里程碑 |

- 每页 **canonical** 指向自身规范 URL
- 标题含**真实搜索词**（"star history"、"trending"、年份、repo 名）——对齐用户实际搜索意图

## 结构化数据（schema.org JSON-LD）

让 Google 富展示：

- **首页 / 数据站**：`Dataset` + `WebSite`（带 `SearchAction` 站内搜索，v0.2）
- **月度页 / 年度页**：`Article` / `CollectionPage`（有发布与更新时间）
- **Repo 页**：`SoftwareSourceCode` + `Dataset`（star 时间序列），`BreadcrumbList`
- **面包屑**：首页 → 年 → 月 → repo，全站 `BreadcrumbList`

## OG / 社交卡片

每页一张 OG 图，**build 时用 `@vercel/og`（Satori）生成**，存 Vercel Blob，不走运行时 Function：

| 页面 | OG 图内容 |
|---|---|
| 首页 | 标题 + 年份脊柱缩略 |
| 年度页 | "GitHub 2024" + 年度 top 3 |
| 月度页 | "Oct 2024" + 当月 top 3 + 缩略热力图 |
| Repo 页 | repo 名 + star 曲线缩略 + 当前 star |

- Twitter `summary_large_image` + Open Graph 全套
- 字体与站点一致（Fraunces 标题）

## 多语言 SEO（EN / JA / ZH）

- URL：默认英文在根 `/2024/10`；日文 `/ja/2024/10`；中文 `/zh/2024/10`
- 每页输出 `hreflang` alternate（含 `x-default` → 英文）
- 三语各自独立静态页 → **页面总数 × 3 ≈ 16,200**（见 ARCHITECTURE 的 build 策略）
- 翻译的只是 UI chrome / 年度标签 / About；repo 数据语言中立

## 内链策略（爬虫消化 5,400 页的关键）

- 榜单内每个 repo 名 → repo 页
- repo 页里程碑/月度表 → 对应月度页
- 月度页 ←→ 上下月、↑ 年度页
- 年份脊柱 → 各年度页
- 形成**网状内链**，任意页 3 跳内可达，爬虫无死角

## 性能即 SEO

Core Web Vitals 直接影响排名。SSG + 零客户端 JS + HTML < 20KB 天然满足：

| 指标 | 目标 |
|---|---|
| LCP | < 1.5s（静态 HTML + 预加载字体） |
| CLS | < 0.05（图表尺寸固定、字体 metric override） |
| INP | 极低（几乎无 JS） |

## 验收清单

- [ ] sitemap index + 分片，全部 URL 可达
- [ ] robots.txt 正确，未误屏蔽
- [ ] 每页唯一 title/description/canonical
- [ ] hreflang 三语互链 + x-default
- [ ] JSON-LD 通过 Google Rich Results 测试
- [ ] 每页 OG 图（build 时生成）
- [ ] Search Console 提交 sitemap，监控收录率
