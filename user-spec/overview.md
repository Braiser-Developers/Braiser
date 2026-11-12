# Braiser 总览

## 项目定位

Braiser 是作者开发的简易 MCP 工具，为 Agent 提供更轻量级的浏览器操作能力。

## 当前远程访问需求

作者希望远程 Linux 服务器中的 Agent 能通过 Braiser MCP 操作作者本机的浏览器。本机已经可以通过 SSH 连接这台服务器。

当前先支持浏览、点击、填写和读取页面内容即可。

以上预期依据作者在 2026-11-12 的需求说明和范围确认整理。

当前目标环境与连接方案见 [D-0002](decisions/0002-remote-access.md)，统一启动入口见 [D-0004](decisions/0004-foreground-ssh-launcher.md)。
