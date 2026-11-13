# 2026-11-13 本机 MCP 客户端接入

最近核对：2026-11-13。

来源：本机配置与 CLI 实测。没有记录任何 token 内容。

## Braiser 状态

- 本机 `braiser.status` 返回 `daemonConnected=true`、`protocolVersion=2`、`clientMode=local`、`extensionConnected=true`。
- 本机 `browser.list_tabs` 和 `browser.get_active_tab` 均能读取 Chrome 中 Braised 标签组的当前焦点页面。
- 当前本机 MCP 入口是用 Homebrew 安装的 node 运行项目中的 `mcp/dist/server.js`。

## Codex

- `~/.codex/config.toml` 已有启用的 `[mcp_servers.braiser]` STDIO 条目，命令指向上述本机 MCP 入口。
- `codex mcp get braiser --json` 实测返回 `enabled=true`；未重复添加，也没有改动 Codex 配置。

## OpenCode

- 通过 OpenCode CLI 的 `mcp add --global` 添加了全局 `braiser` 条目。
- 当前配置文件是 `~/.config/opencode/opencode.jsonc`，条目使用 local STDIO command，并设置 `BRAISER_MODE=local`。
- `opencode mcp list` 实测显示 `braiser connected`。

## 使用边界

已打开的 Codex 或 OpenCode 会话可能需要重新连接 MCP 或新开会话，才会重新读取配置。当前 SSH 远程隧道是否在线不影响本机 MCP；本机 MCP 直接连接本机 daemon。
