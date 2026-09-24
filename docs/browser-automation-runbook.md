# 浏览器自动化运行手册

## 事故记录

`2026-07-16`，一次 agent-browser 持久化工作流因没有总时限、重试上限和 `finally` 清理而运行过夜。随后 Playwright MCP 因复用共享持久化浏览器配置，报出 `browser-profile-in-use` 冲突。

`2026-07-14` 的 3000 端口事件与本事故无关，不应作为本次处置或根因。

## 工具路由

| 场景 | 首选工具 | 规则 |
| --- | --- | --- |
| 有时限、可重复的截图或采集 | `playwright-isolated` | 使用非持久化隔离模式。 |
| 需要交互、登录态或逐步操作 | `agent-browser` | 每次运行使用唯一 `--session`。 |
| 回归验证 | 应用自身 Playwright 测试配置 | 不与 MCP 或 agent-browser 并行运行。 |
| 首选工具失败 | 备用工具 | 仅在首选工具已关闭并确认释放资源后使用。 |

Microsoft 的隔离模式使用非持久化配置。未隔离的并发客户端必须使用不同的用户数据目录。不要假设任何配置在重启前已生效。

## 硬性限制

- 单次运行从启动到清理完成，最长 10 分钟。
- 首次尝试后最多重试两次，总计最多三次。
- 禁止脱离终端、后台运行或过夜执行。
- 同一时间只运行一个浏览器自动化栈，不并发启动 MCP、agent-browser 或应用测试。
- 不修改 `D:\Code\Blog\.playwright-mcp`，除非另获单独批准。issue #5 经单独批准清除了旧捕获产物，目录仍保留并被 git 忽略；后续运行继续将证据写入 `$evidenceDir`。
- 不终止、关闭或清理其他客户端拥有的浏览器进程或配置。

## 标准流程

1. 创建唯一运行编号，例如 `$runId = "20260716-153000-capture"`。
2. 设置证据目录：`$evidenceDir = Join-Path $env:TEMP "opencode\blog-browser\$runId"`，并创建目录。
3. 选定一个首选工具，记录开始时间和最多三次尝试的计划。
4. 执行每一步前确认剩余总时限。等待必须有明确上限，超时即进入停止和清理流程。
5. 成功、失败或超时都必须关闭本次启动的浏览器，再检查本次会话状态。
6. 默认删除证据目录。只有用户明确批准保留时才保留证据。
7. 输出清理回执。

### Playwright MCP，确定性采集

使用隔离命令启动，完成后无条件执行 `browser_close`：

```powershell
npx -y @playwright/mcp@latest --isolated --headless
# 执行限定的采集步骤
browser_close
```

采集只保存在 `$evidenceDir`。若首选运行失败，先完成 `browser_close` 并确认退出，再考虑备用工具。不要共用持久化 profile，也不要改动项目的 `.playwright-mcp`。

### 双标签页参考对比

参考站与本地页面的视觉对比默认使用同一个隔离 `playwright-isolated` 浏览器，不另开浏览器实例或 context。Tab A 打开参考页面，Tab B 打开本地页面。两个标签页只可在当前有界运行内保持打开，不能跨任务或过夜保留。

`2560×1440` CSS 像素是本工作区的主 2K 全屏视口，不等同于物理显示器的缩放或像素密度。先在页面顶部截取视口图，`fullPage` 只在需要补充长页面证据时使用。只有用户要求时，才继续检查更小的断点。

每次定时采集序列开始前，重置到相同的颜色模式、视口、滚动位置，并重新加载两个标签页。先提取截图、DOM 和计算样式等证据，再关闭浏览器。证据已返回到 `$evidenceDir` 后执行 `browser_close` 不会抹除已提取的证据，随后仍按本手册的证据保留和清理规则处理。

### agent-browser，交互操作

会话名必须唯一，并把每个等待限定为具体条件或毫秒数：

```powershell
$session = "blog-$runId"
agent-browser --session $session open "http://localhost:3000"
agent-browser --session $session wait --load domcontentloaded
agent-browser --session $session wait --text "保存成功"
agent-browser --session $session wait 5000
```

`wait 5000` 仅适合已知短暂渲染，不能作为循环等待。清理必须放在 PowerShell 的 `finally` 中：

```powershell
$session = "blog-$runId"
try {
    agent-browser --session $session open "http://localhost:3000"
    agent-browser --session $session wait --load domcontentloaded
}
finally {
    agent-browser --session $session close
    agent-browser --session $session session info --json
}
```

若关闭失败，只记录本次运行拥有的会话和残留进程。不得杀死可能属于其他客户端的进程。

## 停止条件

立即停止主操作并进入清理，只要出现任一情况：

- 已达到 10 分钟总预算，清理时间也计入预算。
- 已完成三次尝试。
- 浏览器配置被占用，出现 `browser-profile-in-use` 或等价错误。
- 无法确认当前 profile、会话或进程归属本次运行。
- 需要启动第二个浏览器自动化栈，或需要后台继续运行。
- 需要修改 `.playwright-mcp`，但没有单独批准。

停止不等于杀进程。先关闭本次工具启动的浏览器和会话，保留错误与状态证据，再写回执。

## 证据与清理

所有截图、日志、HAR、错误文本和回执写入：

```powershell
$evidenceDir = Join-Path $env:TEMP "opencode\blog-browser\$runId"
```

默认在回执完成后删除本次 `$evidenceDir`。只有用户批准保留时，才保留该目录并在回执中写明原因和路径。证据中不得写入密码、令牌、Cookie 或其他密钥。

## 清理回执模板

```text
run id:
tool:
started at:
finished at:
elapsed:
attempts / retries:
close result:
session status:
evidence removed / retained:
.playwright-mcp changed: no
residual owned process:
notes:
```
