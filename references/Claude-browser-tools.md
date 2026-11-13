# Claude 的浏览器操作（Claude in Chrome、browser use tool、computer use）

最近核对：2026-11-13。

来源说明：code.claude.com、support.claude.com 的页面直接读取；platform.claude.com（API 文档）在本机所在地区无法打开，相关条目来自搜索引擎索引的同一页面文本，标「索引文本」。

## Claude in Chrome 与 Claude Code

- Claude Code 通过 native messaging 连接 Claude in Chrome 扩展，用 `claude --chrome` 或 `/chrome` 开启；需要扩展 v1.0.36 以上和 claude.ai 登录。官方说法：默认开启 Chrome 会增加上下文占用，因为浏览器工具及其说明总是被加载。来源：<https://code.claude.com/docs/en/chrome>
- 同一页面提到的工具名：`read_page`、`get_page_text`、`find`、控制台和网络读取、截图（可存盘）、`tabs_context_mcp`、`browser_batch`、GIF 录制、文件上传（最大 10 MB）。完整工具列表官方文档没有列出。
- 扩展权限说明：`debugger` 权限让 Claude 能点击、输入和截图，`scripting` 权限让 Claude 能读取网页文字。即操作通过 chrome.debugger（CDP）完成。来源：<https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome>
- 推断：读树和读文字走 content script，截图和 JavaScript 走 chrome.debugger。依据是一个 issue 中截图和 `javascript_tool` 失败而 `read_page`、`find`、`navigate` 正常。来源：<https://github.com/anthropics/claude-code/issues/16239>
- 待核实（来自社区整理的系统提示和复刻实现，非官方）：工具包括 `navigate`、`computer`（截图、按坐标或 ref 点击、输入、滚动、按键、缩放等）、`read_page`（无障碍树文本，带 `ref`，可选只看可交互元素，深度默认 15，可只读某个子树，输出上限 5 万字符）、`find`（自然语言描述，最多返回 20 个元素）、`form_input`（按 ref 设值）、`get_page_text`、`javascript_tool` 等。来源：<https://github.com/Piebald-AI/claude-code-system-prompts>、<https://raw.githubusercontent.com/noemica-io/open-claude-in-chrome/main/host/tool-definitions.js>
- Claude in Chrome 于 2026-08-26 正式发布。来源：<https://claude.com/resources/articles/claude-in-chrome-generally-available>
- Claude Code 桌面版 2026 年 7 月加入内置浏览器，可以截图、检查 DOM、点击、填表。来源：<https://code.claude.com/docs/en/whats-new/2026-w28>

## browser use tool（API，`browser_toolset_20260801`）

来源：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool>（索引文本）；成员列表见 <https://github.com/anthropics/anthropic-sdk-python/blob/main/browser-toolset.md>。

- 31 个成员工具，默认启用 27 个；`javascript_exec`、`file_upload`、`read_console`、`read_network` 默认关闭。
- 页面通过无障碍树、元素、表单、标签页，以及截图和视口坐标两种方式交给 Claude。ref 的样子：`link "Documentation" [ref_1]`。点击目标可以是 ref，也可以是像素坐标。
- `read_page` 深度默认 15、输出上限 5 万字符；`find` 最多返回 20 个结果。
- 官方说法：典型页面读一次树，输入 token 往往比一张截图少；版面或视觉重要时再用截图。
- 工具定义本身每次请求约 6600 输入 token；打开 4 个可选工具再加约 880。
- 推断：这是 Claude in Chrome 工具集的 API 版本（工具名几乎一致），官方没有这样说。

## computer use 与图片 token

来源：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>、<https://platform.claude.com/docs/en/build-with-claude/vision>（索引文本）。

- 应用把截图作为图片返回，坐标以截图像素为准。官方建议网页应用用 1280×800 或 1366×768。
- 每张截图大约 1000–1800 输入 token。
- 图片 token：按 28×28 像素块计，$\lceil w/28\rceil \times \lceil h/28\rceil$。标准档最长边 1568 像素、最多 1568 token。旧版文档写作约 $w \cdot h / 750$，两者结果接近。
- 按上式计算（推断）：1280×800 约 1334 token，1366×768 约 1372 token。
