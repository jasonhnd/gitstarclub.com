# ≥1k 宇宙：pre 闸门

- **task_id**：`gitstarclub-universe-1k-pre-gate-cca-001`
- **目标分支**：`pre`（不碰 `main`）
- **授权**：Jason 2026-09-21 JST「≥1k：现在就开」

## 目标

把纳入排名／刷新的宇宙下限从硬编码 ≥10,000 星改成可逆闸门，并在预发打开 ≥1,000。页开只用预计算。

## 范围

- `MIN_TRACKED_STARS` 运行时解析，默认 `10000`
- wrangler `env.pre.vars.MIN_TRACKED_STARS=1000`
- CF CI 门禁：预发必须是 `1000`；生产 top-level 不得设成 `1000`
- 文档 / env inventory 同步

## 不做

- 不改 `main` / 生产默认
- 不在页开路径现算
- 不重开 #362 的 ≥100 / 查询平面四项
- 不把浅短菜单当产品方向
- 本次不跑生产 refresh

## 验收

1. 默认 / 生产仍是 ≥10k
2. 预发配置可读出 ≥1k，且 `assert-cf-ci-gates` 锁住
3. 回滚：去掉或改回 `MIN_TRACKED_STARS=10000`
4. 真扩容只发生在下一次 **非 fixture** 全量 refresh
