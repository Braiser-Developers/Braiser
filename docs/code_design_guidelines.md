# 代码设计规范

用于代码完成后的人工/Agent 自查。这里只记录编译不一定能发现、但容易影响可维护性的点。

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

- `tools.ts`：tool 行为编排
- `websocket.ts`：MCP 与扩展通信
- `cleaner.ts`：文本清洗和格式化
- `storage.ts`：本地保存
- `background.ts`：扩展桥接和浏览器 API
- `content.ts`：页面内信息抽取

如果某段逻辑让一个文件同时承担多种职责，移到更合适的位置。
