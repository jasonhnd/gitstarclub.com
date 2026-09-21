# AGENTS

本仓 Cursor 子代理定义见 `.cursor/agents/`。

## 舰队硬边界·不可破

- 禁在用户 Mac（含 /Users/ms23m2）写任何工作文件；禁 LocalExecution/本机 shell/下载桥接落盘。Mac 只聊天显示。
- 写入 GitHub（含文档）必须 Issue→Cursor Cloud Agent(CCA)→PR→授权后合并；握笔写仓仅 CCA。聊天长文≠入库正本。
- 未获 Jason 明确批准：不对外发、不给客户发邮件、不花钱、不动生产数据/开关/定价/文案上线。
- 原生聊天为默认；leader_relay / lead_relay / vm_grok46 等脚本保留，仅 Jason 点名或重开硬接时用。
- 正式【回传】门闩：磁盘有稿、模型返回、已派、已收 ≠ 完成；无合格回传不得标完成。

## Jason 新要求

- 协调者与子代理不得自动合 `main`（合 `pre` 可以）
- 每个任务计划写成 `plans/` 下的 markdown
- 起 agent 按「[角色][项目] 任务」命名
- 面向 Jason 的输出：技术术语第一次出现必须带大白话解释
