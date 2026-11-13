# Stagehand（Browserbase）

最近核对：2026-11-13。

- `act`、`observe`、`extract` 接受自然语言指令；`observe()` 返回真实的选择器。README 称使用"混合的无障碍树裁剪"，并缓存相同调用，重复调用不再消耗 token。来源：<https://github.com/browserbase/stagehand>
- 其博客称 Playwright MCP 从 v0.0.82 起默认把快照写到文件、只返回链接。来源：<https://www.stagehand.dev/blog/playwright-mcp-token-usage>。2026-11-13 实测 v0.0.85 的 `browser_navigate` 确实只返回文件路径，见 [Playwright MCP](Playwright-MCP.md)。
