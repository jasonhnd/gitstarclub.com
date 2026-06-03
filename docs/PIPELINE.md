# gitstarclub 数据 Pipeline

> 如何产出 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) 定义的产物。四段：**① 一次性 bootstrap（归档）② 每日 Vercel cron（已实现）③ 每周 Vercel cron（已实现）④ Vercel Workflow 生产 pipeline（✅ 已实现并线上验证，2026-06-03 status=published）**。
>
> ⚠️ **口径**：本文 §1 的「本机 BigQuery + DuckDB 回填」是**一次性 bootstrap / 历史归档**，**不是日常运营路径**。
> **生产 recurring 数据生命周期（白名单 / 元数据 / canonical 折叠 / 全量重算 / 发布 / 回滚）全部在 Vercel 运行**——
> 由 §4 的 **Vercel Workflow** 承载（**✅ 已实现并线上验证**，详见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)）。
> 普通 Vercel cron 只跑 JSON 增量刷新；引擎（BigQuery / DuckDB）**不得**塞进单个 Function（受 800s / 4GB / 250MB 限）。
> 架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，运维/凭证见 [OPS.md](./OPS.md)。

## 0. 角色与环境

| 阶段 | 跑在哪 | 用什么 | 触发 | 状态 |
|---|---|---|---|---|
| ① 一次性 bootstrap | 本机 / 全 Node | BigQuery（一次）+ DuckDB + GraphQL → JSON | 手动跑一次 | 🗄️ 归档，非生产 |
| ② 每日 cron | Vercel Function | GraphQL + JSON 活尾（**不碰 DuckDB/Parquet**） | Vercel Cron `0 3 * * *` | ✅ 已实现 |
| ③ 每周 cron | Vercel Function | GraphQL + JSON 增量覆盖当前周/月/热集 | Vercel Cron `0 4 * * 0` | ✅ 已实现 |
| ④ 生产重算 | **Vercel Workflow** | 多 step + Blob checkpoint + JSON shard（**无引擎**） | Vercel Cron `0 6 * * 0` / 手动 | ✅ 已实现并线上验证 |

凭证：`GITHUB_TOKEN`（GraphQL/Search）、GCP（**仅 bootstrap** BigQuery）、`BLOB_READ_WRITE_TOKEN`（上传）、`CRON_SECRET`。详见 OPS。

---

## 1. 一次性 bootstrap（`pipeline/backfill/`，手动跑一次，🗄️ 归档）

> **降级声明**：这一段是**首次冷启动 / 灾难重建**用的一次性工具，**不是日常运营 runbook**。它产出的 JSON 视图 + canonical 上传 Blob 后，由 Vercel（②③ live cron + ④ Workflow）接管 recurring 刷新。**日常运营 0 本地依赖。** 不删除这些脚本，但它们只在引入新数据源 / 重建基线时手动跑。

```
01-whitelist → 02-extract(BigQuery) → 03-metadata(GraphQL)
            → 04-rollup(DuckDB) → 05-precompute(DuckDB) → 06-upload(Blob)
```

**01 whitelist** — GitHub Search `stars:>=10000`，按 star 区间**自适应分桶**绕过 Search 1000 结果上限（区间 >1000 则二分），输出 `data/whitelist.json`：`{id, node_id, full_name, owner, name, stars}`（2026-05 bootstrap 基线 ≈5,248，当前约 5,261，每周变动）。

**02 extract（BigQuery，~$10）** — 先 `--dry_run` 确认扫描量/费用，再跑：
```sql
SELECT repo.id AS repo_id, DATE(created_at) AS day, COUNT(*) AS gross_adds
FROM `githubarchive.day.*`
WHERE _TABLE_SUFFIX BETWEEN '20150101' AND '<seam_date>'
  AND type = 'WatchEvent' AND repo.id IN UNNEST(@whitelist_ids)
GROUP BY repo_id, day;
```
含稳定 `repo.id`（改名归并），导出 Parquet 到本机。

**03 metadata（GraphQL）** — `nodes(ids:[node_id])` 批量 100/查询取 `owner.login + owner.__typename + name + description + primaryLanguage + repositoryTopics + createdAt + stargazerCount(=current_stars) + isArchived` → `repos` 维度（DATA-CONTRACTS §1.2）。

**04 rollup（DuckDB）** — 读 02 的 Parquet：
- 落 `canonical/star_daily.parquet`（`repo_id, date, delta=gross_adds`）。
- **里程碑**：每 repo 按 `date` 累加 `delta`，取累计首次 ≥10k/50k/100k 的日期 → `repos.crossed_*`。
- **daily_totals**：`GROUP BY date SUM(delta)` 站点级。

**05 precompute views（DuckDB）** — 按榜单矩阵与实体 rollup，产出全部 JSON 视图（rank/entity/heatmap/lookup，DATA-CONTRACTS §2）。**stock 锚定**与口径见 [RANKING.md](./RANKING.md)。

**06 upload（Blob）** — `star_daily.parquet` + `lookup/*` + `rank/**` + `entity/**` + `heatmap/**` + `meta.json`（含 `seam_date`）。批量 `put()` **节流 <75/s**（OPS Blob 限速）。

---

## 2. 每日 cron（`web/app/api/cron/daily`，JSON-only，幂等）

