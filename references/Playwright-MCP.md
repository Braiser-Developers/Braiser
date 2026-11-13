# Playwright MCP 与 Playwright CLI

最近核对：2026-11-13。

## 页面表示

- 快照是 YAML 格式的无障碍树，例如 `- textbox "What needs to be done?" [ref=e5]`；iframe 内的元素用 `fNeN`。动作用 ref 或 Playwright 选择器定位。来源：<https://playwright.dev/mcp/snapshots>
- 底层 API 是 `page.ariaSnapshot({mode:'ai'})`。来源：<https://playwright.dev/docs/api/class-locator>
- `browser_snapshot` 可选 `target`、`depth`、`boxes`、`filename`（存文件而不返回）；`browser_find` 只返回匹配节点和上下文。
- 实测 v0.0.85（2026-11-13）：`browser_navigate` 只返回快照文件路径（写到 `.playwright-mcp/*.yml`），不内联快照；`browser_snapshot` 内联返回完整快照。官方文档仍写默认内联，与实测不一致，可能文档未更新。
- 启动参数 `--snapshot-mode full|none`、`--caps=vision`（坐标工具）、`--mobile`（文档说移动版页面通常更轻，省 token）。来源：<https://github.com/microsoft/playwright-mcp>

## 省 token 的尝试

- v0.0.43 加入增量快照（未变化的子树写成 `- ref=<id> [unchanged]`），之后在 Playwright PR #39777（2026-03-20）中移除。维护者（2026-06-17）说增量快照效率不高，存文件不额外消耗 token。来源：<https://github.com/microsoft/playwright/pull/39777>、<https://github.com/microsoft/playwright-mcp/issues/1654>
- Playwright CLI 的 README 说它比 MCP 更省 token：不加载大量工具定义和冗长的无障碍树。每条命令后只输出 URL、标题和快照文件链接，用 `snapshot --depth` 和 `find` 缩小读取范围。来源：<https://github.com/microsoft/playwright-cli>

## 他人报告的大页面消耗

- Swagger 文档页 71823 token：<https://github.com/microsoft/playwright-mcp/issues/395>
- bbc.com 导航 25837、快照 36196，工具定义 13678：<https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/>
- Claude Code 拒收超过 25000 token 的 MCP 结果（见上述 issue 中的报错）。

本项目实测见 [2026-11-13 浏览器快照 token 实测](browser-snapshot-tokens-2026-11-13.md)。
