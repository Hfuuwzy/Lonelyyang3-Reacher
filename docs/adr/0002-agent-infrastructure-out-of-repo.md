# ADR 0002: Agent 基础设施目录保留本地、不进版本控制

`.opencode/`（技能配置 + node_modules）、`.omo/`（agent 会话状态）、`.codegraph/`（代码图谱索引）与 `.playwright-mcp/`（浏览器工具目录）四个目录保留在本地供后续开发使用，通过根级 `.gitignore` 排除出版本控制。

背景：仓库的目标是"面向网页应用 + 文档"的纯粹结构。AGENTS.md 与 CONTEXT.md 已为 coding agent 提供所需上下文，技能/会话状态是个人工具层，不应污染仓库，同时 Windows 上技能 junction 链接也无法可靠提交。

执行：issue #3 仅将这四个目录留在本地并加入根 `.gitignore`，不删除、不移动。`.playwright-mcp/` 是否在后续清理（issue #5）中移除，另行决定，不在本票内处理。

后续决议（issue #5）：经单独批准，清除 `.playwright-mcp/` 中的旧日志和页面快照，保留目录及其忽略规则；未来修改该目录仍遵循浏览器自动化运行手册的单独批准要求。

Status: accepted
