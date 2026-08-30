---
owner: operations
status: active
last_reviewed: 2026-08-30
source_of_truth_for:
  - branch topology
  - staging and promotion
  - deploy and rollback runbooks
  - cron and workflow operations
  - environment variables and alerting
---

# gitstarclub Operations Runbook

> 运维与部署的唯一真相源。架构与数据流见 [ARCHITECTURE.md](./ARCHITECTURE.md)，产品见 [PRODUCT.md](./PRODUCT.md)。
> 核心原则承袭架构：**Vercel-first 统一计费**、**运行时纯静态零引擎**、**生产数据运营不依赖本地计算**。本文把这些落到具体的项目、环境变量、Cron、Workflow、Blob 与告警上；endpoint method/auth/cache/status contracts 见 [API.md](./API.md)。

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

Access: Preview is locked. Project-level Vercel Authentication
(`ssoProtection.deploymentType=preview`) was re-enabled 2026-08-28 so
`pre.gitstarclub.com`, PR `*.vercel.app` URLs, and leftover preview deployments
require a Vercel team login. Production domains (`gitstarclub.com` /
`www.gitstarclub.com`) stay public. CI uses the existing Protection Bypass for
Automation secret (`VERCEL_AUTOMATION_BYPASS_SECRET` / header
`x-vercel-protection-bypass`) to read identity and run preview-e2e. Humans open
staging while logged into Vercel.

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

集中在 `zkscio/gitstarclub.com` 项目的 Vercel 环境变量里配置。本地把仓库根
`.env.example` 复制为 `web/.env.local`；`web/scripts/lib/env.ts` 只加载该文件，
**勿提交真实值**。读路径与写路径遵循最小权限：只浏览或构建不需要写令牌。

<!-- env-inventory:start -->

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
| `BING_SITE_VERIFICATION` | Bing `msvalidate.01` token | 可选（生产） | Bing 提供的 token | `web/app/_shell/RootShell.tsx` 输出 verification meta；不需要 XML 文件 |
| `INDEXNOW_ENABLED` | IndexNow post-commit 提交开关 | 可选（默认关闭） | 字符串 `1` 才启用 | live cron 提交 pointer 后调用 IndexNow；dry-run / pre-commit 不调用 |
| `SEO_LIVE_BASE` | 集成测试拉取的活线 origin（默认 `https://www.gitstarclub.com`，留空可跳过测试） | 仅测试 | `https://www.gitstarclub.com` 或空串 | `web/lib/integration/seo.test.ts:23` |
| `SEO_EXPECT_INDEXABLE` | Live SEO 验收的环境策略（Preview `0`，Production `1`；未设时按 canonical host 推断） | 仅测试 | `0` 或 `1` | `web/lib/integration/seo.test.ts` · `.github/workflows/ci.yml` |
| `SEO_CANON_ORIGIN` | 集成测试断言的 canonical origin（默认 `https://gitstarclub.com`） | 仅测试 | 绝对 origin（**无尾斜杠**） | `web/lib/integration/seo.test.ts:25` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Preview Vercel Authentication 的 CI bypass（`x-vercel-protection-bypass`） | **必需**（GitHub Actions preview-e2e / product-gates） | Vercel Protection Bypass for Automation token | `web/lib/vercel-protection-bypass.ts` · `web/scripts/resolve-vercel-preview.ts`；不进浏览器、不进生产页面 |

平台和开发工具变量也属于受维护清单；它们不应被误当作应用密钥：

| 变量 | 范围 | 用途 |
|---|---|---|
| `NEXT_RUNTIME` | Next.js 注入 | `nodejs` / `edge`; enables the shared Data Cache 404 sentinel for `bootstrap/latest.json` |
| `VERCEL_ENV` | Vercel 注入 | 区分 Production / Preview / Development 行为 |
| `VERCEL_URL` | Vercel 注入 | `/.well-known/deployment` 返回当前不可变 deployment URL |
| `VERCEL_GIT_COMMIT_SHA` | Vercel 注入 | `/.well-known/deployment` 返回当前部署 commit |
| `NODE_ENV` | runtime/tooling | Next.js 与测试的标准运行模式 |
| `CI` | CI | 启用 CI 专用超时、输出与安全门禁 |
| `PORT` | 本地工具 | 本地 fixture/dev server 监听端口 |
| `BASE_URL` | Playwright/release | 浏览器测试 origin；通常由 deployment resolver 注入 |
| `PLAYWRIGHT_BASE_URL` | Playwright | `BASE_URL` 的显式 Playwright override |
| `IDENTITY_ORIGIN` | release gate | 校验目标部署 canonical identity |
| `LIVE_SMOKE_SITE_URL` | live smoke | live smoke 的目标 origin |
| `RUN_LIVE_SMOKE` | live smoke | 字符串 `1` 才启用显式网络 smoke |
| `BASELINE_SCREENSHOT_DIR` | visual tooling | baseline 截图输出目录 |
| `BASELINE_SCREENSHOT_LOCALES` | visual tooling | baseline locale 子集 |
| `BASELINE_SCREENSHOT_ROUTE_IDS` | visual tooling | baseline route 子集 |
| `BASELINE_SCREENSHOT_YEAR` | visual tooling | baseline 年份参数 |
| `BASELINE_SCREENSHOT_MONTH` | visual tooling | baseline 月份参数 |
| `BASELINE_SCREENSHOT_WEEK` | visual tooling | baseline 周参数 |
| `BASELINE_SCREENSHOT_REPO` | visual tooling | baseline repo 参数 |
| `BASELINE_SCREENSHOT_ORG` | visual tooling | baseline org 参数 |
| `BASELINE_SCREENSHOT_CATEGORY` | visual tooling | baseline category 参数 |

<!-- env-inventory:end -->

**约定**：

