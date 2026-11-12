# 远程 Agent 操作本机浏览器

设计依据：[D-0002](../user-spec/decisions/0002-remote-access.md)、[D-0003](../user-spec/decisions/0003-credentials-and-tools.md)、[D-0004](../user-spec/decisions/0004-foreground-ssh-launcher.md)。

## 运行位置

```text
Linux Agent → stdio MCP → Linux 127.0.0.1:27833
                            │ SSH 反向转发，由浏览器主机发起
                            ↓
浏览器主机 daemon 127.0.0.1:17833 → 扩展连接 17832 → Chrome 页面
```

服务器不需要主动连接浏览器主机，浏览器主机不需要运行 SSH 服务。启动器目前支持 macOS/Linux OpenSSH；Linux 上的 MCP 只需要 Node 和项目依赖，读取 Markdown 还使用项目的 Python 环境。

## 从旧版本升级

此次加入认证协议 v2，旧 daemon 不接受新认证约定。实际启用时，在浏览器主机构建新版并停止旧 daemon，再启动新版；Linux 使用同版 MCP。启动器遇到不兼容服务或认证错误会报错，不会杀掉已有进程或覆盖其端口。

扩展代码没有变化，已加载的扩展可继续使用。旧 MCP 客户端必须随 daemon 一起升级。仅修改源文件不会改变当前运行服务。

## 本机启动

在浏览器主机项目目录准备依赖并构建（首次安装使用现有 npm install 流程）：

```bash
npm run build
npm run remote -- start --ssh user@server
```

也可以直接运行：

```bash
node mcp/dist/remote.js remote start --ssh user@server
```

若安装了 mcp 包的 bin 入口，等价命令是 `braiser remote start --ssh ...`。支持 `--remote-port 27833`、`--ssh-port 22` 和 `--help`；SSH 目标可用 user@host、IPv4 或 SSH config alias。

入口会准备或复用 daemon，检查远程凭据，再建立一条独立 SSH 连接。正常 SSH 密钥、密码提示和主机密钥校验仍生效。保持终端打开，看到转发确认及 Chrome 扩展已连接才表示两段连接都就绪。扩展未连接时，从 Chrome 扩展 popup 打开 Bridge 页面，并准备 Braised 标签组。

按 Ctrl-C 关闭此次隧道；daemon 保持运行。本机休眠或网络断开后，命令会在检测到断线时退出，重新运行即可。不会自动重发浏览器动作。

## 远程凭据与 MCP 配置

第一次启动本机 daemon 时生成两个文件，默认权限 0600：

- `~/.braiser/local-token`：本机完整工具能力。
- `~/.braiser/remote-token`：远程浏览、操作和读取能力。

只把 `remote-token` 通过可信方式复制到 Linux，例如保存在 Linux 的 `/home/<user>/.braiser/remote-token`，目录权限 0700、文件权限 0600。启动命令只显示凭据文件位置，不打印内容；不会自动上传凭据或修改服务器。

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

这只是 MCP 配置示例，不由启动器自动写入。远程模式未配置凭据时直接报错；隧道尚未建立时仍可列出工具，`braiser.status` 会报告连接错误。后续调用可重新连接，不启动 Linux daemon。

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
| SSH 登录失败/超时 | 检查正常 SSH 登录；命令等待登录最多 120 秒 |
| remote forwarding failed | 远程端口被占用、转发被禁或确认超时；不会显示已就绪 |
| daemonConnected=false | 隧道/本机 daemon 不可用，或凭据不对；查看 status 的 error |
| extensionConnected=false | 打开本机扩展 Bridge 页面并检查扩展端口 |
| operation outcome is unknown | 动作可能已执行；重新 observe 后再决定，不直接重试提交 |

## 验证边界

`npm test` 构建扩展与 MCP，使用随机回环端口的临时 daemon、模拟扩展、真实 MCP stdio，以及假的 SSH 可执行程序验证启动确认、失败和清理。不连接真实服务器或浏览器，不验证真实 sshd 策略与登录；实际启用时仍需端到端验收。测试不读写生产凭据。
