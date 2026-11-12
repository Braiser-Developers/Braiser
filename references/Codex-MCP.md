# Codex MCP 配置

最近核对：2026-11-12。

来源：OpenAI 官方文档 [MCP STDIO servers](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)，通过官方文档工具搜索后读取；以及目标 Linux 上已安装 Codex 的 `codex mcp add --help`、`codex mcp get braiser --json` 实测。

- STDIO server 用 `command` 指定可执行文件，`args` 指定参数，`env` 配置环境变量；可以指定 `cwd`。
- 目标服务器 CLI 支持 `codex mcp add <name> --env KEY=VALUE -- <command> <args...>`。
- 实测 `codex mcp add braiser` 将条目加入远程账号的全局配置；`codex mcp get braiser --json` 返回已启用的 stdio 配置及本次设置的三个 BRAISER 环境变量。
- 本次仅将远程 token 文件路径写入配置，不把 token 内容写入配置。

运行中的旧 Agent 会话是否自动重载 MCP 配置未在本次验证；实际使用建议重新连接 MCP 或开启新会话。
