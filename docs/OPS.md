# gitstarclub Operations Runbook

> 运维与部署的唯一真相源。架构与数据流见 [ARCHITECTURE.md](./ARCHITECTURE.md)，产品见 [PRODUCT.md](./PRODUCT.md)。
> 核心原则承袭架构：**Vercel-first 统一计费**、**运行时纯静态零引擎**、**生产数据运营不依赖本地计算**。本文把这些落到具体的项目、环境变量、Cron、Workflow、Blob 与告警上。

## Scope

本文是 **gitstarclub 的运维运行手册（operations runbook）**——**部署、cron / Workflow 操作、Blob 布局、环境变量清单、告警、回滚**。当生产出问题需要排查、或要搭建一套新环境时，读这一份就够。

数据运营分层：
- **每日 / 每周 live cron**——见 §Cron 调度。
- **历史 / 元数据 / canonical 全量刷新（Vercel Workflow）**——见 §Vercel Workflow runbook（设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)）。
- **一次性 BigQuery + DuckDB bootstrap 回填**——见 §一次性 bootstrap Runbook（归档，非日常路径）。

## 部署拓扑（单一 Vercel 项目）

生产与测试环境合并到同一个 Vercel 项目：

- Team：`zkscio`
- Project：`gitstarclub.com`
- Project ID：`prj_V9RVqspNWPXXiytX7Fj3wlMT9wNw`
- Root Directory：`web`
- Framework：Next.js
- Node.js：24.x

| 项目 | 内容 | 域名 | 说明 |
|---|---|---|---|
| **Production** | `web/`（Next.js，App Router + RSC） | **gitstarclub.com / www.gitstarclub.com** | Production branch is `main`; production is indexable only when `SITE_INDEXABLE=1` is set in Production |
| **Preview / staging** | 同一项目的 Preview deployment | **pre.gitstarclub.com** | Fixed custom domain for the `pre` branch; Cloudflare DNS is `A pre.gitstarclub.com 76.76.21.21`, DNS-only |

## Branch topology / staging

GitHub and Vercel use a two-branch topology:

| Branch | Vercel target | Domain | Indexing | Purpose |
|---|---|---|---|---|
| `main` | Production Branch = `main` | `https://gitstarclub.com` / `https://www.gitstarclub.com` | Indexable only in Production; `SITE_INDEXABLE=1` is Production-only | Production |
| `pre` | Preview deployment for git branch `pre` | `https://pre.gitstarclub.com` | Always noindex in Preview | Staging |

`pre.gitstarclub.com` is a stable custom staging domain, not the auto
`*-git-pre-*.vercel.app` branch alias. It is bound in the Vercel project domain
configuration to the `pre` git branch (`gitBranch: pre`). Cloudflare DNS points
`pre.gitstarclub.com` to Vercel with `A -> 76.76.21.21`; the record is DNS-only
and must not be proxied.

Preview is intentionally noindex. `SITE_INDEXABLE` and `NEXT_PUBLIC_SITE_URL`
are Production-only, so Preview emits `<meta name="robots"
content="noindex,nofollow">` and `robots.txt` returns `User-Agent: *` with
`Disallow: /`. Preview still reads production Blob data because `BLOB_*`
variables are set for Preview.

Access: `pre` is currently public. Project-level Vercel Authentication /
`ssoProtection` was disabled on 2026-07-02, so Preview deployments are publicly
reachable but remain noindex. Production is unaffected. If staging must become
private again, re-enable Vercel Authentication and issue a
Protection-Bypass-for-Automation token for curl, CI, or other automated checks.

Development flow: feature work targets `pre` through PRs into `pre`. Verify the
merged Preview deployment at `https://pre.gitstarclub.com`. Promotion to
production is a merge from `pre` to `main`.

**域名命名约定**：

- 生产访问只使用 `gitstarclub.com` / `www.gitstarclub.com`。
- 测试访问只使用 `pre.gitstarclub.com`。
- `pre.gitstarclub.com` is the fixed custom domain bound to the `pre` branch; it is not the auto `*-git-pre-*.vercel.app` branch alias.
- `gitstarclubcom.vercel.app` / `gitstarclubcom-zkscio.vercel.app` 是 Vercel 自动生成的生产别名，保留但不对外传播。
- `gitstarclub-<hash>-zkscio.vercel.app` 是每次部署的不可变 deployment URL，只用于 inspect / promote / 回滚，不作为环境入口。
- 旧 `gitstarclub-web*.vercel.app` 与旧分支 alias 已移除，避免和当前单项目拓扑混淆。

