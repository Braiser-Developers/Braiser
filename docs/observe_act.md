# 页面观察、操作与正文读取

设计依据：[D-0013](../user-spec/decisions/0013-playwright-recognition-layer.md)（识别照搬 Playwright）、[D-0016](../user-spec/decisions/0016-observe-output-format.md)（输出格式与 iframe）、[D-0017](../user-spec/decisions/0017-lossless-snapshot-compaction.md)（无损压缩）、[D-0014](../user-spec/decisions/0014-lean-action-result.md)（动作结果）。改动 [snapshot.ts](../extension/src/observe/snapshot.ts)、[render.ts](../extension/src/observe/render.ts) 或 [frames.ts](../extension/src/observe/frames.ts) 时，同步更新本文。

## 链路

1. background 找到 Braised 标签组的焦点页面，先在所有 frame 里探测 content script，只给缺少的 frame 注入 `dist/content.js`（esbuild 打包的经典脚本，见 [D-0015](../user-spec/decisions/0015-extension-bundling-and-e2e.md)）。
2. background 告诉每个 frame 它自己的 frame id，然后向每个 frame 发 observe。所有发往 content script 的消息都指定 `frameId`。
3. 每个 frame 用 Playwright 的 `generateAriaTree(document.body, { mode: "ai" })` 生成无障碍树，再由 [render.ts](../extension/src/observe/render.ts) 渲染。遇到 iframe 时，父 frame 通过 postMessage 询问子窗口的 frame id（[frames.ts](../extension/src/observe/frames.ts)），在输出里留占位符。
4. background 把各 frame 的输出按占位符拼接，记录本次快照的编号和 frame 前缀（存在 `chrome.storage.session`，service worker 重启后仍可用），返回 `{ snapshotId, format: "braiser-aria", text, meta }`。

## 识别层（Playwright v1.65.0）

代码在 `extension/src/vendor/playwright/`（入口 [ariaSnapshot.ts](../extension/src/vendor/playwright/injected/ariaSnapshot.ts)），由 `npm run vendor:playwright` 复制，只改了 import 路径。行为要点（详见 [Playwright MCP 资料](../references/Playwright-MCP.md)）：

- 按 ARIA 规范计算角色和可访问名称（`<label for>`、aria-label、alt、内容文字等）。
- 记录 checked、disabled、expanded、invalid、level、pressed、selected、active 等状态；输入框和文本框的当前值作为文字。
- 进入 shadow DOM 和 slot；对无障碍树可见或视觉可见的元素都保留。
- 给可见且能接收指针事件的元素分配内部 ref，并记录光标是否为指针。

## 输出格式

```text
- page "API Tokens" → https://example.com/settings/tokens
- url alias: ~ = /settings/tokens
- main:
  - heading "Create API token" [level=1]
  - paragraph: Tokens expire after [30 days](E3 /docs/expiry) by default.
  - textbox "Token name" [E4]: my token
  - checkbox "Read access" [checked] [E5]
  - combobox "Expiration" [E6]:
    - option "7 days"
    - option "30 days" [selected]
  - button "Create token" [E7]
  - table "Existing tokens":
    - row [header]: Name | Created | Actions
    - row: ci-bot | 2026-10-01 | [Revoke](E8 button) [Details](E9 ~/1)
  - iframe "Captcha":
    - button "I'm not a robot" [F1E1]
- hidden file inputs:
  - file input [E10] accept=".pem"
```

