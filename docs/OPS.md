# gitstarclub 运维 / 部署

> 运维与部署的唯一真相源。架构与数据流见 [ARCHITECTURE.md](./ARCHITECTURE.md)，产品见 [PRODUCT.md](./PRODUCT.md)。
> 核心原则承袭架构：**Vercel-first 统一计费**、**运行时纯静态零引擎**、**重 build 只在每周**。本文把这些落到具体的项目、环境变量、Cron、Blob 与告警上。

## 部署拓扑（单一 Vercel 项目）

2026-06-02 起，生产与测试环境合并到同一个 Vercel 项目：

- Team：`zkscio`
- Project：`gitstarclub.com`
- Project ID：`prj_V9RVqspNWPXXiytX7Fj3wlMT9wNw`
- Root Directory：`web`
- Framework：Next.js
- Node.js：24.x

| 项目 | 内容 | 域名 | 状态 | 说明 |
|---|---|---|---|---|
| **Production** | `web/`（Next.js 16，App Router + RSC） | **gitstarclub.com / www.gitstarclub.com** | 已切到 web 应用 | 生产 alias 指向 `gitstarclub.com` 项目的 Ready deployment |
| **Preview / staging** | 同一项目的 Preview deployment | **pre.gitstarclub.com** | Vercel 侧待 DNS 完成 | Preview deployment 已可用；Cloudflare 需加 `A pre.gitstarclub.com 76.76.21.21` 后才能签证书并完成 alias |

**历史项目处理**：

- `gitstarclub-web` 是旧 web staging 项目，只作临时回滚参考；后续部署不要再使用。
- 根目录的 teaser 静态页源码仍保留，但生产域名已经从 teaser deployment promote 到 `gitstarclub.com` 的 Next.js deployment。
- 删除旧 Vercel 项目属于破坏性操作；确认 `gitstarclub.com` Production 与 `pre.gitstarclub.com` 都稳定后再手动删除旧项目。

**部署命令**：

所有 Vercel CLI 命令从仓库根目录执行，因为项目 Root Directory 已设置为 `web`。

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com
vercel deploy . --yes --scope zkscio --project gitstarclub.com
```

需要先验证再切生产域名时：

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com --skip-domain
vercel promote https://<deployment>.vercel.app --scope zkscio --yes
```

`pre.gitstarclub.com` DNS 生效后，将最新 Preview deployment 绑定为测试环境：

```powershell
vercel alias set https://<preview-deployment>.vercel.app pre.gitstarclub.com --scope zkscio
```

## 环境变量与密钥

集中在 `zkscio/gitstarclub.com` 项目的 Vercel 环境变量里配置；本地用 `.env`（见 `.env.example`，**勿提交真实值**）。

| 变量 | 用途 | 作用域 | 谁用 |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub GraphQL/Search PAT（批量查 `stargazerCount` + 元数据 + 白名单） | Server / 回填脚本 | 每日 cron · 每周 cron · 一次性回填 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 读写令牌 | Server / build / 回填脚本 | build 读视图 · cron 写活尾 · 回填上传 |
| `CRON_SECRET` | Cron 鉴权随机串（Vercel 以 `Authorization: Bearer <secret>` 注入，handler 校验） | Server | 每日 / 每周 cron route |
| `VERCEL_DEPLOY_HOOK_URL` | Deploy Hook URL（可选；触发一次核心 rebuild，用于代码/结构变更或手动全量刷新） | Server | 手动 / CI（数据更新不需要它，长尾走 ISR） |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP 服务账号 key 路径 | **本地回填脚本**（仅一次性 BigQuery 回填） | 一次性回填 |
| `GCP_PROJECT_ID` | GCP 项目 ID | **本地回填脚本**（仅一次性 BigQuery 回填） | 一次性回填 |
| `NEXT_PUBLIC_SITE_URL` | 站点规范域名（canonical / sitemap / OG 绝对 URL） | Build / Client | Next.js |
| `NEXT_PUBLIC_GA_ID` | GA4 measurement ID | Client | Next.js |