**历史项目处理**：

- `gitstarclub-web` 是旧 web staging 项目，只作临时回滚参考；后续部署不要再使用。
- 根目录的 teaser 静态页源码仍保留，但生产域名已从 teaser deployment promote 到 `gitstarclub.com` 的 Next.js deployment。
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

Staging is branch-bound through the Vercel project domain configuration
(`gitBranch: pre`). Do not replace it with a one-off deployment alias except for
an explicit recovery procedure.

## 环境变量与密钥

集中在 `zkscio/gitstarclub.com` 项目的 Vercel 环境变量里配置；本地用 `.env`（见仓库根目录 `.env.example`，**勿提交真实值**）。

| 变量 | 用途 | 必需 / 可选 | 格式 | 谁用（path:line） |
|---|---|---|---|---|
| `GITHUB_TOKEN` | GitHub GraphQL / Search PAT（批量查 `stargazerCount` + 元数据 + 白名单） | **必需**（cron / Workflow） | `ghp_…` PAT 字符串 | `web/lib/github.ts:5`；每日 cron · 每周 cron · Workflow whitelist/metadata step · 一次性回填 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 读写令牌 | **必需**（写路径） | `vercel_blob_rw_…` | `web/lib/data/write.ts:6` · `web/lib/workflows/recompute/io.ts:18` · `web/lib/workflows/steps/gc.ts:10`；cron 写活尾 · Workflow 写 canonical/views · GC 删旧版本 |
| `BLOB_BASE_URL` | Vercel Blob 公开读 base URL（build / 运行时直链 fetch 视图 + 解析 publish pointer） | **必需**（读路径） | `https://<store>.public.blob.vercel-storage.com`（**无尾斜杠 / 无 BOM**） | `web/lib/data/source.ts:10` · `web/lib/cron/sync-runs.ts:83`；Next.js build · ISR 视图直读 · live cron 读发布指针 |
| `NEXT_PUBLIC_BLOB_BASE_URL` | `BLOB_BASE_URL` 的客户端回退（仅当 server-only 值不可用时） | 可选（回退） | 同 `BLOB_BASE_URL` | `web/lib/data/source.ts:10` · `web/lib/cron/sync-runs.ts:83`；客户端 bundle 中读取 |
| `CRON_SECRET` | Cron 鉴权随机串（Vercel 以 `Authorization: Bearer <secret>` 注入，handler 校验） | **必需** | 随机串（≥32 字符，**无首尾空白**） | `web/lib/cron/handlers.ts` · `web/app/api/workflows/refresh/start/route.ts:13`；每日 / 每周 cron · Workflow 触发 |
| `VERCEL_DEPLOY_HOOK_URL` | Deploy Hook URL（触发一次核心 rebuild，用于代码 / 结构变更或手动全量刷新） | 可选 | `https://api.vercel.com/v1/integrations/deploy/<id>` | 手动 / CI（数据更新不需要它，长尾走 ISR） |
| `ALERT_WEBHOOK_URL` | 失败告警 webhook（Slack / Discord incoming webhook 或 `https://webhook.site/...`，POST JSON 摘要；**不设则仅日志**） | 可选 | `https://…` 可接收 JSON POST 的端点 | `web/lib/observability/alert.ts:45`；Workflow `sendAlert` · 每日 / 每周 cron 失败投递 |
| `SITE_INDEXABLE` | 生产 indexing 开关——`"1"` 解除 pre-launch noindex 并开放 sitemap | 可选（默认 noindex） | 字符串 `"1"` 才生效，其他值 / 未设 = noindex | `web/app/robots.ts:6` · `web/app/_shell/RootShell.tsx:18`；上线时单点切换 |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP 服务账号 key 路径 | 仅一次性回填 | 本机文件路径，例 `./gcp-key.json` | **本地回填脚本**（仅一次性 BigQuery 回填） |
| `GCP_PROJECT_ID` | GCP 项目 ID | 仅一次性回填 | GCP project ID 字符串 | **本地回填脚本**（仅一次性 BigQuery 回填） |
| `NEXT_PUBLIC_SITE_URL` | 站点规范域名（canonical / sitemap / OG / JSON-LD 绝对 URL） | **必需**（生产） | `https://gitstarclub.com` 等绝对 URL（**无尾斜杠**） | `web/lib/sitemap.ts:26` · `web/app/robots.ts:5` · `web/app/_shell/RootShell.tsx:17` · `web/lib/jsonld.ts:4` · `web/app/_explore/Breadcrumbs.tsx:10` |
| `NEXT_PUBLIC_GA_ID` | Optional Google Analytics 4 measurement ID. GA4 renders only when this non-empty value starts with `G-`; unset or invalid values emit no GA script. | Optional | `G-...` | `web/app/_shell/RootShell.tsx` |
| `SEO_LIVE_BASE` | 集成测试拉取的活线 origin（默认 `https://www.gitstarclub.com`，留空可跳过测试） | 仅测试 | `https://www.gitstarclub.com` 或空串 | `web/lib/integration/seo.test.ts:23` |
| `SEO_CANON_ORIGIN` | 集成测试断言的 canonical origin（默认 `https://gitstarclub.com`） | 仅测试 | 绝对 origin（**无尾斜杠**） | `web/lib/integration/seo.test.ts:25` |

