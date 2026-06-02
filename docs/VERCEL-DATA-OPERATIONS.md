# gitstarclub Vercel-only 数据运营设计（VERCEL-DATA-OPERATIONS）

> **本文目标**：设计一套**完全不依赖本地计算**的生产数据生命周期——所有 recurring 数据作业在 Vercel 触发、运行、记录、发布、回滚。本机 `pipeline/backfill` 退役为**一次性 bootstrap 工具 / 历史归档**，不再是日常运营路径。
>
> ⚠️ **实现状态声明（务必先读）**：
> - **已实现（Phase 0）**：每日 / 每周 **Vercel live cron**（JSON-only），见 [OPS.md](./OPS.md)、[PIPELINE.md](./PIPELINE.md) §2–3。
> - **本文为设计目标 / 待实现**：**Vercel Workflow** 承载的「历史 / 元数据 / canonical 全量刷新」**尚未落地**，下文所有 Workflow 步骤、canonical JSON shard、staging/pointer 发布机制都是**设计蓝图**，不是现状。落地顺序见 §10 迁移计划。
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
| **L3 Managed refresh** | 白名单 diff → 元数据 shard → 改名检测 → 新晋追踪 → canonical 折叠 → rank/entity/heatmap 全量重算 → 校验 → 发布 → revalidate | **Vercel Workflow**（多 step，Blob checkpoint） | Cron 触发（如每周一次，独立于 L2）或手动 | 🟡 **待实现（本文设计）** |
| **L4 Bootstrap archive** | 11 年事件级历史首次回填（Search → BigQuery → DuckDB → JSON → Blob） | **本机 / 全 Node**（`pipeline/backfill`） | 手动，一次性 | 🗄️ 归档工具，非生产路径 |

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
            ├─ step 5  canonical shard update（折叠当月活尾 + 新晋历史）
            ├─ step 6  rank shard recompute     → views/staging/<run_id>/rank/**
            ├─ step 7  entity shard recompute    → views/staging/<run_id>/entity/**
            ├─ step 8  heatmap update            → views/staging/<run_id>/heatmap/**
            ├─ step 9  validate（Zod + sanity，对 staging 全量）
            ├─ step 10 publish（更新 views/latest.json 指针）
            └─ step 11 revalidate（revalidatePath 核心热集；长尾按需 ISR）
```

**为什么 Cron route 不直接干活**：Cron 触发是对生产 URL 的一次 HTTP GET，受 Function 时长 / 内存约束。所以 route 仅「鉴权 + 启动 workflow + 返回」，把真正的长任务交给 Workflow runtime 异步编排。

### 3.2 Workflow SDK 落地形态（待实现）

Vercel Workflow（[Workflows Concepts](https://vercel.com/docs/workflows/concepts)）用两个指令把普通 async 函数变成持久化工作流：

- **`'use workflow'`**：标记 workflow 函数——有状态、记住进度、崩溃 / 部署后**确定性重放**从断点恢复。
- **`'use step'`**：标记 step 函数——无状态的一个持久工作单元，**内建重试**，能扛网络错误 / 进程崩溃；step 执行时 workflow 挂起、不占资源；step 完成后自动恢复。
- **`sleep('...')`**（来自 `workflow` 包）：暂停若干分钟到若干月，不占资源——用于 GitHub rate-limit 窗口等待（见 §6）。

> 安装：`bun i workflow`（在 `web/` 项目内，因 Workflow 由 Vercel Functions 执行，与 Next.js 同部署）。

骨架示意（**仅设计示意，非现有代码**）：

```ts
// web/app/workflows/refresh.ts —— 待实现
export async function refreshWorkflow(runId: string) {
  'use workflow';

  await refreshWhitelist(runId);        // step 1
  await refreshMetadataShards(runId);   // step 2
  await detectRenames(runId);           // step 3
  await trackNewcomers(runId);          // step 4
  await foldCanonicalShards(runId);     // step 5
  await recomputeRankShards(runId);     // step 6
  await recomputeEntityShards(runId);   // step 7
  await recomputeHeatmaps(runId);       // step 8
  const report = await validateStaging(runId); // step 9
  if (!report.ok) return { runId, published: false, report };
  await publishPointer(runId);          // step 10
  await revalidateCore();               // step 11
  return { runId, published: true, report };
}

// web/app/steps/recompute-rank.ts —— 待实现
async function recomputeRankShards(runId: string) {
  'use step';                            // 独立 Function 路由、内建重试、幂等
  // 读 canonical/v2 月/周 shard（Blob 直链）→ 算 rank → 写 views/staging/<runId>/rank/**
}
```

### 3.3 step 切分原则

| 原则 | 落地 |
|---|---|
| **每个 step 短小** | 单 step 控制在 Function 时长 / 内存内（< 800s、< 4GB）。重算按 **shard 分批**：rank 重算每 step 处理 1 个周期或 1 个 period 批，不是「一次算完所有周期」。 |
| **每个 step 幂等** | step 输入 = `(run_id, shard 范围)`；输出按确定路径覆盖写 staging。重跑同 `run_id` 同 shard = 覆盖同一份产物，不重复累加（见 §8）。 |
| **step 之间用 Blob checkpoint** | 每个 step 完成后写 `ops/workflows/<run_id>/steps/<step>.json`（状态 + 产物清单 + 计数）。Workflow SDK 自身也持久化 step 结果；checkpoint 是**业务可读**的进度账本，供运维 / 恢复用。 |
| **大数据走 Blob 直链** | step 间不通过 Workflow 传大 payload（受 4.5MB 限）。step 只传 `run_id` / shard key 等小标识；数据落 Blob，下一 step 从 Blob 直链读。 |
| **长等待用 sleep** | 命中 GitHub secondary rate limit / `Retry-After` 时，step 内短等待；跨小时级配额恢复用 workflow `sleep('1 hour')`，不空转占资源。 |

### 3.4 步骤职责表

| # | step | 读 | 写 | 说明 |
|---|---|---|---|---|
| 1 | refresh whitelist | GitHub Search `stars:>=10000` | `canonical/v2/whitelist/<run_id>.json` + diff | 自适应分桶绕过 Search 1000 上限（逻辑同现 `01-whitelist`，但跑在 Vercel）。算出**新晋**（新 id）与**跌出**（旧 id 不再 ≥10k）。 |
| 2 | metadata shards | GitHub GraphQL `nodes(ids)` 批量 100/查 | `canonical/v2/repos/<bucket>.json` | owner/type、name、full_name、language、topics、createdAt、current_stars、isArchived。**分 bucket 写**，每 step 处理若干 bucket。 |
| 3 | rename detection | 新旧 `repos/<bucket>` | rename map → `ops/workflows/<run_id>/renames.json` | full_name 变化的 repo：记录旧→新映射，供 web 层 301（见 [SEO.md](./SEO.md) §7）。canonical 按 `repo_id` 归并，改名不丢历史。 |
| 4 | newcomer tracking | whitelist diff | `repos/<bucket>` 写 `tracked_since`；可选历史补片 | 新晋 repo 历史策略见 §6。默认保守：标 `tracked_since`，从发现日起追踪。 |
| 5 | canonical shard update | `current_month.json`（活尾）+ 已收口周期 | `canonical/v2/repo-monthly/**` `repo-weekly/**` `site-daily/**` | **折叠**：当月 / 当周收口时，把活尾 net delta 折进月 / 周 rollup shard；append 站点日总量。跌出者保留历史 shard、停止 poll。 |
| 6 | rank recompute | canonical 月/周/meta shard | `views/staging/<run_id>/rank/**` | 按 period 批量算 flow/stock/growth/new + all-time，幂等写 staging。stock 锚定见 [RANKING.md](./RANKING.md)。 |
| 7 | entity recompute | `repo-monthly` `repo-weekly` `repo-recent-daily` `repos` shard | `views/staging/<run_id>/entity/**` | 按 repo bucket 批量出 entity/repo、entity/org（成员聚合）。 |
| 8 | heatmap update | `site-daily` / `site-monthly` shard | `views/staging/<run_id>/heatmap/**` | 站点级日 / 月总量。 |
| 9 | validate | `views/staging/<run_id>/**` | `ops/workflows/<run_id>/validation.json` | Zod schema + sanity 不变量（[TESTING.md](./TESTING.md) §1.2/1.3）。**不过不发布**。 |
| 10 | publish | staging | `views/latest.json` 指针 + `ops/workflows/latest-success.json` | 原子切指针：读侧从此读新版本（见 §7）。 |
| 11 | revalidate | — | revalidatePath 核心热集 | 长尾按需 ISR、不全量 build（见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。 |

---

## 4. Blob 布局新设计

> 沿用 [OPS.md](./OPS.md) 的单一 PUBLIC store。在现有布局上**新增** `canonical/v2/`、`views/`、`ops/workflows/`，**保留**现有 `live/*`、`current_month.json`、`hot-snapshot.json`、`ops/sync-runs.json`。`canonical/star_daily.parquet` 降级为 bootstrap 归档（仍可留存，不在生产读路径）。

```
blob://
├── ops/
│   ├── sync-runs.json                       # L1/L2 live cron 运行记录（已实现）
│   └── workflows/                           # L3 Workflow（待实现）
│       ├── <run_id>/
│       │   ├── manifest.json                # run 元信息：触发时间、step 列表、整体状态
│       │   ├── steps/<step>.json            # 每个 step 的 checkpoint（状态 + 产物 + 计数）
│       │   ├── renames.json                 # 改名映射（step 3 产出）
│       │   └── validation.json              # 校验报告（step 9 产出）
│       └── latest-success.json              # 最近一次成功发布的 run_id（恢复点）
│
├── canonical/                               # 生产 canonical（JSON shard，待实现 v2）
│   ├── v2/
│   │   ├── whitelist/<run_id>.json          # 白名单快照 + diff
│   │   ├── repos/<bucket>.json              # repo 维度 + 里程碑 + tracked_since（按 id 分桶）
│   │   ├── repo-monthly/<bucket>.json       # per-repo 月 flow 序列（驱动月榜 + 月曲线）
│   │   ├── repo-weekly/<bucket>.json        # per-repo ISO 周 flow 序列（驱动历史周榜）
│   │   ├── repo-recent-daily/<bucket>.json  # per-repo 近 ~90 天日点（曲线尾 + 周边界）
│   │   └── site-daily/<yyyy>.json           # 站点级日总量（驱动 heatmap）
│   └── star_daily.parquet                   # 🗄️ bootstrap 归档（仅 L4 / 灾难重建用，非生产读路径）
│
├── views/                                   # 发布层（指针切换，待实现）
│   ├── latest.json                          # 指针：当前生效的版本前缀（见 §7）
│   ├── staging/<run_id>/                     # Workflow 写入的待发布产物
│   │   ├── rank/** entity/** heatmap/** lookup/** meta.json
│   └── published/<version>/                  # 已发布版本（保留近若干份供回滚）
│       └── rank/** entity/** heatmap/** lookup/** meta.json
│
├── live/                                     # 当前周期活尾覆盖层（L1/L2 写，已实现）
│   ├── rank/{week|month}/<current>/repo/{flow,stock}.json
│   └── heatmap/month/<current>.json
├── current_month.json                        # 当月活尾（L1/L2 写，已实现）
└── hot-snapshot.json                         # 热集快照（L1/L2 写，已实现）
```

### 4.1 读路径优先级（页面如何选版本）

页面 / 数据层读取顺序（保持现有「live 优先、回退 base」的语义，只是 base 改为指针解析）：

```
当前周期 rank/heatmap：  live/* （L1/L2 活尾） → 回退 views/<latest>/* （L3 发布版本）
历史周期 rank/heatmap：  views/<latest>/* （L3 发布版本）
entity / lookup：        views/<latest>/* （L3 发布版本）
hot-snapshot / current_month： 直读（L1/L2 活尾）
```

> 现状（Phase 0）：base 视图直接读 `rank/*` / `heatmap/*`（本机 precompute 上传的固定前缀）。迁移到 L3 后，base 改为「读 `views/latest.json` 指针 → 解析出版本前缀 → 读该前缀下的产物」。这一步是 §10 Phase 3 的事，**对页面逻辑透明**（数据层封装，组件不感知）。

### 4.2 分桶（bucket）策略

| shard | 分桶键 | 桶数（建议） | 单桶量级 | 重算粒度 |
|---|---|---|---|---|
| `repos/<bucket>` | `repo_id % N` | 32 | ~165 repo / 桶 | metadata step 每 step 几个桶 |
| `repo-monthly/<bucket>` | `repo_id % N` | 32 | ~165 repo × ~132 月点 ≈ 数百 KB | entity/rank step 按桶读 |
| `repo-weekly/<bucket>` | `repo_id % N` | 64 | 控制在 ~1MB 内 | 历史周榜重算 |
| `repo-recent-daily/<bucket>` | `repo_id % N` | 32 | 近 90 天，小 | 每日 / 每周折叠 |
| `site-daily/<yyyy>` | 年 | 1/年 | 365 点，KB 级 | heatmap step |

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

### 5.4 stock 锚定如何在 shard 上做

stock（累计总量）历史值 = gross 累加 × 折扣锚定到 `current_stars`（公式见 [RANKING.md](./RANKING.md)）。在 v2 下：

- 折扣系数 `d = current_stars / total_gross`（`total_gross` = 该 repo 月 flow 之和）可在 entity/rank step 内**就地算**（读该 repo 桶的月序列求和），无需全量引擎。
- 每个周期的 `stock_est = round(cumgross × d)`，cumsum 在桶内按 period 顺序累加即可——纯 JS，单桶内存可控。

> 即：原本 DuckDB 的窗口函数 `SUM(flow) OVER (PARTITION BY repo ORDER BY period)`，在 v2 里变成「读一个 repo 桶 → 对每个 repo 的月序列做前缀和」的纯 JS 计算。逻辑等价，但不需要 Parquet / DuckDB。

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

- **默认采用方案 A（保守）**：已有 bootstrap 历史基线（5,248 repo）**保留**；新增 repo **从发现日起追踪**，页面诚实标注 `tracked_since`（与 About 页「幸存者偏差 / as-of」口径一致，见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据口径）。
- **方案 B 作为可选 best-effort 增强**：对 star 不太大的新晋 repo，Workflow 可顺带调 stargazers API 补一段近似历史，失败 / 触限即降级回方案 A（标 `tracked_since`），**绝不**因补历史阻塞主流程。
- **方案 C 仅在「要大规模补全 / 重建基线」时手动跑一次**（L4 bootstrap），产物上传后由 L3 接管，不常态化。

---

## 7. 发布与回滚（staging → pointer → revalidate）

### 7.1 发布流程（atomic pointer swap）

```
1. Workflow step 6–8 把重算产物写到 views/staging/<run_id>/**（不影响线上）
2. step 9 validate：对 staging 全量跑 Zod + sanity（见 TESTING）
   └─ 不过 → 终止，不切指针；staging 留存供排查（见 §8）
3. step 10 publish：
   a. 把 staging/<run_id> 提升为 published/<version>（或直接让指针指向 staging 前缀）
   b. 原子更新 views/latest.json = { version, run_id, published_at, prev_version }
   c. 写 ops/workflows/latest-success.json = run_id
4. step 11 revalidate：revalidatePath 核心热集（首页/pulse/rankings/当年/当月/当前周）
   长尾页按需 ISR，下次访问读新指针对应版本
```

### 7.2 `views/latest.json` 指针契约

```jsonc
{
  "version": "2026-06-02T04-00-00Z",      // 本次发布版本号（建议用发布时刻 UTC）
  "run_id": "refresh-2026-06-02T04-00-00-000Z",
  "published_at": "2026-06-02T04:03:11.000Z",
  "prev_version": "2026-05-26T04-00-00Z", // 上一版本，供一键回滚
  "schema_ver": 1
}
```

- **读侧**：数据层先读 `views/latest.json`（带 `?v=<date>` cache-bust，规避 Blob 60s 传播窗口），解析出 `version` 前缀，再读该前缀下的视图。
- **原子性**：切指针是**单文件覆盖写**，最坏让某次请求读到滞后一版的指针（旧版本数据仍自洽），无半发布风险。

### 7.3 回滚

| 场景 | 操作 |
|---|---|
| 新版本数据有问题（已发布） | 把 `views/latest.json.version` 指回 `prev_version`，revalidate 核心热集——**秒级回退**，旧版本产物仍在 `published/<prev>`。 |
| 校验未过（未发布） | 无需回滚：指针从未切，线上一直是上一版；staging 留存排查。 |
| 部署层问题 | Vercel 保留历史部署，Promote 上一个正常 deployment（见 [OPS.md](./OPS.md) 回滚）。 |

- **保留份数**：`published/<version>` 保留近 N 份（如 4 份），旧版本由后续 Workflow 清理 step 或手动清。
- **顺序**：先回滚数据（指针指回）→ 必要时再 redeploy → 核对 `ops/sync-runs.json` 与漂移恢复正常。

---

## 8. 失败恢复（幂等 + checkpoint）

### 8.1 不变量

| 不变量 | 保证方式 |
|---|---|
| **每个 step 幂等** | step 输出按 `(run_id, shard)` 确定路径覆盖写；重跑同 `run_id` 同 shard = 覆盖同一份，不重复累加。 |
| **重跑同一个 `run_id` 不写坏数据** | staging 前缀含 `run_id`；同 run 重跑只覆盖自己的 staging，不碰已发布版本。 |
| **失败只影响 staging** | 指针未切前，线上读的是上一版 `published/<latest>`；任何 step 失败都不影响线上。 |
| **`ops/workflows/latest-success.json` 是恢复点** | 记录最近一次成功发布的 run_id；新 run 从它的 canonical 状态出发增量重算。 |

### 8.2 恢复路径

- **某 step 失败**：Workflow SDK 内建 step 重试（网络错 / 崩溃自动重试）。业务侧每 step 写 `ops/workflows/<run_id>/steps/<step>.json` checkpoint，Workflow 重放时跳过已完成 step、从断点继续。
- **整个 run 卡死 / 超时**：运维据 `ops/workflows/<run_id>/manifest.json` 看卡在哪一 step；可重新触发同 `run_id`（幂等续跑）或起新 run。线上不受影响（指针未切）。
- **GitHub 限流**：step 内遇 `403` / secondary limit / `Retry-After`，短等待重试；跨小时配额用 workflow `sleep` 等待后继续，不空转。

### 8.3 与 L1/L2 live cron 的隔离

L1/L2 写 `live/*` + `current_month.json` + `hot-snapshot.json`；L3 写 `canonical/v2/**` + `views/staging|published/**`。**前缀不重叠**，L3 重算期间 L1/L2 照常刷活尾，互不干扰。L3 发布后，当前周期的 live 覆盖层继续盖在新 base 之上（读路径见 §4.1）。

---

## 9. 成本边界

> Workflow step 本身按用量计费（[Workflows Pricing](https://vercel.com/docs/workflows/pricing)：Events / Data Written / Data Retained）；真正的大头是 **Function compute + Blob IO + GitHub API 时间**。设计要主动控这三项。

| 成本项 | 驱动 | 控制手段 |
|---|---|---|
| **Function compute** | step 数 × 每 step 时长 | step 按 shard 分批，控制总 step 数；I/O 等待（GraphQL / Blob）不计 active CPU，但要控 active 计算量（前缀和 / 排序在桶内做，桶不过大）。 |
| **Blob 写速率 / 量** | 重算写出的视图文件数 | 遵守 **75/s 写上限**（[OPS.md](./OPS.md)）；批量 put 限并发 + 节流；只写**变化的 shard**（diff-aware），不每次全量重写 16k+ 文件。 |
| **Blob 存储 / 保留** | published 历史版本份数 | 只保留近 N 份 published；旧版本清理。canonical shard 体积小（几十 MB 级）。 |
| **GitHub API 时间** | metadata / stargazers 调用 | GraphQL `nodes()` 100/查、标量字段成本低（5,248 repo ≈ 53 查 ≈ 1% 小时配额）；stargazers（方案 B）受 5,000 req/hr 限，用 sleep 分批。 |
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
| **Phase 1** | 落地 **Workflow 文档 + checkpoint schema**（本文 + DATA-CONTRACTS 契约 + OPS runbook） | 🟡 进行中（文档） | 文档齐全，schema 定义清楚，可据此开工 |
| **Phase 2** | **metadata / whitelist workflow**：把 `01-whitelist` + `03-metadata` 逻辑搬上 Vercel Workflow，产出 `canonical/v2/repos/**` + whitelist diff + rename map | 🟡 待实现 | Workflow 能在 Vercel 刷新白名单 + 元数据 + 改名，写 checkpoint |
| **Phase 3** | **canonical JSON shard 迁移**：把 `star_daily.parquet` 折叠为 `repo-monthly/repo-weekly/repo-recent-daily/site-daily` shard；读侧 base 改走 `views/latest.json` 指针 | 🟡 待实现 | 生产重算不再需要读 Parquet / DuckDB |
| **Phase 4** | **rank / entity / heatmap shard recompute**：step 6–8 在 Workflow 内重算所有视图到 staging + validate + publish + revalidate | 🟡 待实现 | 一次 Workflow run 能全量重算 + 发布 + 回滚，校验通过 |
| **Phase 5** | **archive local backfill**：`pipeline/backfill` 正式标注为 bootstrap-only / 历史归档；日常运营 0 本地依赖 | 🟡 待实现 | 文档与代码注释明确 backfill 非生产路径；recurring 全在 Vercel |

> **Phase 1 = 本轮**：只改文档、设计模式，不动运行代码。后续 Phase 2–5 才逐步写 Workflow 实现代码。

---

## 11. 验收（设计层面）

- [ ] 生产数据生命周期（白名单 / 元数据 / 改名 / 新晋 / canonical 折叠 / 重算 / 校验 / 发布 / 回滚）**全部**有 Vercel 落点，无任何 recurring 步骤要求本地计算。
- [ ] 清楚区分三层：**已实现** L1/L2 live cron · **待实现** L3 Workflow · **归档** L4 `pipeline/backfill`。
- [ ] Blob checkpoint / staging / publish pointer / rollback 模式定义清楚（§3、§4、§7、§8）。
- [ ] canonical 从单 Parquet 重设计为 JSON shard，生产重算不依赖 DuckDB / Parquet（§5）。
- [ ] 新晋 repo 历史三方案取舍诚实写清，默认保守 + `tracked_since`（§6）。
- [ ] 成本 / 限制（Cron、Function 800s/4GB/250MB/4.5MB、Workflow、Blob 75/s、GitHub 配额）写清（§1.3、§9）。
- [ ] 全程**不把 Vercel Workflow 说成已实现**；不把 BigQuery/GCP 说成必须路径。
