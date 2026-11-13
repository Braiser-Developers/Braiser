# Braiser

Braiser 是让 Agent 操作浏览器的轻量级 MCP 工具。支持本机 Agent，以及通过 SSH 反向隧道连接本机浏览器的远程 Linux Agent。MCP 与本地 daemon 分开，多个 MCP 会话可复用桥接连接；页面焦点仍共享，同一时间使用一个操作 Agent。

作者预期见 [user spec](user-spec/README.md)，维护规则见 [AGENTS.md](AGENTS.md)，设计选择见 [决策索引](user-spec/decisions/README.md)。旧远期定位保留为历史材料，见 [材料归位](docs/materials-inventory.md)。

## 远程访问

远程访问是一个开关，平时关着。在浏览器主机完成构建后：

```bash
npm run remote -- enable --ssh user@server   # 打开，daemon 维持隧道并自动重连
npm run remote -- status
npm run remote -- disable                               # 关闭
```

只支持密钥登录（daemon 在后台运行，不能回答 SSH 的提问）。本机生成独立的 local-token 和 remote-token，远程 MCP 只使用 remote-token。升级旧版本需要构建并重启 daemon/MCP。远程 MCP 的配置、凭据准备、首版工具范围和故障定位见 [远程访问指南](docs/remote-access.md)。

```text
本地 Agent / Codex
        -> MCP stdio
braiser-mcp
        -> WebSocket ws://127.0.0.1:17833
braiser-daemon
        -> WebSocket ws://127.0.0.1:17832
Chrome 扩展 debug bridge
        -> Braised tab group 中的 agent focus 页面
```

第一阶段目标：让本地 Agent 能通过 MCP 稳定观察和操作 Chrome 中受控的目标页面，并拿到清洗后的可读内容，或带可操作元素编号的页面大纲。

## 当前功能

- TypeScript 编写的 Chrome 扩展。
- TypeScript 编写的本地 MCP server。
- 本地 `braiser-daemon` 作为单例浏览器桥接进程。
- MCP server 与 daemon 通过 `ws://127.0.0.1:17833` 通信。
- Chrome 扩展 debug bridge 与 daemon 通过 `ws://127.0.0.1:17832` 通信。
- 读取和管理 `Braised` tab group 中的 agent focus 页面。
- 抽取目标页面并以 Markdown 形式返回正文。
- 基于 Playwright 的无障碍树生成页面大纲：文字、结构、表单当前值和状态，包括 shadow DOM 与 iframe，可操作元素带 `E12` 这样的编号。
- 对大纲中的元素执行点击、输入、选择、切换、聚焦和滚动，并只返回成败和大的变化。
- 将页面保存为本地 Markdown。

## 环境要求

- Node.js
- Python 3.10 或更高版本（Markdown conversion 的必需依赖）
- npm
- Google Chrome，或支持 Manifest V3 的 Chromium 浏览器

## 安装依赖

```bash
npm install
```

### Markdown 转换环境

Markdown 转换使用项目本地 Python 虚拟环境里的 Microsoft MarkItDown。`npm install` 会自动创建 `.venv-markdown/`，并安装 `requirements-markdown.txt` 中的依赖。机器上必须有 Python 3.10 或更高版本，否则 `npm install` 直接失败，不会留下只配好一半的转换环境。

手动修复或重建这个环境：

```bash
npm run setup:markdown
```

Braiser 先把 KaTeX 的 LaTeX 注释预处理成带标记的数学节点，再交给项目内的 MarkItDown 包装脚本，这样数学内容会原样保留，不会被当成普通 Markdown 文本转义。

导出当前页面的 Markdown：

```bash
npm run download:markdown
```

查看转换前预处理过的 HTML：

```bash
npm run download:preprocessed-html
```

也可以导出 observe 输出和运行时 DOM：

```bash
npm run download:observe
npm run download:dom
```

预处理和转换的约定见 [Markdown 协议](docs/markdown_pipeline.md)。

## 构建

```bash
npm run build
```

也可以分别构建：

