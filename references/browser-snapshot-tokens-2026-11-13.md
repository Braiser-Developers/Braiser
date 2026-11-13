# 2026-11-13 浏览器快照 token 实测

最近核对：2026-11-13。

## 方法

- 同一天抓取三个页面：英文维基百科 Markdown 条目、中文维基百科 Markdown 条目、GitHub 仓库页 `microsoft/playwright-mcp`。
- Braiser：作者本机 Chrome 的 Braised 标签组里新开后台标签页，调用 `browser.observe` 和 `page.extract_readable_text`（扩展代码同提交 `7e14290`）。
- Playwright MCP v0.0.85、Chrome DevTools MCP v1.13.0：用 MCP SDK 客户端以 stdio 启动，headless 的本机 Chrome，独立配置，视口 1280×800；导航后等 2 秒再取快照。两者看到的是未登录页面，Braiser 用的是作者的 Chrome（维基和 GitHub 公共页面，未登录差异推断很小）。
- token 用 tiktoken 的 `o200k_base` 分词器计算，近似 OpenAI 新模型。Claude 的分词器不同，数字会有出入，但不同工具之间的相对大小可参考。

## 结果

| 页面 | Braiser observe | Playwright MCP `browser_snapshot` | Chrome DevTools MCP `take_snapshot` | Braiser 正文 Markdown |
|---|---|---|---|---|
| 英文维基 | 97304 字符 / 29911 token | 144465 字符 / 37791 token | 117391 字符 / 38275 token | 65569 字符 / 18201 token |
| 中文维基 | 52533 字符 / 20899 token | 85763 字符 / 27625 token | 67301 字符 / 26496 token | 39072 字符 / 16045 token |
| GitHub 仓库页 | 超时（超过 30 秒） | 86920 字符 / 22692 token | 135388 字符 / 37180 token | 超时 |

参照：按 Claude 的图片计算方法，一张 1280×800 截图约 1334 token（见 [Claude 的浏览器操作](Claude-browser-tools.md)）。

## 只保留标题和可交互元素时

同一天用 Playwright MCP 再取一次快照，只保留标题行和可交互元素行（link、button、textbox 等，不含 URL 行和结构层级），用同一分词器计数：

| 页面 | 完整快照 | 标题 + 可交互元素 | 标题数 | 可交互元素数 |
|---|---|---|---|---|
| 英文维基 | 37791 token | 8350 token | 18 | 488 |
| GitHub 仓库页 | 22696 token | 3966 token | 32 | 178 |

英文维基的可交互元素大多是正文段落里的行内链接。headless Chrome 打开 GitHub 注册页时得到 403 和人机验证页面，未计入。

## 其他观察

- GitHub 仓库页上，Braiser 的 `browser.observe` 连续几次都超过 30 秒超时。之后在同一页面和新开的标签页上，`page.extract_readable_text` 也超时；关闭标签页后扩展恢复正常。原因未查明。推断可能与 observe 对每个可点击元素逐个发 CDP 命令，以及先前未完成的 observe 仍在运行有关。
- Playwright MCP 的 `browser_navigate` 不返回快照内容，只返回快照文件路径。
- OpenCode 内置浏览器的 `snapshot` 默认深度很浅：英文维基首次快照 1514 字符并标记截断，`depth: 20` 时 27013 字符仍截断，需要用 `ref` 逐层展开。
