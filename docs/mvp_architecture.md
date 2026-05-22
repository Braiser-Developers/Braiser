# Braiser MVP 架构

## 1. MVP 目标

先验证一个核心价值：

> 本地 Agent 能通过 MCP 读取浏览器中受控目标页面的 DOM、可读文本和可交互元素，并能执行小范围页面操作。

当前目标页面不是 Chrome active tab，而是标题为 `Braised` 的 Chrome tab group 里的最后一个 tab。这样用户可以显式划定 Agent 可访问的浏览器区域，避免 Agent 跟随 active tab 漂移。

MVP 仍不追求完整产品化，不做远程连接、账号体系、云同步或复杂权限系统。但当前架构已经引入本地 `braiser-daemon`，用于解决多个 MCP 会话同时启动时的端口冲突。

## 2. 最小组件

当前 MVP 包含三个运行组件：

```text
1. Chrome Extension
2. braiser-daemon
3. braiser-mcp
```

`braiser-mcp` 负责：

```text
- MCP stdio server
- MCP tools 注册和调度
- 连接 braiser-daemon
- 文本清洗
- 本地页面保存
```

`braiser-daemon` 负责：

```text
- 监听 Chrome 扩展 debug bridge: ws://127.0.0.1:17832
- 监听 MCP clients: ws://127.0.0.1:17833
- 维护当前扩展连接状态
- 将多个 MCP client 的请求转发给当前 Chrome 扩展
- 将扩展响应路由回对应 MCP client
```

Chrome Extension 负责：

```text
- 通过 debug.html 连接本地 daemon
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
braiser-mcp
        |- MCP Server
        |- Tool 编排
        |- 文本清洗
        `- 本地保存
        -> ws://127.0.0.1:17833
braiser-daemon
        |- extension bridge: ws://127.0.0.1:17832
        `- MCP client bridge: ws://127.0.0.1:17833
        -> ws://127.0.0.1:17832
Chrome Extension debug bridge
        -> background service worker
        -> content script
        -> Chrome tab group: Braised
        -> group 中最后一个 tab
```

这个拆分的关键收益是：多个 Codex 会话可以各自启动 `braiser-mcp`，但不会再争抢 `17832`。它们都会作为 daemon client 连接同一个 `braiser-daemon`。

## 4. 请求流程

以 `page.extract_readable_text` 为例：

```text
1. 本地 Agent 调用 MCP tool: page.extract_readable_text
2. braiser-mcp 收到 MCP 请求
3. braiser-mcp 通过 ws://127.0.0.1:17833 请求 braiser-daemon
4. braiser-daemon 将请求转发给已连接的 Chrome 扩展 debug bridge
5. debug bridge 通过 runtime message 转发给 background service worker
6. background 查找标题为 Braised 的 tab group
7. background 选择该 group 中 index 最后的 tab
8. background 注入或复用 content script
9. content script 读取 title / url / DOM HTML / 可见文本
10. 结果沿原链路返回到 braiser-mcp
11. braiser-mcp 清洗文本
12. braiser-mcp 将结果返回给 Agent
```

`browser.observe` 走同一条链路，但返回压缩后的 agent-html 和 `data-eid`。`browser.act` 使用最近一次 observe 快照中的 `snapshotId` 和 `elementId` 在页面内执行受控动作。

## 5. 当前 MCP Tools

当前 tools：

```text
braiser.status
browser.get_active_tab
browser.observe
browser.act
debug.inject_js
debug.cdp_command
page.extract_readable_text
page.save_current_page
```

### `braiser.status`

检查 MCP、daemon 和浏览器扩展是否连接正常。

返回示例：

```json
{
  "mcp": "ok",
  "daemonConnected": true,
  "extensionConnected": true
}
```

### `browser.get_active_tab`

获取 `Braised` tab group 中最后一个 tab 的标题和 URL。

名称中的 `active_tab` 是早期兼容名；当前语义已经不再是 Chrome active tab。

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

基于最近一次 `browser.observe` 快照执行页面动作。

输入示例：

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

### `debug.inject_js`

仅用于调试目的，直接向 `Braised` tab group 中的目标页面 MAIN world 注入 JavaScript。

输入示例：

```json
{
  "script": "return { title: document.title, href: location.href };"
}
```