- `NEXT_PUBLIC_*` 会进客户端 bundle，**只放非敏感值**；其余一律 Server-only。
- Production 与 Preview 的页面/build 读路径只要求 `BLOB_BASE_URL`。只有 cron /
  Workflow mutation 环境才配置 `BLOB_READ_WRITE_TOKEN`、`CRON_SECRET`、
  `GITHUB_TOKEN`；它们**绝不写进仓库或客户端**。
- 写入 Vercel 变量时必须去掉首尾空白和 BOM；`CRON_SECRET` 带空白会让 Cron header 非法，`BLOB_BASE_URL` 带 BOM 会让 Next.js build 在 sitemap 阶段报 `ERR_INVALID_URL`。
- **GCP 两项仅本地一次性回填用**：用 BigQuery 查 GH Archive（约 $10，含稳定 repo.id）。回填一次后这两个变量即可弃用——**日常运营 0 GCP、0 外部账单**。（为何不用免费的 ClickHouse 公共实例 / 自建：见 ARCHITECTURE「为什么回填用 BigQuery」。）
- 启动时校验必需密钥存在，缺失则 fail-fast（不静默吞）。

## Vercel Blob 布局

使用**一个 PUBLIC store**：海量 JSON 视图由 build / 运行时按**直链 URL** 读取，公开读最省事、命中 CDN。首次 bootstrap 的 views + canonical 先封存在 immutable generation，由 `bootstrap/latest.json` 一次提交；后续 canonical 变更进入该 generation 的 copy-on-write overlay。新布局完整定义见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §4 与 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.11–2.13。

```text
blob://
├── bootstrap/
│   ├── latest.json                                  # atomic bootstrap pointer（previous=null 表示 legacy-flat）
│   ├── generations/<bootstrap-generation>/          # create-only、manifest 封存后永不覆盖
│   │   ├── manifests/{base,canonical}.json           # object path/bytes/SHA-256 完整性收据
│   │   ├── views/**                                  # 首次 base views；views/latest 存在后由 managed views 优先
│   │   └── canonical/
│   │       ├── star_daily.parquet                    # bootstrap 归档
│   │       └── v2/**                                 # immutable canonical seed
│   └── overlays/<bootstrap-generation>/canonical/v2/** # recurring canonical copy-on-write 状态
├── canonical/                                       # legacy flat layout：bootstrap pointer 不存在时才读写
│   ├── star_daily.parquet                          # bootstrap 归档（仅一次性 / 灾难重建读写，非生产路径）
│   └── v2/                                          # 生产 canonical JSON shard（见 VERCEL-DATA-OPERATIONS §4）
│       ├── meta.json                                #   seam_date · schema_ver · folded_through（周/月水位）
│       ├── whitelist/                               #   Workflow step 1：≥10k 白名单（web/lib/workflows/steps/whitelist.ts）
│       │   ├── <run_id>.json                        #     单次 run 快照（entries + diff.added/dropped）
│       │   └── latest.json                          #     指针：{ run_id, ids } —— 下次 run 计算 diff 用
│       ├── repos/{bucket}.json                      #   repo 维度 + active/history + tracked_since + 冻结锚定因子 d
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
├── live/                                            # 当前周期原子活尾（每日 / 每周 cron 写）
│   ├── latest.json                                  #   唯一可变控制对象：完整 generation 指针 + ETag/CAS lease
│   └── generations/<run_id>/                        #   不可变；manifest 写完后才允许切 latest
│       ├── manifest.json                            #     完整文件清单 + idempotency key + previous generation
│       ├── current_month.json · hot-snapshot.json
│       ├── rank/{week|month}/{current}/repo/{flow|stock}.json
│       ├── heatmap/month/{current}.json
│       └── rollover/{period}.json                   #     跨月 pending 的 generation 内恢复副本（仅跨月时）
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
│       │   ├── assignments.json                     #       v2 index（或迁移期可读的 v1 单体）
│       │   └── assignments/shards/{0..31}.json      #       repo_id % 32 分片（单文件 < 1.50 MiB）
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
│       ├── active.json                              #   当前 refresh/rollback lease（ETag CAS；idempotency_key + fencing_token + expiry）
│       ├── health/                                  #   每条 pipeline 独立的 CAS 健康状态（无扁平 health.json）
│       │   ├── workflow-refresh.json                #     Sunday 06:00 唯一 operator signal
│       │   ├── cron-daily.json                      #     每次非 dry 成功/失败都更新
│       │   └── cron-weekly.json                     #     每次非 dry 成功/失败都更新
│       └── <run_id>/                                #   Workflow 单次 run checkpoint
│           ├── manifest.json                        #     步骤清单 + 状态（running / published / failed）
│           ├── canonical-manifest.json              #     必需 canonical shard 的记录数、SHA-256 与完整性收据
│           ├── validation.json                      #     发布闸门结果（ok · checked · invariants · failures）
│           ├── renames.json                         #     rename step 输出（old_full_name → new_full_name，web 层 308）
│           └── error.json                           #     失败时写入（run_id · error · at）
├── current_month.json                               # 迁移期 legacy fallback；新 cron 不再覆盖
└── hot-snapshot.json                                # 迁移期 legacy fallback；新 cron 不再覆盖
```

**Blob 操作约束（写 pipeline 时必须遵守）**：

| 维度 | 数值 | 对策 |
|---|---|---|
| API | `put` / `head` / `list` / `del` / `copy`；可在 build 脚本、cron route、server component 调用 | — |
| 单文件上限 | 5TB | 远超需求（数据仅几十 MB） |
| Pro 容量 | ~5GB 存储 + 100GB 传输/月 | 数据几十 MB，宽裕 |
| **写速率** | **4,500 次/分（75/s）** | **批量 `put()` 必须节流**（限并发 + 间隔），尤其 bootstrap 上传 / Workflow 重算写上万 entity JSON 时 |
| 同路径覆盖 | 需 `allowOverwrite: true` | 仅 pointer / lease / 运维状态可覆盖；live generation 对象必须 `allowOverwrite:false` |
| **缓存传播** | 同路径覆盖最长 **60s** 才全网生效 | 页面进程内仍 memo `live/latest.json` 60s。指针写入 `max-age=0`。**publish 用 Blob API `head()` etag（claim 当时记下的 origin etag）做 fence**，不再用 public GET 判断是否仍持有 lease。public store 不能 private get；CDN 按 path 缓存，`?v=` 无效。周日 weekly 快路径 1–2s 否则会读到 `lease: null`。generation 路径不可变 |

