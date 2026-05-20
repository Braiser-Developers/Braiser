# 文件架构与功能说明

本文档说明当前 MVP 的文件结构，以及各部分负责的功能。

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

Chrome 扩展部分。它负责连接本地 MCP 程序，并在收到请求时读取当前浏览器页面。

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
```

### `extension/manifest.json`

Chrome 扩展的配置文件。它声明扩展名称、Manifest V3 background service worker、popup 入口，以及最小权限：

- `activeTab`
- `scripting`
- `storage`
- 访问 `ws://127.0.0.1:17832`

### `extension/src/background.ts`

扩展侧的桥接进程。

主要职责：

- 通过 WebSocket 连接 `braiser-mcp`
- 接收 MCP 服务发来的请求
- 读取当前 active tab
- 在需要抽取页面文本时注入 content script
- 将结果返回给 MCP 服务
- 响应 popup 发来的状态查询

### `extension/src/content.ts`

被注入到当前网页中运行的脚本。

主要职责：

- 读取页面标题和 URL
- 获取页面 HTML
- 抽取页面可见文本
- 将可读页面数据返回给 background service worker

### `extension/src/popup.ts`

控制扩展弹窗界面。

主要职责：

- 向 background service worker 查询连接状态
- 显示当前 active tab 的标题和 URL
- 显示扩展是否已经连接到本地 MCP bridge

### `extension/src/protocol.ts`

扩展侧共享的 TypeScript 类型定义，用于 WebSocket 消息和 popup 消息。

### `extension/dist/`

构建产物目录。TypeScript 编译后会生成 JavaScript 文件，Chrome 实际加载这些文件。这个目录不应该手动编辑。

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
```

### `mcp/src/server.ts`

MCP 服务入口。

主要职责：

- 启动 MCP stdio server
- 注册可用 tools
- 将 tool 调用转发给 tools 层
- 启动扩展通信所需的 WebSocket bridge

### `mcp/src/websocket.ts`

本地 WebSocket 服务，用于和 Chrome 扩展通信。

主要职责：

- 监听 `127.0.0.1:17832`
- 记录 Chrome 扩展是否已连接
- 向扩展发送请求
- 将扩展响应匹配回对应的 MCP tool 调用

### `mcp/src/tools.ts`

实现 MVP 阶段的 tool 行为。

当前 tools：

- `braiser.status`
- `browser.get_active_tab`
- `page.extract_readable_text`
- `page.save_current_page`

### `mcp/src/cleaner.ts`

负责简单的页面文本清洗。

主要职责：

- 规范化空白字符
- 将扩展抽取到的页面数据整理成更干净的文本结构
- 将保存内容格式化为 Markdown

### `mcp/src/storage.ts`

负责本地文件保存。

保存的页面会写入：

```text
~/.braiser/pages/
```

### `mcp/src/protocol.ts`

MCP 侧共享的 TypeScript 类型定义，用于扩展请求、扩展响应、active tab 信息和可读页面数据。

### `mcp/dist/`

本地 MCP 服务的构建产物目录。它由 TypeScript 编译生成，不应该手动编辑。

## `docs/`

项目文档目录。

- `project_positioning.md`：项目定位与长期展望
- `mvp_architecture.md`：MVP 架构设计
- `file_architecture.md`：当前文件结构和功能说明

## 根目录 `package.json`

整个项目的快捷脚本配置：

- `npm run build`：构建扩展和 MCP 服务
- `npm run build:extension`：只构建 Chrome 扩展
- `npm run build:mcp`：只构建 MCP 服务
- `npm run check`：目前等同于完整构建
- `npm run mcp`：运行已编译的 MCP 服务

## 运行流程

1. 用户运行 `npm run build` 构建项目。
2. 用户将 `extension/` 作为未打包扩展加载到 Chrome。
3. 用户运行 `npm run mcp` 启动本地 MCP 服务。
4. 扩展连接到 `ws://127.0.0.1:17832`。
5. 本地 Agent 调用某个 MCP tool。
6. `braiser-mcp` 将请求转发给扩展。
7. 扩展读取 active tab，或注入 `content.ts` 抽取页面内容。
8. MCP 服务清洗或保存结果，并返回给 Agent。