**约定**：

- `NEXT_PUBLIC_*` 会进客户端 bundle，**只放非敏感值**；其余一律 Server-only。
- `BLOB_BASE_URL`、`CRON_SECRET`、`BLOB_READ_WRITE_TOKEN`、`GITHUB_TOKEN` 需要同时配置到 Production 与 Preview，**绝不写进仓库或客户端**。
- 写入 Vercel 变量时必须去掉首尾空白和 BOM；`CRON_SECRET` 带空白会让 Cron header 非法，`BLOB_BASE_URL` 带 BOM 会让 Next.js build 在 sitemap 阶段报 `ERR_INVALID_URL`。
- **GCP 两项仅本地一次性回填用**：用 BigQuery 查 GH Archive（约 $10，含稳定 repo.id）。回填一次后这两个变量即可弃用——**日常运营 0 GCP、0 外部账单**。（为何不用免费的 ClickHouse 公共实例 / 自建：见 ARCHITECTURE「为什么回填用 BigQuery」。）
- 启动时校验必需密钥存在，缺失则 fail-fast（不静默吞）。

## Vercel Blob 布局

使用**一个 PUBLIC store**：海量 JSON 视图由 build / 运行时按**直链 URL** 读取，公开读最省事、命中 CDN。canonical JSON shard 由 Workflow 读写；bootstrap Parquet 体积小、仅一次性 bootstrap 触碰。新布局完整定义见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4 与 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.11–2.13。