> 之所以选 PUBLIC store：JSON 视图本就是要被 build / 运行时直接 `fetch` 的公开数据，公开读免去签名、天然走 CDN。canonical（JSON shard + bootstrap Parquet）虽也在同 store，但只有持 token 的 Workflow / bootstrap 会写它，不在 build / 运行时读路径。

**安全删除（默认只预览）**：

```bash
cd web

# 枚举完整 prefix，并输出精确 object count + bytes；不会删除
bun scripts/blob-del-prefix.ts views/verify-123/

# 只有 --execute 与逐字相同的 --confirm 同时存在才会删除
bun scripts/blob-del-prefix.ts views/verify-123/ \
  --execute --confirm views/verify-123/
```

preview inventory 不持有写锁，也不删除。执行模式会先取得与 managed/bootstrap publish、rollback 共用的 `ops/workflows/active.json` fenced lease；每个 delete chunk 前按 `renew → 重读 live protection state → 再次核对 fencing → del` 执行，最后才释放 lease。因此 current / rollback target 不可能在 protection check 与 destructive call 之间被切入。`canonical/**`、`ops/**`、`live/**`、`current_month`、`hot-snapshot`、两个 latest pointer、当前 / rollback-target / active Workflow 的 view prefix，以及当前 / rollback bootstrap generation + overlay 都硬阻；`views/`、`bootstrap/generations/`、`bootstrap/overlays/` 等宽前缀也不能执行。自动 GC 在所属 refresh lease 释放前复用同一个 guard。

> **公开 JSON endpoint**：`/search-index`、`/repo-curve` 与静态 data export aliases 的 method/cache/status contract 见 [API.md](./API.md)；Blob 读取与物理布局仍以本节为准。

### Live-rank recovery: `2026-W27`