`script` 是 async function body，可以使用 `await`。返回值会被转换为 JSON 可序列化结果；不可序列化对象不会作为稳定 API 保留。

这个工具用于诊断 DOM、样式、框架事件和 observe 缺口，不应作为普通页面自动化能力或产品功能边界。

### `debug.cdp_command`

仅用于调试目的，向 `Braised` tab group 中的目标 tab 发送 Chrome DevTools Protocol 命令。

输入示例：

```json
{
  "method": "DOMSnapshot.captureSnapshot",
  "params": {
    "computedStyles": []
  }
}
```

扩展会临时 attach 目标 tab，发送命令后 detach。这个工具用于验证浏览器调试协议能否提供比 DOM/JS 启发式更好的诊断信号，不应作为主交互流程。

## 6. Chrome Extension 权限

当前权限：

```json
{
  "permissions": ["activeTab", "debugger", "scripting", "storage", "tabGroups"],
  "host_permissions": [
    "ws://127.0.0.1:17832/*",
    "<all_urls>"
  ]
}
```

含义：

```text
activeTab: 保留给扩展交互场景
debugger: 仅用于 debug.cdp_command 临时发送 CDP 命令
scripting: 注入 content script
storage: 保存扩展侧连接状态
tabGroups: 查找 Braised 标签组
<all_urls>: 允许访问普通网页 DOM
ws://127.0.0.1:17832/*: 连接本地 braiser-daemon
```

Chrome 仍然禁止访问 `chrome://`、Chrome Web Store 等特殊页面。

## 7. 暂时不做的事

MVP 暂时不做：

```text
- Native Messaging
- SSH 远程 Agent
- Braiser Relay
- 桌面 App
- 账号体系
- 云同步
- 多用户支持
- 多浏览器支持
- 自动读取所有 tabs
- 面向普通自动化流程的任意 JavaScript 执行
- 完整本地知识库
- 向量索引
```

`browser.act` 是有限动作集合，不等同于任意脚本执行。`debug.inject_js` 和 `debug.cdp_command` 是显式标注的调试工具，只用于排查和验证页面行为。

## 8. 生命周期设计

```text
1. Agent 启动 braiser-mcp
2. braiser-mcp 尝试连接 ws://127.0.0.1:17833
3. 如果 daemon 不存在，braiser-mcp 后台启动 mcp/dist/daemon.js
4. braiser-daemon 监听 17832 和 17833
5. 用户从扩展 popup 打开 debug.html
6. debug bridge 连接 ws://127.0.0.1:17832
7. Agent 调用 MCP tools
8. braiser-mcp 通过 daemon 转发请求给 Extension
9. Extension 操作 Braised 组最后一个 tab
10. Agent 会话结束后，braiser-mcp 可以退出
11. braiser-daemon 可继续常驻，供后续 MCP 会话复用
```

## 9. 最小成功标准

MVP 成功标准：

```text
1. Codex 或本地 Agent 能识别 braiser MCP
2. Agent 能调用 braiser.status
3. braiser.status 能区分 daemonConnected 和 extensionConnected
4. Agent 能读取 Braised 组最后一个 tab 的标题和 URL
5. Agent 能调用 page.extract_readable_text 获取页面正文
6. Agent 能调用 page.save_current_page 保存页面
7. Agent 能调用 browser.observe 获取 agent-html
8. Agent 能调用 browser.act 对 observe 中的元素执行受控动作
9. Agent 能在调试场景调用 debug.inject_js 检查页面运行时状态
10. Agent 能在调试场景调用 debug.cdp_command 检查 CDP 诊断信号
11. 多个 MCP 会话不会争抢扩展端口 17832
```

## 10. 后续演进

```text
阶段 2: daemon 生命周期管理和托盘/桌面入口
阶段 3: 注入 CSS/受限脚本/资源替换能力
阶段 4: SQLite / 搜索 / 页面记忆
阶段 5: SSH 远程 Agent
阶段 6: Braiser Relay
阶段 7: 产品化权限系统
```

## 11. 一句话版本

```text
Braiser MVP = Chrome 扩展 + 本地 daemon + MCP server。
目标：让本地 Agent 通过 MCP 读取和操作 Braised 标签组中的受控页面，同时让多个 MCP 会话共享同一个浏览器桥接进程。
```
