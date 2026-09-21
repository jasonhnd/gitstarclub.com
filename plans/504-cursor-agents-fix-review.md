# #504 按审查修 .cursor/agents + AGENTS.md

- **task_id**：`gitstarclub-cursor-agents-fix-review-cca-001`
- **baseline**：`pre`（已含 #503）
- **目标**：Draft PR → `pre`；FINISHED ≠ 合并

## 范围

1. 13 个 `.cursor/agents/*.md` 的 `description` 改成「当需要……时使用。不用于……」，并分清 vercel/cloudflare、researcher/pm、code-reviewer/test-engineer。
2. 给 `test-engineer`、`github-ops`、`notion-ops` 加 `readonly: true`；保留 `researcher`、`code-reviewer`；其余可写岗不加。
3. 重写根 `AGENTS.md`：删 Grok 专用条目；引用服从 `.grok/rules/pre-only.md` 与 `.delivery.yml`；只留四条可执行新规；创建本目录。

## 不做

- 不碰 `main`；不合并本 PR
- 不改业务代码 / Worker / Cron
- 不造根目录 `WORKFLOW.md`（仓库当前无此文件）
