# gitstarclub 数据 Pipeline

> 如何产出 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) 定义的产物。三段：**① 一次性回填 ② 每日 cron ③ 每周 cron**。
> 引擎（BigQuery / DuckDB）只在**离线 / 全 Node 环境**；build / 运行时 / 每日 cron 零引擎、零原生模块。架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，运维/凭证见 [OPS.md](./OPS.md)。

## 0. 角色与环境

| 阶段 | 跑在哪 | 用什么 | 触发 |
|---|---|---|---|
| 一次性回填 | 本机 / 全 Node | BigQuery（一次）+ DuckDB + GraphQL | 手动跑一次 |
| 每日 cron | Vercel Function | 仅 fetch + JSON（**不碰 DuckDB/Parquet**） | Vercel Cron `0 3 * * *` |
| 每周 cron | 全 Node（本机/CI） | DuckDB + GraphQL/Search | Vercel Cron 触发或本机 |

凭证：`GITHUB_TOKEN`（GraphQL/Search）、GCP（**仅回填** BigQuery）、`BLOB_READ_WRITE_TOKEN`（上传）、`CRON_SECRET`。详见 OPS。

---

## 1. 一次性回填（`pipeline/backfill/`，手动跑一次）

```
01-whitelist → 02-extract(BigQuery) → 03-metadata(GraphQL)
            → 04-rollup(DuckDB) → 05-precompute(DuckDB) → 06-upload(Blob)
```

**01 whitelist** — GitHub Search `stars:>=10000`，按 star 区间**自适应分桶**绕过 Search 1000 结果上限（区间 >1000 则二分），输出 `data/whitelist.json`：`{id, node_id, full_name, owner, name, stars}`（≈5,248）。

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
2. GraphQL 批量查 5,248 repo current_stars（~53 查询）
3. net 日增 = 今日 current_stars − current_month.json 里昨日值
4. upsert current_month.json：按 UTC 日写 daily_totals + per_repo + current_stars（append-only，幂等）
5. 挑 mover 集（deltas 已在手，免费）：今日涨幅前 ~50 ∪（今日 ≥ 其 90d 日均 5× 且当日净增 ≥200）∪ 破里程碑
6. 重算 hot-snapshot.json + `/trending` 数据（含突刺/复活）→ Blob
7. revalidatePath：核心热集（首页/当年/当月/rankings/trending × 3 语言）+ **mover 集的 repo/org 页**
   （没动的实体 + 全部历史一概不碰）
```

- 全程 fetch + JSON，**不碰 Parquet/DuckDB**；秒级。
- 幂等：同一天重复跑 = 用同批 GraphQL 结果覆盖同一天，不重复累加（OPS：cron 无重试、可能触发两次）。
- 首日边界：`current_month.json` 不存在/跨月时初始化新月。

---

## 3. 每周 cron（全 Node，`pipeline/weekly/` 或 cron→本机）

```
1. GitHub Search 刷新 ≥10k 白名单 → diff 出新晋/跌出
2. 新晋者：BigQuery 补其历史（同 02，仅新 id）→ 并入 star_daily.parquet
3. 折叠：上月已收口的 current_month 日数据 → star_daily.parquet；
   重算受影响的月/年/全时视图 + 相关 entity（DuckDB）
4. 上传变更的 JSON 视图 → Blob
5. revalidatePath 变更页（不做 16k 全量 build；长尾按需 ISR）
6. 落 sync_runs 记录
```

- 跌出 ≥10k 的 repo：保留历史（编年史不删历史），仅不再每日轮询；策略见 RANKING / PRODUCT。
- 改名：以 `repo.id` 为准更新 `full_name`，旧 URL 由 web 层 301。

---

## 4. 关键算法

- **里程碑**：`repo cumsum(delta)` 跨阈值首日（回填时一次算定，冻结）。
- **stock 历史锚定**：gross 累加 × 折扣对齐 `current_stars` —— 公式与精度边界见 [RANKING.md](./RANKING.md)。
- **周期边界**：周 = ISO 周（UTC）；月/年 = UTC 日历边界。周不整除月，故 canonical 必须是**日**粒度（见 ARCHITECTURE 决策）。
- **折叠老化**：当月收口 → 日聚合成月度（entity `curve.monthly`）；近 ~90 天保留日点（`recent_daily`），更老只留月度。

## 5. 幂等 / 错误 / 重跑

- 每步可重跑：输出按 period/id 幂等覆盖；回填可分年/分批断点续跑。
- **版本化产物**：发布写 `v/<build_id>/` + `latest.json` 指针（或覆盖 + cache-bust），坏数据可回退（OPS 回滚）。
- **校验闸门**：产出 JSON 后跑 Zod schema + sanity 不变量（TESTING §1.2/§1.3），不过不发布。
- **失败靠告警**（Sentry + `sync_runs`），不靠自动重试（OPS）。
