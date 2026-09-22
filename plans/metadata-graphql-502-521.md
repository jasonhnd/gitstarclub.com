# Issue #521 — metadata GraphQL 502 续跑

## 根因（现场对齐）

- #512 已在 **同一 run / 同一 bucket hop** 内持久化 `metadata-<bucket>.json` 并 `retryMetadata` 重入队；`transient_attempts` 达 **6** 后 throw → `markFailed`，整 run 作废（`refresh-2026-09-22T12-32-21-068Z` 即此路径）。
- `latest-unpublished-whitelist` 只复用 **Search snapshot**，**不**携带旧 run 的 GraphQL batch 进度；再 Bearer 会从 metadata-0 重拉。
- 冷启动只放宽 lookup/repos 空读，**不**绕过 GraphQL metadata。

## 改动

1. 提高 hop 级 transient 预算与退避上限。
2. whitelist 从 unpublished 复用时写 `metadata_resume_run_id`，metadata 读取时合并旧 run 的 `fetched` 并重置 `transient_attempts`。
3. 文档 + 测试。
