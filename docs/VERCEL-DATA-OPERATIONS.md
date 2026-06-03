# gitstarclub Vercel-only 数据运营设计（VERCEL-DATA-OPERATIONS）

> **本文目标**：设计一套**完全不依赖本地计算**的生产数据生命周期——所有 recurring 数据作业在 Vercel 触发、运行、记录、发布、回滚。本机 `pipeline/backfill` 退役为**一次性 bootstrap 工具 / 历史归档**，不再是日常运营路径。
>
> ⚠️ **实现状态（headline）**：Phase 0–5 **✅ 已实现并线上验证**（2026-06-03 `status=published`、约 5,261 repo）——live cron + L3 Workflow（白名单/元数据/改名/月+周折叠/重算/校验/发布/版本 GC）全链路在 Vercel 真跑通过；仅 backfill 归档收尾 🟡 待办。**各 Phase 逐项状态与退出标准见 §10**（canonical），验收见 §11。
> - **仍是本地（bootstrap-only）**：`pipeline/backfill/`（含 BigQuery extract + 本机 DuckDB rollup/precompute）。本文**不删除**它，只把它从「生产 recurring 路径」降级为「一次性 bootstrap / 历史归档 / 紧急人工工具」。
>
> 关联：架构总览 [ARCHITECTURE.md](./ARCHITECTURE.md) · 数据契约 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) · 运维 [OPS.md](./OPS.md) · pipeline [PIPELINE.md](./PIPELINE.md) · 测试 [TESTING.md](./TESTING.md)。
> 官方参考：[Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) · [Vercel Workflows](https://vercel.com/docs/workflows)（含 [Concepts](https://vercel.com/docs/workflows/concepts)）· [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)。

---

## 1. 目标与边界

### 1.1 设计目标

1. **生产数据计算不依赖本地机器**：白名单刷新、元数据刷新、改名检测、新晋追踪、canonical 折叠、rank/entity/heatmap 重算、校验、发布、回滚——**全部**在 Vercel 触发并运行。
2. **所有 recurring jobs 在 Vercel 触发、运行、记录**：Cron 触发；Function / Workflow 运行；`ops/sync-runs.json` 与 `ops/workflows/**` 记录。
3. **Blob 是数据产物与 checkpoint 的中心**：canonical JSON shard、视图产物、workflow 进度、发布指针都落 Vercel Blob。
4. **本地只用于开发与紧急人工检查**，不作为生产路径：`pipeline/backfill` 仅在「首次冷启动」「灾难重建」「引入新数据源做一次性大重算」时手动跑。

### 1.2 不变的约束（沿用既有架构）

- **运行时纯静态**：用户请求永远只读预算好的 JSON / Blob，**永不触达 Workflow / 引擎 / 数据库**（见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。Workflow 只产出数据，页面不知道它存在。
- **Vercel-first / 避免散落账单**：不引入 GCP / 第三方队列 / 外部数据库作为 recurring 依赖。BigQuery 仅在一次性 bootstrap 时作为可选历史数据源（见 §6）。
- **不做 16k 全量 build**：发布只切指针 + revalidate 核心热集，长尾走按需 ISR（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 页面分层）。

### 1.3 关键设计决策：为什么不能把全量重算塞进一个 Function

| 限制 | 普通 Vercel Function（Pro，Node.js） | 对全量重算的影响 |
|---|---|---|
| **最长时长** | 默认 300s，**最大 800s**（13 分钟） | DuckDB 读 8M 行 Parquet 全量预算 16k+ 视图远超 13 分钟 |
| **内存 / CPU** | 默认 2GB / 1 vCPU，**最大 4GB / 2 vCPU** | 本机 precompute 已需 `--max-old-space-size=4096`，贴着上限 |
| **包体积** | 部署 bundle **≤ 250MB**（解压） | `@duckdb/node-api` 原生模块体积大、且 serverless 跑原生模块不可靠 |
| **响应体** | 请求 / 响应体 **≤ 4.5MB** | 大文件必须走 Blob 直链读写绕过此限 |

> 官方明确建议（[Functions Limits](https://vercel.com/docs/functions/limitations)）：**需要超长执行时间的工作负载，用 [Vercel Workflows](https://vercel.com/docs/workflows)**——它能让代码 pause / resume / 跨步骤保存状态，**无单函数时长上限**。
>
> 因此结论：**Cron 只负责触发**（对生产 URL 的一次 GET）；**长任务交给 Workflow 拆成多个 step**，每个 step 是一个独立、可重试、短小的 Function 调用，step 之间用 Blob checkpoint 记录进度。**不在任何单个 Function 里加载 DuckDB / Parquet 做全量重算。**

---

## 2. 运行分层

把数据作业按「频率 × 重量」分四层，明确各自跑在哪、是否已实现：

| 层 | 作业 | 跑在哪 | 触发 | 状态 |
|---|---|---|---|---|
| **L1 每日 live** | poll current_stars → 写 `current_month.json` + `live/*` 当前周期覆盖层 + `hot-snapshot.json` → revalidate 热集 | **Vercel Function**（单函数，JSON-only，秒级） | Cron `0 3 * * *` | ✅ 已实现 |
| **L2 每周 live** | 复用 live refresh，覆盖写当前周 / 当前月 rank + 当月 heatmap + hot snapshot + `ops/sync-runs.json` | **Vercel Function**（单函数，JSON-only） | Cron `0 4 * * 0` | ✅ 已实现 |
| **L3 Managed refresh** | 白名单 diff → 元数据 shard → 改名检测 → 月+周折叠 → rank/entity/heatmap 全量重算 → 校验 → 发布（切指针）→ 版本 GC（step 详见 §3.4） | **Vercel Workflow**（多 step，Blob checkpoint） | 每周 cron + 手动（调度见 [OPS.md](./OPS.md) §Cron） | ✅ 已线上验证（2026-06-03 `status=published`）；逐 Phase 见 §10 |
| **L4 Bootstrap archive** | 11 年事件级历史首次回填（Search → BigQuery → DuckDB → JSON → Blob） | **本机 / 全 Node**（`pipeline/backfill`） | 手动，一次性 | 🗄️ 归档工具，非生产路径 |

> 上表「触发」列只标各层的调度归属；**三条 cron 的权威调度（`0 3` / `0 4` / `0 6` 及 `vercel.json` 声明）见 [OPS.md](./OPS.md) §Cron**。

**分工原则**：
- **L1 / L2** 处理「当前周期的活尾」——KB 级 JSON，单函数秒级，已稳定运行。
- **L3** 处理「跨周期的全量 / 历史 / 元数据刷新」——重、慢、需断点，必须 Workflow。**这是本文的核心。**
- **L4** 只在「从零冷启动」或「灾难重建」时跑一次，产出被 L3 接管后即退役。

> L2 与 L3 的关系：在 L3 Workflow 落地前，L2 每周 live cron 是**唯一**的周级刷新，保证周榜 / 月榜不断档。L3 落地后，L2 继续作为「轻量活尾兜底」，L3 负责「全量重算 + 历史折叠 + 元数据」。两者读写不同的 Blob 前缀（live 覆盖层 vs canonical/staging），天然隔离。

---

## 3. Vercel Workflow 模式（L3 设计核心）

### 3.1 Workflow 与 Cron / Function 的职责切分

```
Vercel Cron（GET /api/workflows/refresh/start，带 CRON_SECRET）
  └─ route 只做一件事：鉴权 + 启动 workflow，立即返回 run_id（不阻塞）
       └─ Vercel Workflow（'use workflow'）：编排下列 steps，可 pause/resume、跨部署存活
            ├─ step 1  refresh whitelist        ('use step')
            ├─ step 2  metadata shards
            ├─ step 3  rename detection
            ├─ step 4  newcomer tracking
            ├─ step 5  canonical shard update（折叠已收口周期 + 新晋历史）
            ├─ step 6  rank recompute（跨桶 gather）   → views/<run_id>/rank/**
            ├─ step 7a entity/repo recompute（桶内独立）→ views/<run_id>/entity/repo/**
            ├─ step 7b entity/org recompute（跨桶 gather）→ views/<run_id>/entity/org/**
            ├─ step 8  heatmap update                  → views/<run_id>/heatmap/**
            ├─ step 9  validate（Zod + sanity，对 views/<run_id> 该版本）
            ├─ step 10 publish（更新 views/latest.json 指针）
            └─ step 11 revalidate（revalidatePath 核心热集；长尾按需 ISR）
```

**为什么 Cron route 不直接干活**：Cron 触发是对生产 URL 的一次 HTTP GET，受 Function 时长 / 内存约束。所以 route 仅「鉴权 + 启动 workflow + 返回」，把真正的长任务交给 Workflow runtime 异步编排。

### 3.2 Workflow SDK 落地形态（✅ 已实现）

Vercel Workflow（[Workflows Concepts](https://vercel.com/docs/workflows/concepts)）用两个指令把普通 async 函数变成持久化工作流：

- **`'use workflow'`**：标记 workflow 函数——有状态、记住进度、崩溃 / 部署后**确定性重放**从断点恢复。
- **`'use step'`**：标记 step 函数——无状态的一个持久工作单元，**内建重试**，能扛网络错误 / 进程崩溃；step 执行时 workflow 挂起、不占资源；step 完成后自动恢复。
- **`sleep('...')`**（来自 `workflow` 包）：暂停若干分钟到若干月，不占资源——用于 GitHub rate-limit 窗口等待（见 §6）。

> 安装：`bun i workflow`（在 `web/` 项目内，因 Workflow 由 Vercel Functions 执行，与 Next.js 同部署）。

骨架示意（**结构示意；实现见 `web/lib/workflows/refresh.ts` + `steps/*`，函数名以代码为准**）：

```ts
// web/lib/workflows/refresh.ts —— ✅ 已实现
export async function refreshWorkflow(runId: string) {
  'use workflow';

  await refreshWhitelist(runId);        // step 1
  await detectRenames(runId);           // step 3（先于 metadata，读旧 full_name）
  // step 2 metadata：按 bucket 循环 refreshMetadataBucket(runId, bucket)
  await foldCanonical(runId);             // step 5（月+周折叠；读 pending 冻结快照，防重复/丢数据）
  await recomputeRank(runId);             // step 6（跨桶 gather）
  await recomputeRepoEntities(runId);     // step 7a（桶内独立，可并行分批）
  await recomputeOrgEntities(runId);      // step 7b（跨桶 gather + 成员 carry-forward + 派生 search/index.json）
  await recomputeHeatmap(runId);          // step 8
  const report = await validateVersion(runId); // step 9
  await publishVersion(runId);            // step 10（切 views/latest.json 指针）
  await gcVersions(runId);                // step 11（版本 GC，best-effort 不抛）
  return { runId, ok: true, report };
}

// web/lib/workflows/steps/recompute-rank.ts —— ✅ 已实现
async function recomputeRank(runId: string) {
  'use step';                            // 独立 Function 路由、内建重试、幂等
  // 载入全部 canonical/v2 月/周 shard（Blob 直链）建 period 索引 → 算 rank → 写 views/<runId>/rank/**
  // ⚠️ 跨桶：rank/all-time/org 都需全部 repo，不能按桶切（见 §3.3 两类重算形状）
}
```

### 3.3 step 切分原则

| 原则 | 落地 |
|---|---|
| **每个 step 短小** | 单 step 控制在 Function 时长 / 内存内（< 800s、< 4GB）。重算按 **shard 分批**：rank 重算每 step 处理 1 个周期或 1 个 period 批，不是「一次算完所有周期」。 |
| **每个 step 幂等** | step 输入 = `(run_id, shard 范围)`；输出按确定路径覆盖写 `views/<run_id>/`。重跑同 `run_id` = 覆盖同一份产物，不重复累加（见 §8）。 |
| **step 之间用 Blob checkpoint** | 每个 step 完成后写 `ops/workflows/<run_id>/steps/<step>.json`（状态 + 产物清单 + 计数）。Workflow SDK 自身也持久化 step 结果；checkpoint 是**业务可读**的进度账本，供运维 / 恢复用。 |
| **大数据走 Blob 直链** | step 间不通过 Workflow 传大 payload（受 4.5MB 限）。step 只传 `run_id` / shard key 等小标识；数据落 Blob，下一 step 从 Blob 直链读。 |
| **长等待用 sleep** | 命中 GitHub secondary rate limit / `Retry-After` 时，step 内短等待；跨小时级配额恢复用 workflow `sleep('1 hour')`，不空转占资源。 |

> ⚠️ **两类重算形状(实现者必读)**：shard 按 `repo_id % N` 分桶,但**不是所有重算都桶内自洽**——
> - **桶内独立(可按桶并行分批)**：**entity/repo** —— 每个 repo 的 entity 文件只依赖它自己那一桶的数据(monthly/weekly/recent-daily/meta),天然可按桶分 step。
> - **必须跨桶 gather(不能按桶切)**：**rank(任一周期需全部 repo 同期 flow/stock)、entity/org(成员 `repo_id` 散落不同桶,见 C2)、all-time(全量排序)** —— 这些 step 要先**把全部 `repo-monthly`(以及需要时 `repo-weekly`)桶载入内存建索引**,再按 period / owner 聚合。全量 repo-monthly ≈ 数 MB(见 §4.2),整体载入远低于 4GB,可行;但**绝不能误以为能桶内算完**。

### 3.4 步骤职责表

| # | step | 读 | 写 | 说明 |
|---|---|---|---|---|
| 1 | refresh whitelist | GitHub Search `stars:>=10000` | `canonical/v2/whitelist/<run_id>.json` + diff | 自适应分桶绕过 Search 1000 上限（逻辑同现 `01-whitelist`，但跑在 Vercel）。算出**新晋**（新 id）与**跌出**（旧 id 不再 ≥10k）。 |
| 2 | metadata shards(**按 bucket,1 step/桶**) | bootstrap `lookup/repos.json`(owner_type/language)+ run whitelist(node_id、新鲜 current_stars、rename-aware full_name) | `canonical/v2/repos/<bucket>.json` | **存量 repo 从 bootstrap seed,不重拉 GitHub**;GitHub GraphQL `nodes()` 只补"既不在 prev shard 也不在 lookup"的真新晋(~12)。⚠️ **不可全量重拉 5,261 repo**——会撞 GitHub 二级限流(已实测)。每桶一个短 step,幂等。milestones/description/topics 留待 entity 富化(后续 phase)。 |
| 3 | rename detection | 新旧 `repos/<bucket>` | rename map → `ops/workflows/<run_id>/renames.json` | full_name 变化的 repo：记录旧→新映射，供 web 层 301（见 [SEO.md](./SEO.md) §7）。canonical 按 `repo_id` 归并，改名不丢历史。 |
| 4 | newcomer tracking | whitelist diff | `repos/<bucket>` 写 `tracked_since`；可选历史补片 | 新晋 repo 历史策略见 §6。默认保守：标 `tracked_since`，从发现日起追踪。 |
| 5 | canonical shard update | 已收口周期的**冻结快照** `canonical/v2/pending/<period>.json` + recent-daily | `canonical/v2/repo-monthly/**` `repo-weekly/**` `site-daily/**` | **折叠**：周期收口时把活尾 net delta 折进月/周 rollup shard;append 站点日总量。**交接靠水位标记防重复/丢数据**——见 §8.3(H1)：cron 跨期重置 `current_month.json` 前先把上一期完整 `per_repo` 落到 `canonical/v2/pending/<period>.json`,step 5 只读 pending、折叠后标记 `folded_through=period`。跌出者保留历史 shard、停止 poll。 |
| 6 | rank recompute(**跨桶 gather**) | 全部 `repo-monthly`/`repo-weekly` + `repos`/`meta` shard | `views/<run_id>/rank/**` | 载入全部 monthly/weekly 桶建「period→repos」索引,按 period 算 flow/stock + all-time,幂等写 staging。**growth**:期初 stock = monthly `stock_est` 前缀和在 `period-1` 的值(§5.4),floor 期初 ≥20k;**new**:直接用 `repos.crossed_10k` 落当期判定(**不另用 stock_est 重算**,口径同 [RANKING.md](./RANKING.md) §4)。stock 锚定见 §5.4 / [RANKING.md](./RANKING.md) §3。 |
| 7a | entity/repo recompute(**桶内独立**) | 单桶 `repo-monthly`/`repo-weekly`/`repo-recent-daily`/`repos` | `views/<run_id>/entity/repo/**` | 每个 repo 只依赖自己那桶,可按桶并行分 step。 |
| 7b | entity/org recompute(**跨桶 gather**) | 全部 `repo-monthly`/`repo-weekly` + `repos`(owner→members) | `views/<run_id>/entity/org/**` + `lookup/**` + `search/index.json` | **不能按桶算**(成员散落各桶,C2)：先全量载入 monthly/weekly 桶,按 `owner` 聚合;org stock 须先对每个成员做 `首次事件期→末期` **carry-forward** 再求和(空期沿用上一期累计),终点对齐 `current_stars_sum`(口径同 [RANKING.md](./RANKING.md) §5)。**v0.2**:同步从 `repos` 维度派生 `search/index.json`(客户端搜索索引,见 [DATA-CONTRACTS](./DATA-CONTRACTS.md) §2.14)。 |
| 8 | heatmap update | `site-daily` shard(+ 派生月总量) | `views/<run_id>/heatmap/**` | 站点级日 / 月总量(月总量 = site-daily 当月求和)。 |
| 9 | validate | `views/<run_id>/**` | `ops/workflows/<run_id>/validation.json` | Zod schema + sanity 不变量（[TESTING.md](./TESTING.md) §1.2/1.3，含 `search/index.json` 条目数闸门）。**不过不发布**。 |
| 10 | publish | `views/<run_id>/**` | `views/latest.json` 指针 + `ops/workflows/latest-success.json` | 原子切指针(version=run_id)：读侧从此读新版本（见 §7）。 |
| 11 | gc | `views/latest.json` + `list(views/)` | `del views/<旧 version>/**` | **版本 GC**（`gc.ts`，发布后跑）：保留最新 4 版 + 当前 / `prev_version` 指针（回滚目标），删更旧的孤儿版本。**best-effort、绝不抛错**——清理失败不拖垮已发布的 run。 |
| 12 | revalidate | — | revalidatePath 核心热集 | 长尾按需 ISR、不全量 build（见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。 |

> 上表是**逻辑职责**的 12 步枚举；运行 manifest 把这些归并为 8 个 checkpoint step（`whitelist / rename / metadata / fold / recompute / validate / publish / gc`），见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §2.12。

---

## 4. Blob 布局新设计

> 沿用 [OPS.md](./OPS.md) 的单一 PUBLIC store。**完整 Blob 树（含 `live/*`、`current_month.json`、`hot-snapshot.json`、`lookup/`、`rank/`、`entity/`、`heatmap/` 等既有前缀）见 [OPS.md](./OPS.md) §Blob 布局**——本文只列**本设计新引入的前缀**（`canonical/v2/*`、`views/`、`ops/workflows/*`），不重复既有布局。`canonical/star_daily.parquet` 降级为 bootstrap 归档（仍可留存，不在生产读路径）。

```
blob://
├── ops/workflows/                           # L3 Workflow（✅ 已实现；同级 ops/sync-runs.json 见 OPS §Blob 布局）
│   ├── <run_id>/
│   │   ├── manifest.json                    # run 元信息：触发时间、step 列表、整体状态
│   │   ├── steps/<step>.json                # 每个 step 的 checkpoint（状态 + 产物 + 计数）
│   │   ├── renames.json                     # 改名映射（step 3 产出）
│   │   └── validation.json                  # 校验报告（step 9 产出）
│   └── latest-success.json                  # 最近一次成功发布的 run_id（恢复点）
│
├── canonical/v2/                            # 生产 canonical（JSON shard，✅ 已实现）
│   ├── meta.json                            # seam_date · schema_ver · folded_through（周/月水位，见 §5.4/§8.3）
│   ├── whitelist/<run_id>.json              # 白名单快照 + diff
│   ├── repos/<bucket>.json                  # repo 维度 + 里程碑 + tracked_since + 冻结折扣 d（按 id 分桶）
│   ├── repo-monthly/<bucket>.json           # per-repo 月 flow 序列（驱动月榜 + 月曲线）
│   ├── repo-weekly/<bucket>.json            # per-repo ISO 周 flow 序列（驱动历史周榜）
│   ├── repo-recent-daily/<bucket>.json      # per-repo 近 ~90 天日点（曲线尾 + 周边界）
│   ├── site-daily/<yyyy>.json               # 站点级日总量（驱动 heatmap）
│   └── pending/<period>.json                # 已收口、待折叠的周期活尾冻结快照（cron 写、step 5 读，见 §8.3）
│   # （同级 canonical/star_daily.parquet 是 🗄️ bootstrap 归档，仅 L4 / 灾难重建用——见 OPS §Blob 布局）
│
└── views/                                   # 发布层（指针切换，✅ 已实现 Phase 4）
    ├── latest.json                          # 指针：当前生效的版本前缀（version = run_id；见 §7）
    └── <run_id>/                            # 一个 run 的完整视图版本（version=run_id，无独立 staging/published）
        └── rank/** entity/** heatmap/** lookup/** search/index.json meta.json   # 写完→validate→指针指向它即上线
```

### 4.1 读路径优先级（页面如何选版本）

页面 / 数据层先读 `views/latest.json` 指针解析出 `<version>`(下记 `V = views/<version>`，version = run_id),再按「live 优先、回退 base」取数。**关键:用 `meta.folded_through` 水位决定某周期归 live 还是归 base,避免重复计数(§8.3)**：

```
未折叠周期(period > folded_through,即当前/刚收口未发布)：
    rank/heatmap：  live/* (L1/L2 活尾) → 回退 V/* (上一版 base,可能尚不含该期)
已折叠周期(period ≤ folded_through,base 已含)：
    rank/heatmap：  直接读 V/* (不再叠 live,防重复)
entity / lookup：    V/* (L3 发布版本)
hot-snapshot / current_month： 直读 (L1/L2 活尾)
```

> ✅ 现状（Phase 4+5 已实现）：base 视图（rank/all-time/entity/heatmap/meta/lookup）走 `readView(path, schema, { base:true })` → 读 `views/latest.json` 指针 → 解析 `<version>` → 读 `views/<version>/<path>`，**无指针时回退扁平布局**（首发前/异常时不致断站）。`live/*`、`current_month`、`hot-snapshot`、`canonical/*`、`ops/*` 仍走扁平（`base:false`）。对页面逻辑透明（数据层封装，组件不感知）。**「live vs base」判据已按 `meta.folded_through` 水位收紧**（period ≤ `folded_through` 直读 base、未折叠周期叠 live，§8.3），防重复计数。

### 4.2 分桶（bucket）策略

| shard | 分桶键 | 桶数（建议） | 单桶量级（估算） | 重算粒度 |
|---|---|---|---|---|
| `repos/<bucket>` | `repo_id % N` | 32 | ~165 repo / 桶，~数百 KB | metadata step 每 step 几个桶 |
| `repo-monthly/<bucket>` | `repo_id % N` | 32 | ~165 repo × ~132 月点 × ~20B ≈ **~430 KB** | rank/entity gather |
| `repo-weekly/<bucket>` | `repo_id % N` | 64 | ~82 repo × ~570 周点 × ~22B ≈ **~1 MB** | 历史周榜重算 |
| `repo-recent-daily/<bucket>` | `repo_id % N` | 32 | ~165 repo × ≤90 日点，~数百 KB | 每日 / 每周折叠 |
| `site-daily/<yyyy>` | 年 | 1/年 | 365 点，KB 级 | heatmap step |

**内存校验(M2)**：跨桶 gather 的 step(rank / entity-org / all-time)需一次载入**全部**桶——
- 全部 `repo-monthly`：32 × ~430KB ≈ **~14 MB**;全部 `repo-weekly`：64 × ~1MB ≈ **~64 MB**。
- 即便同时载入 monthly + weekly + repos ≈ **&lt; 100 MB**,远低于 Function **4GB** 上限。
- 单文件读走 **Blob 直链**(绕过 4.5MB 响应体限制),`repo-weekly` 单桶 ~1MB 也安全。
- 写出侧:全量 entity(~16k 文件)按 **75/s** 节流 ≈ 213s,但 entity/repo 按桶分多 step(7a),每 step 仅 ~165 文件 ≈ 2–3s,不逼近 800s。
> 桶数可调:若白名单扩容使 `repo-weekly` 单桶逼近内存/直链舒适区,调大桶数(如 128)即可,逻辑不变。

> 桶数是可调旋钮：目标是**单桶 JSON 远小于 Function 内存、单 step 处理几个桶在时长内完成**。规模增长（白名单扩容）时调大桶数即可，不改逻辑。

---

## 5. Canonical 模式重设计（脱离本地 Parquet）

### 5.1 为什么要重设计

现状 canonical = **单个 `star_daily.parquet`**（per-repo×天，~800 万行）。它只能被 **DuckDB**（本机原生模块、4GB 内存）读出来做全量预算。这是「依赖本地计算」的根因——**只要生产重算需要读这个 Parquet，就必须有本机 DuckDB**。

### 5.2 设计原则：Vercel-friendly JSON shards

把「一张 8M 行的宽表」拆成**一组小而可单独重算的 JSON shard**，每个 shard：

- **纯 JSON**：`fetch` + `JSON.parse` 即可读，无原生模块、无引擎。
- **小**：单 shard 远小于 4.5MB（大文件走 Blob 直链读绕过响应体限制），可整个装进 Function 内存。
- **可单独重算**：改一个 repo 桶只重算该桶，不动全量。
- **预聚合到视图所需粒度**：生产重算需要的是「per-repo 月 / 周 flow + 累计 stock」「站点日总量」，**不需要**每天每 repo 的原始 8M 行。

### 5.3 shard 模型

| 逻辑事实 | 现状（Parquet 列） | v2 shard（JSON） | 谁消费 |
|---|---|---|---|
| per-repo×天 delta | `star_daily(repo_id,date,delta)` 全量 | **不进生产**：折叠为下面的月/周 rollup；原始日表只留 bootstrap 归档 | — |
| per-repo×月 flow | DuckDB `GROUP BY repo,月` | `canonical/v2/repo-monthly/<bucket>.json` = `{ "<id>": [[period, flow], ...] }` | 月榜 + entity 月曲线 |
| per-repo×周 flow | DuckDB `GROUP BY repo,ISO周` | `canonical/v2/repo-weekly/<bucket>.json` | 历史周榜 |
| per-repo 近 90 天日点 | DuckDB 取近 90 天 | `canonical/v2/repo-recent-daily/<bucket>.json` | entity 曲线尾 + 周边界 |
| 站点级日总量 | DuckDB `GROUP BY 日` | `canonical/v2/site-daily/<yyyy>.json` | heatmap |
| repo 维度 + 里程碑 | `repos` 维度 | `canonical/v2/repos/<bucket>.json` | lookup + entity meta + 新晋 |

> **关键洞察**：日粒度只在 bootstrap 时需要（算里程碑跨阈日 + 首次 rollup 成月/周）。**里程碑一次算定即冻结**；之后生产系统只**追加新日 delta（cron 活尾）并在周期收口时折进月/周 shard**。所以**生产 canonical = 月/周/站点 rollup shard + 滚动近 90 天 + repo 维度**，全 JSON、全小、全可在 Vercel 重算。原始 8M 行日表退为 bootstrap 归档。

> **recent-daily 老化收口（M1，避免曲线尾双源跳变）**：`repo-recent-daily` 是**滚动窗口**——一个日点滑出 90 天时,由 step 5 在折叠当月时**并入该月 `repo-monthly`**(同一动作、同一真相),并从 recent-daily 删除。**任一日期只在一处**：≤90 天在 recent-daily、>90 天在 monthly,不重叠。entity 曲线 `monthly`(月点)接 `recent_daily`(日尾)时,接缝就是 90 天水位线,口径连续(都是 net delta;stock 段按 §5.4 锚定)。

### 5.4 stock 锚定如何在 shard 上做（**必须分 seam 前后,口径同 [RANKING.md](./RANKING.md) §3**）

> ⚠️ **关键：折扣只作用于 seam 前的 gross,seam 后的 net 直接累加、不打折**。这是 [RANKING.md](./RANKING.md) §3 的权威口径,v2 必须照搬,否则曲线终点对不上 `current_stars`。

- **持久化 `seam_date`**:v2 新增 `canonical/v2/meta.json`(含 `seam_date`、`schema_ver`,见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) §1.4)。seam = gross→net 边界(bootstrap 截止日)。
- **折扣系数**(per repo,bootstrap 算定后冻结):`d = current_stars@seam / cumgross@seam_date`,**分母只含 seam 前 gross 累计**(不含任何 net)。`d ≤ 1`。
- **seam 前(历史)**:`stock_est[period] = round(cumgross[period] × d)`,`cumgross` = 该 repo 月 flow(gross)在桶内的前缀和。终点(seam 月)= `cumgross@seam × d = current_stars@seam`,精确锚定。
- **seam 后(net 期)**:`stock[period] = stock_est@seam + Σ(net flow 从 seam 到 period)`,**不打折**——net 是真实增量,精确跟踪(RANKING §3「seam 后不再估算」)。
- **实现**:repo-monthly 桶里每个 period 标记 gross/net(按 `seam_date` 判),折扣只乘到 gross 段前缀和,net 段直接加。纯 JS、单桶内存可控。

> 即:原本 DuckDB 的 `cumgross × d` + seam 后精确跟踪,在 v2 里变成「读一个 repo 桶 → 按 seam 分段做前缀和(gross 段乘 d、net 段不乘)」的纯 JS 计算。逻辑等价、口径与 RANKING §3 一致,但不需要 Parquet / DuckDB。**`d` 在 bootstrap 算定后写入 `repos` shard 冻结,Workflow 不重算 `d`(避免 net 累积让分母漂移)。**

---

## 6. 新晋 repo 历史策略（取舍要诚实）

新晋 repo（上线后首次 star ≥ 10,000、不在 bootstrap 基线里）的**历史 star 曲线**怎么补？三个方案，各有取舍：

| 方案 | 怎么做 | 完整度 | 速度 / 限额 | Vercel-first？ | 引入账单？ |
|---|---|---|---|---|---|
| **A 保守（推荐）** | 从**进入白名单当天**起追踪；entity 页标注 `tracked_since`，该日之前无曲线 | 仅发现日之后 | 快、无外部限额 | ✅ 纯 Vercel | 否 |
| **B GitHub stargazers API** | Workflow 分页调 `GET /repos/{o}/{r}/stargazers`（`Accept: application/vnd.github.star+json` 拿 `starred_at`），按天聚合补历史 | 较全，但有硬上限 | **慢且受限**（见下） | ✅ 纯 Vercel（慢） | 否 |
| **C BigQuery 重跑** | 对新 repo_id 重跑 GH Archive extract（含稳定 repo.id、gross adds） | **最完整** | 一次性、需人工 | ❌ 引入 GCP | **是（~小额 + GCP 账号）** |

### 6.1 诚实的限制说明

- **方案 B 的硬限**：GitHub stargazers 分页**最多约 400 页 × 100 = 40,000 个 stargazer**——超过 4 万 star 的 repo**取不全**早期历史。且 REST **5,000 请求/小时**配额下，一个 4 万 star 的 repo = 400 请求 ≈ 单 repo 吃掉 8% 小时配额，**非常慢**；要靠 Workflow `sleep('1 hour')` 跨配额窗口分批，可能耗时数小时到数天。仅对**小 / 新**（star 不远超 1 万）的 repo 现实可行。
- **方案 C 最完整但违背 Vercel-first**：BigQuery 查 GH Archive 是唯一能精确拿到「任意 repo 任意历史日 gross adds + 稳定 repo.id」的来源，但它**引入 GCP 账号与费用**，与「避免散落账单」冲突，只能作为**手动一次性 bootstrap / 重建**工具（L4），不进 recurring 生产路径。

### 6.2 推荐取舍

- **默认采用方案 A（保守）**：已有 bootstrap 历史基线（≈5,248 repo；当前约 5,261）**保留**；新增 repo **从发现日起追踪**，页面诚实标注 `tracked_since`（与 About 页「幸存者偏差 / as-of」口径一致，见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据口径）。
- **方案 B 作为可选 best-effort 增强**：对 star 不太大的新晋 repo，Workflow 可顺带调 stargazers API 补一段近似历史，失败 / 触限即降级回方案 A（标 `tracked_since`），**绝不**因补历史阻塞主流程。
- **方案 C 仅在「要大规模补全 / 重建基线」时手动跑一次**（L4 bootstrap），产物上传后由 L3 接管，不常态化。

---

## 7. 发布与回滚（版本前缀 → validate → 切指针）

### 7.1 发布流程（atomic pointer swap）

> **版本前缀 = run_id，无独立 staging/published 两段式**。重算直接写 `views/<run_id>/**`（新前缀，不影响线上）；该版本未被指针引用前对读侧不可见，等价于「staging」。publish 仅原子覆盖写一个指针文件即上线——省掉一次全量复制（~12,899 文件）。

```
1. step 6–8 重算产物写到 views/<run_id>/**（version = run_id，不影响线上）
2. step 9 validate：对该版本跑 Zod + sanity（见 TESTING）
   └─ 不过 → 抛错终止，指针从未切；views/<run_id> 成为无人引用的孤儿，留存排查 / 后续 GC
3. step 10 publish：原子覆盖写 views/latest.json = { version: run_id, run_id, published_at, prev_version }
   + 写 ops/workflows/latest-success.json。**无复制**——指针指向 run_id 前缀即上线。
   （读侧只认 views/latest.json + views/<version>/——见 §4.1/§2.11）
4. revalidate：读侧 latest.json 短缓存（≤60s）+ 版本化路径不可变 → 新版本在 ≤60s 内被拾取；
   动态数据页（rankings/pulse/entity 等为 ƒ server-rendered）按请求解析指针，热集亦可按需 ISR。
```

### 7.2 `views/latest.json` 指针契约

```jsonc
{
  "version": "refresh-2026-06-02T15-48-35-661Z",   // = run_id（版本前缀 views/<version>/）
  "run_id": "refresh-2026-06-02T15-48-35-661Z",
  "published_at": "2026-06-02T15:59:13.901Z",
  "prev_version": null,                              // 上一版本（首发为 null），供一键回滚
  "schema_ver": 1
}
```

- **读侧**：数据层先读 `views/latest.json`（带 `?v=<date>` cache-bust，规避 Blob 60s 传播窗口），解析出 `version` 前缀，再读该前缀下的视图。
- **原子性**：切指针是**单文件覆盖写**，最坏让某次请求读到滞后一版的指针（旧版本数据仍自洽），无半发布风险。

### 7.3 回滚

| 场景 | 操作 |
|---|---|
| 新版本数据有问题（已发布） | 把 `views/latest.json.version` 指回 `prev_version`——**秒级回退**，旧版本产物仍在 `views/<prev>`。 |
| 校验未过（未发布） | 无需回滚：指针从未切，线上一直是上一版；孤儿 `views/<run_id>` 留存排查。 |
| 部署层问题 | Vercel 保留历史部署，Promote 上一个正常 deployment（见 [OPS.md](./OPS.md) 回滚）。 |

- **保留份数**：`views/<version>` 保留近 N 份（如 4 份），旧版本 / 孤儿由 GC 清（脚本 `web/scripts/blob-del-prefix.ts <prefix>` 按前缀删，已用于清理临时 verify-* 版本）。
- **顺序**：先回滚数据（指针指回）→ 必要时再 redeploy → 核对 `ops/sync-runs.json` 与漂移恢复正常。

---

## 8. 失败恢复（幂等 + checkpoint）

### 8.1 不变量

| 不变量 | 保证方式 |
|---|---|
| **每个 step 幂等** | step 输出按 `(run_id, shard)` 确定路径覆盖写；重跑同 `run_id` 同 shard = 覆盖同一份，不重复累加。 |
| **重跑同一个 `run_id` 不写坏数据** | 版本前缀含 `run_id`；同 run 重跑只覆盖自己的 `views/<run_id>`，不碰已发布版本。 |
| **失败只影响该版本前缀** | 指针未切前，线上读的是 `views/latest.json` 指向的上一版；任何 step 失败都不影响线上。 |
| **`ops/workflows/latest-success.json` 是恢复点** | 记录最近一次成功发布的 run_id；新 run 从它的 canonical 状态出发增量重算。 |

### 8.2 恢复路径

- **某 step 失败**：Workflow SDK 内建 step 重试（网络错 / 崩溃自动重试）。业务侧每 step 写 `ops/workflows/<run_id>/steps/<step>.json` checkpoint，Workflow 重放时跳过已完成 step、从断点继续。
- **整个 run 卡死 / 超时**：运维据 `ops/workflows/<run_id>/manifest.json` 看卡在哪一 step；可重新触发同 `run_id`（幂等续跑）或起新 run。线上不受影响（指针未切）。
- **GitHub 限流**：step 内遇 `403` / secondary limit / `Retry-After`，短等待重试；跨小时配额用 workflow `sleep` 等待后继续，不空转。

### 8.3 与 L1/L2 live cron 的隔离 + 周期收口交接（H1：防重复/丢数据）

**前缀隔离**：L1/L2 写 `live/*` + `current_month.json` + `hot-snapshot.json`；L3 写 `canonical/v2/**` + `views/<run_id>/**` + `views/latest.json`。前缀不重叠，L3 重算期间 L1/L2 照常刷活尾。

**收口交接契约(关键——否则月初会丢上月最后一天的 net,或 live 与 canonical 重复计同一段)**：`current_month.json` 是**易失活尾**——现状 live cron 跨月时直接初始化新月、覆盖旧月(`live-refresh.ts` 的 `carryMonth` 在 `month` 变化时为空)。所以必须定义谁在「重置前」把上一期数据落到持久区:

| 步骤 | 谁做 | 动作 |
|---|---|---|
| 1. 冻结上一期 | **L1/L2 cron**(跨期那次) | 检测到 `current_month.json.month ≠ 本次 month` → **先**把旧月完整 `per_repo` 写到 `canonical/v2/pending/<旧 period>.json`(幂等覆盖),**再**初始化新月活尾。绝不在未落 pending 前丢弃旧月。 |
| 2. 折叠 | **L3 step 5** | 只读 `canonical/v2/pending/<period>.json`(已冻结、不再变动)→ 折进 `repo-monthly`/`repo-weekly` → 标 `folded_through=period`(写 `canonical/v2/meta.json`)。 |
| 3. 防重复 | **读路径 §4.1** | 已折叠周期(`≤ folded_through`)只读 base(已含该期);未折叠的当前/刚收口周期读 live 覆盖层。**同一周期绝不同时计 live + canonical。** |

> 这样:① 上月最后一天 net 一定先进 pending 才被覆盖 → **不丢**;② base 与 live 按 `folded_through` 水位线**互斥**取数 → **不重复**;③ pending 是冻结快照,L3 折叠期间 cron 不再动它 → step 5 读到的是稳定输入。`folded_through` 同时是周/月两套水位(周收口比月早)。

---

## 9. 成本边界

> Workflow step 本身按用量计费（[Workflows Pricing](https://vercel.com/docs/workflows/pricing)：Events / Data Written / Data Retained）；真正的大头是 **Function compute + Blob IO + GitHub API 时间**。设计要主动控这三项。

| 成本项 | 驱动 | 控制手段 |
|---|---|---|
| **Function compute** | step 数 × 每 step 时长 | step 按 shard 分批，控制总 step 数；I/O 等待（GraphQL / Blob）不计 active CPU，但要控 active 计算量（前缀和 / 排序在桶内做，桶不过大）。 |
| **Blob 写速率 / 量** | 重算写出的视图文件数 | 遵守 **75/s 写上限**（[OPS.md](./OPS.md)）；批量 put 限并发 + 节流；只写**变化的 shard**（diff-aware），不每次全量重写 16k+ 文件。 |
| **Blob 存储 / 保留** | published 历史版本份数 | 只保留近 N 份 published；旧版本清理。canonical shard 体积小（几十 MB 级）。 |
| **GitHub API 时间** | metadata / stargazers 调用 | GraphQL `nodes()` 100/查、标量字段成本低（约 5,261 repo ≈ 53 查 ≈ 1% 小时配额）；stargazers（方案 B）受 5,000 req/hr 限，用 sleep 分批。 |
| **页面再生** | revalidate 后冷生成 | **不一次性生成 16k 页**；继续 ISR / revalidate，长尾首访冷生成一次（读 KB 视图，可忽略）。 |

**硬约束复述**：
- 单 Function ≤ 800s / ≤ 4GB / bundle ≤ 250MB / 响应体 ≤ 4.5MB——**所以全量重算必须 Workflow 分片，大文件走 Blob 直链**。
- 不在请求热路径放任何 Workflow / 引擎；运行时永远只读静态 JSON（见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。

---

## 10. 迁移计划

> 渐进迁移，**每个 Phase 都可独立验证、可回退**；在 L3 完全落地前，L1/L2 live cron 保证站点不断档。

| Phase | 内容 | 状态 | 退出标准 |
|---|---|---|---|
| **Phase 0** | 每日 / 每周 **Vercel live cron**（JSON-only），写 `live/*` + 活尾 + hot-snapshot + sync-runs | ✅ 已完成 | daily/weekly 在 Vercel 真实跑通、契约校验通过 |
| **Phase 1** | 落地 **Workflow 文档 + checkpoint schema**（本文 + DATA-CONTRACTS 契约 + OPS runbook） | ✅ 已完成 | 文档齐全，schema 定义清楚，可据此开工 |
| **Phase 2** | **metadata / whitelist workflow**：把 `01-whitelist` + `03-metadata` 逻辑搬上 Vercel Workflow，产出 `canonical/v2/repos/**` + whitelist diff + rename map | ✅ **已在 Vercel 真跑通过(2026-06-02)** | `workflow@4.3.1` + `withWorkflow()`；`lib/workflows/refresh.ts`（whitelist→rename→metadata）+ `app/api/workflows/refresh/start`（CRON_SECRET）+ checkpoint。生产首跑:`status=published`、5,261 repo、32/32 repos 桶、`latest-success` 已切、~6.5 min。**metadata seed 自 bootstrap `lookup/repos.json`,GitHub 只补新晋(§3.4/§6)——避开二级限流**。start route 已加进 `vercel.json` crons（`0 6 * * 0`，周日 06:00 UTC） |
| **Phase 3** | **canonical JSON shard 迁移**：把 `star_daily.parquet` 折叠为 `repo-monthly/repo-weekly/repo-recent-daily/site-daily` shard（3a，bootstrap 一次性导出）；读侧 base 改走 `views/latest.json` 指针（带扁平回退） | ✅ 已实现 | 生产重算不再需要读 Parquet / DuckDB |
| **Phase 4** | **rank / entity / heatmap recompute**：step 6–8 在 Workflow 内重算所有视图到 `views/<run_id>/**` + validate + publish（切指针） | ✅ 已线上验证（2026-06-03） | 一次 Workflow run 全量重算 + 校验 + 发布，离线 parity 12,899 视图逐字节一致 |
| **Phase 5** | **月+周折叠 + 版本 GC + archive local backfill**：cron 冻结 pending + `foldCanonical`（月+周）+ seam-aware 重算 + `gc` 版本回收（✅ 已实现）；`pipeline/backfill` 正式标注为 bootstrap-only / 历史归档（待收尾） | ✅ 折叠/GC 已线上验证（2026-06-03）；backfill 归档收尾 🟡 待实现 | 折叠/GC 已 `status=published` 真跑；剩文档与代码注释明确 backfill 非生产路径；recurring 全在 Vercel |

> **进度小结**：Phase 0–5 ✅ 线上验证（2026-06-03 `status=published`），仅 backfill 归档收尾 🟡 待做——逐 Phase 状态以上表为准。

---

## 11. 验收（设计层面）

- [x] 生产数据生命周期（白名单 / 元数据 / 改名 / 新晋 / canonical 折叠 / 重算 / 校验 / 发布 / 回滚）**全部**有 Vercel 落点，无任何 recurring 步骤要求本地计算。
- [x] 清楚区分三层：**已实现** L1/L2 live cron · **✅ 已实现并线上验证** L3 Workflow（月+周折叠 / 重算 / 发布 / 版本 GC）· **归档** L4 `pipeline/backfill`。
- [x] Blob checkpoint / 版本前缀 / publish pointer / rollback 模式定义清楚且已实现（§3、§4、§7、§8）。
- [x] canonical 从单 Parquet 重设计为 JSON shard，生产重算不依赖 DuckDB / Parquet（§5）。
- [x] 新晋 repo 历史三方案取舍诚实写清，默认保守 + `tracked_since`（§6）。
- [x] 成本 / 限制（Cron、Function 800s/4GB/250MB/4.5MB、Workflow、Blob 75/s、GitHub 配额）写清（§1.3、§9）。
- [x] BigQuery/GCP 仅一次性 bootstrap，不在 recurring 生产路径；L3 Vercel Workflow 已实现并线上验证（2026-06-03 `status=published`）。
