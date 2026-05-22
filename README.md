# Braiser

Braiser 是一个面向本地 AI 浏览器 Agent 的安全、结构化和记忆层。当前 MVP 保持很小，但已经拆出了本地 daemon，避免多个 Codex/MCP 会话争抢同一个浏览器 WebSocket 端口。

```text
本地 Agent / Codex
        -> MCP stdio
braiser-mcp
        -> WebSocket ws://127.0.0.1:17833
braiser-daemon
        -> WebSocket ws://127.0.0.1:17832
Chrome 扩展 debug bridge
        -> Braised tab group 中的目标页面
```

第一阶段目标：让本地 Agent 能通过 MCP 稳定观察和操作 Chrome 中受控的目标页面，并拿到清洗后的可读内容或压缩后的 agent-html。

## 当前功能

- TypeScript 编写的 Chrome 扩展。
- TypeScript 编写的本地 MCP server。
- 本地 `braiser-daemon` 作为单例浏览器桥接进程。
- MCP server 与 daemon 通过 `ws://127.0.0.1:17833` 通信。
- Chrome 扩展 debug bridge 与 daemon 通过 `ws://127.0.0.1:17832` 通信。
- 读取 `Braised` tab group 中目标页面的标题和 URL。
- 抽取目标页面的可读文本。
- 生成带 `data-eid` 的压缩 agent-html。
- 对 agent-html 中登记过的元素执行点击、输入、选择、切换、聚焦和滚动。
- 将页面保存为本地 Markdown。

## 环境要求

- Node.js
- npm
- Google Chrome，或支持 Manifest V3 的 Chromium 浏览器

## 安装依赖

```powershell
npm install
```

## 构建

```powershell
npm run build
```

也可以分别构建：

```powershell
npm run build:extension
npm run build:mcp
```

TypeScript 源码位于 `extension/src/` 和 `mcp/src/`。构建产物输出到 `extension/dist/` 和 `mcp/dist/`。

## 加载 Chrome 扩展

1. 运行 `npm run build`。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `extension/` 目录。

扩展 popup 会显示目标页面信息，以及 debug bridge 是否已经连接到本地 daemon。

## 运行方式

在 Chrome 中准备一个标题为 `Braised` 的 tab group，并把要操作的目标页面放在该组最后。

通常只需要由 Codex 的 MCP 配置启动：

```toml
[mcp_servers.braiser]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Life\project\Braiser\Braiser\mcp\dist\server.js']
```

`mcp/dist/server.js` 会在启动时尝试连接本地 daemon；如果 daemon 不存在，会自动后台启动 `mcp/dist/daemon.js`。

也可以手动启动：

```powershell
npm run daemon
npm run mcp
```

端口约定：

```text
ws://127.0.0.1:17832  Chrome 扩展 debug bridge -> braiser-daemon
ws://127.0.0.1:17833  braiser-mcp -> braiser-daemon
```

打开扩展 popup，点击“打开 Bridge”。Bridge 页面会连接 daemon，并在页面保持打开时维持 WebSocket 常驻。这样可以避免 MV3 background service worker 休眠导致连接断开。

## MCP Tools

当前暴露的工具：

- `braiser.status`：检查 MCP、daemon 和扩展连接状态。
- `browser.get_active_tab`：获取 `Braised` tab group 中目标页面的标题和 URL。名称保留 `active_tab` 是为了兼容早期调用方。
- `browser.observe`：把目标页面压缩成带 `data-eid` 的 agent-html。
- `browser.act`：根据 `snapshotId` 和 `elementId` 执行受控页面动作。
- `debug.inject_js`：仅用于调试，向目标页面 MAIN world 注入 JavaScript，并返回 JSON 可序列化结果。
- `page.extract_readable_text`：抽取目标页面的可读文本。
- `page.save_current_page`：抽取目标页面并保存为 Markdown。

保存的页面写入：

```text
~/.braiser/pages/
```

`braiser.status` 返回示例：

```json
{
  "mcp": "ok",
  "daemonConnected": true,
  "extensionConnected": true
}
```

## 说明

当前 MVP 不做复杂权限系统、远程连接、账号体系、云同步或多用户管理。它只验证一件事：本地 Agent 是否能通过 MCP 稳定、有价值地观察并操作浏览器页面。

更多设计说明见 `docs/`。
