# AGENTS

本仓 Cursor 子代理定义见 `.cursor/agents/`。

分支与合并策略以 `.grok/rules/pre-only.md` 为准；CI 必过项与交付管线以 `.delivery.yml` 为准。本文件不重复、不覆盖它们。

仓库当前无 `WORKFLOW.md`，以 pre-only + `.delivery.yml` 为准。

## 可执行新规

1. 子代理起 agent 按「[角色][项目] 任务」命名。
2. 面向 Jason 的输出，术语第一次必须大白话解释。
3. 不得自动合 `main`（合 `pre` 可以）。
4. 每个任务计划写成 `plans/` 下 markdown。
