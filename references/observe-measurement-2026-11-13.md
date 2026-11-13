# 2026-11-13 observe 实测

最近核对：2026-11-13。

来源：在作者本机 Chrome 的 Braised 标签组里新开后台标签页，通过本机 Braiser MCP 调用 `browser.observe` 和 `page.extract_readable_text`；测完关闭标签页，焦点切回原页面。被测代码为提交 `7e14290` 的扩展。

## 自制测试页

本机回环地址上的临时页面，包含：长段落、带行内链接的段落、表单（页面脚本把输入框、复选框、下拉框、textarea 改成新值）、只有 SVG 图标和 `aria-label` 的按钮、只靠 JS 监听器的可点击 `div`、`display:none` 的文字、表格、带 shadow DOM 的自定义元素、同源 iframe、contenteditable 区域。

结果：

- 正文、表格、链接文字都出现在输出中；`display:none` 的文字被去掉。
- 只靠 JS 监听器的 `div` 通过 CDP `isClickable` 拿到了编号；`<label>` 也被编了号。
- 图标按钮输出为 `<button data-eid="E8" aria-label="关闭"></button>`。
- 表单只显示初始状态：输入框 `value="初始值"`（实际值已改为新值），复选框没有勾选标记，下拉框没有当前选项，textarea 显示原始文字。
- 自定义元素输出为空的 `<my-card></my-card>`，shadow DOM 里的文字和按钮都没有出现。
- iframe 输出为空的 `<iframe></iframe>`，里面的文字和按钮都没有出现。
- 共 10 个可交互元素，输出未截断。

## 英文维基百科 Markdown 条目

页面：<https://en.wikipedia.org/wiki/Markdown>。

- `browser.observe`：97304 个字符，588 个可交互元素，`meta.truncated=false`。
- 有 28 段文本因超过 120 字符被截断，例如 `The goal of the language was to enable people "to write using an easy-to-read and easy-to-write plain text format, optio...`。
- 段落中的每个行内链接都单独占一行，一个句子会被拆成多行。
- `page.extract_readable_text`：65569 个字符的 Markdown，正文完整，链接保留为 Markdown 链接。