```
blob://
├── canonical/
│   ├── star_daily.parquet                          # bootstrap 归档（仅一次性 / 灾难重建读写，非生产路径）
│   └── v2/                                          # 生产 canonical JSON shard（见 VERCEL-DATA-OPERATIONS §4）
│       ├── meta.json                                #   seam_date · schema_ver · folded_through（周/月水位）
│       ├── whitelist/                               #   Workflow step 1：≥10k 白名单（web/lib/workflows/steps/whitelist.ts）
│       │   ├── <run_id>.json                        #     单次 run 快照（entries + diff.added/dropped）
│       │   └── latest.json                          #     指针：{ run_id, ids } —— 下次 run 计算 diff 用
│       ├── repos/{bucket}.json                      #   repo 维度 + 里程碑 + tracked_since + 冻结锚定因子 d
│       ├── repo-monthly/{bucket}.json · repo-weekly/{bucket}.json · repo-recent-daily/{bucket}.json
│       ├── site-daily/{yyyy}.json
│       └── pending/{period}.json                    #   已收口待折叠的周期活尾冻结快照（防重复 / 丢数据）
├── lookup/
│   ├── repos.json                                   # repo 元数据（build join）
│   └── orgs.json
├── rank/                                            # 预算好的排行榜视图（build 读，flat 旧布局；新布局走 views/<run_id>/rank/**）
│   ├── {week|month|year}/{period}/{repo|org}/{flow|stock}.json
│   └── all-time/{repo|org}/stock.json
├── entity/                                          # flat 旧布局
│   ├── repo/{id}.json                               # 曲线 + 里程碑 + 历期表 + 名次史
│   └── org/{login}.json
├── heatmap/{year|month}/{period}.json
├── live/                                            # 当前周期活尾覆盖层（每日 / 每周 cron 写）
│   ├── rank/{week|month}/{current}/repo/{flow|stock}.json
│   └── heatmap/month/{current}.json
├── views/                                           # 发布层：latest.json 指针 + <run_id>/（version=run_id）
│   ├── latest.json                                  #   pointer：{ version, run_id, published_at, prev_version, schema_ver }
│   └── <run_id>/                                    #   版本化输出（writeVersion → views/<run_id>/<rel>）
│       ├── meta.json                                #     版本元（seam_date · schema_ver · folded_through · generated_at）
│       ├── lookup/                                  #     entity step 派生（lookup/repos.json + lookup/orgs.json）
│       │   ├── repos.json
│       │   ├── orgs.json
│       │   ├── aliases.json                         #     buildAliases step 派生：old_full_name → 当前 id（repo route 308 跳转，validate 校验）
│       │   └── categories.json                      #     category step 派生：公开分类目录（validate 校验非空）
│       ├── categories/                              #     category step 派生（registry + 每仓分配，validate 校验）
│       │   ├── registry.json                        #       分类登记表（dimensions × categories，含 public 标记）
│       │   └── assignments.json                     #       每仓分类分配（language / language_family / owner_kind → category id）
│       ├── search/
│       │   └── index.json                           #     客户端搜索索引（entity step 派生，validate 闸门校验条目数）
│       ├── rank/                                    #     rank 矩阵（窗口 × 维度 × 指标）
│       │   ├── {week|month|year}/{period}/{repo|org}/{flow|stock|growth|new}.json
│       │   ├── all-time/{repo|org}/stock.json
│       │   └── category/{dimension}/{slug}/all-time/{repo|org}/stock.json  # 分类排行榜（validate 抽样校验）
│       ├── entity/                                  #     repo / org 曲线 + 里程碑 + 历期表 + 名次史
│       │   ├── repo/{id}.json
│       │   └── org/{login}.json
│       └── heatmap/                                 #     站点级日 / 月汇总
│           ├── month/{yyyy-mm}.json
│           └── year/{yyyy}.json
├── ops/
│   ├── sync-runs.json                               # live cron 运行记录（保留最近 100 次）
│   └── workflows/
│       ├── latest-success.json                      #   最近一次成功 run 的恢复点：{ run_id, version, published_at }
│       ├── health.json                              #   pipeline 健康灯（workflow ok/failed；cron 失败路径写 failed）
│       └── <run_id>/                                #   Workflow 单次 run checkpoint
│           ├── manifest.json                        #     步骤清单 + 状态（running / published / failed）
│           ├── validation.json                      #     发布闸门结果（ok · checked · invariants · failures）
│           ├── renames.json                         #     rename step 输出（old_full_name → new_full_name，web 层 308）
│           └── error.json                           #     失败时写入（run_id · error · at）
├── current_month.json                               # 当月活尾（KB 级，每日 cron append-only 覆盖写）
└── hot-snapshot.json                                # 热集聚合（首页 / 当年 / 当月，每日 cron 重写，热集 ISR 读）
```

**Blob 操作约束（写 pipeline 时必须遵守）**：

| 维度 | 数值 | 对策 |
|---|---|---|
| API | `put` / `head` / `list` / `del` / `copy`；可在 build 脚本、cron route、server component 调用 | — |
| 单文件上限 | 5TB | 远超需求（数据仅几十 MB） |
| Pro 容量 | ~5GB 存储 + 100GB 传输/月 | 数据几十 MB，宽裕 |
| **写速率** | **4,500 次/分（75/s）** | **批量 `put()` 必须节流**（限并发 + 间隔），尤其 bootstrap 上传 / Workflow 重算写上万 entity JSON 时 |
| 同路径覆盖 | 需 `allowOverwrite: true` | 覆盖写视图 / 活尾时显式带上 |
| **缓存传播** | 同路径覆盖最长 **60s** 才全网生效 | **每日更新的视图（活尾 / hot-snapshot）读取时带 query 参数 cache-bust**（如 `?v=<date>`），避免读到旧副本 |

> 之所以选 PUBLIC store：JSON 视图本就是要被 build / 运行时直接 `fetch` 的公开数据，公开读免去签名、天然走 CDN。canonical（JSON shard + bootstrap Parquet）虽也在同 store，但只有持 token 的 Workflow / bootstrap 会写它，不在 build / 运行时读路径。

> **`/search-index` Route Handler**：`web/app/search-index/route.ts` 服务端经发布指针读版本化搜索索引（`views/<version>/search/index.json`），响应带 `Cache-Control` 走 CDN（命中 `s-maxage=3600`、首发前 MISS `s-maxage=60`），稳态近零后端。

