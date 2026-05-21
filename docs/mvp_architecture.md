# Braiser MVP 架构

## 1. MVP 目标

先验证一个核心价值：

> 本地 Agent 能通过 MCP 读取浏览器中受控目标页面的 DOM、可读文本和可交互元素，并能执行小范围页面操作。

当前目标页面不是 Chrome active tab，而是标题为 `Braised` 的 Chrome tab group 里的最后一个 tab。这样可以让用户显式划定 Agent 可访问的浏览器区域，避免 Agent 随 active tab 漂移。

第一版仍不追求完整产品化，不做远程连接、不做账号体系、不做常驻 Core Daemon。

## 2. 最小组件

MVP 保留两个组件：

```text
1. Chrome Extension
2. braiser-mcp 本地程序
```

`braiser-mcp` 是一个单进程程序，内部负责：

```text
- MCP Server
- WebSocket Server
- Tool 编排
- 文本清洗
- 本地保存
```

Chrome Extension 负责：

```text
- 连接本地 WebSocket bridge
- 定位 Braised tab group 最后一个 tab
- 注入 content script
- 读取 DOM / 可见文本
- 生成 agent-html
- 执行受控页面动作
```

## 3. 架构图

```text
Codex / 本地 Agent
        -> MCP stdio
braiser-mcp 单进程
        |- MCP Server
        |- WebSocket Server
        |- Tool 编排
        |- 文本清洗
        `- 本地保存
        -> ws://127.0.0.1:17832
Chrome Extension
        |- background service worker
        |- content script
        `- popup debug UI
        -> Chrome tab group: Braised
        -> group 中最后一个 tab
```

## 4. 请求流程

以 `page.extract_readable_text` 为例：

```text
1. 本地 Agent 调用 MCP tool: page.extract_readable_text
2. braiser-mcp 收到 MCP 请求
3. braiser-mcp 通过 WebSocket 请求 Chrome Extension
4. Extension 查找标题为 Braised 的 tab group
5. Extension 选择该 group 中 index 最后的 tab
6. Extension 注入或复用 content script
7. content script 读取 title / url / DOM HTML / 可见文本
8. Extension 将结果返回给 braiser-mcp
9. braiser-mcp 清洗文本
10. braiser-mcp 将结果返回给 Agent
```

`browser.observe` 走同一条链路，但返回压缩后的 agent-html 和 `data-eid`。`browser.act` 会使用最新 observe 快照中的 `snapshotId` 和 `elementId` 在页面内执行动作。

## 5. 当前 MCP Tools

当前 tools：

```text
braiser.status
browser.get_active_tab
browser.observe
browser.act
page.extract_readable_text
page.save_current_page
```

### `braiser.status`

检查 MCP 进程和浏览器扩展是否连接正常。

返回示例：

```json
{
  "mcp": "ok",
  "extensionConnected": true
}
```

### `browser.get_active_tab`

获取 `Braised` tab group 中最后一个 tab 的标题和 URL。

名称中的 `active_tab` 是早期兼容名，当前语义已经不再是 Chrome active tab。

返回示例：

```json
{
  "title": "...",
  "url": "..."
}
```

### `page.extract_readable_text`

抽取目标页面的可读文本。

返回示例：

```json
{
  "title": "...",
  "url": "...",
  "text": "..."
}
```

### `page.save_current_page`

抽取目标页面内容，并保存为本地 Markdown。

保存目录：

```text
~/.braiser/pages/
```

### `browser.observe`

观察目标页面，返回压缩后的 agent-html。

agent-html 会保留可交互元素及其必要上下文，并为可操作元素分配 `data-eid`。

返回示例：

```json
{
  "snapshotId": "S1",
  "format": "agent-html",
  "html": "<page ...>...</page>",
  "meta": {
    "elementCount": 12,
    "truncated": false
  }
}
```

### `browser.act`

基于最新 `browser.observe` 快照执行页面动作。

输入字段：

```json
{
  "snapshotId": "S1",
  "elementId": "E2",
  "action": "click"
}
```

支持动作：

```text
click
input-text
select-option
toggle
focus
scroll-into-view
```

## 6. Chrome Extension 权限

当前权限：

```json
{
  "permissions": ["activeTab", "scripting", "storage", "tabGroups"],
  "host_permissions": [
    "ws://127.0.0.1:17832/*",
    "<all_urls>"
  ]
}
```

含义：

```text
activeTab: 保留给扩展交互场景
scripting: 注入 content script
storage: 保存扩展侧连接状态
tabGroups: 查找 Braised 标签组
<all_urls>: 允许访问任意普通网页 DOM
ws://127.0.0.1:17832/*: 连接本地 MCP bridge
```

Chrome 仍然禁止访问 `chrome://`、Chrome Web Store 等特殊页面。

## 7. 第一版明确不做的东西

MVP 暂时不做：

```text
- 独立 Braiser Core Daemon
- Native Messaging
- SSH 远端 Agent
- Braiser Relay
- 桌面 App
- 账号体系
- 云同步
- 多用户支持
- 多浏览器支持
- 自动读取所有 tabs
- 任意 JavaScript 执行
- 完整本地知识库
- 向量索引
```

`browser.act` 是有限动作集合，不等同于任意脚本执行。

## 8. 生命周期设计

第一版不做常驻 daemon，生命周期保持简单：

```text
1. Agent 启动 braiser-mcp
2. braiser-mcp 开启 WebSocket Server
3. Chrome Extension 尝试连接 ws://127.0.0.1:17832
4. Agent 调用 MCP tools
5. braiser-mcp 转发请求给 Extension
6. Extension 操作 Braised 组最后一个 tab
7. Agent 结束后，braiser-mcp 可以退出
8. Extension 断线后等待下次重连
```

## 9. 最小成功标准

MVP 成功标准：

```text
1. Codex 或本地 Agent 能识别 braiser MCP
2. Agent 能调用 braiser.status
3. Agent 能读取 Braised 组最后一个 tab 的标题和 URL
4. Agent 能调用 page.extract_readable_text 获取页面正文
5. Agent 能调用 page.save_current_page 保存页面
6. Agent 能调用 browser.observe 获取 agent-html
7. Agent 能调用 browser.act 对 observe 中的元素执行受控动作
```

## 10. 后续再考虑的演进

只有当 MVP 验证成功后，再考虑：

```text
阶段 2: 拆出 braiser daemon
阶段 3: 加入 SQLite / 搜索 / 页面记忆
阶段 4: 支持 SSH 远端 Agent
阶段 5: 支持 Braiser Relay
阶段 6: 做桌面 App 和产品化权限系统
```

## 11. 一句话版本

```text
Braiser MVP = 一个 Chrome 扩展 + 一个本地 MCP 进程。
目标：让本地 Agent 通过 MCP 读取和操作 Braised 标签组中最后一个页面。
```
