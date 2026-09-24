# Blog Workspace Context

个人博客/门户工作区。仓库根在 `D:\Code\Blog`，前端应用位于 `portfolio/`（Nuxt 4），未来后端将以同级目录加入。本文档是该上下文唯一的领域词汇表。

## Language

**根提升 (Root promotion) (issue #3)**:
把 git 仓库根从 `portfolio/` 提升到 `D:\Code\Blog` 的过程：原有全部路径在索引中以 `portfolio/` 前缀保留，根级治理文件（README/.gitignore/AGENTS/CONTEXT/ADR/agents 文档）加入暂存区，并以一个**普通的结构性提交**落地——保留现有提交历史与远程跟踪（remote-tracking）引用，不压平历史、不发布。
_Avoid_: 基准提交、封存、历史重写

**基准提交 (Baseline commit)**:
清理完成、结构规范化后压成的单个 git 提交，是后续一切改造的起点。**属于 issue #8 的最终动作**：在根提升（issue #3）的结构性提交之后，将现有提交序列压成单个基准提交并发布到远程。
_Avoid_: 根提升、WIP 提交

**封存 (Seal)**:
在不影响任何已完成网页功能的前提下，删除与网页无关的文件、使仓库进入干净新状态的过程。注意：这里不是 git tag/分支快照，而是"清理到可用新起点"。
_Avoid_: 打标签、归档分支

**结构规范化 (Structure normalization)**:
只调整文件/目录的位置与组织方式，不修改任何功能代码；移动图片等资源时同步修复所有引用链接，保证页面显示不受影响。

**运行时资产 (Runtime assets)**:
`portfolio/public/images/` 下被页面、文章直接引用的图片，必须保留。
_Avoid_: 素材库、参考图

**源素材 (Source assets)**:
`portfolio/reference/asset-sources/` 下由生成脚本复制或产出到运行时资产位置的原始图片，被 `ASSET-SOURCES.md` 记录；`portfolio/reference/research/` 中的研究参考资料不属于源素材。
_Avoid_: 设计参考

**设计研究素材 (Design research material)**:
开发过程中的参考截图、抓取数据（如 `ref_design/`、`.firecrawl/`），与运行无关，删除后可在未来开发中重新生成。

**Agent 基础设施 (Agent infrastructure)**:
`.opencode/`、`.omo/` 等本地 agent 工具目录。保留在本地供后续开发使用，但不纳入 git 版本控制。

**前端应用 (Frontend app)**:
`portfolio/` 目录下的 Nuxt 应用本体。未来 `backend/` 作为同级目录加入本仓库。
_Avoid_: Blog 根目录、工作区

**仓库根 (Repo root)**:
`D:\Code\Blog`。git 仓库的根目录，纳入版本管理的内容只有：前端应用、当前有用的文档、根级规范文件（README/AGENTS/CONTEXT/.gitignore）。