## Cron 调度

`web/vercel.json` 声明 `crons[]`；Pro 计划 **100 job / 项目**、最小 1 次 / 分。三条 job：

| Job | 调度（UTC） | 动作 | 触发 deploy？ |
|---|---|---|---|
| **每日** | `0 3 * * *`（~03:00） | **Vercel Function / JSON-only**：GraphQL 查 current_stars → append `current_month.json` → 重算 `hot-snapshot.json`、当前月 / 当前周 rank、当月 heatmap → `revalidatePath` 热集页 | **否**（不碰 Parquet / 引擎 / deploy） |
| **每周** | `0 4 * * 0`（周日 ~04:00） | **Vercel Function / 增量刷新**：复用 live refresh，把当前周、当前月与热集重新覆盖写入 Blob，并落 `ops/sync-runs.json` | **否**（长尾按需 ISR；不做全量 build） |
| **每周 refresh workflow** | `0 6 * * 0`（周日 06:00） | **Vercel Workflow / 全量刷新**：`/api/workflows/refresh/start` 鉴权后启动 `refreshWorkflow`——白名单 → 改名 → 元数据 → 折叠 → rank / entity / heatmap 重算 → 校验 → 发布（切指针）→ 版本 GC | **否**（发布只切指针；排程独立于 daily / weekly） |

```jsonc
// web/vercel.json — all scheduled entrypoints run on Vercel Production
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 3 * * *" },
    { "path": "/api/cron/weekly", "schedule": "0 4 * * 0" },
    { "path": "/api/workflows/refresh/start", "schedule": "0 6 * * 0" }
  ]
}
```

> **Vercel-only cron 实现**：每日 job = `web/app/api/cron/daily/route.ts`，每周 job = `web/app/api/cron/weekly/route.ts`，两者都委托 `web/lib/cron/handlers.ts` 并支持 `?dry=1`。CRON_SECRET 鉴权 → GraphQL 拉 current_stars（`web/lib/github.ts`，按 owner / name 批量）→ `web/lib/cron/live-refresh.ts` 幂等 upsert `current_month.json`（按 UTC 日）→ 重算 `hot-snapshot.json`、`live/rank/month/<current>/repo/{flow,stock}.json`、`live/rank/week/<current>/repo/flow.json`、`live/heatmap/month/<current>.json` → `revalidatePath` 核心页 → `ops/sync-runs.json` 记录运行。普通 Vercel Function 不承载一次性 DuckDB / Parquet 全量重算；若需要把历史全量刷新也放进 Vercel，必须拆成 Vercel Workflow 分片步骤，而不是单个 Function。

**鉴权模式（CRON_SECRET）**：

- 触发是对生产 URL 的 **HTTP GET**；配置 `CRON_SECRET` 后 Vercel 自动带 `Authorization: Bearer <CRON_SECRET>`。
- handler 第一步校验该头，与 `process.env.CRON_SECRET` 不符即 `401`，拦截外部直呼 `/api/cron/*`（robots 已屏蔽 `/api/`，但鉴权才是真防线）。

**幂等（关键约束）**：

> Vercel Cron **无自动重试**，且**同一次可能触发两次**。两个 handler **必须幂等**：
> - 每日：`current_month.json` 当月内 **append-only + 覆盖写**，按「今天 UTC 日期」作 upsert 键——重复执行只是用同一份 GraphQL 结果覆盖同一天，不会重复累加。
> - 每周：当前周、当前月与热集视图按「目标周期」幂等覆盖；`ops/sync-runs.json` 保留最近 100 次运行；`revalidatePath` 天然幂等（重复调用无害）。
> - 失败靠**告警**兜底（见下），不靠重试。

**时长**：cron route 是 Function，default 300s / **max 800s**。每日 / 每周 Vercel cron 都只读写 JSON，但 GraphQL 全量轮询需要按批次 pacing；本地全量模拟约 131s，Vercel 实跑必须预留数分钟并控制在 800s 内。DuckDB / Parquet 的历史全量重算不得放进单个 Function；要 Vercel-only 时拆成 Workflow 分片，逐步读写 Blob checkpoint。

**Daily cron 实跑 runbook**：

