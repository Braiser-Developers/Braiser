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

## 改版后的 observe（分支 observe-aria）

同一天在 Playwright 下载的 Chromium（158）里加载改版后的扩展，打开同样三个页面，等待 6 秒后调用 `browser.observe`，用同一分词器计数：

| 页面 | 字符 | token | 可操作元素 | 耗时 |
|---|---|---|---|---|
| 英文维基 | 84931 | 24647 | 501 | 约 0.1 秒 |
| 中文维基 | 51244 | 18460 | 322 | 约 0.1 秒 |
| GitHub 仓库页 | 54280 | 13053 | 249 | 约 0.1 秒 |

- 去掉所有链接网址后分别为 18734、13341、9235 token，即网址约占 25%–30%。

### 各部分占多少（同一批输出，o200k）

| 页面 | 合计 | 缩进 | 网址 | 无名容器行（generic、list、listitem 等） | 正文文字 | 标题 + 可操作元素的名称和编号 |
|---|---|---|---|---|---|---|
| 英文维基 | 24647 | 796 | 5913 | 1411 | 约 11000 | 5499 |
| 中文维基 | 18284 | 558 | 4974 | 956 | 约 8300 | 3538 |
| GitHub 仓库页 | 13053 | 825 | 3818 | 1119 | 约 4000 | 3290 |

"正文文字"是从去掉缩进、网址和容器行后的总数里减去最后一列得到的，包含段落、表格单元格、列表文字和行内链接周围的文字。

### 网址显示方式的影响

把 `%xx` 转义显示成原字符（保留字符保持转义），并把指向本页的锚点只写成 `#锚点` 后：英文维基 24647 → 24005，中文维基 18284 → 16945，GitHub 13053 → 12926 token。中文页面的网址里有大量中文转义，收益最大；英文页面的转义多是 `%3A%2F` 这类保留字符，不能无损还原。
- 上方表格里旧版 Braiser 的数字取自作者的 Chrome，这里取自未登录的测试 Chromium；GitHub 等页面登录与否内容不同，对比只能作参考。
- 同一 Chromium 里，旧版 observe 打开 GitHub 仓库页用了约 0.3 秒、输出 120368 字符，没有超时。作者 Chrome 里的超时原因未查明。
- GitHub 页面在 6 秒内可能还没加载完文件列表，同一页面不同次测得的元素数会不同（一次 146 个，一次 249 个）。

## 其他观察

- GitHub 仓库页上，Braiser 的 `browser.observe` 连续几次都超过 30 秒超时。之后在同一页面和新开的标签页上，`page.extract_readable_text` 也超时；关闭标签页后扩展恢复正常。原因未查明。推断可能与 observe 对每个可点击元素逐个发 CDP 命令，以及先前未完成的 observe 仍在运行有关。
- Playwright MCP 的 `browser_navigate` 不返回快照内容，只返回快照文件路径。
- OpenCode 内置浏览器的 `snapshot` 默认深度很浅：英文维基首次快照 1514 字符并标记截断，`depth: 20` 时 27013 字符仍截断，需要用 `ref` 逐层展开。
