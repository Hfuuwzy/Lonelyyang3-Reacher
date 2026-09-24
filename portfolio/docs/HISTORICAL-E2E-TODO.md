# 历史 E2E 待复核清单

## 证据与处理原则

本清单记录的是 **2026-09-23 曾观测到的基线**：40 个 E2E 通过、11 个 E2E 失败、18 个 unit 通过。这是历史证据，不是本次运行结果。

这 11 个测试仍处于活跃且失败的状态，既没有被跳过，也不能计为通过。本文不改动当前页面，只保存已通过覆盖范围和待重审的旧合同。品牌是 `Lonelyyang3`，`MyWorks` 是 GitHub 仓库名，不是品牌名。

开始 redesign 时，应逐项复核下列测试，用已批准的 `DESIGN.md` 替换过期断言，同时保留仍有价值的功能、可访问性和国际化覆盖。首个断言失败不代表整项测试其余断言都无效，未执行的后续断言须重新验证。

## 11 个待复核用例

### 1. `rail and drawer use the approved desktop tablet and mobile widths` ([来源](../tests/e2e/final-qa.spec.ts#L116-L141))

- 过期断言与观测差异：在 `object-position` 断言处失败，旧测试要求 `50% 18%`、`58% 38%`、`72% 42%` 的人物焦点位置。当前设计要求完整主视觉正常流显示，不做人物焦点裁切。
- 未验证：该次执行尚未走到各断点的右轨和抽屉宽度断言。
- 复核条件：redesign 确认主视觉和抽屉几何后，移除焦点裁切合同，按批准的 80/64/56px 右轨及抽屉覆盖规则重新验证。

### 2. `homepage exposes the approved semantic regions and character-level brand` ([来源](../tests/e2e/homepage-iteration.spec.ts#L12-L36))

- 过期断言与观测差异：测试把可访问品牌名写为 `MyWorks`，观测到当前品牌为 `Lonelyyang3`。
- 未验证：失败后的七个隐藏视觉字符数量和 `aria-hidden` 断言未得到确认。
- 复核条件：按 `DESIGN.md` 的单一 `Lonelyyang3` 语义标题重写品牌断言，并保留已批准的语义区域与辅助技术可读性检查。

### 3. `first visit follows brand artwork handoff and settled timing` ([来源](../tests/e2e/homepage-iteration.spec.ts#L38-L77))

- 过期断言与观测差异：旧测试假定七个 `home-brand-character` 节点存在，观测到这些字符节点不存在，因此字符动效时长断言失败。
- 未验证：字符延迟数组，以及随后的 artwork、handoff、settled 状态和下落过渡证据均未执行。
- 复核条件：以五张加载 Logo、最终品牌图片和批准的进入时序为准，重建可观察的阶段断言。

### 4. `return and reduced modes preserve the complete final DOM` ([来源](../tests/e2e/homepage-iteration.spec.ts#L79-L121))

- 过期断言与观测差异：旧测试期望刷新后为 `data-intro-mode="return"`，观测到仍为 `first`。现行设计要求每次刷新和路由重新进入使用同一序列，不以会话状态加速。
- 未验证：return 阶段状态、完整 DOM、字符终态，以及 reduced-motion 的所有断言都未执行。
- 复核条件：按每次进入一致的阶段合同和 reduced-motion 的即时 settled 行为分别验证，不再假定 return 模式。

### 5. `paper begins at the complete artwork bottom rather than the first viewport` ([来源](../tests/e2e/homepage-iteration.spec.ts#L170-L189))

- 过期断言与观测差异：测试以 `parseFloat()` 读取 `--home-paper-diagonal` 的 `clamp(...)`，结果为 `NaN`。这是测试取值方式的问题，不是已证实的页面几何回归。
- 未验证：带入 diagonal 的下界断言无法成立，后续上界断言也未执行。
- 复核条件：先用能解析 CSS 计算值的测量方式修正测试，再按完整主视觉底缘的批准纸层重叠范围验证。

### 6. `Japanese homepage and navigation preserve locale and active state` ([来源](../tests/e2e/oracle-regressions.spec.ts#L65-L94))

- 过期断言与观测差异：`home-latest-update` 不存在而失败。当前设计把最新文章放在 INFORMATION 区，不把“最新更新”行放入 Hero 信息区。
- 未验证：其后的日文项目和关于链接、右轨品牌、抽屉各导航链接、活跃状态及日文 blog 路由断言均未执行。
- 复核条件：按批准首页结构选择稳定的最新文章入口，再完整保留日文 href、`lang` 和 active-state 覆盖。

