# 远程 Agent 操作本机浏览器

设计依据：[D-0002](../user-spec/decisions/0002-remote-access.md)、[D-0003](../user-spec/decisions/0003-credentials-and-tools.md)、[D-0018](../user-spec/decisions/0018-remote-tunnel-switch.md)。

## 运行位置

```text
Linux Agent → stdio MCP → Linux 127.0.0.1:27833
                            │ SSH 反向转发，由浏览器主机发起
                            ↓
浏览器主机 daemon 127.0.0.1:17833 → 扩展连接 17832 → Chrome 页面
```

服务器不需要主动连接浏览器主机，浏览器主机不需要运行 SSH 服务。隧道由浏览器主机上的 daemon 维持，目前支持 macOS/Linux OpenSSH；Linux 上的 MCP 只需要 Node 和项目依赖，读取 Markdown 还使用项目的 Python 环境。

## 打开和关闭远程访问

远程访问是一个开关，平时关着。在浏览器主机的项目目录运行：

```bash
npm run build
npm run remote -- enable --ssh user@server   # 打开
npm run remote -- status                                # 查看设置和隧道状态
npm run remote -- disable                               # 关闭
```

也可以写成 `node mcp/dist/remote.js remote enable --ssh ...`；安装了 mcp 包的 bin 入口时是 `braiser remote enable --ssh ...`。`enable` 支持 `--remote-port 27833`、`--ssh-port 22`；SSH 目标可用 user@host、IPv4 或 SSH config alias。

- `enable` 先用 `BatchMode=yes` 检查能否免交互登录。daemon 在后台运行，不能回答主机密钥确认或密码提示，所以只支持密钥登录；第一次连新服务器时，先在终端手动 `ssh` 一次。
- 检查通过后，设置写入 `~/.braiser/remote.json`（权限 0600），命令确保 daemon 在运行，请它按新设置建立隧道，等待最多 30 秒并报告结果。
- 开关打开期间，daemon 维持一条专用 SSH 连接，把服务器 `127.0.0.1:27833` 转发到本机 `127.0.0.1:17833`。断线后按 2、5、10、30、60 秒的间隔自动重连；重连只恢复转发，不重发浏览器动作。
- 开关状态记在文件里，daemon 重启后照旧。daemon 在本机 Codex/OpenCode 会话或 `remote enable` 需要时启动；重启电脑后，在这之前隧道不会恢复。
- `disable` 写入关闭状态并让 daemon 立即断开隧道；daemon 没在运行时只改设置。
- 本机 `braiser.status` 会附带 `tunnel` 字段（state 为 disabled、connecting、connected 或 retrying，以及目标、端口和上次错误）。远程凭据看不到这个字段，也不能开关隧道。
- 扩展未连接时，从 Chrome 扩展 popup 打开 Bridge 页面。

升级到这个版本后，需要重启一次旧 daemon，新的 daemon 才会管理隧道；`enable` 遇到不支持隧道的旧 daemon 会提示重启。

## 远程凭据与 MCP 配置

第一次启动本机 daemon 时生成两个文件，默认权限 0600：

- `~/.braiser/local-token`：本机完整工具能力。
- `~/.braiser/remote-token`：远程浏览、操作和读取能力。

只把 `remote-token` 通过可信方式复制到 Linux，例如保存在 Linux 的 `/home/<user>/.braiser/remote-token`，目录权限 0700、文件权限 0600。`enable` 只显示凭据文件位置，不打印内容；不会自动上传凭据或修改服务器。

Linux 上准备同版项目及其依赖。项目现有安装流程会创建 Python Markdown 环境，见 [Markdown 协议](markdown_pipeline.md)。在远程 Agent 的 MCP 配置中指定以下环境变量；路径应按实际 checkout 调整：

```toml
[mcp_servers.braiser]
command = "node"
args = ["/path/to/Braiser/mcp/dist/server.js"]

[mcp_servers.braiser.env]
BRAISER_MODE = "remote"
BRAISER_DAEMON_URL = "ws://127.0.0.1:27833"
BRAISER_TOKEN_FILE = "/home/<user>/.braiser/remote-token"
```