- 编号只给可操作元素：交互角色，以及最外层带指针光标的元素。iframe 内编号带 `F1` 这样的前缀。
- 文字全部保留；含文字的段落写成一行，行内链接为 `[文字](编号 网址)`，非链接的可操作元素在编号后注明角色。
- 网址总在行尾。同源网址只写路径，本页锚点只写 `#锚点`；非 ASCII 字符的转义显示成原字符，保留字符、空白和控制字符保持转义（无损）。
- 只重复链接、按钮名称的内部文字不再展开。
- 无损压缩（D-0017）：没有尺寸、只靠 title 得到名称的 generic 节点（如维基的 COinS 引用元数据）不输出；主 frame 里以本页路径开头的网址写成 `~/...`；16 字符以上的网址重复出现时写成 `=E12`，以前面网址结尾的网址把结尾写成 `=E12`；简单表格行写成 `a | b | c`，rowgroup 不单独占行；只包一个行内子元素的节点写成一行。
- 整份快照超过 30 万字符时截断，`meta.truncated` 为 true。

## browser.act

1. background 按编号前缀找到 frame，确认快照编号是当前的、目标页面仍是焦点页面。
2. 动作前在所有 frame 收集一份"角色 + 名称"清单。
3. 目标 frame 执行动作：确认元素仍在文档中（含 shadow DOM）、可见、未禁用。

| 动作 | 实现 |
|---|---|
| `click` | `HTMLElement.click()` |
| `input-text` | input/textarea 设置 `value`，contenteditable 设置 `textContent`；`clearFirst` 默认 true；随后派发 `input` 和 `change` |
| `select-option` | 按选项的值或显示文字选择，派发 `input` 和 `change` |
| `toggle` | checkbox/radio 设置 `checked`（不传则取反）并派发事件；其他元素 `click()` |
| `focus` | `focus()` |
| `scroll-into-view` | `scrollIntoView({ block: "center", inline: "center" })` |

4. 等待约 0.4 秒；页面在加载就继续等到加载完（最多 10 秒）。期间记录新开的标签页和开始的下载。
5. 再收集一次清单，返回：

```json
{ "ok": true, "snapshotValid": true,
  "changes": { "added": ["button \"Confirm\"", "button \"Cancel\""], "addedCount": 2 } }
```

`changes` 可能包含 `navigated`、`url`、`title`、`newTabs`、`downloads`、`added`/`removed`（各最多 15 条）及总数。页面换成新文档时只报告跳转，`snapshotValid` 为 false。不返回任何页面文字。

## browser.upload

按快照编号在各 frame 的 content script 隔离环境里找到文件输入框，通过 CDP `DOM.setFileInputFiles` 设置文件。主 frame 和同进程的 iframe 可用。

## page.extract_readable_text

只读主 frame：content script 返回 `document.documentElement.outerHTML`，MCP 所在主机按 [Markdown 协议](markdown_pipeline.md) 转成 Markdown，不截断，没有元素编号。

## 当前局限

- 动作是合成事件（`isTrusted=false`），部分网站不响应；富文本编辑器通常不认直接改写的 `textContent`（推断，未实测）。
- 没有交互角色、也没设指针光标的 JS 可点击元素拿不到编号。
- 浏览器原生对话框（alert、confirm）会阻塞页面，动作结果无法报告。
- 跨源 iframe 里的文件输入框无法上传。
- 正文读取不包含 iframe 和 shadow DOM 内容，也不经过 CSS 计算（推断，未实测）。
- 体积：2026-11-13 在测试 Chromium 中，英文维基约 14.8k token、中文维基约 11.0k、GitHub 仓库页约 9.5k（o200k 分词器）。维基剩下的大头是参考文献的可见正文，GitHub 是 README 和文件列表。见 [2026-11-13 浏览器快照 token 实测](../references/browser-snapshot-tokens-2026-11-13.md)。

## 测试

- `npm test` 包含 [render.test.mjs](../extension/test/render.test.mjs)：渲染格式、编号规则、行内处理、清单比较。
- `npm run test:e2e` 运行 [observe.e2e.mjs](../mcp/test/e2e/observe.e2e.mjs)：在 Chromium 里加载扩展，经真实 daemon 验证表单当前值、shadow DOM、iframe、长文字、动作结果、上传和跳转。需要先 `npx playwright-core install chromium`。
