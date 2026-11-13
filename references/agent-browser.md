# agent-browser（Vercel）

最近核对：2026-11-13。

- Rust 写的命令行工具。`snapshot` 返回带 `@e1` 这类 ref 的精简文本，`-i` 只保留可交互元素。来源：<https://github.com/vercel-labs/agent-browser>
- 待核实："比 Playwright MCP 少用最多 93% 上下文"的说法只见于 2026 年 1 月的博客转述，当前 README 里没有。
- 第三方测试（同一页面，Gemini 分词器）：Playwright MCP 7846 token，agent-browser `-i -c` 867 token。来源：<https://zenn.dev/bekku/articles/42e6a31f1eb571>
