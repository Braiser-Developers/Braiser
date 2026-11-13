# Playwright MCP 与 Playwright CLI

最近核对：2026-11-13。

## 页面表示

- 快照是 YAML 格式的无障碍树，例如 `- textbox "What needs to be done?" [ref=e5]`；iframe 内的元素用 `fNeN`。动作用 ref 或 Playwright 选择器定位。来源：<https://playwright.dev/mcp/snapshots>
- 底层 API 是 `page.ariaSnapshot({mode:'ai'})`。来源：<https://playwright.dev/docs/api/class-locator>
- `browser_snapshot` 可选 `target`、`depth`、`boxes`、`filename`（存文件而不返回）；`browser_find` 只返回匹配节点和上下文。
- 实测 v0.0.85（2026-11-13）：`browser_navigate` 只返回快照文件路径（写到 `.playwright-mcp/*.yml`），不内联快照；`browser_snapshot` 内联返回完整快照。官方文档仍写默认内联，与实测不一致，可能文档未更新。
- 启动参数 `--snapshot-mode full|none`、`--caps=vision`（坐标工具）、`--mobile`（文档说移动版页面通常更轻，省 token）。来源：<https://github.com/microsoft/playwright-mcp>

## AI 模式快照的生成逻辑

来源：Playwright 源码（main 分支，2026-11-13 读取）<https://github.com/microsoft/playwright/blob/main/packages/injected/src/ariaSnapshot.ts>、<https://github.com/microsoft/playwright/blob/main/packages/injected/src/ariaSnapshotDistiller.ts>、<https://github.com/microsoft/playwright/blob/main/packages/isomorphic/ariaSnapshot.ts>。许可证 Apache-2.0。

- 快照由注入页面的脚本在页面里计算（`generateAriaTree`），读取时不依赖 CDP 的无障碍接口。角色和可访问名称由 `roleUtils.ts`（约 1400 行）按 ARIA 规范计算。
- 遍历时进入 shadow DOM 和 slot，处理 `aria-owns`，读取 `::before`、`::after` 的 CSS 内容。iframe 先输出为一个节点，内容按 frame 分别生成，ref 带 frame 前缀。
- AI 模式下，对无障碍树可见或视觉上可见的节点都保留；没有明确角色的 div/span 记为 `generic`，只含一段文字的行内 generic 不单独成节点；`presentation`、`none` 去掉。
- 每个节点记录：角色、可访问名称，以及 checked、disabled、expanded、invalid、level、pressed、selected、active（是否获得焦点）等状态。input/textarea（复选框、单选框、文件除外）把当前值作为子文本；链接记 URL；textbox 的 placeholder 与名称不同时另记。
- 文字整段保留，只压缩空白，不截断。
- ref 分配给所有可见且能接收指针事件的元素，不限于按钮、链接；带指针光标的再标 `[cursor=pointer]`。
- 生成后由"蒸馏"步骤压缩，源码注释称不丢信息：合并相邻文字、去掉没有名称的装饰图片、名称与已输出内容重复时去掉名称、把只包一个子节点的 generic 拆掉、把单个文字子节点内联进父节点、去掉重复父节点名称的子节点。
- 另有 `findNewNode(from, to)`：按"角色 + 名称"比较前后两份快照，返回新出现的节点中最靠上、最大的那个。

## 动作后的返回

- 实测 v0.0.85（2026-11-13）：`browser_click` 的返回是执行的 Playwright 代码、页面 URL 和标题，以及快照文件路径，没有内联快照。

## 省 token 的尝试

- v0.0.43 加入增量快照（未变化的子树写成 `- ref=<id> [unchanged]`），之后在 Playwright PR #39777（2026-03-20）中移除。维护者（2026-06-17）说增量快照效率不高，存文件不额外消耗 token。来源：<https://github.com/microsoft/playwright/pull/39777>、<https://github.com/microsoft/playwright-mcp/issues/1654>
- Playwright CLI 的 README 说它比 MCP 更省 token：不加载大量工具定义和冗长的无障碍树。每条命令后只输出 URL、标题和快照文件链接，用 `snapshot --depth` 和 `find` 缩小读取范围。来源：<https://github.com/microsoft/playwright-cli>

## 他人报告的大页面消耗

- Swagger 文档页 71823 token：<https://github.com/microsoft/playwright-mcp/issues/395>
- bbc.com 导航 25837、快照 36196，工具定义 13678：<https://blog.fsck.com/2025/10/19/mcps-are-not-like-other-apis/>
- Claude Code 拒收超过 25000 token 的 MCP 结果（见上述 issue 中的报错）。

本项目实测见 [2026-11-13 浏览器快照 token 实测](browser-snapshot-tokens-2026-11-13.md)。
