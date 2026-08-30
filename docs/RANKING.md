---
owner: ranking
status: active
last_reviewed: 2026-08-30
source_of_truth_for:
  - ranking definitions
  - stock anchoring
  - derived rankings
  - ranking edge cases
---

# gitstarclub 排名规格

## Scope

本文定义所有榜单的口径与边界：窗口 × 维度 × 指标的精确定义、stock 锚定算法、派生榜（增速 / 新晋）规则、org 聚合、周期边界、平手处理。新增榜单、改口径、改 floor 前必读。数据来源见 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)（`star_daily` 事实表）；产物形状同文 `rank/*` 节；页面呈现见 [PRODUCT.md](./PRODUCT.md)；口径瑕疵的产品级解释见 [ARCHITECTURE.md](./ARCHITECTURE.md)「数据口径的诚实瑕疵」。

## 1. 矩阵总览

排名 = **窗口 × 维度 × 指标**：

| 轴 | 取值 |
|---|---|
| **窗口** | 周（ISO `YYYY-Www`）· 月（`YYYY-MM`）· 年（`YYYY`）· 全时（`all`） |
| **维度** | repo（按 `repo_id`）· org（按 `owner` login，含 User 与 Organization） |
| **指标** | **flow**=期间新增（谁在涨）· **stock**=期末总量（谁最大） |

全部在 pipeline 预算成 `rank/{window}/{period}/{dim}/{metric}.json`（全时仅 stock）。

## 2. flow / stock 精确定义

设某实体在某窗口 `[t0, t1]`：

- **flow** = `Σ delta`（窗口内每日增量求和）。seam 后含 net（**可为负**——取消多于新增的窗口）。flow 榜按 flow 降序。
- **stock** = 期末累计总数（`t1` 当日的累计 star）。stock 榜按 stock 降序；全时榜 = `current_stars` / `current_stars_sum` 降序。

> 一个实体在窗口内**无任何事件**则不入该窗口榜（flow=0 也可入但排末尾；无数据 ≠ 0，见 §8）。

## 3. stock 历史锚定算法（解 gross 偏高）

历史是 gross（GH Archive 无取消事件），累加会**系统性偏高**；唯一精确锚点是今天的 `current_stars`（GraphQL）。算法：

```text
cumgross[repo, date] = Σ_{d ≤ date} delta            # gross 累加曲线
d[repo] = current_stars[repo] / cumgross[repo, seam_date]   # 锚定因子 (>= 0; archive undercount can make it > 1)
stock_est[repo, date] = round(cumgross[repo, date] × d[repo])   # 锚定估算
```

- **锚定因子**把 GitHub Archive 低计或取消 star 的差异统一锚定到 `current_stars`，因此 `d` 可能小于、等于或大于 1。
- **seam 后**：stock 由每日 `current_stars` 精确跟踪，不再估算。`computeRepoWindow` 仍用冻结 `anchor + cumNet`；若该公式为负（`d=0` 新晋、首段负流量），**发布的** `stock_est` 钳到 0，flow 保持有符号。
- 写 Blob 前对全部 `RepoEntity` / `OrgEntity` 做 Zod parse；不得放宽 `MonthlyPoint` 的 `NonNegativeInt`。
- `entity/repo.curve.monthly` 的 `total_end` = 月末 `stock_est`（历史）/ 精确（seam 后）。
- **年窗口 stock 锚定到该年最后有数据月**：年榜的 stock **不**在年粒度独立重算 gross/net，而是直接取该年**最后一个有数据月**的月度 `stock_est`（年 flow = 该年有数据月 flow 之和）。这样跨 seam 那一年内部已被月度逻辑解掉的"年内接缝拆分"会原样继承进年窗口，避免双重锚定（`web/lib/workflows/recompute/windows.ts` `deriveYearWindow`）。
- **精度边界**：假设取消率随时间均匀（实际会变），是 MVP 可接受估算；About 页注明"历史曲线为锚定估算，终点精确"。star-history.com 同类做法。

> **唯一必须精确的数 = `current_stars`**（页面显示的当前 star）。历史曲线形状保留、终点锚定即可。

## 4. 派生榜：增速（growth）+ 新晋（new member）

二者由 flow/stock 推导，**零新增数据**，主要用于 repo 维度的月/年页。

### 增速 TOP（growth rate）
- 定义：`当期 flow / 期初 stock`，降序。
- **入选两条件（同时满足）**：① **期初 stock ≥ 20,000**（Floor）；② **当期 flow > 0**（仅取正增长，排除 flow ≤ 0 的取消/持平期，使"增速"语义干净）。无 floor 时增速榜永远是"刚进榜小项目榜"、与新晋榜重复；加 floor 后变成"已有体量却仍在加速的中坚"，信息量独立。
- 期初 stock = 上一有数据期末 `stock_est`（历史）/ 精确（seam 后）。

