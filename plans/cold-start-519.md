# Issue #519 — 预发冷启动契约

- **task_id**: `gitstarclub-cold-start-519-cca`
- **基线**: `pre`
- **Issue**: https://github.com/jasonhnd/gitstarclub.com/issues/519

## 目标

预发 Blob 无 `canonical/v2/meta.json`、无 `lookup/repos.json`、无 65015 时，Bearer 全量 refresh 仍可从 Search 写出新宇宙。

## 实现要点

- `WORKFLOW_COLD_START=1`（仅 wrangler `env.pre`）+ 已有 `PREFLIGHT_RELAX_EMPTY_SHARDS=1`
- 触发条件：`views/latest.json` 仍 404（首 publish 前）
- Route：允许 enqueue；workflow preflight 在 lease 下写最小合法 `canonical/v2/meta.json`
- Whitelist baseline `[]`；lookup / repos / series 缺 shard 读作 `{}`
- `seam_date` = bootstrap UTC 日；`node_id`/stars 仅来自 GitHub

## 冲突优先级（文档化）

冷启动 > #515 空桶占位语义扩展 > #512 502 恢复路径（502 仍有效，但不再要求旧 lookup）> SafeText（仍截断，不造假）

## 不做

- 不触发 Bearer refresh、不 empty Blob、不合 main
