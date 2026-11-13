# D-0019 修复新建 Braised 标签组时后台标签页跳到前台

- 状态：有效
- 日期：2026-11-14
- 决策者：agent（作者同意修复）
- 服务于：
  - 作者预期：[overview.md「项目定位」](../overview.md)
  - 上游决策：[D-0001](0001-existing-browser-architecture.md)

## 背景

`browser.create_tab` 和 `browser.open_tab` 的 `active` 参数、`browser.switch_tab` 的 `activate` 参数，决定 Chrome 是否把这个标签页切到前台，当时默认是 true（[D-0020](0020-background-tabs-by-default.md) 起改为 false）。传 false 时，Braiser 的工作焦点仍会换到这个标签页，但作者眼前看到的页面不变，Agent 在后台操作。

## 决策

Chrome 里还没有 Braised 标签组时，创建组所用的那个标签页也遵守 `active` 参数。

## 修复的 bug

- 现象：没有 Braised 标签组时调用 `browser.create_tab` 并传 `active: false`，新标签页仍会跳到前台。2026-11-14 在作者 Chrome 中实测时发现。
- 原因：创建标签组的函数新建第一个标签页时写死了 `active: true`，没有用调用方传入的值。
- 为什么原来的做法会出 bug：同一个参数在"组已存在"和"组不存在"两条路径上各自处理，只改了一条路径。重构时，凡是新建标签页的路径都要带上调用方的 `active`。
- 怎么验证修好了：端到端测试 `creating the Braised group keeps a background tab in the background (D-0019)` 在全新的浏览器里（没有 Braised 组）创建后台标签页，断言返回的 `active` 为 false；去掉修复后该测试失败。