**约定**：

- `NEXT_PUBLIC_*` 会进客户端 bundle，**只放非敏感值**；其余一律 Server-only。
- `BLOB_BASE_URL`、`CRON_SECRET`、`BLOB_READ_WRITE_TOKEN`、`GITHUB_TOKEN` 需要同时配置到 Production 与 Preview，**绝不写进仓库或客户端**。
- 写入 Vercel 变量时必须去掉首尾空白和 BOM；`CRON_SECRET` 带空白会让 Cron header 非法，`BLOB_BASE_URL` 带 BOM 会让 Next.js build 在 sitemap 阶段报 `ERR_INVALID_URL`。
- **GCP 两项仅本地一次性回填用**：用 BigQuery 查 GH Archive（~$10，含稳定 repo.id）。回填一次后这两个变量即可弃用——**日常运营 0 GCP、0 外部账单**。（为何不用免费的 ClickHouse 公共实例/自建：见 ARCHITECTURE「为什么回填用 BigQuery」。）
- 启动时校验必需密钥存在，缺失则 fail-fast（不静默吞）。

## Vercel Blob 布局

用**一个 PUBLIC store**：海量 JSON 视图由 build 在打包时按**直链 URL** 读取，公开读最省事、命中 CDN。Parquet canonical 体积小、仅离线 pipeline 触碰。

```
blob://
├── canonical/
│   └── star_daily.parquet          # 事实表（per-repo×天，~几十 MB，唯一真相源，仅离线/每周读写）
├── lookup/
│   ├── repos.json                  # repo 元数据（build join）
│   └── orgs.json
├── rank/                           # 预算好的排行榜视图（build 读）
│   ├── {week|month|year}/{period}/{repo|org}/{flow|stock}.json
│   └── all-time/{repo|org}/stock.json
├── entity/
│   ├── repo/{id}.json              # 曲线 + 里程碑 + 历期表 + 名次史
│   └── org/{login}.json
├── heatmap/{year|month}/{period}.json
├── current_month.json              # 当月活尾（KB 级，每日 cron append-only 覆盖写）
└── hot-snapshot.json               # 热集聚合（首页/当年/当月，每日 cron 重写，热集 ISR 读）
```

**Blob 操作约束（已验证，写 pipeline 时必须遵守）**：

| 维度 | 数值 | 对策 |
|---|---|---|
| API | `put` / `head` / `list` / `del` / `copy`；可在 build 脚本、cron route、server component 调用 | — |
| 单文件上限 | 5TB | 远超需求（我们数据仅几十 MB） |
| Pro 容量 | ~5GB 存储 + 100GB 传输/月 | 数据几十 MB，宽裕 |
| **写速率** | **4,500 次/分（75/s）** | **离线 pipeline 批量 `put()` 必须节流**（限并发 + 间隔），尤其上传上万 entity JSON 时 |
| 同路径覆盖 | 需 `allowOverwrite: true` | 覆盖写视图 / 活尾时显式带上 |
| **缓存传播** | 同路径覆盖最长 **60s** 才全网生效 | **每日更新的视图（活尾 / hot-snapshot）读取时带 query 参数 cache-bust**（如 `?v=<date>`），避免读到旧副本 |

> 之所以选 PUBLIC store：JSON 视图本就是要被 build 直接 `fetch` 的公开数据，公开读免去签名、天然走 CDN。Parquet canonical 虽也在同 store，但只有持 token 的离线 pipeline 会动它，不在 build/运行时路径。

## Cron 调度

`web/vercel.json` 声明 `crons[]`；Pro 计划 **100 job/项目**、最小 1 次/分。两条 job：