### 新晋（new member）
- 定义：`stock` 在当期内**首次** ≥ 10,000（白名单门槛）。
- **判定来源**：直接读冻结的 `repos.crossed_10k`（bootstrap 算定后写入 `canonical/v2/repos/<bucket>.json`），按其 `slice(0,len(period))` 等于当期归类——**不在 recompute 或页面端用 `stock_est` 反推首破日期**，避免与 bootstrap 算定的里程碑漂移。
- **排重**：增速榜的 ≥20k floor 隐式排除刚破 1 万的新晋项目；两榜信息域天然不重叠。

## 5. org 维度聚合

org 榜不抓新数据——把 per-repo 按 `owner` 分组求和：

- `flow_org[period] = Σ_{r ∈ org 白名单 repo} flow[r, period]`
- `stock_org[period] = Σ stock[r, period]`；当前全时榜只聚合 `active:true` 成员，值 = GraphQL `current_stars_sum`。`active:false` repo 的历史 entity/曲线继续保留，但不进入当前全时榜。
- **成员 stock 前向填充（实现细节）**：成员 repo 在某期无事件时其 `stock_est` 缺失，直接求和会让 org 曲线在末期掉下来、终点对不上 `current_stars_sum`。故聚合前先按成员各自 `首次事件期→全局末期` **carry-forward** 其 `stock_est`（空期沿用上一期累计），再求和——org stock 曲线由此单调、终点精确等于 `current_stars_sum`（已验证 drift=0）。代价：org flow 在成员全闲的期记为 0（而非"无数据"），轻微偏离 §2 的"无事件不入榜"，仅影响极稀疏早期、榜尾，可接受。
- org 成员 = 该 owner 的 ≥10k 白名单 repo（`entity/org.members`）。
- owner_type（User/Organization）都参与；页面可加筛选（仅 Org / 全部），数据层不区分。
- org 的"增速/新晋"可选（MVP 可不做）；若做：增速 = org flow / org 期初 stock（floor 更高，如 ≥100k）。

## 6. 周期边界

- **周** = ISO 8601 周（周一起，UTC），标识 `YYYY-Www`；跨年周归属按 ISO（第 1 周含该年首个周四）。
- **月 / 年** = UTC 日历边界。
- 因周不整除月，canonical 必须**日**粒度（见 ARCHITECTURE 决策）；任意窗口由日聚合精确得出。
- "进行中"周期（当周/月/年）含活尾当日数据，每日 cron 刷新（hot-snapshot）。

## 7. 名次与变化

- `rank`：窗口内按指标降序，1 起；并列见 §8。
- `prev_rank`：上一同类周期（上周/上月/上年）同维度同指标的名次，供"↑↓ / 进出 TOP-N"。无（新进榜）则 `null`。
- 月/年页"上下期对比"= 本期 vs 上期 TOP-50 的进入/跌出 diff，由 `rank` + `prev_rank` 算出。

## 8. 边界 case

| 情况 | 处理 |
|---|---|
| flow 为负（取消 > 新增） | 正常入榜、排末尾；不裁剪（诚实展示） |
| 平手（同 value）— 主榜 | 二级排序：window 内 flow 榜按 `stock_est` 降序；window 内 stock 榜按 `flow` 降序；**all-time repo stock 榜按 `current_stars` 降序**；最末稳定排序按 `repo_id`（`web/lib/workflows/recompute/ranks.ts`） |
| 平手（同 value）— 增速 growth | `rate`（=flow/base）降序 → `flow` 降序 → `repo_id` 升序 |
| 平手（同 value）— 新晋 new | `current_stars` 降序 → `repo_id` 升序 |
| 平手（同 value）— all-time org stock | `current_stars_sum` 降序 → `login` 升序 |
| 实体在窗口无数据 | 不入该窗口榜（区别于 flow=0） |
| 新 repo（创建于窗口内） | 仅从创建日起有数据；stock 从 0 起 |
| `stock_est` would go negative (`d=0` newcomer, first-period unstars, opening negative flow) | Clamp the **published** count to 0. Flow stays signed. Running `cumGross` / `cumNet` / `anchor` stay unclamped so later periods can recover. Do not relax `MonthlyPoint` `NonNegativeInt`. |
| repo 跌出 ≥10k 白名单 | 保留历史（编年史不删），停止每日轮询；是否仍进当前榜 = PRODUCT 取舍（默认：当前榜按当前白名单，历史榜保留） |
| 改名/迁移 | 按 `repo.id` 归并（PIPELINE §4）；显示用当前 `full_name` |

## 9. 与产品页的映射（详见 PRODUCT）

| 页面 | 用到的榜 |
|---|---|
| 首页 | 年度脊柱（年 flow）· 本月聚焦（月 repo flow/stock）· 历史上的今天（里程碑） |
| 月度页 | 月 repo flow TOP · 月 repo 增速 TOP · 本月新晋 · 月历热力图 · 上下月对比 · （周 section 待定） |
| 年度页 | 年 repo flow TOP50 · 年新晋 · 12 月热力 · （周/月细分） |
| Repo 页 | 自身曲线（stock_est + recent daily）· 里程碑 · 月度表（flow + 名次） |
| Org 页 | org 自身曲线 · 成员 repo · org 在各 period 的名次 |
| 全时榜 `/rankings` | 全时 repo/org stock TOP |
