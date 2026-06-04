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

```
cumgross[repo, date] = Σ_{d ≤ date} delta            # gross 累加曲线
d[repo] = current_stars[repo] / cumgross[repo, seam_date]   # 折扣 (≤ 1)
stock_est[repo, date] = round(cumgross[repo, date] × d[repo])   # 锚定估算
```

- **比例折扣**把"取消 star"的修正**均匀分摊**到全历史，曲线终点正好落在 `current_stars`。
- **seam 后**：stock 由每日 `current_stars` 精确跟踪，不再估算。
- `entity/repo.curve.monthly` 的 `total_end` = 月末 `stock_est`（历史）/ 精确（seam 后）。
- **精度边界**：假设取消率随时间均匀（实际会变），是 MVP 可接受估算；About 页注明"历史曲线为锚定估算，终点精确"。star-history.com 同类做法。

> **唯一必须精确的数 = `current_stars`**（页面显示的当前 star）。历史曲线形状保留、终点锚定即可。

## 4. 派生榜：增速（growth）+ 新晋（new member）

二者由 flow/stock 推导，**零新增数据**，主要用于 repo 维度的月/年页。

### 增速 TOP（growth rate）
- 定义：`当期 flow / 期初 stock`，降序。
- **Floor：期初 stock ≥ 20,000 才入选**。无 floor 时增速榜永远是"刚进榜小项目榜"、与新晋榜重复；加 floor 后变成"已有体量却仍在加速的中坚"，信息量独立。
- 期初 stock = 上一周期末 `stock_est`（历史）/ 精确（seam 后）。

### 新晋（new member）
- 定义：`stock` 在当期内**首次** ≥ 10,000（白名单门槛）。
- 历史用 `stock_est` 跨越判定；seam 后用精确 stock。日期精度来自里程碑 `crossed_10k`（PIPELINE §4）。
- **排重**：新晋成员**不进入增速 TOP**，避免重复展示。

## 5. org 维度聚合

org 榜不抓新数据——把 per-repo 按 `owner` 分组求和：

- `flow_org[period] = Σ_{r ∈ org 白名单 repo} flow[r, period]`
- `stock_org[period] = Σ stock[r, period]`；全时 = `current_stars_sum`。
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
| 平手（同 value） | 二级排序按 `stock`（flow 榜）/ `current_stars`（stock 榜）降序，再按 `repo_id` 稳定排序 |
| 实体在窗口无数据 | 不入该窗口榜（区别于 flow=0） |
| 新 repo（创建于窗口内） | 仅从创建日起有数据；stock 从 0 起 |
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