| Job | 调度（UTC） | 动作 | 触发 deploy？ |
|---|---|---|---|
| **每日** | `0 3 * * *`（~03:00） | **JSON-only**：GraphQL 查 current_stars → append `current_month.json` → 重算 `hot-snapshot.json` → `revalidatePath` 热集 9 页 | **否**（秒级，不碰 Parquet/引擎/deploy） |
| **每周** | `0 4 * * 0`（周日 ~04:00） | 刷新白名单 diff + 新晋者补历史 → 折叠活尾入 Parquet + DuckDB 重算受影响视图 → `revalidatePath` 变更页 | **否**（长尾按需 ISR；不做 16k 全量 build） |

```jsonc
// web/vercel.json — MVP ships daily only (see 落地 note)
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 3 * * *" }
  ]
}
```

> **MVP 落地（已实现）**：每日 job = `web/app/api/cron/daily/route.ts`（`?dry=1` 可空跑预览）。CRON_SECRET 鉴权 → GraphQL 拉 current_stars（`web/lib/github.ts`，按 owner/name 批量）→ 幂等 upsert `current_month.json`（按 UTC 日）→ 重算 `hot-snapshot.json` 的**实时可推导部分**（all-time 用新 stars 重排；当月 flow = **回填的当月榜为底 + 活尾增量**，解了 OPS 原先"YTD-base 现场定"的开放点）；`year_spine`/`on_this_day` 暂沿用上一份快照（由离线/每周重算）→ `revalidatePath` 核心页。**每周重算不上 serverless**（运行时零引擎，无 DuckDB/Parquet）：白名单刷新 + 折叠当月入 Parquet + 重算视图 = 本机/CI **重跑 pipeline 01–06**，非 Vercel cron。`GITHUB_TOKEN` + `CRON_SECRET` 已配在 `gitstarclub.com` 项目 Production/Preview 环境变量。

**实跑状态（2026-05-31）**：首次在 Vercel 真实触发 daily cron 遇到 GitHub GraphQL `403`；当时 Blob 里的 `current_month.json` 与 `hot-snapshot.json` 仍为 `404`，没有半写。修复后已在旧 `gitstarclub-web` production target 复测成功：GraphQL 批次 pacing + `Retry-After`/secondary-limit 等待生效，`current_month.json` 与 `hot-snapshot.json` 已写入同一个 public Blob store，并通过 `web/scripts/validate-live-views.ts --bust 2026-05-31` 的 Zod contract 校验。2026-06-02 已把同一套环境变量迁移到 `gitstarclub.com` 项目；迁移后仍需在新项目上做一次 `?dry=1` 和真实 cron 复核。

**鉴权模式（CRON_SECRET）**：

- 触发是对生产 URL 的 **HTTP GET**；配置 `CRON_SECRET` 后 Vercel 自动带 `Authorization: Bearer <CRON_SECRET>`。
- handler 第一步校验该头，与 `process.env.CRON_SECRET` 不符即 `401`，拦截外部直呼 `/api/cron/*`（robots 已屏蔽 `/api/`，但鉴权才是真防线）。

**幂等（关键约束）**：

> Vercel Cron **无自动重试**，且**同一次可能触发两次**。两个 handler **必须幂等**：
> - 每日：`current_month.json` 当月内 **append-only + 覆盖写**，按「今天 UTC 日期」作 upsert 键——重复执行只是用同一份 GraphQL 结果覆盖同一天，不会重复累加。
> - 每周：折叠活尾入 Parquet、重算视图按「目标周期」幂等覆盖；新晋者补历史按 repo id 去重；`revalidatePath` 天然幂等（重复调用无害）。
> - 失败靠**告警**兜底（见下），不靠重试。

**时长**：cron route 是 Function，default 300s / **max 800s**。每日 job 只读写 KB 级 JSON，但 GraphQL 全量轮询需要按批次 pacing；本地全量模拟约 131s，Vercel 实跑必须预留数分钟并控制在 800s 内。每周 job 较重（折叠 Parquet + 重算受影响视图 + revalidate），不上 serverless；若重算量逼近上限，拆分分批或移到本机/CI 跑。

**Daily cron 实跑 runbook**：

