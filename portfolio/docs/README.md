# 文档索引

## 当前权威文档

| 文档 | 受众 | 内容 |
|---|---|---|
| [`../../README.md`](../../README.md) | 使用者与新贡献者 | 工作区布局、安装、运行和测试命令。 |
| [`../DESIGN.md`](../DESIGN.md) | UI 开发者 | 视觉令牌、布局、组件、响应式和素材合同。 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 开发者与未来维护者 | 运行时结构、数据流、扩展方法和技术债务。 |

代码和测试始终是最终事实来源；上述文档应随代码变更就地更新。

## 历史测试参考

- [`HISTORICAL-E2E-TODO.md`](HISTORICAL-E2E-TODO.md)：2026-09-23 已观测 E2E 失败的历史证据与 redesign 复核条件，不是当前设计权威。

## 同步规则

发生以下变更时，应在同一次修改中同步文档：

- 路由、Content schema、locale 或主题流变化：更新 `ARCHITECTURE.md`。
- 视觉令牌、断点、组件合同或素材策略变化：更新 `DESIGN.md`。
- 安装命令、脚本、使用方式或发布状态变化：更新根 `README.md`。
