# 文件架构与职责说明

本文档记录当前 MVP 的文件结构、模块职责和主要运行路径。代码职责边界以 `docs/code_design_guidelines.md` 为准：调用层只编排行为，具体兜底、清洗、存储、浏览器访问分别放在对应模块里。

## 顶层结构

```text
Braiser/
  extension/
  mcp/
  docs/
  package.json
  package-lock.json
  LICENSE
  .gitignore
```

## `extension/`

Chrome 扩展部分。它负责通过 `debug.html` 连接本地 `braiser-daemon`，并把 daemon 发来的请求转发到浏览器页面。

当前约定不是读取 Chrome active tab，而是读取 Chrome 中标题为 `Braised` 的 tab group 里的最后一个 tab。这里的“最后一个”按 Chrome 标签栏中的 `windowId` 和 `index` 排序后取最后一页。

```text
extension/
  debug.html
  debug.css
  manifest.json
  popup.html
  popup.css
  tsconfig.json
  src/
    background.ts
    content.ts
    debug.ts
    popup.ts
    protocol.ts
  dist/
```

### `extension/manifest.json`

Chrome 扩展配置文件。它声明 Manifest V3 service worker、popup 入口和权限。

主要权限：

- `activeTab`：保留给扩展交互场景使用。
- `debugger`：仅用于 `debug.cdp_command` 调试工具，临时 attach 目标 tab 发送 CDP 命令。
- `scripting`：向目标 tab 注入 `dist/content.js`。
- `storage`：保存扩展侧连接状态。
- `tabGroups`：查找标题为 `Braised` 的 tab group。
- `host_permissions: ["<all_urls>"]`：允许对普通网页注入 content script。
- `host_permissions: ["ws://127.0.0.1:17832/*"]`：允许连接本地 `braiser-daemon` 的扩展端口。

### `extension/debug.html` 和 `extension/src/debug.ts`

可见的调试 bridge 页面。它负责持有和 `braiser-daemon` 的 WebSocket 长连接。

主要职责：

- 通过 WebSocket 连接 `ws://127.0.0.1:17832`。
- 接收 daemon 发来的扩展请求。
- 通过 runtime message 转发给 background 执行。
- 将 background 的执行结果返回给 daemon。
- 将连接状态写入 `chrome.storage.local`。
- 显示简单连接日志，方便调试。

只要这个页面保持打开，WebSocket 就不会因为 MV3 background service worker 空闲休眠而断开。

### `extension/src/background.ts`

扩展侧浏览器能力执行层，运行在 MV3 background service worker 中。

主要职责：

- 接收 debug bridge 页面转发的扩展请求。
- 定位标题为 `Braised` 的 Chrome tab group。
- 在该 group 中选择最后一个 tab 作为目标页面。
- 必要时向目标页面注入 `dist/content.js`。
- 在 observe 前用 CDP `isClickable` 信号给可点击节点打临时标记，作为 content script 交互元素收集规则的补充。
  - 通过 `DOMSnapshot.captureSnapshot` 读取 `nodes.isClickable` 和 `backendNodeId`。
  - 在同一个 CDP session 中先调用 `DOM.getDocument`，再用 `DOM.pushNodesByBackendIdsToFrontend` 将 `backendNodeId` 转为前端 `nodeId`。
  - 使用 `DOM.setAttributeValue` 写入临时属性 `data-braiser-cdp-clickable="true"`，不执行页面 JavaScript。
  - `browser.observe` 完成后清理临时属性。
- 转发 `page.extract_readable_text`、`browser.observe` 和 `browser.act` 到 content script。
- 执行 `debug.inject_js` 调试请求，将 JavaScript 注入目标页面 MAIN world，并返回 JSON 可序列化结果。
- 执行 `debug.cdp_command` 调试请求，临时 attach 目标 tab，发送 CDP 命令后 detach。
- 返回浏览器结果给 debug bridge 页面。
- 响应 popup 的状态查询和调试下载请求。

### `extension/src/content.ts`

注入到目标网页中的 content script。

主要职责：

- 读取页面 `title`、`url`、完整 DOM HTML 和可见文本。
- 生成压缩的 `agent-html` 页面快照。
- 为可操作元素分配 `data-eid`。
- 维护 `snapshotId + elementId -> DOM Element` 的页面内 registry。
- 根据 `browser.act` 请求执行点击、输入、选择、切换、聚焦和滚动。
- 将页面读取或操作结果返回给 background service worker。

### `extension/src/popup.ts`

扩展 popup UI 的控制逻辑。

主要职责：

- 查询扩展与 daemon 的连接状态。
- 显示目标页面的标题和 URL。
- 打开 `debug.html`，让浏览器插件保持与 daemon 的连接。
- 手动下载目标页面运行时 DOM。
- 手动下载 `browser.observe` 的 agent-html 输出，方便调试。

### `extension/src/protocol.ts`

扩展侧共享类型定义。

覆盖内容：

- 扩展 WebSocket 请求与响应。
- debug bridge 与 background 之间的 runtime message。
- popup 请求与状态。
- 可读页面数据。
- agent-html 快照。
- `browser.act` 输入和结果。
- `debug.inject_js` 输入和结果。
- `debug.cdp_command` 输入和结果。

### `extension/dist/`

TypeScript 构建产物目录。Chrome 实际加载这里的 JavaScript 文件，不应手动编辑。

