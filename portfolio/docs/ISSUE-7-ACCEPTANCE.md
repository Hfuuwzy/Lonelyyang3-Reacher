# GitHub Hfuuwzy/MyWorks#7 验收记录

**日期：** 2026-09-23

**代码基线：** HEAD `9ef9b25`。工作区原有未提交的素材源迁移和文档变更，本次未改动。

**结论：**

* **2026-09-23 初始严格验收：** 不通过，按当时的验收条件不应关闭 issue。E2E 有 11 项失败，生产预览有纸纹素材 404，且部分可访问性行为和浏览器证据清理未完成。
* **2026-09-24 用户批准的收尾：** 用户明确要求将已知问题延期，并将其从 #7 的关闭条件中豁免。这不代表全绿验收；E2E 未通过，404 未修复，可访问性仍有未知项，证据清理也未完成。

## 验收结果

* **生产构建，通过。** `npm run build` 退出码为 0。日志有 sourcemap、Nitro 模块解析和 Node 弃用警告，均未阻止构建。
* **单元测试，通过。** `npm run test:unit`：3 个文件共 18/18 通过，退出码为 0。
* **品牌素材校验，通过。** `node scripts/generate-brand-assets.mjs --check` 退出码为 0；hero 和 5 组 intro 源文件与运行时文件的 SHA256 均相同。
* **E2E，不通过。** `npm run test:e2e -- --workers=2 --reporter=line` 用时 3.4 分钟，40 通过、11 失败，退出码为 1。失败均与 issue #2 已记录的首个断言一致，是反复出现的过期测试合同，不是环境阻塞。根 README 将同一组失败列为 issue #2 的基线，但这不等于 issue #7 的 E2E 验收通过。各测试在首个失败处停止，之后的断言没有因此得到验证。
* **首页及博客路由，手工抽查通过。** 生产构建预览 `http://127.0.0.1:43187` 上，`/`、`/blog`、`/blog/linux-commands` 可访问。首页 9 张图片均解码成功且 `naturalWidth` 大于 0，文章封面解码成功。
* **素材完整性，不通过。** 日文页面实际请求以下两张纸纹素材时返回 404：`/ja/images/reference/deaimon/paper-nav.jpg`、`/ja/images/reference/deaimon/paper-body.jpg`。因此无损坏素材标准失败，尽管开发模式 E2E 用例 `Japanese routes never request locale-prefixed shared images` 通过。
* **语言路由抽查，通过但范围有限。** `/ja`、`/ja/blog`、`/ja/blog/linux-commands` 可访问；未加语言前缀的路由使用 `zh-CN`，日文路由的 `lang` 为 `ja`。纸纹 404 仍使素材标准失败。
* **响应式、主题及可访问性，部分通过，整体未完整证明。** `/ja` 在 2560、1280、768、390、375px 宽度下无水平溢出，右轨宽度依次为 80、80、64、56、56px。`/ja/blog` 的导航活动项 href 正确；主题切换后暗色状态保留；按 Escape 可关闭抽屉。E2E 中焦点相关用例在过期断言处停止，不能据此宣称完整键盘或可访问性验收通过。
* **功能代码未改动，通过。** 本次只新增本报告。

## E2E 失败明细

11 项的首个失败都与既有基线相同。下面列出测试来源位置、测试名称及失败断言；这些失败不应归为环境问题。