1. 先在 Vercel production-target URL 调 `GET /api/cron/daily?dry=1`，带 `Authorization: Bearer <CRON_SECRET>`；若日志出现 GitHub GraphQL `403`、`Retry-After` 或 rate-limit remaining 接近 0，停止实跑，先继续降批次 / 加等待。
2. 实跑前记录两个 Blob 对象状态：`current_month.json`、`hot-snapshot.json`。若返回 `404`，记录为「原本不存在」；若存在，下载到本地备份目录再继续。
3. 真实触发 `GET /api/cron/daily`，同样带 `Authorization: Bearer <CRON_SECRET>`。客户端连接可能比函数完成更早关闭；以 Blob 写入和 Vercel logs 为准。
4. 写后运行 `cd web && bun scripts/validate-live-views.ts --bust <UTC day>`，确认 `current_month.json` 包含本次 UTC day，`hot-snapshot.json` schema 可被现有 contracts 校验；再检查 `/`、`/pulse` 仍可访问且保持 noindex。
5. 若再次失败且两个 Blob 仍为 `404`，视为无写入失败，无需数据回滚；若任一对象已写入但校验失败，按 §回滚「每日活尾」处理。

## Vercel Workflow runbook

> 承载历史 / 元数据 / canonical 全量刷新的长任务。本节只给**运维步骤**；**Workflow 设计与 step 清单见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §3**。
>
> 关键约束：**metadata seed 自 `lookup/repos.json`，GitHub 只补新晋**；旧 shard 缺少 GitHub `languages` breakdown 时允许一次性补齐，补完后不每周全量重拉，否则撞 GitHub 二级限流。
>
> 接 cron：`/api/workflows/refresh/start` 在 `web/vercel.json` 的 `crons` 中，调度 `0 6 * * 0`（周日 06:00 UTC，独立于 daily / weekly）。

