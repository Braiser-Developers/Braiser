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
| [daemon.ts](../mcp/src/daemon.ts) | daemon 进程入口，准备凭据、监听、启动隧道守护并处理退出 |
| [daemon-server.ts](../mcp/src/daemon-server.ts) | 两个回环监听端口、客户端认证和身份、扩展来源校验、扩展请求路由 |
| [remote.ts](../mcp/src/remote.ts) | `remote enable/disable/status` 命令：检查免交互登录、写开关设置、通知 daemon |
| [tunnel-supervisor.ts](../mcp/src/tunnel-supervisor.ts) | 读写 `remote.json` 开关，按设置维持隧道并断线重连（D-0018） |
| [ssh-tunnel.ts](../mcp/src/ssh-tunnel.ts) | 命令解析与参数校验、免交互登录检查、独立 OpenSSH master、转发确认和子进程清理 |
| [cli.ts](../mcp/src/cli.ts) | 原调试/下载 CLI，复用连接配置和生命周期；远程禁止文件导出 |
| [protocol.ts](../mcp/src/protocol.ts) | MCP/daemon 与扩展消息类型；认证状态协议 v2、请求超时 |
| [markdown.ts](../mcp/src/markdown.ts) | MCP 所在主机的 DOM → Markdown 共享管线及临时文件清理 |
| [cleaner.ts](../mcp/src/cleaner.ts) | 文本清洗与格式化 |
| [storage.ts](../mcp/src/storage.ts) | 本机模式保存页面到 ~/.braiser/pages |
| [remote.test.mjs](../mcp/test/remote.test.mjs) | 随机回环端口、模拟扩展、真实 MCP stdio 和模拟 SSH 验证 |

## Chrome 扩展

Bridge 页面保持 WebSocket，避免 MV3 service worker 休眠中断长连接。页面观察与操作见 [observe_act.md](observe_act.md)。

| 文件 | 职责 |
|---|---|
| [manifest.json](../extension/manifest.json) | MV3 权限和入口 |
| [debug.ts](../extension/src/debug.ts) | 连接本机 17832，转发 runtime message，显示状态日志 |
| [background.ts](../extension/src/background.ts) | Braised 标签组焦点与标签管理、浏览器下载/上传、CDP 与脚本执行；按 frame 注入 content script、拼接各 frame 快照、执行动作并比较前后清单 |
| [content.ts](../extension/src/content.ts) | content script 入口：处理 observe、清单、动作和正文读取消息，维护本 frame 的快照 registry |
| [observe/snapshot.ts](../extension/src/observe/snapshot.ts) | 调用 Playwright 生成无障碍树，分配编号，列出隐藏的文件输入框 |
| [observe/render.ts](../extension/src/observe/render.ts) | 纯函数：输出格式、可操作元素判定、动作前后清单比较 |
| [observe/frames.ts](../extension/src/observe/frames.ts) | 通过 postMessage 把 `<iframe>` 元素对应到 frame id |
| [vendor/playwright/injected/ariaSnapshot.ts](../extension/src/vendor/playwright/injected/ariaSnapshot.ts) 等 | 复制的 Playwright 识别代码（v1.65.0，Apache-2.0，见同目录 [LICENSE](../extension/src/vendor/playwright/LICENSE)），不直接修改 |
| [popup.ts](../extension/src/popup.ts) | 状态 UI、打开 Bridge、手工导出 |
| [protocol.ts](../extension/src/protocol.ts) | 扩展内部消息类型；网络客户端认证不涉及扩展协议 |

## 辅助脚本与构建

[setup-markdown.mjs](../scripts/setup-markdown.mjs) 创建项目 Python 环境；[预处理脚本](../scripts/preprocess-markdown-html.py) 和 [MarkItDown 包装](../scripts/markitdown-braiser.py) 保留数学内容。依据见 [D-0009](../user-spec/decisions/0009-existing-markdown-pipeline.md)。

[build-extension.mjs](../scripts/build-extension.mjs) 用 esbuild 打包扩展，[vendor-playwright.mjs](../scripts/vendor-playwright.mjs) 从固定版本复制 Playwright 代码，依据见 [D-0015](../user-spec/decisions/0015-extension-bundling-and-e2e.md)。

[根 package.json](../package.json) 提供 build、mcp、daemon、remote、test、test:e2e、vendor:playwright 和原 CLI 命令。[mcp/package.json](../mcp/package.json) 保留原 bin 并增加 braiser 入口。构建输出到 extension/dist 与 mcp/dist，不跟踪产物，不直接编辑。

测试：[mcp/test/remote.test.mjs](../mcp/test/remote.test.mjs) 与 [extension/test/render.test.mjs](../extension/test/render.test.mjs) 随 `npm test` 运行；[mcp/test/e2e/observe.e2e.mjs](../mcp/test/e2e/observe.e2e.mjs) 由 `npm run test:e2e` 运行。
