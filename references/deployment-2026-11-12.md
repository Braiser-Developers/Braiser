# 2026-11-12 远程部署实测

最近核对：2026-11-12。

来源：本次在作者本机与 `user@server` 之间的实测。没有记录 token 内容。

## 环境

- 浏览器主机项目：`/path/to/Braiser`。
- 远程项目：`/path/to/Braiser`，由提交 `86a1704` 的源码归档复制得到；不是远程 Git 工作区。
- 远程 Node：`v24.18.0`，路径 `/home/<user>/.nvm/versions/node/v24.18.0/bin/node`。
- 远程 Python：`3.10.12`；项目虚拟环境使用 `uv` 创建，依赖 `markitdown==0.1.5`、`beautifulsoup4==4.14.3` 及解析出的依赖已安装。
- 远程凭据：`/home/<user>/.braiser/remote-token`，文件权限 0600；只部署了 remote-token。
- 远程 Codex 已注册名为 `braiser` 的 STDIO MCP，启动命令为远程 Node 和项目 `mcp/dist/server.js`；配置了 `BRAISER_MODE=remote`、回环 27833 地址和 token 文件路径。原 `~/.codex/config.toml` 在修改前保存为 `~/.codex/config.toml.before-braiser-20261112`。
- 本机 daemon 使用新版协议 v2，监听本机回环 17832/17833；Chrome Bridge 已连接。
- 当前前台 SSH 入口保持在线：服务器 `127.0.0.1:27833` → 本机 `127.0.0.1:17833`。服务器端口实测只监听回环地址。

## 实测结果

- 远程 MCP 列出 10 个工具；上传、下载、保存页面、任意 JS 和 CDP 调试工具未出现在远程工具列表。
- 使用 remote-token 直接请求调试工具被 daemon 拒绝。
- 远程 MCP 能创建临时标签页并打开本机回环测试页。
- `browser.observe` 返回真实页面的 agent-html。
- `browser.act` 的 `input-text` 和 `click` 能更新真实 Chrome 页面 DOM。
- `page.extract_readable_text` 在远程 Linux 执行 Markdown 转换，并返回更新后的页面内容。
- 暂停 SSH 隧道后，Linux MCP 报告 `ECONNREFUSED`；本机 daemon 保持运行。重新启动入口后 daemon 和扩展恢复在线。
- 本机 local-token 仍能返回 `protocolVersion=2`、`clientMode=local`、`extensionConnected=true`。
- 远程 Linux 上 10 项回归测试全部通过。

## 边界

这是一次真实部署验收，不是长期服务托管。前台入口所在终端关闭，SSH 隧道随之关闭；本机 daemon 会继续运行。运行中的远程 Agent 会话是否自动重载刚登记的 MCP 未验证；如看不到 Braiser 工具，重新连接 MCP 或开启新会话。
