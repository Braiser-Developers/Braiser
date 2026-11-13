# 2026-11-12 远程部署实测

最近核对：2026-11-14（远程代码同步见文末）。

来源：本次在作者本机与远程 Linux 服务器之间的实测。没有记录 token 内容；服务器的登录名、地址和各处具体路径按作者要求不写进仓库。

## 环境

- 浏览器主机项目：作者本机的 Braiser 检出目录。
- 远程项目：服务器上的 Braiser 目录，最初由提交 `4675b5b` 的源码归档复制得到，2026-11-14 同步到 `784c93e`；不是远程 Git 工作区。（2026-11-14 为去掉登录名、地址和路径改写过历史，这两个提交原来的编号是 `86a1704` 和 `3df08f0`，服务器上备份文件名里的编号沿用旧编号。）
- 远程 Node：`v24.18.0`，通过 nvm 安装。
- 远程 Python：`3.10.12`；项目虚拟环境使用 `uv` 创建，依赖 `markitdown==0.1.5`、`beautifulsoup4==4.14.3` 及解析出的依赖已安装。
- 远程凭据：服务器上的 `~/.braiser/remote-token`，文件权限 0600；只部署了 remote-token。
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

## 2026-11-14 同步到 784c93e（原编号 3df08f0）

- 同步前用 checksum 比对，远程源码与 `86a1704`（现 `4675b5b`）完全一致，没有本地改动。同步前的源码备份在服务器上 Braiser 目录旁的 `braiser-backup-86a1704-20261114.tgz`（不含 node_modules 和 Python 环境）。
- 用 `git archive 3df08f0`（现 `784c93e`）的内容经 rsync 覆盖源码，排除 node_modules、`.venv-markdown`、两个 dist 目录和 downloads；新增 40 个文件、更新 25 个，没有删除。
- 远程执行 `npm install` 和 `npm test`：19 项测试全部通过。npm 提示 esbuild 的安装脚本被拦截，构建仍然成功。
- 远程模式的 MCP 列出 10 个工具，observe 的说明已是新版（包含网址简写说明）。当时 SSH 隧道未开，`braiser.status` 报告 `ECONNREFUSED 127.0.0.1:27833`。
- 远程 OpenCode 也注册了 `braiser`（`~/.config/opencode/opencode.jsonc`，local STDIO，`BRAISER_MODE=remote`、27833 地址和 token 文件），与 Codex 指向同一个 `mcp/dist/server.js`。
- 同步时远程有 4 个正在运行的 Braiser MCP 进程（3 个属于 OpenCode 服务，1 个属于 Codex 应用服务），都在构建前启动，仍是旧代码；没有结束它们。

## 2026-11-14 远程访问开关（D-0018）的真实服务器验证

- 为了不开放作者的浏览器，用独立的测试 daemon 验证：临时 state 目录、客户端端口 18901、扩展端口 18902，服务器端口 27899，没有连接 Chrome 扩展。作者真实的 `~/.braiser` 和 daemon 没有参与。
- `remote enable --ssh user@server --remote-port 27899`：免交互登录检查通过，约 1 秒后报告隧道已连接。服务器上 `ss -ltn` 显示只在 `127.0.0.1:27899` 监听；不带凭据的 WebSocket 握手得到 401，说明转发到了 Braiser daemon。
- 手动结束本机 SSH master 进程后，状态先变为 retrying（上次错误 `SSH connection closed (code 0)`），约 2 秒后自动重连成功，换了新的 master 进程。
- `remote disable` 后 master 进程退出，服务器上 27899 不再监听。测试 daemon 和临时目录随后删除。
- 之后重启了作者本机的真实 daemon（换成支持开关的新代码），并执行 `remote disable`：`~/.braiser/remote.json` 为 `{"enabled": false}`，`braiser.status` 显示 `tunnel.state=disabled`，Chrome 扩展重新连上。
