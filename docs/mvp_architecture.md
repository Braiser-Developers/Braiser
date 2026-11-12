# 当前 MVP 架构

设计依据：[D-0001](../user-spec/decisions/0001-existing-browser-architecture.md)、[D-0002](../user-spec/decisions/0002-remote-access.md)。作者需求见 [overview](../user-spec/overview.md)。

## 本机链路

Agent → MCP stdio → 认证 WebSocket 127.0.0.1:17833 → daemon → 扩展 Bridge 连接 127.0.0.1:17832 → background → content script。

MCP 自动读取 local-token。本机 daemon 不存在时按需启动；认证错误、协议不兼容或其他连接错误直接报告，不替换既有服务。扩展 Bridge 仍需保持打开。

## 远程链路

Linux Agent → Linux MCP stdio → Linux 回环 27833 → 本机发起的 SSH 反向隧道 → 本机 daemon 17833 → 原扩展链路。

前台入口准备 daemon 和独立隧道，SSH 转发得到确认后报告就绪；关闭入口只停止这条隧道。远程 MCP 用 remote-token，从不在 Linux 启动 daemon。配置与操作步骤见 [远程访问](remote-access.md)。

## 能力边界

本机仍有原有上传、下载、页面保存和调试工具；远程只允许状态、标签管理、observe、act 和页面读取。列表过滤、MCP 调用校验、daemon 凭据身份限制共用同一允许集合，见 [D-0003](../user-spec/decisions/0003-credentials-and-tools.md)。这不是网页提交风险审批系统。

页面观察继续生成 agent-html，动作以 snapshotId/elementId 定位。所有 MCP 会话共享一个焦点，首版按单 Agent 使用。正文读取在 MCP 主机运行原 Markdown 管线，见 [D-0009](../user-spec/decisions/0009-existing-markdown-pipeline.md)。

## 状态与失败

braiser.status 包含 MCP 模式、端点、daemonConnected、extensionConnected；连接成功还返回 protocolVersion=2 和凭据对应的 clientMode。连接失败返回可定位的 error，不泄漏 token。

daemon 重新映射请求 ID，避免多个客户端 ID 冲突。动作超时或断线可能意味着已执行、响应丢失，返回结果未知；重连不重放动作。扩展替换和解析错误处理见 [D-0005](../user-spec/decisions/0005-extension-replacement.md)、[D-0006](../user-spec/decisions/0006-malformed-bridge-messages.md)、[D-0007](../user-spec/decisions/0007-timeouts-and-reconnection.md)。

## 验证与边界

自动测试验证认证、能力限制、请求路由、断线/超时、MCP stdio 和模拟 SSH 启动流程。真实网络、服务器策略、浏览器端到端验证留待实际启用。不实现公网服务、文件跨机搬运、多 Agent 隔离或后台托管。旧定位与草稿作为历史材料保留，见 [材料归位](materials-inventory.md)。
