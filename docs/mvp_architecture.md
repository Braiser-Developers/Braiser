# Braiser 最简单 MVP 架构

## 1. MVP 目标

先只验证一个核心价值：

> 本地 Agent 能通过 MCP 读取当前 Chrome 页面，并拿到清洗后的内容。

第一版不追求完整产品化，不做远程连接，不做复杂后台服务，不做账号体系。

---

## 2. 最小组件

MVP 只保留两个部件：

```text
1. Chrome Extension
2. braiser-mcp 本地程序
```

其中 `braiser-mcp` 是一个单进程程序，内部同时负责：

```text
- MCP Server
- WebSocket Server
- HTML 清洗
- 简单本地保存
```

暂时不拆独立 Core Daemon。

---

## 3. 最简单架构图

```text
Codex / 本地 Agent
        ↓ MCP stdio
braiser-mcp 单进程
        ├─ MCP Server
        ├─ WebSocket Server
        ├─ HTML 清洗
        └─ 本地保存
        ↓ ws://127.0.0.1:17832
Chrome Extension
        ├─ background
        └─ content script
        ↓
当前 Chrome 页面
```

---

## 4. 请求流程

以 `page.extract_readable_text` 为例：

```text
1. 本地 Agent 调用 MCP tool：page.extract_readable_text
2. braiser-mcp 收到 MCP 请求
3. braiser-mcp 通过 WebSocket 请求 Chrome Extension
4. Chrome Extension 获取当前 active tab
5. Chrome Extension 注入 content script 或调用已注入脚本
6. content script 抽取页面正文 / 可见文本 / title / url
7. Chrome Extension 把结果返回给 braiser-mcp
8. braiser-mcp 做简单 HTML 清洗和文本整理
9. braiser-mcp 把结果返回给 Agent
```

保存页面时也走同一条链路，只是在第 8 步后额外写入本地文件。

---

## 5. 第一版只做的 MCP Tools

第一版只做 4 个工具：

```text
braiser.status
browser.get_active_tab
page.extract_readable_text
page.save_current_page
```

### `braiser.status`

检查 MCP 程序和浏览器扩展是否连接正常。

返回示例：

```json
{
  "mcp": "ok",
  "extensionConnected": true
}
```

### `browser.get_active_tab`

获取当前 Chrome active tab 的基础信息。

返回：

```json
{
  "title": "...",
  "url": "..."
}
```

### `page.extract_readable_text`

抽取当前页面的可读文本。

返回：

```json
{
  "title": "...",
  "url": "...",
  "text": "..."
}
```

### `page.save_current_page`

抽取当前页面内容，并保存到本地文件。

第一版可以只保存 Markdown 或纯文本。

---

## 6. 第一版明确不做的东西

MVP 先不做：

```text
- 独立 Braiser Core Daemon
- Native Messaging
- SSH 远端 Agent
- Braiser Relay
- 桌面 App
- 账号体系
- 云同步
- 复杂权限系统
- 多用户支持
- 多浏览器支持
- 自动读取所有 tabs
- 执行任意 JavaScript
- 点击、填写表单、提交网页
- 完整本地知识库
- 向量索引
```

第一版只验证“本地 Agent 能否有价值地读取当前浏览器页面”。

---

## 7. 技术栈

推荐最小技术栈：

```text
Chrome Extension：TypeScript 或 JavaScript
本地 MCP 程序：Node.js + TypeScript
通信方式：WebSocket
本地保存：文件系统
HTML 清洗：直接写在 braiser-mcp 内部
```

第一版不需要数据库。保存目录可以先用：

```text
~/.braiser/pages/
```

例如：

```text
~/.braiser/pages/2026-05-20-example-com.md
```

---

## 8. 代码目录建议

最简单目录：

```text
braiser/
  extension/
    manifest.json
    background.ts
    content.ts
    popup.html
    popup.ts

  mcp/
    package.json
    src/
      server.ts
      websocket.ts
      tools.ts
      cleaner.ts
      storage.ts
      protocol.ts
```

暂时不要拆 monorepo packages。

---

## 9. Chrome Extension 权限

第一版尽量少要权限。

建议：

```json
{
  "permissions": ["activeTab", "scripting", "storage"]
}
```

含义：

```text
activeTab：用户触发扩展后，临时访问当前页面
scripting：注入 content script
storage：保存扩展侧简单状态，例如连接状态
```

第一版先不要申请 `<all_urls>`。

---

## 10. 生命周期设计

第一版不做常驻 daemon，所以生命周期可以很简单：

```text
1. Agent 启动 braiser-mcp
2. braiser-mcp 开启 WebSocket Server
3. Chrome Extension 尝试连接 ws://127.0.0.1:17832
4. Agent 调用 MCP tools
5. braiser-mcp 转发请求给 Extension
6. Agent 结束后，braiser-mcp 可以退出
7. Extension 断线后等待下次重连
```

这意味着第一版允许：

```text
- MCP 程序不常驻
- 浏览器扩展偶尔断线
- 用户需要重新打开 Agent 后再连接
```

只要能稳定完成核心调用，就够了。

---

## 11. 最小成功标准

MVP 成功标准：

```text
1. Codex 或本地 Agent 能识别 braiser MCP
2. Agent 能调用 braiser.status
3. Agent 能调用 browser.get_active_tab 获取当前页面标题和 URL
4. Agent 能调用 page.extract_readable_text 获取当前页面正文
5. Agent 能调用 page.save_current_page 把页面保存到本地
```

如果这 5 件事能跑通，就说明 Braiser 的核心方向值得继续做。

---

## 12. 后续再考虑的演进

只有当 MVP 验证成功后，再考虑：

```text
阶段 2：拆出 braiser daemon
阶段 3：加入 SQLite / 搜索 / 页面记忆
阶段 4：支持 SSH 远端 Agent
阶段 5：支持 Braiser Relay
阶段 6：做桌面 App 和产品化权限系统
```

不要在第一版提前实现这些。

---

## 13. 一句话版本

```text
Braiser MVP = 一个 Chrome 扩展 + 一个本地 MCP 进程。

目标：让本地 Agent 通过 MCP 读取当前 Chrome 页面，并返回清洗后的内容。
```
