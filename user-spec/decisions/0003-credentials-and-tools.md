# D-0003 用两种凭据在 daemon 和 MCP 同时限制远程能力

- 状态：有效
- 日期：2026-11-12
- 决策者：agent
- 服务于：[作者预期](../overview.md)、[D-0002](0002-remote-access.md)

## 背景

SSH 回环监听不能隔离 Linux 上的其他本机进程。作者认可增加 token 认证，并确认第一版只需浏览、点击、填写、读取。

## 决策

本机首次启动生成独立的 local-token、remote-token，权限 0600，保存在 ~/.braiser 或 BRAISER_STATE_DIR。WebSocket 握手使用 Authorization Bearer；不把 token 放进 URL、日志、命令参数或响应。daemon 按凭据确定身份；远程身份只允许状态、标签管理、observe、act 和页面读取。MCP 同时过滤列表与调用入口，不暴露上传、下载、保存文件、任意 JS/CDP。远程机只复制 remote-token。

这限制的是工具能力，并不拦截网页自身的提交或点击下载链接。不是完整的浏览器操作审查系统。

## 考虑过、没有采用

- 仅隐藏 tools：直接请求 daemon 仍能绕过。
- 仅依赖 SSH：同服务器其他进程可访问转发端口。
- 共用 token：无法在 daemon 上区分本机完整能力与远程能力。

## 代价

升级后旧 MCP/daemon 不兼容，实际启用时需要一起构建并重启。Token 不防远程管理员。扩展保留现有本机连接，未增加扩展配对；扩展端口后来加了来源校验，见 [D-0011](0011-extension-port-origin.md)。

## 什么时候应该重新考虑

需要文件传输、权限分级、凭据轮换或多设备配对时。