1. [`final-qa.spec.ts` 第 116 到 141 行](../tests/e2e/final-qa.spec.ts#L116-L141)，`rail and drawer use the approved desktop tablet and mobile widths`：人物焦点 `object-position` 断言与当前完整主视觉布局不符。
2. [`homepage-iteration.spec.ts` 第 12 到 36 行](../tests/e2e/homepage-iteration.spec.ts#L12-L36)，`homepage exposes the approved semantic regions and character-level brand`：测试要求品牌名 `MyWorks`，当前品牌为 `Lonelyyang3`。
3. [`homepage-iteration.spec.ts` 第 38 到 77 行](../tests/e2e/homepage-iteration.spec.ts#L38-L77)，`first visit follows brand artwork handoff and settled timing`：测试要求的 `home-brand-character` 字符节点不存在。
4. [`homepage-iteration.spec.ts` 第 79 到 121 行](../tests/e2e/homepage-iteration.spec.ts#L79-L121)，`return and reduced modes preserve the complete final DOM`：刷新后测试期望 `data-intro-mode="return"`，实际仍为 `first`。
5. [`homepage-iteration.spec.ts` 第 170 到 189 行](../tests/e2e/homepage-iteration.spec.ts#L170-L189)，`paper begins at the complete artwork bottom rather than the first viewport`：测试用 `parseFloat()` 解析 `clamp(...)`，得到 `NaN`。
6. [`oracle-regressions.spec.ts` 第 65 到 94 行](../tests/e2e/oracle-regressions.spec.ts#L65-L94)，`Japanese homepage and navigation preserve locale and active state`：测试查找的 `home-latest-update` 不存在。
7. [`redesign.spec.ts` 第 12 到 30 行](../tests/e2e/redesign.spec.ts#L12-L30)，`opens and closes the right drawer with keyboard, overlay, and Escape`：测试期望抽屉打开时 body `overflow: hidden`，实际可见。
8. [`redesign.spec.ts` 第 32 到 53 行](../tests/e2e/redesign.spec.ts#L32-L53)，`exposes the approved rail and drawer IDs at responsive rail widths`：测试要求的 `right-nav-close` 不存在。
9. [`redesign.spec.ts` 第 55 到 83 行](../tests/e2e/redesign.spec.ts#L55-L83)，`traps focus and restores page state after Escape, close, and route navigation`：在不存在的 `right-nav-close` 上失败，焦点回环和恢复行为未执行。
10. [`redesign.spec.ts` 第 129 到 139 行](../tests/e2e/redesign.spec.ts#L129-L139)，`homepage renders H-01 through H-05 with real DOM layers`：测试要求 `/images/reference/deaimon/hero-main.png`，当前路径为 `/images/home/hero-main.png`。
11. [`redesign.spec.ts` 第 179 到 185 行](../tests/e2e/redesign.spec.ts#L179-L185)，`homepage mobile copy starts below the protected hero face region`：测试要求 `--mobile-hero-safe-area: 75svh`，该变量不存在。

特别是响应式断言、焦点回环与恢复、日文导航及移动端后续断言，不能因各自用例在首个断言失败就记为通过。

## 手工检查记录与后续条件

在生产构建预览中对浅色配色和减少动态效果偏好检查了 `/`、`/blog`、`/blog/linux-commands`、`/ja`、`/ja/blog`、`/ja/blog/linux-commands`。首次使用端口 3001 时遇到 `EACCES`，改用 43187 后完成检查。

浏览器清理回执：本次未预先分配运行编号和 `$evidenceDir`（偏离运行手册）；使用 `playwright-isolated`，浏览器尝试 1 次、重试 0 次；导航记录时间为 2026-09-23 08:28:56 UTC，结束时间未单独记录，无法独立核实总时长。`browser_close` 返回 `No open tabs`；预览进程 PID 10688 已停止，43187 端口无监听进程；未启动并行浏览器栈，未修改 `.playwright-mcp` 配置。工具自动在忽略目录 `.playwright-mcp/` 生成了页面快照和控制台记录，未保留截图；由于工作区规则禁止未经单独批准修改该目录，这些自动记录尚未删除，证据清理不符合运行手册，不能写为已清理。

**2026-09-23 初始严格验收结论：** 关闭 issue 前需先按已批准的设计重审并更新这些过期断言，不得把失败标成环境问题或直接削弱测试；修正纸纹素材的站点根路径引用，避免日文页面请求 `/ja/images/...` 后，还需重新跑 E2E 并在生产预览复测素材请求。按当时验收条件，当前结果不支持关闭 issue。

## 2026-09-24 用户批准的收尾补充

用户明确要求将上述已知问题延期，并豁免其作为关闭 #7 的条件。后续复核事项已补充至[历史 E2E 待复核清单](HISTORICAL-E2E-TODO.md)，原有 11 项未改动。该清单目前仍是本地用户撰写的未跟踪文件。

这是用户批准的豁免式关闭决定，不是全绿验收；实际关闭状态以 GitHub issue 为准。原记录中的 40 通过、11 失败和生产纸纹 404 均仍是历史事实；可访问性有未验证项，浏览器证据清理也存在流程偏差。本补充不声称 E2E 已通过、404 已修复或清理已完成。
