# HTML Normalization 与 Markdown Conversion 协议

本文档定义“当前网页运行时 DOM -> Markdown”的本地接口协议。CLI 和未来 MCP tool
都应该复用同一套协议，不应在其他层重新实现 KaTeX 或 MarkItDown 处理逻辑。

## 依赖协议

Markdown conversion 使用项目本地 Python 虚拟环境 `.venv-markdown/`。安装命令：

```powershell
npm run setup:markdown
```

Python 依赖固定写在 `requirements-markdown.txt`：

```text
markitdown==0.1.5
beautifulsoup4==4.14.3
```

`markitdown==0.1.5` 是有意固定的版本，因为
`scripts/markitdown-braiser.py` 继承了 MarkItDown 的 HTML converter 和 markdownify
adapter。升级 MarkItDown 前，必须先检查 wrapper 是否仍兼容新版内部 API。

`beautifulsoup4==4.14.3` 是显式直接依赖。虽然 MarkItDown 也会间接安装
BeautifulSoup，但 Braiser 自己的 HTML normalization 脚本直接 import `bs4`，
因此依赖文件里必须直接声明。

## Stage 1: HTML Normalization

可执行接口：

```powershell
python scripts/preprocess-markdown-html.py input.html output.html
```

输入：

- UTF-8 HTML。
- 内容来源是当前页面运行时 DOM。
- 当前 CLI 使用 `page.extract_readable_text.html` 作为 HTML 来源。

输出：

- UTF-8 normalized HTML。
- 非 KaTeX 内容保留为普通 HTML。
- 带有原始 LaTeX annotation 的 KaTeX 节点会被替换为 Braiser 标记的数学节点。
- 没有 `annotation[encoding="application/x-tex"]` 的 KaTeX 节点保持不变。
- 空 annotation 会被忽略。
- 对已经 normalization 过的 HTML 再执行一次应当是无害的，因为输出中已经没有原始 KaTeX wrapper 节点。

Display math 规则：

- 来源 selector：`.katex-display`
- 来源 annotation：后代 `annotation[encoding="application/x-tex"]`
- 替换结果：

```html
<div
  class="braiser-markdown-math braiser-markdown-math-display"
  data-braiser-source="katex"
>$$
latex source
$$</div>
```

Inline math 规则：

- 来源 selector：`.katex`
- 排除规则：跳过位于 `.katex-display` 内部的 `.katex`
- 来源 annotation：后代 `annotation[encoding="application/x-tex"]`
- 替换结果：

```html
<span
  class="braiser-markdown-math braiser-markdown-math-inline"
  data-braiser-source="katex"
>$latex source$</span>
```

以下 class 属于协议字段：

- `braiser-markdown-math`
- `braiser-markdown-math-display`
- `braiser-markdown-math-inline`

`data-braiser-source="katex"` 用于记录替换来源，属于诊断元数据；实际 conversion
行为以 class 为准。

## Stage 2: Markdown Conversion

可执行接口：

```powershell
python scripts/markitdown-braiser.py input.html output.md
```

输入：

- Stage 1 生成的 UTF-8 normalized HTML。

输出：

- UTF-8 Markdown。

转换协议：

- 带 `braiser-markdown-math-display` 的 HTML 节点按 raw text content 输出。
- 带 `braiser-markdown-math-inline` 的 HTML 节点按 raw text content 输出。
- raw text content 使用 `get_text("", strip=False)` 读取，因此 `_`、`{}`、`\`
  等数学字符不会经过 markdownify 的普通文本转义。
- 其他 HTML 继续遵循固定版本 MarkItDown 0.1.5 的 HTML conversion 行为。

例如 normalized HTML：

```html
<div class="braiser-markdown-math braiser-markdown-math-display">$$
u_1u_2,\quad v_1v_2
$$</div>
```

必须转换为：

```md
$$
u_1u_2,\quad v_1v_2
$$
```

而不是：

```md
$$
u\_1u\_2,\quad v\_1v\_2
$$
```

## CLI 协议

`npm run download:markdown` 执行完整 pipeline：

```text
current DOM HTML
  -> scripts/preprocess-markdown-html.py
  -> scripts/markitdown-braiser.py
  -> downloads/<timestamp>-<page>-runtime-dom.md
```

中间 HTML 文件是临时文件，无论成功还是失败都应被清理。

`npm run download:preprocessed-html` 只执行 Stage 1，并写入：

```text
downloads/<timestamp>-<page>-runtime-dom-preprocessed.html
```

这个命令用于调试 normalization 结果。只要数学处理协议仍在演进，就应该保留这个入口。

## 职责边界

- `mcp/src/cli.ts` 负责编排 pipeline 和生成文件名。
- `scripts/preprocess-markdown-html.py` 负责 HTML normalization。
- `scripts/markitdown-braiser.py` 负责 MarkItDown 集成和数学节点 conversion。
- 未来暴露给 MCP 的 Markdown tool 应调用同一条 normalization/conversion 路径，不应在
  `tools.ts`、`background.ts` 或 `content.ts` 内重新实现。