## `mcp/`

本地 MCP 和 daemon 代码。`braiser-mcp` 通过 MCP stdio 与本地 Agent 通信；`braiser-daemon` 负责浏览器桥接，并被多个 MCP server 复用。

```text
mcp/
  package.json
  tsconfig.json
  src/
    daemon.ts
    server.ts
    websocket.ts
    tools.ts
    cleaner.ts
    storage.ts
    protocol.ts
  dist/
```

### `mcp/src/daemon.ts`

本地 daemon 入口。

主要职责：

- 监听扩展端口 `127.0.0.1:17832`。
- 监听 MCP client 端口 `127.0.0.1:17833`。
- 维护当前 Chrome 扩展 debug bridge socket。
- 接收多个 MCP client 的请求。
- 为转发给扩展的请求生成新的 request id。
- 将扩展响应路由回发起请求的 MCP client。
- 在扩展断开、client 断开或超时时清理 pending request。

### `mcp/src/server.ts`

MCP 服务入口。

主要职责：

- 启动 MCP stdio server。
- 启动时尝试连接 daemon。
- 如果 daemon 不存在，后台启动 `mcp/dist/daemon.js`。
- 注册可用 tools。
- 把 tool 调用转发给 `tools.ts`。

### `mcp/src/websocket.ts`

MCP server 到 daemon 的 WebSocket client。

主要职责：

- 连接 `ws://127.0.0.1:17833`。
- 查询 daemon 是否可用。
- 查询 Chrome 扩展是否已连接 daemon。
- 将 MCP tool 请求封装为 daemon 请求。
- 将 daemon 响应匹配回对应的 MCP tool 调用。
- 管理超时和连接关闭时的 pending request。

### `mcp/src/tools.ts`

MCP tool 行为编排层。

当前 tools：

- `braiser.status`
- `browser.get_active_tab`
- `browser.observe`
- `browser.act`
- `debug.inject_js`
- `debug.cdp_command`
- `page.extract_readable_text`
- `page.save_current_page`

注意：`browser.get_active_tab` 名称暂时保留是为了兼容旧调用方；实际读取的是 `Braised` tab group 的最后一个 tab。
`debug.inject_js` 和 `debug.cdp_command` 只用于调试目的，不应作为常规页面自动化或稳定业务接口使用。

### `mcp/src/cleaner.ts`

页面文本清洗和 Markdown 格式化模块。

主要职责：

- 规范化空白字符。
- 清理扩展抽取到的可见文本。
- 将 `CleanPage` 格式化为 Markdown。

### `mcp/src/storage.ts`

本地页面保存模块。

主要职责：

- 将页面 Markdown 写入 `~/.braiser/pages/`。
- 根据 URL host 或页面标题生成文件名。
- 将最终文件名兜底留给 `slugify()`，避免调用层重复兜底逻辑。

### `mcp/src/protocol.ts`

MCP/daemon 侧共享类型定义。

覆盖内容：

- 扩展端口和 daemon client 端口常量。
- daemon 请求和响应。
- 扩展请求和响应。
- 可读页面数据。
- 清洗后的页面数据。
- agent-html 快照。
- `browser.act` 输入和结果。
- `debug.inject_js` 输入和结果。
- `debug.cdp_command` 输入和结果。

### `mcp/dist/`

本地 MCP 和 daemon 的构建产物目录，由 TypeScript 编译生成，不应手动编辑。

## `docs/`

项目文档目录。

- `project_positioning.md`：项目定位与长期展望。
- `mvp_architecture.md`：当前 MVP 架构说明。
- `file_architecture.md`：当前文件结构和职责说明。
- `code_design_guidelines.md`：代码完成后的设计自查规则。
- `todo/`：待实现或讨论中的功能设计草稿。

## 根目录 `package.json`

整个项目的快捷脚本配置：

- `npm run build`：构建扩展、MCP server 和 daemon。
- `npm run build:extension`：只构建 Chrome 扩展。
- `npm run build:mcp`：只构建 MCP server 和 daemon。
- `npm run check`：当前等同于完整构建。
- `npm run mcp`：运行已编译的 MCP 服务。
- `npm run daemon`：运行已编译的 daemon。

## 运行流程

1. 用户运行 `npm run build` 构建项目。
2. 用户将 `extension/` 作为未打包扩展加载到 Chrome。
3. Chrome 中准备一个标题为 `Braised` 的 tab group，并把目标页面放在该组最后。
4. 用户运行 `npm run mcp`，或由 Agent 启动 `mcp/dist/server.js`。
5. `braiser-mcp` 连接 `ws://127.0.0.1:17833`。
6. 如果 daemon 不存在，`braiser-mcp` 自动后台启动 `mcp/dist/daemon.js`。
7. `braiser-daemon` 监听 `17832` 和 `17833`。
8. 用户从 popup 打开 `debug.html`。
9. debug 页面连接到 `ws://127.0.0.1:17832`。
10. 本地 Agent 调用 MCP tool。
11. `braiser-mcp` 将请求转发给 daemon。
12. daemon 将请求转发给 debug 页面。
13. debug 页面把请求转发给 background。
14. background 选择 `Braised` 组最后一个 tab，注入或复用 content script。
15. content script 读取页面、生成 agent-html 或执行 act。
16. 结果沿原链路返回给 MCP server。
17. MCP server 清洗、保存或直接返回结果给 Agent。