1. 先在 Vercel production-target URL 调 `GET /api/cron/daily?dry=1`，带 `Authorization: Bearer <CRON_SECRET>`；若日志仍出现 GitHub GraphQL `403`、`Retry-After` 或 rate-limit remaining 接近 0，停止实跑，先继续降批次/加等待。
2. 实跑前记录两个 Blob 对象状态：`current_month.json`、`hot-snapshot.json`。若返回 `404`，记录为“原本不存在”；若存在，下载到本地备份目录再继续。
3. 真实触发 `GET /api/cron/daily`，同样带 `Authorization: Bearer <CRON_SECRET>`。客户端连接可能比函数完成更早关闭；以 Blob 写入和 Vercel logs 为准。
4. 写后运行 `cd web && bun scripts/validate-live-views.ts --bust <UTC day>`，确认 `current_month.json` 包含本次 UTC day，`hot-snapshot.json` schema 可被现有 contracts 校验；再检查 `/en`、`/en/pulse` 仍可访问且保持 noindex。
5. 若再次失败且两个 Blob 仍为 `404`，视为无写入失败，无需数据回滚；若任一对象已写入但校验失败，按下方“每日活尾”回滚。

## Deploy Hook 使用（可选）

- 在 web 应用项目 **Settings → Git → Deploy Hooks** 创建（项目须 Git 连接），得到 URL 存入 `VERCEL_DEPLOY_HOOK_URL`；触发 `POST .../deploy/<prj>/<id>`（无 auth/payload）；限额 **5 hook/项目**。
- **用途有限**：ISR 模型下**数据更新不需要 deploy**（cron 直接 `revalidatePath`）。Deploy 只在**代码/结构变更**时发生（一般 Git push 自动部署；此 hook 供手动/CI 触发一次核心 rebuild）。
- **每日 / 每周 cron 都不触发全量 deploy**：每日 revalidate 热集，每周 revalidate 变更页；长尾页按需 ISR。

> ⚠️ Vercel **每次 deploy 重建所有 build-时 SSG 页**，`.next/cache` 不跨 deploy 保留预渲染 HTML——所以历史/长尾页**不在 deploy 构建**（按需 ISR），deploy 只 build 小核心，永不逼近 45min 上限（见 ARCHITECTURE「页面分层」）。

## 监控与告警

| 关注 | 工具 | 触发 |
|---|---|---|
| 运行时 / build / cron 异常 | **Sentry**（Vercel Marketplace 接入） | 未捕获异常、route 报错、build 失败 |
| pipeline 运行记录 | **`sync_runs` 日志**（每次每日/每周 job 落一条：开始/结束时刻、查询数、写入数、`total_drift_pct`、状态） | 供对账与回溯 |
| **数据漂移** | 比对 GraphQL 权威总数 vs adds 累加总数 | **漂移 > 阈值（如 2%）告警**，并以 GraphQL 为锚点重锚（见 ARCHITECTURE「数据校验 / 对账」） |
| **Cron 失败** | Sentry + `sync_runs` 状态 | **任一 cron 失败立即告警**——因无自动重试，漏一次每日 job = 活尾缺一天，必须人工补跑 |
| 单日突刺 | pipeline sanity check | 单日新增极端突刺打日志告警（net 允许为负） |

**告警通道**：Sentry 告警直发（邮件 / Slack 任一）。重点盯**两类无重试的失效**：cron 没跑 / 跑失败、数据漂移越界。

> `sync_runs` 不需要数据库：可作为一条 JSON 记录 append 到 Blob（如 `ops/sync_runs.json`，append-only），或直接进 Sentry 的结构化事件。MVP 用最轻的即可。

## 一次性 BigQuery 回填 Runbook（高层）

11 年事件级历史只回填一次，走 **BigQuery**（要 GCP 凭证，~$10、含稳定 repo.id）。免费替代（ClickHouse 公共实例、自建摄入）评估后均不可行，见 ARCHITECTURE「为什么回填用 BigQuery」。