### 7. `opens and closes the right drawer with keyboard, overlay, and Escape` ([来源](../tests/e2e/redesign.spec.ts#L12-L30))

- 过期断言与观测差异：旧测试期望打开抽屉后 `body` 的 `overflow` 为 `hidden`，观测为可见。当前设计要求抽屉开闭始终不锁定页面滚动。
- 未验证：Escape 关闭后的状态、再次打开后点击透明外部区域关闭的断言未执行。
- 复核条件：改为验证页面滚动保持不变，同时保留键盘、Escape 和外部点击关闭路径。

### 8. `exposes the approved rail and drawer IDs at responsive rail widths` ([来源](../tests/e2e/redesign.spec.ts#L32-L53))

- 过期断言与观测差异：旧测试要求抽屉内存在 `right-nav-close`，观测到该 ID 不存在。当前设计只允许右轨菜单按钮变形为可见关闭控件。
- 未验证：900px 和 390px 的右轨宽度断言未执行。
- 复核条件：删除第二个内部关闭按钮的要求，保留右轨菜单图标状态与 80/64/56px 响应式宽度验证。

### 9. `traps focus and restores page state after Escape, close, and route navigation` ([来源](../tests/e2e/redesign.spec.ts#L55-L83))

- 过期断言与观测差异：测试在不存在的 `right-nav-close` 上失败，无法按旧的双关闭控件模型继续。
- 未验证：焦点回环、Escape 后恢复、菜单关闭、路由跳转关闭与焦点恢复行为都未获得完整证据。
- 复核条件：以右轨菜单按钮作为唯一可见关闭控件，重新验证焦点陷阱、Escape、外部点击和路由后的焦点恢复。

### 10. `homepage renders H-01 through H-05 with real DOM layers` ([来源](../tests/e2e/redesign.spec.ts#L129-L139))

- 过期断言与观测差异：旧测试要求 `/images/reference/deaimon/hero-main.png`，当前批准路径为 `/images/home/hero-main.png`，因此在主视觉 `src` 处失败。
- 未验证：其后的 `MyWorks` 品牌、最新更新、分类、媒体位和右轨断言未执行。
- 复核条件：按已批准的本站素材路径与 `Lonelyyang3` 品牌更新 H-01 至 H-05 的测试，同时保留真实 DOM 层的覆盖。

### 11. `homepage mobile copy starts below the protected hero face region` ([来源](../tests/e2e/redesign.spec.ts#L179-L185))

- 过期断言与观测差异：旧测试要求 `--mobile-hero-safe-area: 75svh`，观测到该变量不存在。当前设计禁止断点人物焦点裁切，要求完整主视觉自然滚动。
- 未验证：品牌顶部位置的后续断言未执行。
- 复核条件：以移动端完整图像、右轨 gutter、无水平溢出和内容不覆盖主视觉为验收条件，替换人物安全区断言。

## 后续复核补充（issue #7）

- 2026-09-23 的 E2E 结果为 40 通过、11 失败，见上列历史清单；并非全绿，也不是环境阻塞。本次未重新运行测试。
- 生产构建预览的 `/ja` 路由曾请求以下共享图片并收到 404：`/ja/images/reference/deaimon/paper-nav.jpg`、`/ja/images/reference/deaimon/paper-body.jpg`。开发服务器 E2E「Japanese routes never request locale-prefixed shared images」通过，不能据此推断生产预览正常。后续应修正为站点根路径图片 URL，并增加生产预览回归检查；同时核验 paper section 和其他运行时纹理，不把尚未观测到的破损写成事实。
- 焦点陷阱与恢复、Escape／外部点击、日文导航、响应式几何和无障碍的下游断言尚未完整执行，应在旧合同复核后重测。部分抽查已通过，但不代表整组测试通过。
- 浏览器证据清理有偏差：没有设置 run id／`$evidenceDir`，自动快照和日志留在被忽略的 `.playwright-mcp` 中；按工作区规则，未经单独批准未删除。后续流程应遵循 browser runbook。这是流程偏差，不是应用缺陷。

用户同意将上述未完成验证留待后续处理；issue #7 已于 2026-09-24 按明确豁免关闭。这不表示测试全绿或素材已修复。