**为什么用 Workflow 而非单 Function**：单 Function 上限 800s / 4GB / bundle 250MB / 响应体 4.5MB（[Functions Limits](https://vercel.com/docs/functions/limitations)），装不下 DuckDB 全量重算；官方建议超长任务用 [Vercel Workflows](https://vercel.com/docs/workflows)（无单函数时长上限，可 pause / resume / checkpoint）。

**部署前置**：
- **Fluid Compute 必须开启**（Workflow 依赖；Vercel 项目 Settings → Functions）。
- env：`CRON_SECRET`、`GITHUB_TOKEN`、`BLOB_READ_WRITE_TOKEN`、`BLOB_BASE_URL` 同时配 Production 与 Preview。
- 部署：`vercel deploy . --yes --scope zkscio --project gitstarclub.com`（preview，从仓库根；Root Directory=web）。

**手动触发 runbook**：

1. `GET <deployment>/api/workflows/refresh/start`，带 `Authorization: Bearer <CRON_SECRET>` → 拿 `run_id`（route 仅鉴权 + `start(refreshWorkflow)` + 返回，不阻塞）。
2. 在 **Vercel Dashboard → Observability → Workflows** 看 run；或 `bun x workflow inspect runs`。
3. 看 `ops/workflows/<run_id>/manifest.json`（status running / published / failed）+ 产物 `canonical/v2/whitelist/<run_id>.json`、`canonical/v2/repos/<bucket>.json`、`renames.json`、`views/<run_id>/lookup/aliases.json`（buildAliases，recompute 之后 / validate 之前）、`latest-success.json`。
4. 校验白名单数、repos shard 分桶齐全、diff / rename 合理。
5. cron 已接入（`/api/workflows/refresh/start`，`0 6 * * 0`，独立于 daily / weekly 排程）；手动验证某次部署时可先用 `?dry=1` 或单次触发再观察。

> 全链路 step：`fold`（月 + 周）、`recompute`、`buildAliases`（→ `lookup/aliases.json`）、`validate` 发布闸门、`publish` 切 `views/latest.json` 指针 / 回滚、`gc` 版本回收（设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7）。

**鉴权 / 凭证**：`CRON_SECRET`（触发）、`GITHUB_TOKEN`（Search / GraphQL）、`BLOB_READ_WRITE_TOKEN`（读写 canonical / staging / published）。**Workflow 全程 0 GCP**（GCP 仅 bootstrap）。

**告警**：Workflow 失败 / 卡死 → Sentry + `ops/workflows/<run_id>` 状态；因不切指针，线上始终是上一版，可从容排查。

## Deploy Hook 使用（可选）

- 在 web 应用项目 **Settings → Git → Deploy Hooks** 创建（项目须 Git 连接），得到 URL 存入 `VERCEL_DEPLOY_HOOK_URL`；触发 `POST .../deploy/<prj>/<id>`（无 auth / payload）；限额 **5 hook / 项目**。
- **用途有限**：ISR 模型下**数据更新不需要 deploy**（cron 直接 `revalidatePath`）。Deploy 只在**代码 / 结构变更**时发生（一般 Git push 自动部署；此 hook 供手动 / CI 触发一次核心 rebuild）。
- **每日 / 每周 cron 都不触发全量 deploy**：每日 revalidate 热集，每周 revalidate 变更页；长尾页按需 ISR。

> Vercel **每次 deploy 重建所有 build-时 SSG 页**，`.next/cache` 不跨 deploy 保留预渲染 HTML——所以历史 / 长尾页**不在 deploy 构建**（按需 ISR），deploy 只 build 小核心，永不逼近 45min 上限（见 ARCHITECTURE「页面分层」）。

## 监控与告警

| 关注 | 工具 | 触发 |
|---|---|---|
| 运行时 / build / cron 异常 | **Sentry**（Vercel Marketplace 接入） | 未捕获异常、route 报错、build 失败 |
| pipeline 运行记录 | **`ops/sync-runs.json` 日志**（每次每日 / 每周 job 落一条：开始 / 结束时刻、查询数、写入路径、状态） | 供对账与回溯 |
| **数据漂移** | 比对 GraphQL 权威总数 vs adds 累加总数 | **漂移 > 阈值（如 2%）告警**，并以 GraphQL 为锚点重锚（见 ARCHITECTURE「数据校验 / 对账」） |
| **Cron 失败** | Sentry + `sync_runs` 状态 | **任一 cron 失败立即告警**——因无自动重试，漏一次每日 job = 活尾缺一天，必须人工补跑 |
| 单日突刺 | pipeline sanity check | 单日新增极端突刺打日志告警（net 允许为负） |

**告警通道**：Sentry 告警直发（邮件 / Slack 任一）。重点盯**两类无重试的失效**：cron 没跑 / 跑失败、数据漂移越界。

> `sync_runs` 不需要数据库：当前实现覆盖写 Blob 上的 `ops/sync-runs.json`，保留最近 100 次运行；需要更强告警时再把同一条结构化事件同步到 Sentry / Slack。

### 告警 webhook（`ALERT_WEBHOOK_URL`，可选）

数据 pipeline（Vercel Workflow 全量刷新 + 每日 / 每周 cron）失败时调用 `sendAlert`（`web/lib/observability/alert.ts`）。`sendAlert` 有两条投递面，都是**尽力而为、绝不抛错**（告警失败不能拖垮 pipeline）：

1. **永远**写一条可 grep 的结构化日志 `[ALERT] <pipeline> failed`（含 `run_id` / `step` / `error`）到 **Vercel function logs**——即便没配 webhook 也看得到。
2. **当且仅当**设置了环境变量 `ALERT_WEBHOOK_URL` 时，额外向该 URL `POST` 一段 JSON 失败摘要（`{ text, pipeline, run_id, step, error, at }`，5s 超时）。**未设置 = 仅日志**（no-op，不报错）。

**一行接入**：在 Vercel 项目 Settings → Environment Variables 加 `ALERT_WEBHOOK_URL`，值指向一个能收 JSON POST 的端点——Slack / Discord incoming webhook，或调试用的 `https://webhook.site/...`。配上即生效，无需改代码；留空则保持纯日志模式。

> `ops/workflows/health.json` 由 `recordHealth` 写入：Workflow 成功 / 失败都会写 `workflow-refresh` 的 `ok` / `failed`；每日 / 每周 cron 当前只在失败路径写 `cron-daily` / `cron-weekly` 的 `failed`（成功记录仍以 `ops/sync-runs.json` 为准）。因此排查 cron 最近成功时间时，先看 `ops/sync-runs.json`，不要把 health.json 没有 cron `ok` 误判成成功灯缺失。

## 一次性 bootstrap Runbook（归档 / 非日常路径）

> **降级声明**：这是**首次冷启动 / 灾难重建 / 引入新数据源**时手动跑一次的工具，**不是 recurring 运营路径**。产物上传 Blob 后由 Vercel（live cron + Workflow）接管，日常运营 **0 本地依赖 · 0 GCP**。

11 年事件级历史只回填一次，走 **BigQuery**（要 GCP 凭证，约 $10、含稳定 repo.id）。免费替代（ClickHouse 公共实例、自建摄入）评估后均不可行，见 ARCHITECTURE「为什么回填用 BigQuery」。

**前置**：GCP 凭证（`GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID`）· GitHub PAT（`GITHUB_TOKEN`）· Vercel Blob store（`BLOB_READ_WRITE_TOKEN`）。本机 / 全 Node 环境跑，不在 Vercel。

```
1. 查 GH Archive WatchEvents（BigQuery）
   按 repo + UTC 天 汇总 WatchEvent（2015-01 起，量大按年 / 按批分块）→ 导出
2. 本机 DuckDB
   落 per-repo×天 事实表 → star_daily.parquet
   + 算里程碑（破 10k / 50k / 100k 精确日期）
3. GraphQL（GITHUB_TOKEN）
   抓元数据 + owner(+type) + current_stars（权威）→ repos.json
4. DuckDB 预算所有 JSON 视图
   {周 / 月 / 年 / 全时}×{repo / org}×{flow / stock} + entity 曲线 + heatmap
5. 上传 Vercel Blob（BLOB_READ_WRITE_TOKEN）
   canonical/star_daily.parquet + lookup/*.json + rank/** + entity/** + heatmap/**
   ⚠️ 批量 put() 节流到 < 75/s（见 Blob 写速率约束）
```

- **成本**：~$10（一次性）；回填完永不再碰 GCP。
- 口径瑕疵（gross vs net、幸存者偏差、起点 2015）见 ARCHITECTURE，About 页注明。
- 回填完成后 GCP 两个变量即可弃用，日常运营回到 0 GCP。

## Build 约束

> **Vercel build 45 分钟硬上限（所有计划）—— 首要约束。** 绝不在单次 deploy 里 build 全部页面。

- 长尾页（历史 repo / org 详情）走**按需 ISR**，不在 deploy 时构建（见 ARCHITECTURE「页面分层」）。
- 长尾（历史 / repo / org / 周页）**不在 deploy 构建**，按需 ISR 懒生成、存持久 ISR store；数据变更靠 cron `revalidatePath`，不做全量 build。
- OG 图**不在每次 build 生成**：仅数据变化时（pipeline 侧）增量出图存 Blob，历史页 OG 永不重生成。
- build 只读预算好的 JSON 视图直接渲染——**不聚合、不带引擎、不碰原生模块**。

**Function 资源（ISR / cron）核对**：

| 资源 | 默认 | 上限 |
|---|---|---|
| 时长 | 300s | **800s** |
| 内存 / CPU | 2GB / 1 vCPU | 4GB / 2 vCPU |
| `/tmp` | 500MB | — |
| 响应体 | 4.5MB | Blob 直读绕过此限 |

> 每日 cron 与热集 ISR 都只读写 KB 级 JSON，远不触及上述任何上限。读大文件一律走 Blob（绕过 4.5MB 响应体限制）。**全量重算超出单 Function 上限，必须走 Vercel Workflow 分片**（见 §Vercel Workflow runbook）。

## 回滚

- **指针回滚（Workflow 发布）**：base 视图由 Workflow 写 `views/<run_id>/`（version=run_id）→ validate → 切 `views/latest.json` 指针发布。坏数据把指针的 `version` 指回 `prev_version` 即秒级回退（旧版本仍在 `views/<prev>`），见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7。重跑触发：`GET https://www.gitstarclub.com/api/workflows/refresh/start`（Bearer `CRON_SECRET`）。
- **部署回滚**：Vercel 保留历史部署，**Promote 上一个正常 deployment** 即可秒级回退。旧 `gitstarclub-web` 暂保留为额外回滚参考，但正常回滚应在 `gitstarclub.com` 项目内完成。
- **每日活尾**：`current_month.json` 当月 append-only、覆盖写；`hot-snapshot.json` 由同次 daily cron 重写。实跑前先备份已存在对象；若失败前两者原本不存在，回滚就是保持 / 恢复为不存在；若已存在且新写入校验失败，用备份覆盖回 `current_month.json` 与 `hot-snapshot.json`，再用 cache-bust 读取确认。
- **顺序**：先回滚数据（Blob 指回上一版视图）→ 再 redeploy 上一个正常部署 → 核对 `sync_runs` 与漂移恢复正常。
