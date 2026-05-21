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

Chrome 扩展部分。它负责连接本地 MCP 进程，并把 MCP 请求转发到浏览器页面。

当前约定不是读取 active tab，而是读取 Chrome 中标题为 `Braised` 的 tab group 里的最后一个 tab。这里的“最后一个”按 Chrome 标签栏中的 `windowId` 和 `index` 排序后取最后一项。

```text
extension/
  manifest.json
  popup.html
  popup.css
  tsconfig.json
  src/
    background.ts
    content.ts
    popup.ts
    protocol.ts
  dist/
```

### `extension/manifest.json`

Chrome 扩展配置文件。它声明 Manifest V3 service worker、popup 入口和权限。

当前主要权限：

- `activeTab`：保留给扩展交互场景使用。
- `scripting`：向目标 tab 注入 `dist/content.js`。
- `storage`：保存扩展侧连接状态。
- `tabGroups`：查找标题为 `Braised` 的 tab group。
- `host_permissions: ["<all_urls>"]`：允许对普通网页注入 content script。
- `host_permissions: ["ws://127.0.0.1:17832/*"]`：允许连接本地 MCP bridge。

### `extension/src/background.ts`

扩展侧桥接进程，运行在 MV3 background service worker 中。

主要职责：

- 通过 WebSocket 连接 `braiser-mcp`。
- 接收 MCP 发来的扩展请求。
- 定位标题为 `Braised` 的 Chrome tab group。
- 在该 group 中选择最后一个 tab 作为目标页面。
- 必要时向目标页面注入 `dist/content.js`。
- 转发 `page.extract_readable_text`、`browser.observe` 和 `browser.act` 到 content script。
- 返回浏览器结果给 MCP 服务。
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

- 查询扩展与 MCP bridge 的连接状态。
- 显示目标页面的标题和 URL。
- 手动下载目标页面运行时 DOM。
- 手动下载 `browser.observe` 的 agent-html 输出，方便调试。

### `extension/src/protocol.ts`

扩展侧共享类型定义。

覆盖内容：

- WebSocket 请求与响应。
- popup 请求与状态。
- 可读页面数据。
- agent-html 快照。
- `browser.act` 输入和结果。

### `extension/dist/`

TypeScript 构建产物目录。Chrome 实际加载这里的 JavaScript 文件，不应手动编辑。

## `mcp/`

本地 MCP 程序。它通过 MCP stdio 与本地 Agent 通信，并通过 WebSocket 与 Chrome 扩展通信。

```text
mcp/
  package.json
  tsconfig.json
  src/
    server.ts
    websocket.ts
    tools.ts
    cleaner.ts
    storage.ts
    protocol.ts
  dist/
```

### `mcp/src/server.ts`

MCP 服务入口。

主要职责：

- 启动 MCP stdio server。
- 注册可用 tools。
- 把 tool 调用转发给 `tools.ts`。
- 启动扩展通信所需的 WebSocket bridge。

### `mcp/src/websocket.ts`

MCP 与 Chrome 扩展之间的 WebSocket bridge。

主要职责：

- 监听 `127.0.0.1:17832`。
- 记录扩展是否连接。
- 向扩展发送请求。
- 将扩展响应匹配回对应的 MCP tool 调用。
- 管理超时和 bridge 关闭时的 pending request。

### `mcp/src/tools.ts`

MCP tool 行为编排层。

当前 tools：

- `braiser.status`
- `browser.get_active_tab`
- `browser.observe`
- `browser.act`
- `page.extract_readable_text`
- `page.save_current_page`

注意：`browser.get_active_tab` 名称暂时保留是为了兼容旧调用方；实际读取的是 `Braised` tab group 的最后一个 tab。

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

MCP 侧共享类型定义。

覆盖内容：

- 扩展请求和响应。
- 可读页面数据。
- 清洗后的页面数据。
- agent-html 快照。
- `browser.act` 输入和结果。

### `mcp/dist/`

本地 MCP 服务的构建产物目录。由 TypeScript 编译生成，不应手动编辑。

## `docs/`

项目文档目录。

- `project_positioning.md`：项目定位与长期展望。
- `mvp_architecture.md`：当前 MVP 架构说明。
- `file_architecture.md`：当前文件结构和职责说明。
- `code_design_guidelines.md`：代码完成后的设计自查规则。
- `todo/`：待实现或讨论中的功能设计草稿。

## 根目录 `package.json`

整个项目的快捷脚本配置：

- `npm run build`：构建扩展和 MCP 服务。
- `npm run build:extension`：只构建 Chrome 扩展。
- `npm run build:mcp`：只构建 MCP 服务。
- `npm run check`：当前等同于完整构建。
- `npm run mcp`：运行已编译的 MCP 服务。

## 运行流程

1. 用户运行 `npm run build` 构建项目。
2. 用户将 `extension/` 作为未打包扩展加载到 Chrome。
3. Chrome 中准备一个标题为 `Braised` 的 tab group，并把目标页面放在该组最后。
4. 用户运行 `npm run mcp` 或由 Agent 启动 `mcp/dist/server.js`。
5. 扩展连接到 `ws://127.0.0.1:17832`。
6. 本地 Agent 调用 MCP tool。
7. `braiser-mcp` 将请求转发给扩展。
8. 扩展选择 `Braised` 组最后一个 tab，注入或复用 content script。
9. content script 读取页面、生成 agent-html 或执行 act。
10. MCP 服务清洗、保存或直接返回结果给 Agent。