**前置**：GCP 凭证（`GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID`）· GitHub PAT（`GITHUB_TOKEN`）· Vercel Blob store（`BLOB_READ_WRITE_TOKEN`）。本机 / 全 Node 环境跑，不在 Vercel。

```
1. 查 GH Archive WatchEvents（BigQuery）
   按 repo + UTC 天 汇总 WatchEvent（2015-01 起，量大按年/按批分块）→ 导出
2. 本机 DuckDB
   落 per-repo×天 事实表 → star_daily.parquet
   + 算里程碑（破 10k/50k/100k 精确日期）
3. GraphQL（GITHUB_TOKEN）
   抓元数据 + owner(+type) + current_stars（权威）→ repos.json
4. DuckDB 预算所有 JSON 视图
   {周/月/年/全时}×{repo/org}×{flow/stock} + entity 曲线 + heatmap
5. 上传 Vercel Blob（BLOB_READ_WRITE_TOKEN）
   canonical/star_daily.parquet + lookup/*.json + rank/** + entity/** + heatmap/**
   ⚠️ 批量 put() 节流到 < 75/s（见 Blob 写速率约束）
```

- **成本**：~$10（一次性）；回填完永不再碰 GCP。
- 口径瑕疵（gross vs net、幸存者偏差、起点 2015）见 ARCHITECTURE，About 页注明。
- 回填完成后 GCP 两个变量即可弃用，日常运营回到 0 GCP。

## Build 约束

> **Vercel build 45 分钟硬上限（所有计划）—— 首要约束。** 绝不在单次 deploy 里 build 全部 ~16k 页。

- 长尾页（历史 repo / org 详情）走**按需 ISR**，不在 deploy 时构建（见 ARCHITECTURE「页面分层」）。
- 长尾（历史 / repo / org / 周页）**不在 deploy 构建**，按需 ISR 懒生成、存持久 ISR store；数据变更靠 cron `revalidatePath`，不做 16k 全量 build。
- OG 图**不在每次 build 生成**：仅数据变化时（pipeline 侧）增量出图存 Blob，历史页 OG 永不重生成。
- build 只读预算好的 JSON 视图直接渲染——**不聚合、不带引擎、不碰原生模块**。

**Function 资源（ISR / cron）核对**：

| 资源 | 默认 | 上限 |
|---|---|---|
| 时长 | 300s | **800s** |
| 内存 / CPU | 2GB / 1 vCPU | 4GB / 2 vCPU |
| `/tmp` | 500MB | — |
| 响应体 | 4.5MB | Blob 直读绕过此限 |

> 每日 cron 与热集 ISR 都只读写 KB 级 JSON，远不触及上述任何上限。读大文件一律走 Blob（绕过 4.5MB 响应体限制），且大文件只在离线 / 每周构建里碰。

## 回滚

- **Blob artifacts 版本化**：每周 pipeline 产出的视图 / Parquet 以版本/日期标识保留若干份（不就地永久覆盖 canonical），坏数据可指回上一版。
- **部署回滚**：Vercel 保留历史部署，**Promote 上一个正常 deployment**即可秒级回退。旧 `gitstarclub-web` 暂保留为额外回滚参考，但正常回滚应在 `gitstarclub.com` 项目内完成。
- **每日活尾**：`current_month.json` 当月 append-only、覆盖写；`hot-snapshot.json` 由同次 daily cron 重写。首次实跑失败时两者仍为 `404`，说明 GraphQL 阶段失败不会半写。以后实跑前先备份已存在对象；若失败前两者原本不存在，回滚就是保持/恢复为不存在；若已存在且新写入校验失败，用备份覆盖回 `current_month.json` 与 `hot-snapshot.json`，再用 cache-bust 读取确认。
- **顺序**：先回滚数据（Blob 指回上一版视图）→ 再 redeploy 上一个正常部署 → 核对 `sync_runs` 与漂移恢复正常。