```
1. 校验 Authorization: Bearer CRON_SECRET（否则 401）
2. GraphQL 批量查约 5,261 repo current_stars（~53 查询）
3. net 日增 = 今日 current_stars − current_month.json 里昨日值
4. upsert current_month.json：按 UTC 日写 daily_totals + per_repo + current_stars（append-only，幂等）
5. 挑 mover 集（deltas 已在手，免费）：今日涨幅前 ~50 ∪（今日 ≥ 其 90d 日均 5× 且当日净增 ≥200）∪ 破里程碑
6. 重算 hot-snapshot.json + `/pulse` 数据（含突刺/复活）→ Blob
7. revalidatePath：核心热集（首页/当年/当月/rankings/pulse）+ **mover 集的 repo/org 页**
   （没动的实体 + 全部历史一概不碰）
```

- 全程 fetch + JSON，**不碰 Parquet/DuckDB**；秒级。
- 幂等：同一天重复跑 = 用同批 GraphQL 结果覆盖同一天，不重复累加（OPS：cron 无重试、可能触发两次）。
- 首日边界：`current_month.json` 不存在/跨月时初始化新月。

---

## 3. 每周 cron（Vercel Function，`web/app/api/cron/weekly`）

```
1. 校验 Authorization: Bearer CRON_SECRET
2. GraphQL 批量刷新 current_stars
3. upsert current_month.json
4. 覆盖写当前月 repo flow/stock、当前周 repo flow、当前月 heatmap、hot-snapshot
5. revalidatePath 核心页与当前周/月页
6. 落 ops/sync-runs.json 记录
```

- 跌出 ≥10k、新晋者补多年历史、全时/实体历史重算：不作为普通 cron 的同步步骤，交给 §4 Workflow。
- 改名：Vercel cron 的 live refresh 仍以现有 lookup 为准；全量 metadata 刷新进入 Workflow 分片后再更新 lookup，旧 URL 由 web 层 301。

---

## 4. Vercel Workflow 生产 pipeline（✅ 已实现并线上验证 —— 取代本机 DuckDB 全量重算）

> 完整设计见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md)。这里给与 §1 bootstrap 的**对应关系**：§1 那条本机链路已逐步搬上 Vercel Workflow，**不依赖本地计算**。

| §1 bootstrap 步骤（本机） | → | §4 Workflow step（Vercel，✅ 已实现） |
|---|---|---|
| 01-whitelist（Search） | → | step `refresh whitelist`（Search 自适应分桶 + diff） |
| 03-metadata（GraphQL） | → | step `metadata shards` → `canonical/v2/repos/<bucket>.json` |
| —（新增） | → | step `rename detection` + `newcomer tracking`（`tracked_since`） |
| 04-rollup（DuckDB → Parquet + 里程碑） | → | step `canonical shard update`（活尾折叠进月/周 JSON shard；里程碑 bootstrap 算定后冻结） |
| 05-precompute（DuckDB → 全部 JSON 视图） | → | steps `rank / entity / heatmap recompute`（读 JSON shard、纯 JS 聚合 → `views/<run_id>/**`）；entity/org step（`recompute-entity.ts`）派生 `search/index.json`，并入 validate 闸门 |
| 06-upload（Blob put 节流） | → | steps `validate → publish（切 views/latest 指针）→ gc（版本回收）→ revalidate` |

**关键差异**：
- **无引擎**：Workflow step 读 `canonical/v2/*` JSON shard，用纯 JS 做前缀和 / 分组 / 排序，**不加载 DuckDB / Parquet**（见 [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §5）。
- **分片 + checkpoint**：每 step 短小幂等，进度写 `ops/workflows/<run_id>/steps/<step>.json`；失败只影响该版本前缀 `views/<run_id>/`，不切线上指针（§7–8）。
- **发布 = 切指针**：写 `views/<run_id>/**`（version=run_id）→ validate → 切 `views/latest.json` → revalidate；可秒级回滚（§7）。✅ Phase 4 已线上验证。
- **不做 16k 全量 build**：发布只 revalidate 核心热集，长尾按需 ISR。

> Workflow 已落地：③ 每周 live cron 与 ④ Workflow 前缀隔离、各司其职（live 覆盖层 vs base 发布层），周级刷新不断档。

---

## 5. 关键算法

- **里程碑**：`repo cumsum(delta)` 跨阈值首日（回填时一次算定，冻结）。
- **stock 历史锚定**：gross 累加 × 折扣对齐 `current_stars` —— 公式与精度边界见 [RANKING.md](./RANKING.md)。
- **周期边界**：周 = ISO 周（UTC）；月/年 = UTC 日历边界。周不整除月，故 canonical 必须是**日**粒度（见 ARCHITECTURE 决策）。
- **折叠老化**：当月收口 → 日聚合成月度（entity `curve.monthly`）；近 ~90 天保留日点（`recent_daily`），更老只留月度。**ISO 周**在所有归属日落入已冻结月后折进 `repo-weekly`（与月折叠同期、同一 `fold` step，水位 `folded_through.week`；跨月周从两个月 pending 取日聚合）。

## 6. 幂等 / 错误 / 重跑

- 每步可重跑：输出按 period/id 幂等覆盖；bootstrap 可分年/分批断点续跑；Workflow step 按 `(run_id, shard)` 幂等（[VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) §8）。
- **版本化产物**：Workflow 发布写 `views/<run_id>/`（version=run_id）→ 切 `views/latest.json` 指针（保留 `prev_version`），坏数据指回上一版即可（OPS 回滚）。
- **校验闸门**：产出 JSON 后跑 Zod schema + sanity 不变量（TESTING §1.2/§1.3），不过不发布、不切指针。
- **失败靠告警**（Sentry + `sync_runs` + `ops/workflows/**`）；Workflow step 自带重试，跨配额用 `sleep` 等待，不空转。
