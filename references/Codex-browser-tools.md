# Codex 与 OpenAI 的浏览器操作

最近核对：2026-11-13。以下 OpenAI 文档均为直接读取。

## Codex 应用

- Codex 应用内置浏览器，通过 Browser 插件（`@Browser`）使用：可以点击、输入、检查渲染状态、截图、下载页面资源、运行只读的页面检查 JavaScript。来源：<https://developers.openai.com/codex/app/browser.md>
- 更新日志（约 2026-06-11）：通过 CDP 和 DOM snapshot 优化，Browser use 最多快 2 倍；同一版本的开发者模式提供完整 CDP 访问。来源：<https://developers.openai.com/codex/changelog>
- Chrome 扩展（`@Chrome`，2026-08-25 起也支持 Edge、Brave、Opera、Vivaldi）安装时请求"访问页面调试器"，即使用 chrome.debugger。OpenAI 会保存从页面读取的文字、截图和工具调用。来源：<https://developers.openai.com/codex/chrome-extension.md>
- 待核实：Codex 交给模型的页面格式（无障碍树还是 DOM 文本）。官方文档只提到页面文字、截图和"DOM snapshot"。

## Codex CLI

- 推断：没有文档化的内置浏览器工具。
- OpenAI 官方 skill `playwright` 封装 `@playwright/cli`：先取快照得到 `e15` 这类 ref，再 `click e15`。来源：<https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md>
- `playwright-interactive` skill 在持久的 Playwright 会话里截图交给模型。来源：<https://github.com/openai/skills/blob/main/skills/.curated/playwright-interactive/SKILL.md>

## OpenAI API

- `computer` 工具是截图加坐标动作。来源：<https://developers.openai.com/api/docs/guides/tools-computer-use>
- 另有 `BrowserToolset`，由调用方驱动报告页面结构：默认 18 个方法，包括 `read_page`（全部或仅可交互元素）、`find`、`get_page_text`、`click(target)`、`screenshot`、`zoom`。`read_page` 返回 `{text, elements:[{ref, label, role}], omitted}`，role 只有 7 种（button、textbox、combobox、checkbox、radio、slider、listbox）；可选 `read_page_scoped` 按 1–32 的深度读一部分。来源：<https://developers.openai.com/api/docs/guides/tools-computer-use-sdk-drivers>
- 截图建议：computer use 用 `detail:"original"`；缩小时 1440×900、1600×900 表现较好。来源：<https://developers.openai.com/api/docs/guides/tools-computer-use-integration>
- 已下线的 ChatGPT agent 通过虚拟浏览器窗口的截图"看"页面。来源：<https://help.openai.com/en/articles/11752874>
- 图片 token（按块计费的模型）：32×32 像素块数 × 模型系数（gpt-5.2 起为 1.2）；文档示例 1024×1024 `high` 约 1229 token。来源：<https://developers.openai.com/api/docs/guides/images-vision.md>
