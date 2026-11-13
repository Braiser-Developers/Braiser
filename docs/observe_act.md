# 页面观察、操作与正文读取

设计依据：[D-0001](../user-spec/decisions/0001-existing-browser-architecture.md)。本文描述 `browser.observe`、`browser.act`、`page.extract_readable_text` 当前的实际行为；早期设计草稿见 [Observe/Act 草稿](todo/browser-agent-dom-mvp-agent-html.md)（部分已过时）。改动 [content.ts](../extension/src/content.ts) 的过滤、序列化或动作实现时，同步更新本文。

## 链路

background 找到 Braised 标签组的焦点页面，每次请求都用 `chrome.scripting.executeScript` 向顶层 frame 注入 content script（脚本自带防重复安装）。observe 先通过 CDP 补充可点击元素，再由 content script 生成 agent-html 和元素登记表（registry）。

## browser.observe

1. **可交互元素**：两种来源合并去重。
   - 选择器：`a[href]`、`button`、非 hidden 的 `input`、`textarea`、`select`、`summary`、`[contenteditable='true']`、若干 ARIA role（button、link、textbox、checkbox、radio、menuitem、tab）、`[tabindex='0']`、`[aria-haspopup]`、`[aria-expanded]`、`[onclick]`。
   - CDP：`DOMSnapshot.captureSnapshot` 的 `isClickable`。background 在 content script 的 isolated world 里用 `DOM.resolveNode` 和 `Runtime.callFunctionOn` 把节点交给 content script，不往真实 DOM 写临时属性。这一步失败时静默跳过。
   - 过滤：排除 `script`、`style`、`svg` 内的元素；要求可见（宽高大于 0 且未被隐藏），`input[type=file]` 例外。
2. **建树**：从 `document.body` 遍历子节点。丢弃 `script`、`style`、`link`、`meta`、`svg`、`path`，以及带 `hidden`、`display:none`、`visibility:hidden`、`opacity:0` 的整棵子树；既不是 HTML 也不是 SVG 的元素（例如 MathML 的 `<math>`）同样被当作不可见整棵丢弃。隐藏子树里的 file input 仍保留。
3. **属性**：只保留 `href`、`type`、`role`、`aria-label`、`aria-labelledby`、`aria-expanded`、`aria-checked`、`aria-selected`、`aria-haspopup`、`placeholder`、`title`、`alt`、`value`、`disabled`、`accept`、`multiple`、`capture`、`webkitdirectory`、`aria-hidden`、`contenteditable`、`data-testid`，file input 另加 `id`、`name`。属性读取的是 HTML 属性（`getAttribute`），不是元素当前状态；超过 200 字符的属性丢弃，`href` 超过 180 字符截断。
4. **简化**：没有保留属性、不可交互的 `div` 和 `span` 是透明包装：空的删除，只含文本的换成文本，只有一个子节点的折叠成子节点。相邻的单行文本合并成一行。
5. **编号**：简化之后按文档顺序分配 `data-eid="E1"` 起的编号，registry 只记录最终输出里出现的元素。快照编号 `S1`、`S2`……逐次递增，页面里只保留最近一次快照。
6. **文本截断**：每一段文本（合并后的连续行内文本或单独一行）最多 120 个字符，超出部分以 `...` 结尾。
7. **渲染**：每层缩进两个空格，深度每 6 层回到零缩进。整段输出超过 300000 个字符时从尾部截断，并设置 `meta.truncated`。`meta.debug` 是 CDP 补充链路的诊断计数。

## browser.act

先确认 `snapshotId` 是最近一次快照、元素仍在文档中、可见且没有 `disabled` / `aria-disabled="true"`，然后执行：

| 动作 | 实现 |
|---|---|
| `click` | `HTMLElement.click()` |
| `input-text` | input/textarea 直接设置 `value`，contenteditable 设置 `textContent`；`clearFirst` 默认 true；随后派发 `input` 和 `change` |
| `select-option` | 设置 `select.value`，派发 `input` 和 `change` |
| `toggle` | checkbox/radio 设置 `checked`（不传则取反）并派发事件；其他元素调用 `click()` |
| `focus` | `focus()` |
| `scroll-into-view` | `scrollIntoView({ block: "center", inline: "center" })` |

这些都是脚本合成的事件（`isTrusted=false`）。成功时返回 `shouldObserveAgain: true`，调用方应重新 observe。

## page.extract_readable_text

content script 返回 `document.documentElement.outerHTML`（运行时 DOM），MCP 所在主机按 [Markdown 协议](markdown_pipeline.md) 转成 Markdown，放在 `text` 字段返回，不截断。结果里没有 `data-eid`，不能直接用来操作。content script 同时计算的可见文本（`ReadablePage.text`）目前没有被 MCP 使用。

## 当前局限

以下按代码核对，标「实测」的见 [2026-11-13 observe 实测](../references/observe-measurement-2026-11-13.md)。

- observe 看不到表单当前状态：输入框显示的是初始 `value` 属性，复选框是否勾选、下拉框当前选项、textarea 当前内容都不显示。Agent 填写后无法通过 observe 确认结果。（实测）
- observe 不进入 shadow DOM 和 iframe，其中的文字和按钮都不出现。（实测）
- observe 中超过 120 字符的文本段会被截断，长段落读不全。（实测）
- observe 丢弃 MathML 等非 HTML/SVG 元素，只靠 MathML 表达的公式不会出现。
- observe 不包含元素是否在视口内、页面滚动位置等信息；没有按距离滚动页面的动作。
- 动作是合成事件，部分网站不响应；富文本编辑器（ProseMirror、Lexical 等）通常不认直接改写的 `textContent`。（推断，未实测）
- 正文读取基于 outerHTML，不经过 CSS 计算：CSS 隐藏的内容也会出现，shadow DOM 和 iframe 内容不会出现。（推断，未实测）
- 整页 observe 在大页面上很大：英文维基一页约 3 万 token，只比 Playwright MCP、Chrome DevTools MCP 的整页快照少约 20%；在 GitHub 仓库页上超过 30 秒超时，原因未查明。（实测，见 [2026-11-13 浏览器快照 token 实测](../references/browser-snapshot-tokens-2026-11-13.md)）
