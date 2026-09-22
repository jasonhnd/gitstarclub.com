# SafeText：只拦 javascript: URL scheme

- **task_id**：`gitstarclub-safetext-javascript-scheme-cca-0774`
- **目标分支**：`pre`（不碰 `main`）
- **Issue**：#513
- **授权**：Lead — 可逆修 SafeText；不要问 Jason

## 目标

`refresh-2026-09-22T00-40-32-142Z` 在 metadata bucket 3 被 `/javascript:/i` 误杀。收紧检查，只拦真正的 `javascript:` URL scheme。防护保留。unpublished 65015 可复用。

## 范围

- `containsJavascriptUrlScheme` + `SafeText` refine
- 回归：LABjs / simpl 原文通过；`javascript:alert(1)` 拒绝
- 契约一句说明

## 不做

- 不改 `main` / 生产
- 不关 `WHITELIST_SEARCH_SHARDS` / 不退分片 Search
- 不 live-deploy、不打 Bearer、不用 `/start` fixture
- 不删 `javascript:` 防护

## 验收

1. 描述里的 `JavaScript:` 通过 `SafeText` / `ReposShard`
2. 真正的 `javascript:` URL 仍拒绝
3. 必过 CI：`static` + `production-build`