这只是 MCP 配置示例，不会自动写入。远程模式未配置凭据时直接报错；隧道尚未建立时仍可列出工具，`braiser.status` 会报告连接错误。后续调用可重新连接，不启动 Linux daemon。

本机默认模式仍是 local，MCP 会自动读取本机 local-token，在端口没有监听时启动 daemon。daemon 已运行但认证不通过时，检查凭据与版本，不会悄悄启动另一个服务。

## 环境变量

| 变量 | 含义 |
|---|---|
| `BRAISER_MODE` | `local`（默认）或 `remote` |
| `BRAISER_DAEMON_URL` | 回环 WebSocket 地址；本机默认 17833，远程默认 27833 |
| `BRAISER_TOKEN_FILE` | 凭据文件；远程需显式指定，本机默认读取 state 目录的 local-token |
| `BRAISER_TOKEN` | 可选直接提供 token，优先于文件；不要放进命令历史、日志或仓库 |
| `BRAISER_STATE_DIR` | 浏览器主机凭据目录，默认 `~/.braiser`；远程模式不会创建此目录 |
| `BRAISER_DAEMON_PORT` | daemon 的客户端监听端口，默认 17833 |
| `BRAISER_EXTENSION_PORT` | daemon 的扩展监听端口，默认 17832；改动时需同步扩展地址，普通使用保持默认 |
| `BRAISER_REQUEST_TIMEOUT_MS` | 请求期限，默认 30000，可设 1000–120000 |

## 首版能力与限制

远程允许状态、标签页管理、observe、act 和 page.extract_readable_text。上传、下载、保存页面及任意 JS/CDP 调试工具在远程工具列表与调用入口禁用；daemon 也按 remote-token 限制请求。网页自身的点击或提交仍可能触发下载，工具限制不等同于网页行为审查。

正文读取在 Linux 进行 Markdown 转换，结果直接返回 Agent；不提供跨机器文件搬运。所有 Agent 仍共享 Braised 焦点和页面快照，同一时间使用一个操作 Agent。

SSH 默认只申请服务器回环地址，服务端应保持 `GatewayPorts no` 或允许精确绑定的 `clientspecified`；`GatewayPorts yes` 可能强制对外监听，实际启用时应核对。Token 补充隔离同服务器的其他进程，不防持有凭据或具有管理员权限的进程。服务端还需要允许 remote forwarding，具体 `AllowTcpForwarding` / `PermitListen` 由服务器配置决定。

## 故障定位

| 状态 | 含义与处理 |
|---|---|
| 本机连接 HTTP 401 | 凭据不匹配，或需要升级/重启旧 daemon |
| 不兼容 daemon | 连接到旧协议或错误进程，构建并重启对应服务 |
| Cannot log in ... without prompts | 不能免交互登录：先在终端 `ssh` 一次，确认主机密钥并配置密钥登录 |
| tunnel state=retrying | 隧道断开或连不上，daemon 会自动重连；`npm run remote -- status` 显示上次错误 |
| remote forwarding failed | 远程端口被占用、转发被禁或确认超时；daemon 会继续重试 |
| daemonConnected=false | 隧道/本机 daemon 不可用，或凭据不对；查看 status 的 error |
| extensionConnected=false | 打开本机扩展 Bridge 页面并检查扩展端口；扩展端口只接受 `chrome-extension://` 来源，其他来源得到 403（见 [D-0011](../user-spec/decisions/0011-extension-port-origin.md)） |
| operation outcome is unknown | 动作可能已执行；重新 observe 后再决定，不直接重试提交 |

## 验证边界

`npm test` 构建扩展与 MCP，使用随机回环端口的临时 daemon、模拟扩展（带扩展来源）、真实 MCP stdio、假的 SSH 可执行程序（验证转发确认、失败和清理，以及 master 带 `BatchMode=yes`），并用假隧道验证开关、断线重连和凭据权限。不连接真实服务器或浏览器，不读写生产凭据。2026-11-14 另外用独立的测试 daemon 对真实服务器做过一次开关和断线重连验证，见 [远程部署实测](../references/deployment-2026-11-12.md)。
