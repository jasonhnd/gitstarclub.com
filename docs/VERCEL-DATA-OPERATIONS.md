# gitstarclub Vercel 数据运营（VERCEL-DATA-OPERATIONS）

> 本文目标:描述 gitstarclub 生产数据生命周期在 Vercel 上的当前运行形态——所有 recurring 数据作业在 Vercel 触发、运行、记录、发布、回滚。本机 `pipeline/backfill` 仅作为一次性 bootstrap 工具 / 历史归档,不在日常运营路径上。
>
> 关联:架构总览 [ARCHITECTURE.md](./ARCHITECTURE.md) · 数据契约 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) · 运维 [OPS.md](./OPS.md) · pipeline [PIPELINE.md](./PIPELINE.md) · 测试 [TESTING.md](./TESTING.md) · 变更记录 [CHANGELOG.md](./CHANGELOG.md)。
>
> 官方参考:[Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) · [Vercel Workflows](https://vercel.com/docs/workflows)(含 [Concepts](https://vercel.com/docs/workflows/concepts))· [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)。

---

## Scope

本文描述 recurring 数据刷新如何在 Vercel 上运行:Vercel Workflow 编排、Blob 物理布局、`views/latest.json` 发布指针、原子版本切换与回滚模型。**修改 recompute 流水线或读侧版本解析路径之前,先读本文**。读侧契约见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md);运维操作手册见 [OPS.md](./OPS.md)。

---

## 1. 系统总览与边界

### 1.1 系统定位

gitstarclub 的运行时是**纯静态**:用户请求只读预算好的 JSON / Blob,**永不触达 Workflow / 引擎 / 数据库**(见 [ARCHITECTURE.md](./ARCHITECTURE.md))。本文描述的数据运营层负责**离线产出这些静态 JSON**:白名单刷新、元数据刷新、改名检测、新晋追踪、canonical 折叠、rank/entity/heatmap 重算、校验、发布、回滚——全部在 Vercel 触发并运行。

### 1.2 不变的约束

- **运行时纯静态**:Workflow 只产出数据,页面不知道它存在。
- **Vercel-first / 避免散落账单**:不引入 GCP / 第三方队列 / 外部数据库作为 recurring 依赖。BigQuery 仅在一次性 bootstrap 时作为可选历史数据源(见 §10)。
- **不做 16k 全量 build**:发布只切指针 + revalidate 核心热集,长尾走按需 ISR(见 [ARCHITECTURE.md](./ARCHITECTURE.md) 页面分层)。

### 1.3 关键设计决策:为什么不能把全量重算塞进一个 Function

| 限制 | 普通 Vercel Function(Pro,Node.js) | 对全量重算的影响 |
|---|---|---|
| **最长时长** | 默认 300s,**最大 800s**(13 分钟) | DuckDB 读 8M 行 Parquet 全量预算 16k+ 视图远超 13 分钟 |
| **内存 / CPU** | 默认 2GB / 1 vCPU,**最大 4GB / 2 vCPU** | 本机 precompute 已需 `--max-old-space-size=4096`,贴着上限 |
| **包体积** | 部署 bundle **≤ 250MB**(解压) | `@duckdb/node-api` 原生模块体积大、且 serverless 跑原生模块不可靠 |
| **响应体** | 请求 / 响应体 **≤ 4.5MB** | 大文件必须走 Blob 直链读写绕过此限 |

