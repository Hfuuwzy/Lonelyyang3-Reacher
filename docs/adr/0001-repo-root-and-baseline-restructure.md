# ADR 0001: 仓库根提升至工作区根并压成单个基准提交

git 仓库根从 `portfolio/` 提升到 `D:\Code\Blog`，前端应用 `portfolio/` 作为子目录保留其全部内容；随后将现有 commit 与全部未提交改动合并为**单个基准提交**，force-push 到原远程 `git@github.com:Hfuuwzy/MyWorks.git` 的 `main` 分支，作为后续一切改造的干净起点。

背景：此前只有 `portfolio/` 是 git 仓库，根级文件（docs、AGENTS.md、规范）游离在版本控制之外；工作区残留大量与网页无关的开发产物。仓库名后续由用户在 GitHub 上自行重命名。

## 执行时序（issue sequencing）

该长期决定分两个 issue 落地：

- **issue #3（根提升）**：移动仓库根、重建索引（全部旧路径以 `portfolio/` 前缀保留）、暂存根级治理文件（README/.gitignore/AGENTS/CONTEXT/ADR/agents 文档），并以一个**普通的结构性提交**（normal structural commit）落地——这是实现工作流要求的常规提交，保留现有提交历史与远程跟踪引用，不压平历史、不推送。
- **issue #8（最终基准）**：在 #3 结构就位后，将现有提交序列压成单个基准提交并发布（force-push）到远程。

## 冻结检查点（freeze checkpoint）

`HEAD 31756e272f0c00beee2f2ff78e2a12050fa45042` 是清理前的冻结状态；其根树 `63b7c5c3ce306dc99fbfb248ce192f015e48086b` 必须逐字节保留为 #3 索引中 `portfolio/` 子树的哈希。任何修改该子树内容的操作都在冻结检查点之前完成。

Status: accepted

Consequences: 历史提交最终将被压平，中间状态无法再从 git 历史找回；删除的文件仅存在于基准提交之前的本地 git 对象中。这是有意的——用户以"单基准 + 后续清晰演进"为目标。