During the `GITHUB_TOKEN` outage (**2026-06-30 → ~2026-07-12**, issue #280) daily/weekly live refresh failed, so no `live/rank/week/2026-W27/**` was written by cron, and `current_month` / pending never recorded **2026-06-29 … 2026-07-05** (ISO week W27).

**Backfill (landed):** `web/scripts/backfill-live-week.ts` rebuilt `live/rank/week/2026-W27/repo/flow.json` from [GH Archive](https://www.gharchive.org/) hourly `WatchEvent` rows for the tracked ≥10k set (Mon–Sun UTC).

| Caveat | Detail |
|---|---|
| Metric | **Gross** star additions (WatchEvent count), not GraphQL **net** deltas used by normal live cron |
| Completeness | GH Archive `WatchEvent` volume in mid-2026 is **far lower** than 2024 samples for the same hour-of-day (~80× fewer in a spot check). Treat W27 ranks as **ordering best-effort / lower-bound**, not comparable in magnitude to W26/W28 live shards |
| Scope | Top-20 flow only (same shape as live cron) |
| Base ranks | Still absent under `views/<version>/rank/week/2026-W27/**` until July is frozen and fold advances `folded_through.week` past W27 (needs July pending) |

Re-run:

```bash
cd web
# one day at a time (resumable state under $TMPDIR/gitstarclub-backfill-<week>/)
bun run scripts/backfill-live-week.ts --week 2026-W27 --date 2026-06-29
# …
bun run scripts/backfill-live-week.ts --week 2026-W27 --finalize
```

`KNOWN_MISSING_LIVE_WEEKS` is empty after this backfill. Product gates expect `live/rank/week/2026-W27/repo/flow.json` **200**.

## Cron 调度

`web/vercel.json` 声明 `crons[]`；Pro 计划 **100 job / 项目**、最小 1 次 / 分。三条 job：

Endpoint method、auth、query、response、cache 与 status contract 见 [API.md](./API.md)；本节只维护调度、幂等和运维 runbook。

| Job | 调度（UTC） | 动作 | 触发 deploy？ |
|---|---|---|---|
| **每日** | `0 3 * * *`（~03:00） | **Vercel Function / JSON-only**：GraphQL 查 current_stars → 生成并校验完整 immutable live generation → 原子切 `live/latest.json` → `revalidatePath` 热集页 | **否**（不碰 Parquet / 引擎 / deploy） |
| **每周** | `0 4 * * 0`（周日 ~04:00） | **Vercel Function / 增量刷新**：复用同一 generation/pointer 发布协议，并落 `ops/sync-runs.json` | **否**（长尾按需 ISR；不做全量 build） |
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

> **Vercel-only cron 实现**：每日 job = `web/app/api/cron/daily/route.ts`，每周 job = `web/app/api/cron/weekly/route.ts`，两者都委托 `web/lib/cron/handlers.ts` 并支持 `?dry=1`。CRON_SECRET 鉴权 → 以 `<job>:<UTC-day>` 幂等 key 在 `live/latest.json` 取得 15 分钟 ETag/CAS lease → GraphQL 拉 current_stars → `live-refresh.ts` 幂等重建当日状态 → 校验全部 JSON → 写 `live/generations/<run_id>/**`（`current_month.json` v2 index + `current_month/shards/<0-31>.json`）与 manifest → 同一个控制对象做 fenced CAS 切 generation → **之后**才 `revalidatePath` / IndexNow / `ops/sync-runs.json`。UTC 周日 daily 在取得 lease 前返回 `skipped: weekly-owns-sunday`，避免与 04:00 weekly 争 live/health。不同 key 并发返回 409；同 key 运行中返回 202 attached，已提交返回 200 already-published。手动同日再次刷新须提供新的 `idempotency_key`。Publish / release fence with the Blob API `head()` etag captured at acquire — not a public GET of the pointer body (#402). Health CAS 最多 5 次，指数退避 + 抖动；不要靠加次数解决持续冲突。

**Failed weekly / leftover lease:** A false-fence (or any failure after acquire) used to leave `lease` on `live/latest.json` until `expires_at` (~15 min) because release also read the CDN-stale `lease: null` body and skipped the clear. Release now CAS-clears when `claimedEtag` still matches origin `head()`. If an old deploy left a lease stuck, wait until `expires_at` before the next acquire; do not skip that wait by writing `main` or calling production cron unless the user said push main. Sunday **workflow-refresh** failures are the next section, not this path.

### Sunday 06:00 UTC workflow-refresh failure

Schedule: `0 6 * * 0` UTC → `GET /api/workflows/refresh/start` (managed Workflow). This is **not** the Sunday 04:00 weekly live cron above. A leftover `live/latest.json` lease is that other path (#402).

Paging already exists — do not invent new alerts. `markFailed` in `web/lib/workflows/checkpoint.ts` calls `recordHealth("workflow-refresh", "failed", …)` and `sendAlert`. Start-route lease/enqueue failures in `web/lib/workflows/start.ts` also `sendAlert`. `sendAlert` always writes a structured `[ALERT] workflow-refresh failed` function log; it POSTs a webhook only when `ALERT_WEBHOOK_URL` is set.

1. Read **`ops/workflows/health/workflow-refresh.json`** (`status`, `last_failure`, `freshness.stale_after`). **Do not read** retired `ops/workflows/health.json`.
2. Grep Vercel function logs for `[ALERT] workflow-refresh`.
3. Check `ops/workflows/active.json` (`run_id`, `expires_at`, `fencing_token`, `idempotency_key`). Default Sunday key is week-scoped (`workflow-refresh:YYYY-Www`). Same-key retries attach; a different active trigger is 409.
4. Check `ops/workflows/<run_id>/manifest.json`, `error.json`, and `validation.json`. Validate is fail-closed; do not relax invariants.
5. Check `views/latest.json`. If the failure was before publish, the pointer must be unchanged. Do not hand-edit the pointer.
6. Enqueue with a **new** Idempotency-Key only after leftover lease `expires_at`, and only if same-week attach is not the right move. How: authenticated `GET /api/workflows/refresh/start` with a new `Idempotency-Key`. There is **no** dry-run for managed refresh.
7. Hard stops: no validate-invariant relaxation; no inventing `bootstrap/latest.json`; do not push `main` or call production cron unless the user said push main; wait leftover lease; product-gates stay fail-closed.
8. After a successful publish, static exports still need the [DATA-EXPORTS.md](./DATA-EXPORTS.md) regenerate path (#375). Do not duplicate that runbook here.

**Optional — retire the stale flat object (do not run unless the user authorized a production Blob write).** Writers no longer touch `ops/workflows/health.json`. `blob-del-prefix.ts` hard-blocks `ops/**`. If the Jul-2026 object is still confusing operators, overwrite or delete that **single** pathname from the Vercel Blob dashboard after confirming `healthPath` still has no flat-file writer. Do not prefix-delete `ops/`. Do not call production cron to “refresh” it.

**鉴权模式（CRON_SECRET）**：

- 触发是对生产 URL 的 **HTTP GET**；配置 `CRON_SECRET` 后 Vercel 自动带 `Authorization: Bearer <CRON_SECRET>`。
- handler 第一步校验该头，拦截外部直呼 `/api/cron/*` 与 Workflow trigger；精确 status / response contract 见 [API.md](./API.md)（robots 已屏蔽 `/api/`，但鉴权才是真防线）。

**幂等（关键约束）**：

> Vercel Cron **无自动重试**，且**同一次可能触发两次**。两个 handler **必须幂等**：
> - 每日 / 每周：默认 key 为 `<job>:<UTC-day>`；同 key 最多发布一次。租约、当前 generation 和 fencing token 共存于 `live/latest.json`，所以失去 lease 的旧进程不能晚到覆盖新指针。
> - generation 文件不可变；对象写到任意一步失败，`generation` 字段仍指向上一完整版本。部分失败后释放/过期 lease 即可用同 key 重试，已存在的同字节 immutable 对象可安全复用。
> - `current_month` 内仍按 UTC 日 upsert，保证显式新 key 的同日追加刷新不会重复累计。
> - 失败靠**告警**兜底（见下），不靠重试。

**时长**：cron route 是 Function，default 300s / **max 800s**。每日 / 每周 Vercel cron 都只读写 JSON，但 GraphQL 全量轮询需要按批次 pacing；本地全量模拟约 131s，Vercel 实跑必须预留数分钟并控制在 800s 内。DuckDB / Parquet 的历史全量重算不得放进单个 Function；要 Vercel-only 时拆成 Workflow 分片，逐步读写 Blob checkpoint。

**Daily cron 实跑 runbook**：

1. 先在 Vercel production-target URL 调 `GET /api/cron/daily?dry=1`，带 `Authorization: Bearer <CRON_SECRET>`；若日志出现 GitHub GraphQL `403`、`Retry-After` 或 rate-limit remaining 接近 0，停止实跑，先继续降批次 / 加等待。
2. 实跑前记录 `live/latest.json`（尤其 `generation` / `previous_generation` / `lease`）。不需要逐个备份 immutable generation 文件。
3. 真实触发 `GET /api/cron/daily`，同样带 `Authorization: Bearer <CRON_SECRET>`。客户端连接可能比函数完成更早关闭；以 Blob 写入和 Vercel logs 为准。
4. 写后从仓库根运行 `bun web/scripts/validate-live-views.ts --bust <UTC day>`；脚本先解析 `live/latest.json`，再校验同一 generation 的 `current_month` / `hot-snapshot` 与 freshness。再检查 `/`、`/pulse`。
5. 若失败，确认 pointer 的 `generation` 未变；已写但未引用的 partial generation 不影响线上，可留待后续 GC。若已提交内容有误，把 `generation` 指回 `previous_generation`（同时使用 ETag 条件写，勿覆盖活跃 lease）。

## Vercel Workflow runbook

> 承载历史 / 元数据 / canonical 全量刷新的长任务。本节只给**运维步骤**；**Workflow 设计与 step 清单见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §3**。
>
> 关键约束：Search 只发现 membership；metadata 按 32 个 bucket 逐桶对全部 active repo 调 GraphQL `nodes()`，以 `stargazerCount` 写唯一权威 `current_stars`。单桶最多约两批请求并保留批间节流；任一 active repo 缺失 GraphQL 结果即停止发布，不能回退 Search stars。
>
> 接 cron：`/api/workflows/refresh/start` 在 `web/vercel.json` 的 `crons` 中，调度 `0 6 * * 0`（周日 06:00 UTC，独立于 daily / weekly）。

**为什么用 Workflow 而非单 Function**：单 Function 上限 800s / 4GB / bundle 250MB / 响应体 4.5MB（[Functions Limits](https://vercel.com/docs/functions/limitations)），装不下 DuckDB 全量重算；官方建议超长任务用 [Vercel Workflows](https://vercel.com/docs/workflows)（无单函数时长上限，可 pause / resume / checkpoint）。

**部署前置**：
- **Fluid Compute 必须开启**（Workflow 依赖；Vercel 项目 Settings → Functions）。
- env：`CRON_SECRET`、`GITHUB_TOKEN`、`BLOB_READ_WRITE_TOKEN`、`BLOB_BASE_URL` 同时配 Production 与 Preview。
- 部署：`vercel deploy . --yes --scope zkscio --project gitstarclub.com`（preview，从仓库根；Root Directory=web）。

**手动触发 runbook**：

1. `GET <deployment>/api/workflows/refresh/start`，带 `Authorization: Bearer <CRON_SECRET>` → route 先只读校验 `canonical/v2/meta.json` 与全部 32 个 `repos` shard（含 `active` / `tracked_since` / `d`、key/id/bucket），通过后才取得 lease 并 `start(refreshWorkflow)`，随即返回 `run_id`（不阻塞）。preflight 失败时不会 enqueue 或取得 lease；workflow step 0 会在任何 canonical mutation 前再全量校验 128 个必需 shard。
2. 在 **Vercel Dashboard → Observability → Workflows** 看 run；或 `bun x workflow inspect runs`。
3. 看 `ops/workflows/active.json` 的 `(run_id, fencing_token, expires_at)`、`ops/workflows/<run_id>/manifest.json`（status running / published / failed）+ 产物 `canonical/v2/whitelist/<run_id>.json`、`canonical/v2/repos/<bucket>.json`、`renames.json`、`views/<run_id>/lookup/aliases.json`、`publish-intent.json` 与 `latest-success.json`。
4. 校验白名单数、repos shard 分桶齐全、diff / rename 合理。
5. cron 已接入（`/api/workflows/refresh/start`，`0 6 * * 0`，独立于 daily / weekly 排程）。该 managed Workflow **没有 dry-run 模式**；任何 `dry` query 都会在取得 lease 或写入状态前返回 `400`。需要无写入探测时只能使用 `/api/cron/daily?dry=1` 或 `/api/cron/weekly?dry=1`；手动触发 managed refresh 必须按上述步骤观察完整真实运行。

> 全链路 step：`preflight`（再次校验全部 canonical shard）→ `fold`（月 + 周）→ `recompute` → `buildAliases`（→ `lookup/aliases.json`）→ `validate` 发布闸门 → `publish` 切 `views/latest.json` 指针 / 回滚 → `gc` 版本回收（设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7）。

**鉴权 / 凭证**：`CRON_SECRET`（触发）、`GITHUB_TOKEN`（Search / GraphQL）、`BLOB_READ_WRITE_TOKEN`（读写 canonical / staging / published）。**Workflow 全程 0 GCP**（GCP 仅 bootstrap）。

**告警**：Workflow 失败会写结构化 Vercel Function log、可选 webhook、run checkpoint 和独立 health 状态；仓库当前没有 Sentry SDK 或 Marketplace 集成。失败发生在 publish 前时不会切换线上指针。

### Post-publish checklist: static data exports

Workflow publish only cuts the Blob pointer. Committed static exports under
`web/public/data/exports/v1/` do **not** update automatically. Product-gates
`export-manifest-age` requires the deployed manifest `data_as_of` within
**14 days** (`EXPORT_MAX_AGE_MS`). Full copy-paste runbook:
[DATA-EXPORTS.md](./DATA-EXPORTS.md) §After a successful weekly publish.

After a successful `views/latest.json` publish (cron or manual):

1. Confirm `views/latest.json` has the intended `version` / `published_at`.
2. On a branch from `pre`: `cd web && bun run exports:generate`
   (needs `BLOB_BASE_URL` / `NEXT_PUBLIC_BLOB_BASE_URL`).
3. PR the new dated directory `web/public/data/exports/v1/YYYY-MM-DD/` **into
   `pre`**. Do not commit a `latest/` tree; do not push straight to `main`.
4. Verify Preview
   `https://pre.gitstarclub.com/data/exports/v1/latest/manifest.json`.
5. Promote `pre` → `main` through the normal PR path only — no silent
   production overwrite and no runtime export regenerate endpoint.

## Deploy Hook 使用（可选）

- 在 web 应用项目 **Settings → Git → Deploy Hooks** 创建（项目须 Git 连接），得到 URL 存入 `VERCEL_DEPLOY_HOOK_URL`；触发 `POST .../deploy/<prj>/<id>`（无 auth / payload）；限额 **5 hook / 项目**。
- **用途有限**：ISR 模型下**数据更新不需要 deploy**（cron 直接 `revalidatePath`）。Deploy 只在**代码 / 结构变更**时发生（一般 Git push 自动部署；此 hook 供手动 / CI 触发一次核心 rebuild）。
- **每日 / 每周 cron 都不触发全量 deploy**：每日 revalidate 热集，每周 revalidate 变更页；长尾页按需 ISR。

> Vercel **每次 deploy 重建所有 build-时 SSG 页**，`.next/cache` 不跨 deploy 保留预渲染 HTML——所以历史 / 长尾页**不在 deploy 构建**（按需 ISR），deploy 只 build 小核心，永不逼近 45min 上限（见 ARCHITECTURE「页面分层」）。

## 监控与告警

| 关注 | 工具 | 触发 |
|---|---|---|
| 运行时 / build 异常 | Vercel build / function logs | 未捕获异常、route 报错、build 失败；当前没有 Sentry 集成 |
| pipeline 运行记录 | **`ops/sync-runs.json` 日志**（每次每日 / 每周 job 落一条：开始 / 结束时刻、查询数、写入路径、状态） | 供对账与回溯 |
| **数据漂移** | 比对 GraphQL 权威总数 vs adds 累加总数 | **漂移 > 阈值（如 2%）告警**，并以 GraphQL 为锚点重锚（见 ARCHITECTURE「数据校验 / 对账」） |
| **Cron 失败** | `[ALERT]` function log + 可选 `ALERT_WEBHOOK_URL` + `sync-runs` + pipeline health | webhook 投递为 best-effort；失败或未配置时以日志和 health 为准，必要时人工补跑 |
| 单日突刺 | pipeline sanity check | 单日新增极端突刺打日志告警（net 允许为负） |

For aggregate-only GEO crawler and AI-referrer reporting from Vercel-side logs, use [geo/ai-log-reporting.md](./geo/ai-log-reporting.md). That appendix owns the operator command and taxonomy; this runbook owns the production log and alerting context.

**告警通道**：Vercel Function logs 始终存在；`ALERT_WEBHOOK_URL` 可接 Slack / Discord 等接收 JSON POST 的端点。重点盯 cron 没跑 / 跑失败和数据漂移越界。Webhook 不是可靠队列，不应作为唯一状态来源。

> `sync_runs` 不需要数据库：当前实现覆盖写 Blob 上的 `ops/sync-runs.json`，保留最近 100 次运行。需要可靠投递或 paging 时，应另接带持久重试的告警服务；当前代码没有声明该能力。

### 告警 webhook（`ALERT_WEBHOOK_URL`，可选）

数据 pipeline（Vercel Workflow 全量刷新 + 每日 / 每周 cron）失败时调用 `sendAlert`（`web/lib/observability/alert.ts`）。`sendAlert` 有两条投递面，都是**尽力而为、绝不抛错**（告警失败不能拖垮 pipeline）：

1. **永远**写一条可 grep 的结构化日志 `[ALERT] <pipeline> failed`（含 `run_id` / `step` / `error`）到 **Vercel function logs**——即便没配 webhook 也看得到。
2. **当且仅当**设置了环境变量 `ALERT_WEBHOOK_URL` 时，额外向该 URL `POST` 一段 JSON 失败摘要（`{ text, pipeline, run_id, step, error, at }`，单次 5s 超时）。只有 HTTP 2xx 才算成功；408 / 425 / 429 / 5xx、超时和网络错误最多尝试 3 次（100ms / 250ms backoff），其他 4xx 立即标为投递失败。最终结果含 `delivered` / `failed` / `disabled`、attempt 数和安全诊断，并写入结构化日志；不会把 webhook 错误抛回 pipeline。

**一行接入**：在 Vercel 项目 Settings → Environment Variables 加 `ALERT_WEBHOOK_URL`，值指向一个能收 JSON POST 的端点——Slack / Discord incoming webhook，或调试用的 `https://webhook.site/...`。配上即生效，无需改代码；留空则保持纯日志模式。

> `recordHealth` 分别写 `ops/workflows/health/{workflow-refresh|cron-daily|cron-weekly}.json`。Sunday 06:00 的唯一 operator signal 是 `ops/workflows/health/workflow-refresh.json`。扁平 `ops/workflows/health.json` 已退役，不要读。每条记录用 ETag compare-and-set 更新，保留 `last_success`、`last_failure`、`correlation_id` / `run_id` / `idempotency_key`，并给出 `freshness.stale_after`。每日和每周 cron 的每次非 dry 成功与失败都会更新；`attached` / `rejected` 只改变该 pipeline 的 latest signal，不删除历史成功或失败。不同 pipeline 的并发运行不能互相覆盖。

## 一次性 bootstrap Runbook（归档 / 非日常路径）

> **降级声明**：这是**首次冷启动 / 灾难重建 / 引入新数据源**时手动跑一次的工具，**不是 recurring 运营路径**。产物上传 Blob 后由 Vercel（live cron + Workflow）接管，日常运营 **0 本地依赖 · 0 GCP**。

11 年事件级历史只回填一次，走 **BigQuery**（要 GCP 凭证，约 $10、含稳定 repo.id）。免费替代（ClickHouse 公共实例、自建摄入）评估后均不可行，见 ARCHITECTURE「为什么回填用 BigQuery」。

**前置**：GCP 凭证（`GOOGLE_APPLICATION_CREDENTIALS` + `GCP_PROJECT_ID`）· GitHub PAT（`GITHUB_TOKEN`）· Vercel Blob store（`BLOB_READ_WRITE_TOKEN`）。本机 / 全 Node 环境跑，不在 Vercel。

```text
1. 查 GH Archive WatchEvents（BigQuery）
   按 repo + UTC 天 汇总 WatchEvent（2015-01 起，量大按年 / 按批分块）→ 导出
2. 本机 DuckDB
   落 per-repo×天 事实表 → star_daily.parquet
   + 算里程碑（破 10k / 50k / 100k 精确日期）
3. GraphQL（GITHUB_TOKEN）
   Search 发现成员（动态开放上界）；GraphQL 抓元数据 + owner(+type) + current_stars（唯一权威）→ repos.json
4. DuckDB 预算所有 JSON 视图
   {周 / 月 / 年 / 全时}×{repo / org}×{flow / stock} + entity 曲线 + heatmap
5. 生成唯一 id，例如 `bootstrap-20260717T120000Z`；先运行
   `06-upload.mjs --generation <id> --dry-run`，再以同 id stage / resume base phase
6. 运行 `07-export-v2.mjs --generation <id> --stage-only` 检查 canonical phase；确认后重跑
   不带 `--stage-only`。脚本复核 manifest + 远端 bytes/SHA-256，取得 Workflow CAS lease，
   最后只切 `bootstrap/latest.json`。批量 create 节流到 < 75/s
```

- **成本**：~$10（一次性）；回填完永不再碰 GCP。
- 口径瑕疵（gross vs net、幸存者偏差、起点 2015）见 ARCHITECTURE，About 页注明。
- 回填完成后 GCP 两个变量即可弃用，日常运营回到 0 GCP。

## 一次性 canonical lifecycle provenance 迁移（Issue #326）

> 这是为 legacy canonical rows 补齐 lifecycle provenance 的**一次性受控迁移**，不是
> bootstrap 重跑，也不是 recurring Workflow。实现 PR 只交付工具、测试和 dry-run
> 证据；没有明确的生产执行授权时，禁止使用 `--execute`。

2026-07-28 的只读盘点证明：5,393 个 canonical repo row 都缺显式
`active`；当前已发布 whitelist 有 5,389 个 id，因此计划结果是 5,389 个
`active:true`、4 个 retained historical `active:false`。另有 79 个 row 同时为
`tracked_since:null` 且无 `d`。它们不属于 bootstrap historical rows：legacy
`lookup/repos.json` 不含这些 id，而 19 个 immutable whitelist snapshot 能完整恢复首次
出现日（12 个 `2026-06-02`、18 个 `2026-06-28`、49 个 `2026-07-12`）。因此迁移只补
`tracked_since`，**绝不猜测 `d=1`，也不以可变的 current stars 重算 anchor**。

### Dry-run（默认、零生产写）

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts
```

Dry-run 只加载 `BLOB_BASE_URL`，不需要 `BLOB_READ_WRITE_TOKEN`，也不会调用 Blob
create / put / delete。评审至少核对：

- `production_writes=0`；
- source layout / `views/latest.run_id` / 19 个 snapshot hash 均与评审证据一致；
- `canonical_repositories=5393`、`active_true=5389`、`active_false=4`；
- `tracked_since_recovered=79`、`anchors_invented=0`、`changed_buckets=32`；
- 输出的 `plan_sha256` 在重复 dry-run 中不变。

如需保存完整 changed-id / per-bucket checksum 计划，使用
`--plan-out <new-local-file>`；工具只创建新文件，遇到内容不同的既有文件会拒绝覆盖。
`bootstrap/latest.json`、published whitelist pointer、任一 snapshot 或 repo shard 发生漂移
都会产生新计划或直接 fail closed，必须重新评审。

### Execute（必须单独授权）

只有完整 plan 已人工评审、确认当前没有 planned `pre → main` promotion，并取得明确生产
执行授权后，才能运行：

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts \
  --execute \
  --confirm <exact-reviewed-plan-sha256>
```

执行器先取得 `ops/workflows/active.json` 的 shared fenced lease，再把 plan、32 个 before
shard 和 32 个 after shard create-only 封存到
`ops/migrations/canonical-lifecycle/<plan-sha256>/`。plan receipt 最后创建；此后每个
canonical write 只接受两种状态：checksum 等于 reviewed before（待写）或 reviewed after
（重试时已完成）。任何第三种 bytes、pointer drift、lease loss 或 full canonical
validation failure 都中止。Public Blob overwrite 最多可在 CDN 继续暴露旧 bytes 60 秒，
因此写后 exact-after checksum 验证使用覆盖该窗口的有界退避；期间只允许看到 reviewed
before，超出窗口或出现第三种 bytes 仍会失败释放 lease。所有写经 `putOwnedView` 在写前
续租；成功后 full 128-shard canonical validation 必须 `complete=true`。

中断后用**同一条 execute 命令和同一 digest**重试；执行器读取 immutable receipt，跳过已
达到 after checksum 的 bucket。不要生成一个基于 partial state 的新确认 digest。

### Rollback

Rollback 只接受原 plan receipt，且 current shard 必须仍等于该 plan 的 before 或 after
checksum；后续 Workflow 已改写的第三种状态会被硬阻：

```bash
cd web
bun scripts/migrate-canonical-lifecycle.ts \
  --rollback <exact-reviewed-plan-sha256> \
  --execute \
  --confirm <exact-reviewed-plan-sha256>
```

Rollback 恢复 immutable before shards，因此会重新恢复 #320 preflight 所阻断的 legacy
状态；它用于迁移事故恢复，不代表 canonical readiness 已通过。迁移成功后的正常验收是：
再次 dry-run 得到 `changed_repositories=0`，再运行 full canonical preflight / product
gates，最后才重新评估 `pre → main`。

## Build 约束

> **Vercel build 45 分钟硬上限（所有计划）—— 首要约束。** 绝不在单次 deploy 里 build 全部页面。

- 长尾页（历史 repo / org 详情）走**按需 ISR**，不在 deploy 时构建（见 ARCHITECTURE「页面分层」）。
- 长尾（历史 / repo / org / 周页）**不在 deploy 构建**，按需 ISR 懒生成、存持久 ISR store；数据变更靠 cron `revalidatePath`，不做全量 build。
- OG 图**不在每次 build 全量生成**：四类 `next/og` route 在请求/ISR 时现绘，
  `revalidate=86400` 后由 Vercel ISR/CDN 缓存；没有 pipeline 侧 OG 生成或 Blob
  `og/*` 产物。
- build 只读预算好的 JSON 视图直接渲染——**不聚合、不带引擎、不碰原生模块**。

**Function 资源（ISR / cron）核对**：

| 资源 | 默认 | 上限 |
|---|---|---|
| 时长 | 300s | **800s** |
| 内存 / CPU | 2GB / 1 vCPU | 4GB / 2 vCPU |
| `/tmp` | 500MB | — |
| 响应体 | 4.5MB | Blob 直读绕过此限 |

> 每日 cron 与热集 ISR 都只读写 KB 级 JSON，远不触及上述任何上限。读大文件一律走 Blob（绕过 4.5MB 响应体限制）。**全量重算超出单 Function 上限，必须走 Vercel Workflow 分片**（见 §Vercel Workflow runbook）。

## Vercel Firewall bot rules (pre-app)

`robots.txt` is not a security boundary and still incurs Edge/middleware cost
if the request reaches the deployment. Apply these **Vercel Firewall** rules
on project `gitstarclub.com` (`prj_V9RVqspNWPXXiytX7Fj3wlMT9wNw`, scope
`zkscio`) so blocked crawlers never enter Fluid/ISR/Blob:

| Rule | Condition | Action |
|---|---|---|
| Block Meta external agent | User-Agent contains `meta-externalagent` OR `facebookexternalhit` | Deny |
| Block GoogleOther | User-Agent contains `GoogleOther` | Deny |
| Block GPTBot training | User-Agent contains `GPTBot` and does **not** contain `OAI-SearchBot` or `ChatGPT-User` | Deny |
| Block SEO scrapers | User-Agent contains `AhrefsBot` OR `Amazonbot` OR `PetalBot` OR `Bytespider` OR `SemrushBot` OR `DotBot` OR `CCBot` | Deny |
| Rate-limit remaining unknown bots | `bot_category` is `unclassified` or `tool`, path matches `/:locale(ja\|zh\|zh-TW\|ko\|es\|fr)?/:owner/:name` | Challenge or 30 req/min/IP |

Do not implement these blocks as application middleware 403s; that still
bills Edge invocations. Keep `Googlebot` and `Bingbot` unblocked.

The table above is the optional recipe. **Do not apply it unless an operator
explicitly asks.** On 2026-08-20 the four Deny rules were published, then
**removed the same day** after the operator chose to allow those crawlers
(including Meta link-preview). Production currently has **zero custom
Firewall rules**. The unclassified/tool rate-limit was never published
(Security Plus 401). Re-apply only with a new dated decision; then
`vercel firewall publish`.

Operator command for the missing bootstrap pointer (dry-run first):

```text
cd web && bun scripts/ensure-bootstrap-pointer.ts
cd web && bun scripts/ensure-bootstrap-pointer.ts --execute
```

`--execute` only writes when a sealed `bootstrap/generations/<id>` already
exists. If none exists, the plan is `leave-legacy-flat` and no pointer is
invented. Creating a pointer is not the root-cost fix: a missing pointer is a
normal long-lived legacy state and must stay negatively cached with coalesced
reads even if the object disappears again.

## 回滚

- **指针回滚（Workflow 发布）**：不要直接覆盖 Blob。用稳定 idempotency key 调受保护 rollback API；它取得 fenced lease、固定 rollback intent、同步 recovery / whitelist pointer 并失效页面和 pointer cache。示例：`curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Idempotency-Key: rollback-<incident>" -H "Content-Type: application/json" --data '{"target_version":"<views/latest.prev_version>"}' https://www.gitstarclub.com/api/workflows/refresh/rollback`。返回成功后在 **≤60s** 可见性 SLA 内核对页面与 `views/latest.json`。设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §7。
- **bootstrap generation / legacy 回滚**：先读取 `bootstrap/latest.previous_generation`。值为 generation 时执行 `cd pipeline && node backfill/07-export-v2.mjs --rollback <bootstrap-generation> --execute`；首次 publish 的值为 `null`，其明确含义是执行 `--rollback legacy-flat --execute`。generation target 在 lease 前复核 sealed manifests 与全部对象；mutable legacy target 在取得同一个 Workflow CAS lease 后验证关键 flat base artifacts 和全部 `4 × 32` canonical shards。随后命令在 lease 内重读 pointer，只做一次 pointer 覆盖；legacy target 则原子删除 `bootstrap/latest.json`。写/删 pointer 已成功但响应丢失时，同 target 重试返回 `already-rolled-back`。不要手改 pointer，也不要删除 current / previous generation 或 overlay。
- **部署回滚**：Vercel 保留历史部署，**Promote 上一个正常 deployment** 即可秒级回退。旧 `gitstarclub-web` 暂保留为额外回滚参考，但正常回滚应在 `gitstarclub.com` 项目内完成。Cost-control changes (robots, pointer cache, long-tail ISR, proxy matcher) rollback the same way: promote the previous Ready production deployment, then revert any Firewall deny rules that were added in the same change window.
- **每日活尾**：`live/generations/<run_id>/**` 不可变，`live/latest.json` 是唯一发布开关。提交前失败无需数据回滚（pointer 仍指向旧 generation）；提交后发现坏数据，将 pointer 的 `generation` 指回 `previous_generation`。回滚也必须先确认没有活跃 `lease` 并使用 ETag 条件写，避免覆盖正在发布的 cron。
- **顺序**：先回滚数据（Blob 指回上一版视图）→ 再 redeploy 上一个正常部署 → 核对 `sync_runs` 与漂移恢复正常。