> 官方明确建议([Functions Limits](https://vercel.com/docs/functions/limitations)):**需要超长执行时间的工作负载,用 [Vercel Workflows](https://vercel.com/docs/workflows)**——它能让代码 pause / resume / 跨步骤保存状态,**无单函数时长上限**。
>
> 因此结论:**Cron 只负责触发**(对生产 URL 的一次 GET);**长任务交给 Workflow 拆成多个 step**,每个 step 是一个独立、可重试、短小的 Function 调用,step 之间用 Blob checkpoint 记录进度。**不在任何单个 Function 里加载 DuckDB / Parquet 做全量重算。**

---

## 2. 运行分层

数据作业按「频率 × 重量」分四层,明确各自跑在哪:

| 层 | 作业 | 跑在哪 | 触发 |
|---|---|---|---|
| **L1 每日 live** | poll current_stars → 写 `current_month.json` + `live/*` 当前周期覆盖层 + `hot-snapshot.json` → revalidate 热集 | **Vercel Function**(单函数,JSON-only,秒级) | Cron `0 3 * * *` |
| **L2 每周 live** | 复用 live refresh,覆盖写当前周 / 当前月 rank + 当月 heatmap + hot snapshot + `ops/sync-runs.json` | **Vercel Function**(单函数,JSON-only) | Cron `0 4 * * 0` |
| **L3 Managed refresh** | 白名单 diff → 元数据 shard → 改名检测 → 月+周折叠 → rank/entity/heatmap 全量重算 → 校验 → 发布(切指针)→ 版本 GC(step 详见 §4) | **Vercel Workflow**(多 step,Blob checkpoint) | 每周 cron + 手动(调度见 [OPS.md](./OPS.md) §Cron) |
| **L4 Bootstrap archive** | 11 年事件级历史首次回填(Search → BigQuery → DuckDB → JSON → Blob) | **本机 / 全 Node**(`pipeline/backfill`) | 手动,一次性 |

> 上表「触发」列只标各层的调度归属;**三条 cron 的权威调度(`0 3` / `0 4` / `0 6` 及 `vercel.json` 声明)见 [OPS.md](./OPS.md) §Cron**。

**分工原则**:
- **L1 / L2** 处理「当前周期的活尾」——KB 级 JSON,单函数秒级。
- **L3** 处理「跨周期的全量 / 历史 / 元数据刷新」——重、慢、需断点,必须 Workflow。**这是本文的核心。**
- **L4** 只在「从零冷启动」或「灾难重建」时跑一次,产出被 L3 接管后即退役。

> L2 与 L3 的关系:L2 是「轻量活尾兜底」,L3 负责「全量重算 + 历史折叠 + 元数据」。两者读写不同的 Blob 前缀(live 覆盖层 vs canonical / `views/<run_id>`),天然隔离。

---

## 3. Vercel Workflow 模式(L3 设计核心)

### 3.1 Workflow 与 Cron / Function 的职责切分

```
Vercel Cron(GET /api/workflows/refresh/start,带 CRON_SECRET)
  └─ route 只做一件事:鉴权 + 启动 workflow,立即返回 run_id(不阻塞)
       └─ Vercel Workflow('use workflow'):编排下列 steps,可 pause/resume、跨部署存活
            ├─ step 1  refresh whitelist                 ('use step')
            ├─ step 2  rename detection(先于 metadata,读旧 full_name)
            ├─ step 3  metadata shards(按 bucket 循环,含 newcomer-aware `tracked_since`)
            ├─ step 4  canonical fold(月+周折叠已收口周期)
            ├─ step 5  rank recompute(跨桶 gather)        → views/<run_id>/rank/**
            ├─ step 6a entity/repo recompute(桶内独立)    → views/<run_id>/entity/repo/**
            ├─ step 6b entity/org recompute(跨桶 gather + 派生 search/index.json)
            │                                              → views/<run_id>/entity/org/** + lookup/** + search/index.json
            ├─ step 7  heatmap update                       → views/<run_id>/heatmap/**
            ├─ step 8  validate(Zod + sanity,对 views/<run_id> 该版本)
            ├─ step 9  publish(更新 views/latest.json 指针)
            └─ step 10 gc(版本垃圾回收,best-effort)
```

> 上图 step 顺序与实现源码 `web/lib/workflows/refresh.ts` L27–60 一致:
> `whitelist → rename → metadata(per-bucket loop)→ fold → rank → repo-entities → org-entities → heatmap → validate → publish → gc`。
> Workflow 编排到 `gc` 即结束,**不主动调 `revalidatePath`**——读侧通过 `views/latest.json` 指针 + 60s TTL 自然拾取(§7.4),按需 ISR 接管长尾;若要把传播窗口从 60s 压到秒级,由 live-overlay cron handler 单独负责 revalidate(职责分离,不在 L3 workflow 内)。

**为什么 Cron route 不直接干活**:Cron 触发是对生产 URL 的一次 HTTP GET,受 Function 时长 / 内存约束。所以 route 仅「鉴权 + 启动 workflow + 返回」,把真正的长任务交给 Workflow runtime 异步编排。

### 3.2 Workflow SDK 落地形态

Vercel Workflow([Workflows Concepts](https://vercel.com/docs/workflows/concepts))用两个指令把普通 async 函数变成持久化工作流:

- **`'use workflow'`**:标记 workflow 函数——有状态、记住进度、崩溃 / 部署后**确定性重放**从断点恢复。
- **`'use step'`**:标记 step 函数——无状态的一个持久工作单元,**内建重试**,能扛网络错误 / 进程崩溃;step 执行时 workflow 挂起、不占资源;step 完成后自动恢复。
- **`sleep('...')`**(来自 `workflow` 包):暂停若干分钟到若干月,不占资源——用于 GitHub rate-limit 窗口等待(见 §10)。

> 安装:`bun i workflow`(在 `web/` 项目内,因 Workflow 由 Vercel Functions 执行,与 Next.js 同部署)。

骨架示意(**结构示意;实现见 `web/lib/workflows/refresh.ts` + `steps/*`,函数名以代码为准**):

```ts
// web/lib/workflows/refresh.ts
export async function refreshWorkflow(runId: string) {
  'use workflow';

  await refreshWhitelist(runId);                       // step 1
  await detectRenames(runId);                          // step 2(先于 metadata,读旧 full_name)
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    await refreshMetadataBucket(runId, bucket);        // step 3(per-bucket loop,含 newcomer-aware tracked_since)
  }
  await foldCanonical(runId);                          // step 4(月+周折叠;读 pending 冻结快照,防重复/丢数据)
  await recomputeRank(runId);                          // step 5(跨桶 gather)
  await recomputeRepoEntities(runId);                  // step 6a(桶内独立,可并行分批)
  await recomputeOrgEntities(runId);                   // step 6b(跨桶 gather + 成员 carry-forward + 派生 search/index.json)
  await recomputeHeatmap(runId);                       // step 7
  await validateVersion(runId);                        // step 8
  await publishVersion(runId);                         // step 9(切 views/latest.json 指针)
  await gcVersions(runId);                             // step 10(版本 GC,best-effort 不抛)
  return { runId, ok: true };
}

// web/lib/workflows/steps/recompute-rank.ts
async function recomputeRank(runId: string) {
  'use step';                            // 独立 Function 路由、内建重试、幂等
  // 载入全部 canonical/v2 月/周 shard(Blob 直链)建 period 索引 → 算 rank → 写 views/<runId>/rank/**
  // ⚠️ 跨桶:rank/all-time/org 都需全部 repo,不能按桶切(见 §3.3 两类重算形状)
}
```

> 实现源码见 `web/lib/workflows/refresh.ts`(workflow 编排)+ `web/lib/workflows/steps/*`(各 step 实现)。函数名以代码为准,本文表格用「逻辑职责」描述。

### 3.3 step 切分原则

| 原则 | 落地 |
|---|---|
| **每个 step 短小** | 单 step 控制在 Function 时长 / 内存内(< 800s、< 4GB)。重算按 **shard 分批**:rank 重算每 step 处理 1 个周期或 1 个 period 批,不是「一次算完所有周期」。 |
| **每个 step 幂等** | step 输入 = `(run_id, shard 范围)`;输出按确定路径覆盖写 `views/<run_id>/`。重跑同 `run_id` = 覆盖同一份产物,不重复累加(见 §11)。 |
| **step 之间用 Blob checkpoint** | 每个 step 完成后写 `ops/workflows/<run_id>/steps/<step>.json`(状态 + 产物清单 + 计数)。Workflow SDK 自身也持久化 step 结果;checkpoint 是**业务可读**的进度账本,供运维 / 恢复用。 |
| **大数据走 Blob 直链** | step 间不通过 Workflow 传大 payload(受 4.5MB 限)。step 只传 `run_id` / shard key 等小标识;数据落 Blob,下一 step 从 Blob 直链读。 |
| **长等待用 sleep** | 命中 GitHub secondary rate limit / `Retry-After` 时,step 内短等待;跨小时级配额恢复用 workflow `sleep('1 hour')`,不空转占资源。 |

> ⚠️ **两类重算形状(实现者必读)**:shard 按 `repo_id % N` 分桶,但**不是所有重算都桶内自洽**——
> - **桶内独立(可按桶并行分批)**:**entity/repo** —— 每个 repo 的 entity 文件只依赖它自己那一桶的数据(monthly/weekly/recent-daily/meta),天然可按桶分 step。
> - **必须跨桶 gather(不能按桶切)**:**rank(任一周期需全部 repo 同期 flow/stock)、entity/org(成员 `repo_id` 散落不同桶,见 C2)、all-time(全量排序)** —— 这些 step 要先**把全部 `repo-monthly`(以及需要时 `repo-weekly`)桶载入内存建索引**,再按 period / owner 聚合。全量 repo-monthly ≈ 数 MB(见 §5.2),整体载入远低于 4GB,可行;但**绝不能误以为能桶内算完**。

---

## 4. Workflow 流水线职责

| # | step | 读 | 写 | 说明 |
|---|---|---|---|---|
| 1 | refresh whitelist | GitHub Search `stars:>=10000` | `canonical/v2/whitelist/<run_id>.json` + diff | 自适应分桶绕过 Search 1000 上限(逻辑同 `01-whitelist`,但跑在 Vercel)。算出**新晋**(新 id)与**跌出**(旧 id 不再 ≥10k)。 |
| 2 | rename detection | 新旧 `repos/<bucket>` | rename map → `ops/workflows/<run_id>/renames.json` | full_name 变化的 repo:记录旧→新映射,供 web 层 301(见 [SEO.md](./SEO.md) §7)。**先于 metadata 跑**——metadata 会覆盖 `full_name`,改名检测必须在覆盖前读到旧值。canonical 按 `repo_id` 归并,改名不丢历史。 |
| 3 | metadata shards(**按 bucket,1 step/桶**,内含 newcomer 追踪) | bootstrap `lookup/repos.json`(owner_type/language)+ run whitelist(node_id、新鲜 current_stars、rename-aware full_name) | `canonical/v2/repos/<bucket>.json`(含 `tracked_since` + GitHub `languages`) | **存量 repo 从 bootstrap seed,不重拉 GitHub**;GitHub GraphQL `nodes()` 只补"既不在 prev shard 也不在 lookup"的真新晋(~12)，以及缺少 `languages` breakdown 的旧 shard repo（一次性补齐后不再每周全量重拉）。**newcomer 追踪不是独立 step**——发现新 id 时同步写 `tracked_since`(默认方案 A,见 §10)。⚠️ **不可每次全量重拉所有 repo**——会撞 GitHub 二级限流(已实测)。每桶一个短 step,幂等。milestones/description/topics 留待 entity 富化。 |
| 4 | canonical fold | 已收口周期的**冻结快照** `canonical/v2/pending/<period>.json` + recent-daily | `canonical/v2/repo-monthly/**` `repo-weekly/**` `site-daily/**` + `meta.json.folded_through` | **折叠**:周期收口时把活尾 net delta 折进月/周 rollup shard;append 站点日总量。**交接靠水位标记防重复/丢数据**——见 §7.2(H1):cron 跨期重置 `current_month.json` 前先把上一期完整 `per_repo` 落到 `canonical/v2/pending/<period>.json`,fold 只读 pending、折叠后标记 `folded_through=period`。跌出者保留历史 shard、停止 poll。 |
| 5 | rank recompute(**跨桶 gather**) | 全部 `repo-monthly`/`repo-weekly` + `repos`/`meta` shard | `views/<run_id>/rank/**` | 载入全部 monthly/weekly 桶建「period→repos」索引,按 period 算 flow/stock + all-time,幂等写 staging。**growth**:期初 stock = monthly `stock_est` 前缀和在 `period-1` 的值(§6.3),floor 期初 ≥20k;**new**:直接用 `repos.crossed_10k` 落当期判定(**不另用 stock_est 重算**,口径同 [RANKING.md](./RANKING.md) §4)。stock 锚定见 §6.3 / [RANKING.md](./RANKING.md) §3。 |
| 5a | category artifacts(**same gather as rank**) | `repos` + rank inputs already loaded by step 5 | `views/<run_id>/categories/**` + `lookup/categories.json` + `rank/category/**/all-time/repo/stock.json` | Phase-1 deterministic category registry, repo assignments, public category lookup, and bounded all-time category stock ranks. Windowed category ranks stay out of Phase 1 to avoid a large view-count expansion. |
| 6a | entity/repo recompute(**桶内独立**) | 单桶 `repo-monthly`/`repo-weekly`/`repo-recent-daily`/`repos` | `views/<run_id>/entity/repo/**` | 每个 repo 只依赖自己那桶,可按桶并行分 step。 |
| 6b | entity/org recompute(**跨桶 gather**) | 全部 `repo-monthly`/`repo-weekly` + `repos`(owner→members) | `views/<run_id>/entity/org/**` + `lookup/**` + `search/index.json` | **不能按桶算**(成员散落各桶,C2):先全量载入 monthly/weekly 桶,按 `owner` 聚合;org stock 须先对每个成员做 `首次事件期→末期` **carry-forward** 再求和(空期沿用上一期累计),终点对齐 `current_stars_sum`(口径同 [RANKING.md](./RANKING.md) §5)。同步从 `repos` 维度派生 `search/index.json`(客户端搜索索引,见 [DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.14)。 |
| 7 | heatmap update | `site-daily` shard(+ 派生月总量) | `views/<run_id>/heatmap/**` | 站点级日 / 月总量(月总量 = site-daily 当月求和)。 |
| 8 | validate | `views/<run_id>/**` | `ops/workflows/<run_id>/validation.json` | Zod schema + sanity 不变量(见 §8 实测清单)。**不过不发布**。 |
| 9 | publish | `views/<run_id>/**` | `views/latest.json` 指针 + `ops/workflows/latest-success.json` | 原子切指针(version=run_id):读侧从此读新版本(见 §7)。 |
| 10 | gc | `views/latest.json` + `list(views/)` | `del views/<旧 version>/**` | **版本 GC**(`gc.ts`,发布后跑):保留最新 4 版 + 当前 / `prev_version` 指针(回滚目标),删更旧的孤儿版本。**best-effort、绝不抛错**——清理失败不拖垮已发布的 run。 |

> 上表是**逻辑职责**枚举,顺序与 `web/lib/workflows/refresh.ts` L27–60 完全一致(`whitelist → rename → metadata(per-bucket loop)→ fold → rank → repo-entities → org-entities → heatmap → validate → publish → gc`)。运行 manifest 把这些归并为 8 个 checkpoint step(`whitelist / rename / metadata / fold / recompute / validate / publish / gc`),见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.12。
>
> ⚠️ **workflow 不调 `revalidatePath`**:发布后读侧通过 `views/latest.json` 指针 + 60s TTL 自然拾取新版本(§7.4);若要把传播窗口从 60s 压到秒级,由 live-overlay cron handler 负责 revalidate,不在 L3 workflow 路径内(职责分离 / 可独立 GC)。

---

## 5. Blob 物理布局

> 沿用 [OPS.md](./OPS.md) 的单一 PUBLIC store。下面只列**与 L3 Workflow 生命周期直接相关的前缀**(`canonical/v2/*`、`views/*`、`ops/workflows/*`,以及 L1/L2 活尾即 `live/*` / `current_month.json` / `hot-snapshot.json` 的位置点)。`lookup/`、`search/index.json`、`current_month.json` 是 L3 / L1 的**一级产物**故同列于此;**完整 Blob 树(含历史前缀 / 完整 `live/*` 子目录 / 归档残留)以 [OPS.md](./OPS.md) §Blob 布局为准**——本节与 OPS 冗余,以 OPS 为权威。`canonical/star_daily.parquet` 已降级为 bootstrap 归档(仍可留存,不在生产读路径)。

```
blob://
├── ops/workflows/                           # L3 Workflow checkpoints + 元信息
│   ├── <run_id>/
│   │   ├── manifest.json                    # run 元信息:触发时间、step 列表、整体状态
│   │   ├── steps/<step>.json                # 每个 step 的 checkpoint(状态 + 产物 + 计数)
│   │   ├── renames.json                     # 改名映射(rename step 产出)
│   │   ├── validation.json                  # 校验报告(validate step 产出,见 §8)
│   │   └── error.json                       # 失败时写入(markFailed,含 step + message,便于排查)
│   ├── latest-success.json                  # 最近一次成功发布的 run_id(恢复点)
│   └── health.json                          # 整体健康状态(最近 run 摘要,供运维 / 监控查询)
│
├── canonical/v2/                            # 生产 canonical(JSON shard)
│   ├── meta.json                            # seam_date · schema_ver · folded_through(周/月水位,见 §6.3/§7.2)
│   ├── whitelist/<run_id>.json              # 白名单快照 + diff(每次 whitelist step 产出)
│   ├── repos/<bucket>.json                  # repo 维度 + 里程碑 + tracked_since + 冻结折扣 d(按 id 分桶)
│   ├── repo-monthly/<bucket>.json           # per-repo 月 flow 序列(驱动月榜 + 月曲线)
│   ├── repo-weekly/<bucket>.json            # per-repo ISO 周 flow 序列(驱动历史周榜)
│   ├── repo-recent-daily/<bucket>.json      # per-repo 近 ~90 天日点(曲线尾 + 周边界)
│   ├── site-daily/<yyyy>.json               # 站点级日总量(驱动 heatmap)
│   └── pending/<period>.json                # 已收口、待折叠的周期活尾冻结快照(cron 写、fold step 读,见 §7.2)
│   # (同级 canonical/star_daily.parquet 是 bootstrap 归档,仅 L4 / 灾难重建用——见 OPS §Blob 布局)
│
├── live/                                    # L1/L2 活尾覆盖层(完整子目录见 OPS §Blob 布局)
├── current_month.json                       # 当月 per_repo 活尾(L1 daily cron 维护,跨月落 pending,见 §7.2)
├── hot-snapshot.json                        # 热榜活尾快照(L1/L2 cron 维护)
│
└── views/                                   # 发布层(指针切换)
    ├── latest.json                          # 指针:当前生效的版本前缀(version = run_id;见 §7)
    └── <run_id>/                            # 一个 run 的完整视图版本(version=run_id,无独立 staging/published)
        ├── meta.json                        # 该版本元信息(含 seam_date,validate 必读)
        ├── rank/**                          # 全周期 flow/stock + all-time(repo + org)
        ├── entity/repo/<id>.json            # per-repo entity(曲线 monthly + recent_daily + 里程碑)
        ├── entity/org/<login>.json          # per-org entity(carry-forward 后求和)
        ├── heatmap/year/<yyyy>.json         # 年度热力图
        ├── lookup/repos.json                # repo 维度查询表(owner_type / language / full_name 等)
        ├── search/index.json                # 客户端搜索索引(见 DATA-CONTRACTS §2.14)
        └── current_month.json               # 该版本快照下的当月活尾投影(读侧可用作回退)
        # 写完→validate→指针指向它即上线
```

Phase-1 category outputs under `views/<run_id>/`:

- `categories/registry.json`
- `categories/assignments.json`
- `lookup/categories.json`
- `rank/category/<dimension>/<slug>/all-time/repo/stock.json`

These are written by the rank recompute gather. Windowed category ranks are not
part of Phase 1 because they multiply the view count across every public
category and every historical week/month/year.

### 5.1 读路径优先级(页面如何选版本)

页面 / 数据层先读 `views/latest.json` 指针解析出 `<version>`(下记 `V = views/<version>`,version = run_id),再按「live 优先、回退 base」取数。**关键:用 `meta.folded_through` 水位决定某周期归 live 还是归 base,避免重复计数(§7.2)**:

```
未折叠周期(period > folded_through,即当前/刚收口未发布):
    rank/heatmap:  live/* (L1/L2 活尾) → 回退 V/* (上一版 base,可能尚不含该期)
已折叠周期(period ≤ folded_through,base 已含):
    rank/heatmap:  直接读 V/* (不再叠 live,防重复)
entity / lookup:    V/* (L3 发布版本)
hot-snapshot / current_month: 直读 (L1/L2 活尾)
```

> base 视图(rank/all-time/entity/heatmap/meta/lookup)走 `readView(path, schema, { base:true })` → 读 `views/latest.json` 指针 → 解析 `<version>` → 读 `views/<version>/<path>`,**无指针时回退扁平布局**(首发前/异常时不致断站)。`live/*`、`current_month`、`hot-snapshot`、`canonical/*`、`ops/*` 仍走扁平(`base:false`)。对页面逻辑透明(数据层封装,组件不感知)。**「live vs base」判据按 `meta.folded_through` 水位收紧**(period ≤ `folded_through` 直读 base、未折叠周期叠 live,§7.2),防重复计数。

> ⚠️ **指针读取必须用「60s 重校验缓存」而非 `no-store`**:`resolveVersion()`(`web/lib/data/source.ts`)用 `fetch(views/latest.json, { next: { revalidate: 60 } })`。`no-store` 是动态 API——会让**按需 ISR 长尾页**(repo / org / rankings)在**冷函数实例**首渲时"由静态变动态",Next 抛 `Page changed from static to dynamic at runtime` → **首访 500**,内存 memo 暖后才恢复 200。60s 重校验保持同样 ≤60s 指针新鲜度、对静态/ISR 安全。

### 5.2 分桶(bucket)策略

| shard | 分桶键 | 桶数(建议) | 单桶量级(估算) | 重算粒度 |
|---|---|---|---|---|
| `repos/<bucket>` | `repo_id % N` | 32 | ~165 repo / 桶,~数百 KB | metadata step 每 step 几个桶 |
| `repo-monthly/<bucket>` | `repo_id % N` | 32 | ~165 repo × ~132 月点 × ~20B ≈ **~430 KB** | rank/entity gather |
| `repo-weekly/<bucket>` | `repo_id % N` | 64 | ~82 repo × ~570 周点 × ~22B ≈ **~1 MB** | 历史周榜重算 |
| `repo-recent-daily/<bucket>` | `repo_id % N` | 32 | ~165 repo × ≤90 日点,~数百 KB | 每日 / 每周折叠 |
| `site-daily/<yyyy>` | 年 | 1/年 | 365 点,KB 级 | heatmap step |

**内存校验**:跨桶 gather 的 step(rank / entity-org / all-time)需一次载入**全部**桶——
- 全部 `repo-monthly`:32 × ~430KB ≈ **~14 MB**;全部 `repo-weekly`:64 × ~1MB ≈ **~64 MB**。
- 即便同时载入 monthly + weekly + repos ≈ **&lt; 100 MB**,远低于 Function **4GB** 上限。
- 单文件读走 **Blob 直链**(绕过 4.5MB 响应体限制),`repo-weekly` 单桶 ~1MB 也安全。
- 写出侧:全量 entity(~16k 文件)按 **75/s** 节流 ≈ 213s,但 entity/repo 按桶分多 step(7a),每 step 仅 ~165 文件 ≈ 2–3s,不逼近 800s。

> 桶数是可调旋钮:目标是**单桶 JSON 远小于 Function 内存、单 step 处理几个桶在时长内完成**。规模增长(白名单扩容)时调大桶数即可,不改逻辑。

---

## 6. Canonical shard 模型

### 6.1 为什么是 JSON shard

历史上 canonical = **单个 `star_daily.parquet`**(per-repo×天,~800 万行)。它只能被 **DuckDB**(本机原生模块、4GB 内存)读出来做全量预算——这是「依赖本地计算」的根因。生产 canonical 改成**一组小而可单独重算的 JSON shard**,每个 shard:

- **纯 JSON**:`fetch` + `JSON.parse` 即可读,无原生模块、无引擎。
- **小**:单 shard 远小于 4.5MB(大文件走 Blob 直链读绕过响应体限制),可整个装进 Function 内存。
- **可单独重算**:改一个 repo 桶只重算该桶,不动全量。
- **预聚合到视图所需粒度**:生产重算需要的是「per-repo 月 / 周 flow + 累计 stock」「站点日总量」,**不需要**每天每 repo 的原始 8M 行。

### 6.2 shard 模型

| 逻辑事实 | 历史(Parquet 列) | 生产 shard(JSON) | 谁消费 |
|---|---|---|---|
| per-repo×天 delta | `star_daily(repo_id,date,delta)` 全量 | **不进生产**:折叠为下面的月/周 rollup;原始日表只留 bootstrap 归档 | — |
| per-repo×月 flow | DuckDB `GROUP BY repo,月` | `canonical/v2/repo-monthly/<bucket>.json` = `{ "<id>": [[period, flow], ...] }` | 月榜 + entity 月曲线 |
| per-repo×周 flow | DuckDB `GROUP BY repo,ISO周` | `canonical/v2/repo-weekly/<bucket>.json` | 历史周榜 |
| per-repo 近 90 天日点 | DuckDB 取近 90 天 | `canonical/v2/repo-recent-daily/<bucket>.json` | entity 曲线尾 + 周边界 |
| 站点级日总量 | DuckDB `GROUP BY 日` | `canonical/v2/site-daily/<yyyy>.json` | heatmap |
| repo 维度 + 里程碑 | `repos` 维度 | `canonical/v2/repos/<bucket>.json` | lookup + entity meta + 新晋 |

> **关键洞察**:日粒度只在 bootstrap 时需要(算里程碑跨阈日 + 首次 rollup 成月/周)。**里程碑一次算定即冻结**;之后生产系统只**追加新日 delta(cron 活尾)并在周期收口时折进月/周 shard**。所以**生产 canonical = 月/周/站点 rollup shard + 滚动近 90 天 + repo 维度**,全 JSON、全小、全可在 Vercel 重算。原始 8M 行日表退为 bootstrap 归档。

> **recent-daily 老化收口(避免曲线尾双源跳变)**:`repo-recent-daily` 是**滚动窗口**——一个日点滑出 90 天时,由 step 5 在折叠当月时**并入该月 `repo-monthly`**(同一动作、同一真相),并从 recent-daily 删除。**任一日期只在一处**:≤90 天在 recent-daily、>90 天在 monthly,不重叠。entity 曲线 `monthly`(月点)接 `recent_daily`(日尾)时,接缝就是 90 天水位线,口径连续(都是 net delta;stock 段按 §6.3 锚定)。

### 6.3 stock 锚定(必须分 seam 前后,口径同 [RANKING.md](./RANKING.md) §3)

> ⚠️ **关键:折扣只作用于 seam 前的 gross,seam 后的 net 直接累加、不打折**。这是 [RANKING.md](./RANKING.md) §3 的权威口径,生产 shard 照搬,否则曲线终点对不上 `current_stars`。

- **持久化 `seam_date`**:`canonical/v2/meta.json` 含 `seam_date`、`schema_ver`(见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §1.4)。seam = gross→net 边界(bootstrap 截止日)。
- **折扣系数**(per repo,bootstrap 算定后冻结):`d = current_stars@seam / cumgross@seam_date`,**分母只含 seam 前 gross 累计**(不含任何 net)。`d ≤ 1`。
- **seam 前(历史)**:`stock_est[period] = round(cumgross[period] × d)`,`cumgross` = 该 repo 月 flow(gross)在桶内的前缀和。终点(seam 月)= `cumgross@seam × d = current_stars@seam`,精确锚定。
- **seam 后(net 期)**:`stock[period] = stock_est@seam + Σ(net flow 从 seam 到 period)`,**不打折**——net 是真实增量,精确跟踪(RANKING §3「seam 后不再估算」)。
- **实现**:repo-monthly 桶里每个 period 标记 gross/net(按 `seam_date` 判),折扣只乘到 gross 段前缀和,net 段直接加。纯 JS、单桶内存可控。

> 即:原本 DuckDB 的 `cumgross × d` + seam 后精确跟踪,在生产 shard 里变成「读一个 repo 桶 → 按 seam 分段做前缀和(gross 段乘 d、net 段不乘)」的纯 JS 计算。逻辑等价、口径与 RANKING §3 一致,但不需要 Parquet / DuckDB。**`d` 在 bootstrap 算定后写入 `repos` shard 冻结,Workflow 不重算 `d`(避免 net 累积让分母漂移)。**

---

## 7. Live 覆盖与发布指针

### 7.1 L1 / L2 live 覆盖层

L1 daily cron / L2 weekly cron 写 `live/*` + `current_month.json` + `hot-snapshot.json`,提供**当前周期的活尾**。这些文件 KB 级、覆盖写、对读侧即时可见。读侧按 §5.1 与 base 视图叠合:

- **当前/刚收口未折叠的周期**:读 `live/*` 覆盖层(若回退到 base,base 尚不含该期,会缺活尾)。
- **已折叠的周期**:读 base(`views/<version>/*`),不再叠 live,避免重复计数。

L1/L2 与 L3 写不同 Blob 前缀(`live/*` vs `canonical/v2/**` + `views/<run_id>/**`),前缀不重叠;L3 重算期间 L1/L2 照常刷活尾。

### 7.2 周期收口交接契约(防重复 / 丢数据)

`current_month.json` 是**易失活尾**——live cron 跨月时直接初始化新月、覆盖旧月(`live-refresh.ts` 的 `carryMonth` 在 `month` 变化时为空)。所以必须定义谁在「重置前」把上一期数据落到持久区:

| 步骤 | 谁做 | 动作 |
|---|---|---|
| 1. 冻结上一期 | **L1/L2 cron**(跨期那次) | 检测到 `current_month.json.month ≠ 本次 month` → **先**把旧月完整 `per_repo` 写到 `canonical/v2/pending/<旧 period>.json`(幂等覆盖),**再**初始化新月活尾。绝不在未落 pending 前丢弃旧月。 |
| 2. 折叠 | **L3 step 5** | 只读 `canonical/v2/pending/<period>.json`(已冻结、不再变动)→ 折进 `repo-monthly`/`repo-weekly` → 标 `folded_through=period`(写 `canonical/v2/meta.json`)。 |
| 3. 防重复 | **读路径 §5.1** | 已折叠周期(`≤ folded_through`)只读 base(已含该期);未折叠的当前/刚收口周期读 live 覆盖层。**同一周期绝不同时计 live + canonical。** |

> 这样:① 上月最后一天 net 一定先进 pending 才被覆盖 → **不丢**;② base 与 live 按 `folded_through` 水位线**互斥**取数 → **不重复**;③ pending 是冻结快照,L3 折叠期间 cron 不再动它 → step 5 读到的是稳定输入。`folded_through` 同时是周/月两套水位(周收口比月早)。

### 7.3 发布指针模型(atomic pointer swap)

> **版本前缀 = run_id,无独立 staging/published 两段式**。重算直接写 `views/<run_id>/**`(新前缀,不影响线上);该版本未被指针引用前对读侧不可见,等价于「staging」。publish 仅原子覆盖写一个指针文件即上线——省掉一次全量复制(~12,899 文件)。

```
1. step 6–8 重算产物写到 views/<run_id>/**(version = run_id,不影响线上)
2. step 9 validate:对该版本跑 Zod + sanity(见 TESTING)
   └─ 不过 → 抛错终止,指针从未切;views/<run_id> 成为无人引用的孤儿,留存排查 / 后续 GC
3. step 10 publish:原子覆盖写 views/latest.json = { version: run_id, run_id, published_at, prev_version }
   + 写 ops/workflows/latest-success.json。**无复制**——指针指向 run_id 前缀即上线。
   (读侧只认 views/latest.json + views/<version>/——见 §5.1 / DATA-CONTRACTS §2.11)
4. revalidate:读侧 latest.json 短缓存(≤60s)+ 版本化路径不可变 → 新版本在 ≤60s 内被拾取;
   动态数据页(rankings/pulse/entity 等为 ƒ server-rendered)按请求解析指针,热集亦可按需 ISR。
```

### 7.4 `views/latest.json` 指针契约

```jsonc
{
  "version": "refresh-2026-06-02T15-48-35-661Z",   // = run_id(版本前缀 views/<version>/)
  "run_id": "refresh-2026-06-02T15-48-35-661Z",
  "published_at": "2026-06-02T15:59:13.901Z",
  "prev_version": null,                              // 上一版本(首发为 null),供一键回滚
  "schema_ver": 1
}
```

- **读侧**:数据层先读 `views/latest.json`(带 `?v=<date>` cache-bust,规避 Blob 60s 传播窗口),解析出 `version` 前缀,再读该前缀下的视图。
- **原子性**:切指针是**单文件覆盖写**,最坏让某次请求读到滞后一版的指针(旧版本数据仍自洽),无半发布风险。
- **TTL 源头**:60s 这个数字不是文档约定的常量——它由 `web/lib/data/source.ts` 的 `VERSION_TTL_MS = 60_000` 同时驱动 in-memory memo 时长与 `fetch(views/latest.json, { next: { revalidate: VERSION_TTL_MS / 1000 } })` 的 ISR 重校验窗口。调整指针传播窗口请改 `VERSION_TTL_MS` 并同步本节。

---

## 8. 校验门(validate)

validate step 在指针切换前对 `views/<run_id>/**` **抽样**校验,**不过不发布**。下面是 `web/lib/workflows/steps/validate.ts` 实测执行的检查清单——以代码为权威,文档只记录代码做了什么:

### 8.1 当前实际执行的检查

- **Zod schema 校验**(每个文件读取时按 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2 契约逐字段验证;任一文件 schema parse 失败计入 `schema_failures` 并加入 `failures`):
  - `views/<run_id>/meta.json`(契约 `Meta`)
  - `views/<run_id>/rank/all-time/repo/stock.json`(契约 `RankList`)
  - `views/<run_id>/lookup/repos.json`(契约 `ReposLookup`)
  - `views/<run_id>/search/index.json`(契约 `SearchIndex`)
  - `views/<run_id>/categories/registry.json`(契约 `CategoryRegistry`)
  - `views/<run_id>/categories/assignments.json`(契约 `CategoryAssignments`)
  - `views/<run_id>/lookup/categories.json`(契约 `CategoriesLookup`)
  - `views/<run_id>/rank/category/<sample>/all-time/repo/stock.json`(契约 `CategoryRankList`)
  - `views/<run_id>/entity/repo/<topId>.json`(契约 `RepoEntity`,top repo 抽样)
  - `views/<run_id>/heatmap/year/<lastYear>.json`(契约 `Heatmap`,上一公历年抽样)
- **Sanity 不变量**(在 schema 校验之外另行 assert,失败即抛错终止 workflow):
  - **`meta.seam_date` 存在**(布尔 truthy);
  - **`rank/all-time/repo/stock.json`**:`items` 非空 · `items[0].rank === 1` · `value` 严格非递增(`items[i].value <= items[i-1].value`);
  - **`lookup/repos.json`**:条目数 ≥ `MIN_LOOKUP`(=1000);
  - **`search/index.json`**:`count ≥ MIN_LOOKUP`(=1000)且 `count === repos.length`;
  - **category views**:`registry` 非空且有 public categories;assignments 覆盖 ≥ `MIN_LOOKUP`;`language`/`language_family` 每 repo 至少一个,`owner_kind` 每 repo 单值;assignment 引用都存在于 registry;抽样 category rank 的 repo 都属于该 category;
  - **top repo entity**:`entity/repo/<allTime.items[0].id>.json` 的 `curve.monthly` 长度 > 0;
  - **上一公历年 heatmap 存在**:`heatmap/year/<UTCFullYear - 1>.json` 能读到(prior calendar year 总是已收口)。
- **输出**:`ops/workflows/<run_id>/validation.json`(契约 `WorkflowValidation`,含 `run_id` / `ok` / `checked` / `schema_failures` / `invariants` / `failures`)。任一 sanity 失败 → `failures` 非空 → 抛错;publish step 不会启动,版本前缀留作孤儿待 GC。

校验不通过 = 指针从未切 = 线上一直是上一版,**无半发布风险**。

### 8.2 未启用的不变量(future work)

下列检查曾在早期设计稿中列为"硬不变量",但**目前 `validate.ts` 未实现**——它们或者代价过高(全量遍历)、或者依赖 L1 cron 与 L3 折叠之间的同步语义(运行时另有侦测/告警机制),保留为未来增强项,不应被误读为已生效:

- ~~rank 文件数与 period 集合一致~~ —— 目前只抽样 `all-time/repo/stock.json`,不枚举全部 period。
- ~~org stock 终点 = 成员 `current_stars_sum`(carry-forward 等式)~~ —— 不在 validate 内,口径靠 recompute step 内部不变量(见 [RANKING.md](./RANKING.md) §5)。
- ~~entity 曲线 monthly / recent_daily 接缝在 90 天水位线连续~~ —— 仅抽样 top repo 的 `monthly` 非空,**不**校验 monthly↔recent_daily 接缝。
- ~~月榜 / 近期日榜的 seam 连续性~~ —— 不在 validate 内,seam 锚定由 recompute 阶段保证(§6.3)。
- ~~`meta.folded_through` 单调不退~~ —— 仅检查 `seam_date` 存在;`folded_through` 单调性靠 fold step 内部水位写入,validate 不二次校验。

> 如要补强其中任一项,直接改 `validate.ts` 并同步更新本节;不要在其他文档(如 TESTING)宣称已生效。

---

## 9. 失败模式与回滚

### 9.1 不变量

| 不变量 | 保证方式 |
|---|---|
| **每个 step 幂等** | step 输出按 `(run_id, shard)` 确定路径覆盖写;重跑同 `run_id` 同 shard = 覆盖同一份,不重复累加。 |
| **重跑同一个 `run_id` 不写坏数据** | 版本前缀含 `run_id`;同 run 重跑只覆盖自己的 `views/<run_id>`,不碰已发布版本。 |
| **失败只影响该版本前缀** | 指针未切前,线上读的是 `views/latest.json` 指向的上一版;任何 step 失败都不影响线上。 |
| **`ops/workflows/latest-success.json` 是恢复点** | 记录最近一次成功发布的 run_id;新 run 从它的 canonical 状态出发增量重算。 |

### 9.2 恢复路径

- **某 step 失败**:Workflow SDK 内建 step 重试(网络错 / 崩溃自动重试)。业务侧每 step 写 `ops/workflows/<run_id>/steps/<step>.json` checkpoint,Workflow 重放时跳过已完成 step、从断点继续。
- **整个 run 卡死 / 超时**:运维据 `ops/workflows/<run_id>/manifest.json` 看卡在哪一 step;可重新触发同 `run_id`(幂等续跑)或起新 run。线上不受影响(指针未切)。
- **GitHub 限流**:step 内遇 `403` / secondary limit / `Retry-After`,短等待重试;跨小时配额用 workflow `sleep` 等待后继续,不空转。

### 9.3 回滚

| 场景 | 操作 |
|---|---|
| 新版本数据有问题(已发布) | 把 `views/latest.json.version` 指回 `prev_version`——**秒级回退**,旧版本产物仍在 `views/<prev>`。 |
| 校验未过(未发布) | 无需回滚:指针从未切,线上一直是上一版;孤儿 `views/<run_id>` 留存排查。 |
| 部署层问题 | Vercel 保留历史部署,Promote 上一个正常 deployment(见 [OPS.md](./OPS.md) 回滚)。 |

- **保留份数**:`views/<version>` 保留近 N 份(如 4 份),旧版本 / 孤儿由 GC 清(脚本 `web/scripts/blob-del-prefix.ts <prefix>` 按前缀删,已用于清理临时 verify-* 版本)。
- **顺序**:先回滚数据(指针指回)→ 必要时再 redeploy → 核对 `ops/sync-runs.json` 与漂移恢复正常。

### 9.4 版本垃圾回收(GC)

step 11(`gc`)在 publish 成功后跑,负责回收旧版本前缀:

- **保留策略**:最新 4 版 `views/<version>` + 当前指针 + `prev_version`(回滚目标)。
- **删除目标**:`list(views/)` 列出所有 `<version>` 前缀,排除保留集,逐前缀 `del`。
- **best-effort,绝不抛错**:清理失败只记日志,不拖垮已发布的 run。下次 run 会重试清同一批孤儿。
- **手动清理**:`web/scripts/blob-del-prefix.ts <prefix>` 按前缀删任意残留(临时 verify-* 版本、卡死的孤儿 run 等)。

---

## 10. 新晋 repo 历史策略

新晋 repo(上线后首次 star ≥ 10,000、不在 bootstrap 基线里)的**历史 star 曲线**怎么补?三个方案,各有取舍:

| 方案 | 怎么做 | 完整度 | 速度 / 限额 | Vercel-first? | 引入账单? |
|---|---|---|---|---|---|
| **A 保守(默认)** | 从**进入白名单当天**起追踪;entity 页标注 `tracked_since`,该日之前无曲线 | 仅发现日之后 | 快、无外部限额 | 是,纯 Vercel | 否 |
| **B GitHub stargazers API** | Workflow 分页调 `GET /repos/{o}/{r}/stargazers`(`Accept: application/vnd.github.star+json` 拿 `starred_at`),按天聚合补历史 | 较全,但有硬上限 | **慢且受限**(见下) | 是,纯 Vercel(慢) | 否 |
| **C BigQuery 重跑** | 对新 repo_id 重跑 GH Archive extract(含稳定 repo.id、gross adds) | **最完整** | 一次性、需人工 | ❌ 引入 GCP | **是(~小额 + GCP 账号)** |

### 10.1 诚实的限制说明

- **方案 B 的硬限**:GitHub stargazers 分页**最多约 400 页 × 100 = 40,000 个 stargazer**——超过 4 万 star 的 repo**取不全**早期历史。且 REST **5,000 请求/小时**配额下,一个 4 万 star 的 repo = 400 请求 ≈ 单 repo 吃掉 8% 小时配额,**非常慢**;要靠 Workflow `sleep('1 hour')` 跨配额窗口分批,可能耗时数小时到数天。仅对**小 / 新**(star 不远超 1 万)的 repo 现实可行。
- **方案 C 最完整但违背 Vercel-first**:BigQuery 查 GH Archive 是唯一能精确拿到「任意 repo 任意历史日 gross adds + 稳定 repo.id」的来源,但它**引入 GCP 账号与费用**,与「避免散落账单」冲突,只能作为**手动一次性 bootstrap / 重建**工具(L4),不进 recurring 生产路径。

### 10.2 推荐取舍

- **默认采用方案 A(保守)**:已有 bootstrap 历史基线**保留**;新增 repo **从发现日起追踪**,页面诚实标注 `tracked_since`(与 About 页「幸存者偏差 / as-of」口径一致,见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据口径)。
- **方案 B 作为可选 best-effort 增强**:对 star 不太大的新晋 repo,Workflow 可顺带调 stargazers API 补一段近似历史,失败 / 触限即降级回方案 A(标 `tracked_since`),**绝不**因补历史阻塞主流程。
- **方案 C 仅在「要大规模补全 / 重建基线」时手动跑一次**(L4 bootstrap),产物上传后由 L3 接管,不常态化。

---

## 11. 成本边界

> Workflow step 本身按用量计费([Workflows Pricing](https://vercel.com/docs/workflows/pricing):Events / Data Written / Data Retained);真正的大头是 **Function compute + Blob IO + GitHub API 时间**。设计要主动控这三项。

| 成本项 | 驱动 | 控制手段 |
|---|---|---|
| **Function compute** | step 数 × 每 step 时长 | step 按 shard 分批,控制总 step 数;I/O 等待(GraphQL / Blob)不计 active CPU,但要控 active 计算量(前缀和 / 排序在桶内做,桶不过大)。 |
| **Blob 写速率 / 量** | 重算写出的视图文件数 | 遵守 **75/s 写上限**([OPS.md](./OPS.md));批量 put 限并发 + 节流;只写**变化的 shard**(diff-aware),不每次全量重写 16k+ 文件。 |
| **Blob 存储 / 保留** | published 历史版本份数 | 只保留近 N 份 published;旧版本清理。canonical shard 体积小(几十 MB 级)。 |
| **GitHub API 时间** | metadata / stargazers 调用 | GraphQL `nodes()` 100/查、标量字段成本低(约 5,261 repo ≈ 53 查 ≈ 1% 小时配额);stargazers(方案 B)受 5,000 req/hr 限,用 sleep 分批。 |
| **页面再生** | revalidate 后冷生成 | **不一次性生成 16k 页**;继续 ISR / revalidate,长尾首访冷生成一次(读 KB 视图,可忽略)。 |

**硬约束复述**:
- 单 Function ≤ 800s / ≤ 4GB / bundle ≤ 250MB / 响应体 ≤ 4.5MB——**所以全量重算必须 Workflow 分片,大文件走 Blob 直链**。
- 不在请求热路径放任何 Workflow / 引擎;运行时永远只读静态 JSON(见 [ARCHITECTURE.md](./ARCHITECTURE.md))。

---

## 12. 设计验收

- [x] 生产数据生命周期(白名单 / 元数据 / 改名 / 新晋 / canonical 折叠 / 重算 / 校验 / 发布 / 回滚)**全部**有 Vercel 落点,无任何 recurring 步骤要求本地计算。
- [x] 清楚区分四层:L1/L2 live cron · L3 Workflow(月+周折叠 / 重算 / 发布 / 版本 GC)· L4 `pipeline/backfill` 归档。
- [x] Blob checkpoint / 版本前缀 / publish pointer / rollback 模式定义清楚(§3、§5、§7、§9)。
- [x] canonical 从单 Parquet 重设计为 JSON shard,生产重算不依赖 DuckDB / Parquet(§6)。
- [x] 新晋 repo 历史三方案取舍诚实写清,默认保守 + `tracked_since`(§10)。
- [x] 成本 / 限制(Cron、Function 800s/4GB/250MB/4.5MB、Workflow、Blob 75/s、GitHub 配额)写清(§1.3、§11)。
- [x] BigQuery/GCP 仅一次性 bootstrap,不在 recurring 生产路径。
