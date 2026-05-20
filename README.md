# Braiser

Braiser 是一个面向 AI 浏览器 Agent 的开源安全、结构化与记忆层。

当前 MVP 保持得很小：

```text
本地 Agent / Codex
        -> MCP stdio
braiser-mcp
        -> WebSocket ws://127.0.0.1:17832
Chrome 扩展
        -> 当前 Chrome 页面
```

第一阶段的目标是：让本地 Agent 能通过 MCP 读取当前 Chrome 页面，并拿到清洗后的可读内容。

## 当前功能

- 使用 TypeScript 编写的 Chrome 扩展
- 使用 TypeScript 编写的本地 MCP 服务
- MCP 与扩展之间通过 WebSocket 通信
- 读取当前 active tab 的标题和 URL
- 抽取当前页面的可读文本
- 将当前页面保存为本地 Markdown 文件

## 环境要求

- Node.js
- npm
- Google Chrome，或支持 Manifest V3 的 Chromium 系浏览器

## 安装依赖

在仓库根目录运行：

```powershell
npm install
```

## 构建

构建 Chrome 扩展和 MCP 服务：

```powershell
npm run build
```

也可以分别构建：

```powershell
npm run build:extension
npm run build:mcp
```

TypeScript 源码位于 `extension/src/` 和 `mcp/src/`。构建产物会输出到 `extension/dist/` 和 `mcp/dist/`。

## 加载 Chrome 扩展

1. 运行 `npm run build`。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `extension/` 目录。

扩展弹窗会显示当前 active tab，以及是否已经连接到本地 MCP bridge。

## 运行 MCP 服务

启动本地 MCP 服务：

```powershell
npm run mcp
```

MCP 服务会在本地开启 WebSocket：

```text
ws://127.0.0.1:17832
```

Chrome 扩展会自动尝试连接这个地址。

## MCP Tools

当前 MVP 暴露 4 个工具：

- `braiser.status`：检查 MCP 服务是否正常，以及扩展是否已连接
- `browser.get_active_tab`：获取当前 active tab 的标题和 URL
- `page.extract_readable_text`：抽取当前页面的可读文本
- `page.save_current_page`：抽取当前页面，并保存为 Markdown

保存的页面会写入：

```text
~/.braiser/pages/
```

## 说明

当前 MVP 不做点击、表单填写、页面提交、任意 JavaScript 执行、数据同步或多用户管理。

这一阶段只验证一件事：本地 Agent 是否能通过 MCP 稳定、有价值地读取当前浏览器页面。

更多设计说明见 `docs/`。
