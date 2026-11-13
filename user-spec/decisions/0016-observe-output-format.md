# D-0016 observe 的输出格式与 iframe 拼接

- 状态：有效
- 日期：2026-11-13
- 决策者：agent
- 服务于：
  - 作者预期：[overview.md「observe 改版」](../overview.md)、[overview.md「设计初衷」](../overview.md)
  - 上游决策：[D-0013](0013-playwright-recognition-layer.md)、[D-0012](0012-internal-cdp.md)
- 部分取代：[D-0001](0001-existing-browser-architecture.md) 中 agent-html 的页面表示

## 背景

作者要求页面快照保留文字和结构等信息。Playwright 的 YAML 快照信息完整但冗长：几乎每个元素都带 ref 和 `[cursor=pointer]`，链接网址单独占一行，一句话被行内链接拆成很多行，链接内部重复名称的文字也会展开。

另外，2026-11-13 在作者 Chrome 的 GitHub 页面上，旧 observe 超过 30 秒超时。在测试用 Chromium 里，旧 observe 在同一页面只用约 0.3 秒，所以之前"逐个元素发 CDP 命令太慢"的推断不成立，原因仍未查明。

## 决策

在 Playwright 的 AI 模式无障碍树（含它自己的"蒸馏"压缩）之上，按以下规则输出缩进文本：

- 每个节点一行：`- 角色 "名称" [状态] [E12]`，单段文字接在冒号后。保留全部文字，不截断单段文字；整份快照超过 30 万字符才截断。
- 只有可操作的元素带编号：交互角色（按钮、链接、输入框、复选框、下拉框、选项、标签页等），以及最外层带指针光标的元素。iframe 里的编号带 frame 前缀，如 `F1E3`。
- 链接网址跟在 `→` 后，并且总在行尾，避免后面的冒号或文字被读成网址的一部分。与页面同源的网址只写路径，指向本页的锚点只写 `#锚点`。`%E4%B8%AD` 这类转义按浏览器的做法显示成原字符；会改变网址含义的保留字符（`/ ? # & =` 等）、空白、控制字符和本格式用到的括号、引号保持转义，所以是无损的。
- 含文字的段落写成一行，行内链接写成 `[文字](E12 /url)`；上标引用、加粗等修饰元素也按行内处理。
- 链接、按钮内部只是重复其名称的文字包装不再展开。
- 隐藏的文件输入框（常被样式化按钮挡住）集中列在末尾，供 `browser.upload` 使用。
- 第一行写页面标题和网址。默认获得焦点的 body 不标 `[active]`。
- 每个 frame 的 content script 各自生成快照，iframe 位置留占位符，由 background 拼接。content script 不知道 `<iframe>` 元素对应哪个 frame id（实测在 Chromium 里用 `runtime.getFrameId` 拿不到），所以 background 先告诉每个 frame 它自己的 id，父 frame 再通过 postMessage 询问子窗口，按 `event.source` 对应。
- 不再用 CDP 的 `isClickable` 补充可点击元素：带指针光标的元素已由 Playwright 的树覆盖，observe 因此不再需要挂调试器。
- `select-option` 同时接受选项的值和显示文字，因为快照里只显示文字。

## 考虑过、没有采用

- 原样输出 Playwright YAML：在英文维基上比本格式多约 50%（37.8k 对 24.6k token）。
- 省略链接网址：可再省约 25%–30% token，但会丢信息，与作者"信息量很大、都要保留"的要求不符；留待作者决定。
- 把没有名称的 `generic` 容器拍平：能省 token，但会丢掉分组结构。

## 代价

- 输出格式是 Braiser 自定的，模型不像熟悉 Playwright YAML 那样熟悉它。
- 只有指针光标、没有交互角色、又没设光标的 JS 可点击元素拿不到编号（以前靠 CDP `isClickable` 补充）。
- 跨源 iframe 里的文件输入框无法用 `browser.upload` 设置（CDP 会话只覆盖同一进程的 frame）。

## 什么时候应该重新考虑

Agent 经常看不懂格式、找不到应有的元素，或者作者决定在 token 和信息量之间换一个取舍时。
