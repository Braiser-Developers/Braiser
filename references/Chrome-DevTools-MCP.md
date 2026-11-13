# Chrome DevTools MCP

最近核对：2026-11-13。

- `take_snapshot` 返回基于无障碍树的文本快照，每个元素带 `uid`；文档建议优先用快照而不是截图。选项 `filePath`（存文件）和 `verbose`（默认 false）。动作用 `uid` 定位。来源：<https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md>
- 实测 v1.13.0（2026-11-13）：`navigate_page` 和 `take_snapshot` 都必须传 `pageId`；快照行的样子是 `uid=1_12 searchbox "Search Wikipedia" description="..."`，链接带完整 URL。共 33 个工具。`click` 有 `includeSnapshot` 参数，默认 false，即点击后默认不返回快照，由调用方决定要不要。

本项目实测见 [2026-11-13 浏览器快照 token 实测](browser-snapshot-tokens-2026-11-13.md)。
