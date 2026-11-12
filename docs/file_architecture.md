# 文件架构与职责

依据：[D-0001](../user-spec/decisions/0001-existing-browser-architecture.md)、[D-0002](../user-spec/decisions/0002-remote-access.md)。

## 维护层

| 文件 | 职责 |
|---|---|
| [AGENTS.md](../AGENTS.md) | 作者合作规则，属于 user spec |
| [user-spec/README.md](../user-spec/README.md) | 作者预期和决策维护规则 |
| [user-spec/overview.md](../user-spec/overview.md) | 本次确认的作者预期 |
| [user-spec/decisions/README.md](../user-spec/decisions/README.md) | 实现决策索引 |
| [references/README.md](../references/README.md) | 外部事实索引 |
| [docs/README.md](README.md) | 当前技术文档和历史材料索引 |

## MCP 与本机服务

| 文件 | 职责 |
|---|---|
| [server.ts](../mcp/src/server.ts) | MCP stdio 入口，按模式注册并执行工具 |
| [tools.ts](../mcp/src/tools.ts) | 工具编排、入参验证、Markdown 转换与本机文件操作 |
| [config.ts](../mcp/src/config.ts) | 本机/远程模式、回环端点和超时配置验证 |
| [auth.ts](../mcp/src/auth.ts) | 本机凭据生成、文件读取、Bearer 比较 |
| [policy.ts](../mcp/src/policy.ts) | MCP 和 daemon 共用远程工具允许集合 |
| [lifecycle.ts](../mcp/src/lifecycle.ts) | 本机 daemon 就绪检查与按需启动；远程不启动 daemon |
| [websocket.ts](../mcp/src/websocket.ts) | 认证 WebSocket client、请求关联、超时、断线处理 |
| [daemon.ts](../mcp/src/daemon.ts) | daemon 进程入口，准备凭据、监听并处理退出 |
| [daemon-server.ts](../mcp/src/daemon-server.ts) | 两个回环监听端口、客户端认证和身份、扩展请求路由 |
| [remote.ts](../mcp/src/remote.ts) | 前台远程访问入口，编排 daemon、隧道与状态显示 |
| [ssh-tunnel.ts](../mcp/src/ssh-tunnel.ts) | 参数校验、独立 OpenSSH master、转发确认和子进程清理 |
| [cli.ts](../mcp/src/cli.ts) | 原调试/下载 CLI，复用连接配置和生命周期；远程禁止文件导出 |
| [protocol.ts](../mcp/src/protocol.ts) | MCP/daemon 与扩展消息类型；认证状态协议 v2、请求超时 |
| [markdown.ts](../mcp/src/markdown.ts) | MCP 所在主机的 DOM → Markdown 共享管线及临时文件清理 |
| [cleaner.ts](../mcp/src/cleaner.ts) | 文本清洗与格式化 |
| [storage.ts](../mcp/src/storage.ts) | 本机模式保存页面到 ~/.braiser/pages |
| [remote.test.mjs](../mcp/test/remote.test.mjs) | 随机回环端口、模拟扩展、真实 MCP stdio 和模拟 SSH 验证 |

## Chrome 扩展

扩展本次没有代码变动。Bridge 页面保持 WebSocket，避免 MV3 service worker 休眠中断长连接。

| 文件 | 职责 |
|---|---|
| [manifest.json](../extension/manifest.json) | MV3 权限和入口 |
| [debug.ts](../extension/src/debug.ts) | 连接本机 17832，转发 runtime message，显示状态日志 |
| [background.ts](../extension/src/background.ts) | Braised 标签组焦点与标签管理、浏览器下载/上传、CDP 与脚本执行；observe 时补充 CDP isClickable |
| [content.ts](../extension/src/content.ts) | 生成 agent-html、维护快照 registry、执行有限动作集合 |
| [popup.ts](../extension/src/popup.ts) | 状态 UI、打开 Bridge、手工导出 |
| [protocol.ts](../extension/src/protocol.ts) | 扩展内部消息类型；网络客户端认证不涉及扩展协议 |

## 辅助脚本与构建

[setup-markdown.mjs](../scripts/setup-markdown.mjs) 创建项目 Python 环境；[预处理脚本](../scripts/preprocess-markdown-html.py) 和 [MarkItDown 包装](../scripts/markitdown-braiser.py) 保留数学内容。依据见 [D-0009](../user-spec/decisions/0009-existing-markdown-pipeline.md)。

[根 package.json](../package.json) 提供 build、mcp、daemon、remote、test 和原 CLI 命令。[mcp/package.json](../mcp/package.json) 保留原 bin 并增加 braiser 入口。构建输出到 extension/dist 与 mcp/dist，不跟踪产物，不直接编辑。