```bash
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

在 Chrome 中准备一个标题为 `Braised` 的 tab group。Braiser 会维护一个 agent focus tab，所有观察和操作默认作用于这个 tab；初次使用或已保存的焦点失效时，会回退到该组最后一个 tab。也可以通过 MCP tab 工具创建、打开、切换或关闭 `Braised` 组内页面。

通常只需要由 MCP 客户端以 stdio 方式启动 `mcp/dist/server.js`。Codex 的配置示例（路径按实际位置调整）：

```toml
[mcp_servers.braiser]
command = "node"
args = ["/path/to/Braiser/mcp/dist/server.js"]
```

OpenCode 等其他 MCP 客户端也是用 stdio 启动同一个文件。`mcp/dist/server.js` 启动时会尝试连接本地 daemon；如果 daemon 不存在，会自动在后台启动 `mcp/dist/daemon.js`。

也可以手动启动：

```bash
npm run daemon
npm run mcp
```

端口约定：

```text
ws://127.0.0.1:17832  Chrome 扩展 debug bridge -> braiser-daemon
ws://127.0.0.1:17833  braiser-mcp -> braiser-daemon
```

17833 要求 token；17832 只接受来自 Chrome 扩展页面的连接，网页无法冒充扩展。

打开扩展 popup，点击“打开 Bridge”。Bridge 页面会连接 daemon，并在页面保持打开时维持 WebSocket 常驻。这样可以避免 MV3 background service worker 休眠导致连接断开。

常用 CLI 辅助命令：

```bash
npm run tabs
npm run switch-tab -- <tabId>
```

## MCP Tools

当前暴露的工具：

- `braiser.status`：检查 MCP、daemon 和扩展连接状态。
- `browser.get_active_tab`：获取 `Braised` tab group 中当前 agent focus tab 的标题、URL 和 tab id。名称保留 `active_tab` 是为了兼容早期调用方。
- `browser.list_tabs`：列出 `Braised` tab group 中的页面，并标出当前 agent focus tab。
- `browser.create_tab`：在 `Braised` tab group 中创建新 tab，并将其设为 agent focus tab。默认在后台打开，不切换你眼前的页面；只有页面在后台不正常或需要你亲手操作时，Agent 才传 `active: true`。
- `browser.open_tab`：在指定 tab 或当前 agent focus tab 中打开 URL。
- `browser.close_tab`：关闭指定 tab 或当前 agent focus tab，并重新选择焦点。
- `browser.switch_tab`：把 agent focus 切换到 `Braised` tab group 中的指定 tab，默认不切换 Chrome 前台（`activate: true` 才切换）。
- `browser.download`：通过 Chrome 原生下载管理器下载 URL 到默认下载目录；相对 URL 会基于当前 agent focus tab 解析，可选传入默认目录下的文件名。
- `browser.observe`：返回目标页面的缩进大纲（角色、名称、全部文字、表单当前值和状态），可操作元素带编号，iframe 内编号带 `F1` 前缀。格式见 [页面观察与操作](docs/observe_act.md)。
- `browser.act`：根据 `snapshotId` 和 `elementId` 执行受控页面动作。
- `browser.upload`：把本地绝对路径指向的普通文件设置到 observe 快照中的 `<input type="file">`；文件选入后立即返回，不等待网页完成上传或处理。
- `debug.inject_js`：仅用于调试，向目标页面 MAIN world 注入 JavaScript，并返回 JSON 可序列化结果。
- `debug.cdp_command`：仅用于调试，向目标 tab 发送 Chrome DevTools Protocol 命令，并返回 JSON 可序列化结果。
- `page.extract_readable_text`：抽取目标页面运行时 DOM，并复用 Markdown pipeline，在返回对象的 `text` 字段中提供 Markdown。
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

当前 MVP 支持基于 SSH 的远程连接和 token 身份区分；不做复杂权限系统、账号体系、云同步或多使用者管理。远程首版提供浏览、点击、填写和读取，不提供文件传输与任意 JS/CDP 调试工具。

## 验证

`npm test` 构建代码并运行回环桥接、MCP stdio、模拟 SSH 和页面大纲渲染测试，不连接真实浏览器或服务器。

`npm run test:e2e` 在 Playwright 下载的 Chromium 里加载扩展，经真实 daemon 验证 observe、act 和上传；首次运行前执行 `npx playwright-core install chromium`。实际启用仍需确认服务器转发策略和浏览器连接。

更多设计说明见 `docs/`。
