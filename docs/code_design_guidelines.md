# 代码设计规范

用于代码完成后的人工/Agent 自查。这里记录的是编译不一定能发现、但容易影响可维护性的点。

## 兜底逻辑只保留一处

如果下游函数已经有兜底，调用处不要再写一层等价 fallback。

例如 `slugify()` 已经会在结果为空时返回 `"page"`，调用处不要写：

```ts
const fileName = `${dateStamp()}-${slugify(hostFromUrl(page.url) || page.title || "page")}.md`;
```

应写成：

```ts
const pageName = hostFromUrl(page.url) || page.title;
const fileName = `${dateStamp()}-${slugify(pageName)}.md`;
```

调用处负责选择名称来源，`slugify()` 负责生成安全文件名和最终兜底。

## 不把职责塞进错误的位置

保持现有边界：

- `daemon.ts`：本地 daemon，负责扩展连接、MCP client 连接和请求路由。
- `server.ts`：MCP stdio server 入口，负责注册 tools，并在需要时启动 daemon。
- `tools.ts`：MCP tool 行为编排。
- `websocket.ts`：MCP server 到 daemon 的 WebSocket client。
- `cleaner.ts`：文本清洗和格式化。
- `storage.ts`：本地保存。
- `background.ts`：扩展侧浏览器 API 执行层。
- `debug.ts`：扩展侧 debug bridge，负责持有和 daemon 的 WebSocket 长连接。
- `content.ts`：页面内信息抽取和受控动作执行。

`debug.inject_js`、`debug.cdp_command` 这类高权限调试能力必须保持 debug-only 命名、描述和文档边界，避免和 `browser.act` 的受控动作集合混在一起。

如果某段逻辑让一个文件同时承担多种职责，移到更合适的位置。

## 同步文件架构文档

如果新增、删除、移动文件，或者改变某个模块的主要职责，同步更新 `docs/file_architecture.md`。

## 远程改造后的职责补充

依据：[D-0002](../user-spec/decisions/0002-remote-access.md)、[D-0003](../user-spec/decisions/0003-credentials-and-tools.md)、[D-0004](../user-spec/decisions/0004-foreground-ssh-launcher.md)。

- daemon.ts 保留进程入口，监听、认证、路由移到 daemon-server.ts。
- config.ts、auth.ts、policy.ts 分别管理配置、凭据和能力集合。
- lifecycle.ts 统一 MCP 和 CLI 的本机自动启动，远程模式禁止启动 daemon。
- remote.ts 只编排前台远程访问，SSH 子进程与转发确认由 ssh-tunnel.ts 管理。
- 远程工具限制同时作用于列表、调用和 daemon，不能只隐藏工具名。
