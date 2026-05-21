# Browser Agent DOM MVP: Agent-HTML Observe/Act Protocol

## 1. 背景与目标

本 MVP 的目标是把当前浏览器页面的复杂 DOM 压缩成一份适合 LLM 阅读和选择的 **agent-html**，让 LLM 可以通过标号选择页面上的交互元素，并由浏览器插件执行真实交互。

核心思想：

- 插件负责观察页面、压缩 DOM、标号可交互元素。
- LLM 只阅读压缩后的类 HTML。
- LLM 不写 CSS selector，不直接操作 DOM。
- LLM 只选择 `data-eid` 对应的元素，并指定动作。
- 插件根据内部 registry 找回真实 DOM 元素并执行动作。
- 每次动作后重新 observe，生成新的页面快照。

本 MVP 追求极简可用，不追求完整语义理解。

---

## 2. MVP 范围

### 2.1 要做的事

实现两个核心能力：

1. `browser.observe`
   - 从当前页面提取可见交互元素。
   - 保留这些元素的有意义祖先。
   - 输出压缩后的 agent-html。
   - 给每个可操作元素添加 `data-eid`。
   - 维护 `snapshotId + elementId -> DOM Element` 的内部映射。

2. `browser.act`
   - 接收 LLM 选择的 `snapshotId`、`elementId` 和动作。
   - 定位对应 DOM 元素。
   - 执行点击、输入、选择等基础交互。
   - 返回执行结果。
   - 提示调用方重新 observe。

### 2.2 暂时不做的事

本 MVP 明确不做以下功能：

- 不做祖先评分规则。
- 不做复杂 accessible name 推断。
- 不做 `nearbyText`、`parentText`、自动命名增强。
- 不输出 action hints。
- 不输出 JSON 语义树。
- 不分析 React/Vue 等框架绑定的 JS。
- 不读取元素上的真实事件监听器。
- 不做复杂视觉理解。
- 不做截图 overlay。
- 不做跨页面长期记忆。
- 不做复杂 iframe 支持，除非实现成本很低。
- 不保证覆盖所有低置信度自定义交互元素。

---

## 3. 核心输出格式：agent-html

`browser.observe` 的主体输出是一段类 HTML 字符串，而不是 JSON 树。

外层 API 可以仍然用 JSON 包装，但页面结构本体使用 HTML-like 格式。

示例：

```json
{
  "snapshotId": "S1",
  "format": "agent-html",
  "html": "<page snapshot=\"S1\" title=\"Example\" url=\"https://example.com\">...</page>"
}
```

agent-html 的目标不是还原完整 DOM，而是提供一份 LLM 友好的最小页面表示。

---

## 4. agent-html 设计原则

### 4.1 保留

agent-html 应保留：

- 页面标题。
- 页面 URL。
- 主要语义区域。
- 有意义祖先结构。
- 可见可交互元素。
- 交互元素的原始标签。
- 交互元素的关键属性。
- 交互元素的简短文本。
- 每个可操作元素的 `data-eid`。

### 4.2 删除

agent-html 应删除：

- `script`
- `style`
- `link`
- `meta`
- `svg`
- `path`
- 大部分无意义 `div`
- 大部分无意义 `span`
- `class`
- `style`
- 纯布局 wrapper
- 隐藏节点
- 长文本内容
- 重复噪音节点

### 4.3 不做额外解释

agent-html 不应该加入过多自造解释。尽量保留原始 DOM 的语义和文本，让 LLM 自己判断。

---

## 5. 可交互元素范围

MVP 只需要覆盖高价值、常见、稳定的交互元素。

应识别以下元素为可操作候选：

- `a[href]`
- `button`
- `input`，排除 `type="hidden"`
- `textarea`
- `select`
- `summary`
- `[contenteditable="true"]`
- `[role="button"]`
- `[role="link"]`
- `[role="textbox"]`
- `[role="checkbox"]`
- `[role="radio"]`
- `[role="menuitem"]`
- `[role="tab"]`
- `[tabindex="0"]`
- `[aria-haspopup]`
- `[aria-expanded]`
- `[onclick]`

MVP 可以先不使用 `cursor: pointer` 作为候选来源，以减少误判。

---

## 6. 有意义祖先规则

MVP 不使用评分系统，只使用简单白名单规则。

### 6.1 保留的语义标签

以下祖先标签应被保留：

- `header`
- `nav`
- `main`
- `aside`
- `footer`
- `section`
- `article`
- `form`
- `dialog`
- `menu`
- `ul`
- `ol`
- `li`
- `table`
- `thead`
- `tbody`
- `tr`
- `td`
- `th`
- `fieldset`

### 6.2 保留的语义属性

带有以下属性的祖先应被保留：

- `role`
- `aria-label`
- `aria-labelledby`
- `data-testid`

### 6.3 丢弃规则

如果祖先既不是语义标签，也不带上述语义属性，则默认丢弃。

如果一个容器最终不包含任何可操作元素，也应从 agent-html 中删除，除非它是当前可见 dialog、alert 或明显的状态提示区域。

---

## 7. 属性保留规则

序列化到 agent-html 时，只保留少量关键属性。

建议保留：

- `data-eid`
- `href`
- `type`
- `role`
- `aria-label`
- `aria-labelledby`
- `aria-expanded`
- `aria-checked`
- `aria-selected`
- `aria-haspopup`
- `placeholder`
- `title`
- `alt`
- `value`
- `disabled`
- `contenteditable`
- `data-testid`

不要保留：

- `class`
- `style`
- `onclick`
- `onmousedown`
- `onmouseup`
- `onkeydown`
- framework-specific internal attributes
- long serialized datasets

`onclick` 可用于判断元素是否为交互元素，但不应输出到 agent-html，避免把页面脚本内容暴露给 LLM。

---

## 8. 文本保留规则

MVP 不做复杂命名推断，但需要保留元素自身可见文本。

要求：

- 保留按钮、链接、label、菜单项等元素的简短文本。
- 纯文本内容过长时截断。
- 每个文本片段应有长度上限。
- 页面大段文章正文不应完整输出，除非它是判断交互所必需的上下文。
- SVG 图标内容不应输出。
- 空白文本应压缩。

文本目标是辅助 LLM 识别元素，而不是完整抽取网页正文。

---

## 9. 元素编号规则

每次 observe 都生成一个新的 `snapshotId`。

每个可操作元素分配一个短标号：

- `E1`
- `E2`
- `E3`
- ...

编号只在当前 snapshot 内有效。

agent-html 中只有带 `data-eid` 的元素可以被 LLM 操作。

示例：

```html
<button data-eid="E2" aria-label="分享">分享</button>
```

容器节点不需要编号。

---

## 10. 内部 Registry

插件内部必须维护 registry：

```text
snapshotId + elementId -> real DOM Element
```

LLM 不需要知道 selector。

执行动作时，插件通过 `snapshotId` 和 `elementId` 找到真实 DOM 元素。

如果元素不存在、已被移除或页面变化导致映射失效，应返回 stale element 错误，并要求重新 observe。

---

## 11. Observe 行为

`browser.observe` 的输出应包含：

- `snapshotId`
- `format`
- `html`

推荐外层结构：

```json
{
  "snapshotId": "S1",
  "format": "agent-html",
  "html": "<page snapshot=\"S1\" title=\"...\" url=\"...\">...</page>",
  "meta": {
    "elementCount": 42,
    "truncated": false
  }
}
```

### 11.1 页面根节点

agent-html 应始终以 `<page>` 为根节点。

`<page>` 至少包含：

- `snapshot`
- `title`
- `url`

示例：

```html
<page snapshot="S1" title="ChatGPT - Braiser" url="https://chatgpt.com/...">
  ...
</page>
```

### 11.2 输出模式

MVP 默认只输出可见元素。

后续可以扩展：

- visible only
- all DOM
- current viewport only
- query filtered
- region filtered

但 MVP 只需要一个默认观察模式即可。

---

## 12. Act 行为

`browser.act` 接收结构化参数。

### 12.1 点击

```json
{
  "snapshotId": "S1",
  "elementId": "E2",
  "action": "click"
}
```

### 12.2 输入文本

```json
{
  "snapshotId": "S1",
  "elementId": "E12",
  "action": "input-text",
  "text": "hello",
  "clearFirst": true
}
```

### 12.3 选择选项

```json
{
  "snapshotId": "S1",
  "elementId": "E8",
  "action": "select-option",
  "value": "option-value"
}
```

### 12.4 勾选 / 切换

```json
{
  "snapshotId": "S1",
  "elementId": "E5",
  "action": "toggle",
  "checked": true
}
```

### 12.5 最小动作集合

MVP 至少支持：

- `click`
- `input-text`

如果实现成本不高，可以同时支持：

- `select-option`
- `toggle`
- `focus`
- `scroll-into-view`

---

## 13. Act 返回格式

成功：

```json
{
  "ok": true,
  "message": "Action executed",
  "shouldObserveAgain": true
}
```

失败：

```json
{
  "ok": false,
  "error": "stale_element",
  "message": "Element E12 no longer exists. Please call browser.observe again."
}
```

常见错误类型：

- `stale_element`
- `element_not_found`
- `element_disabled`
- `element_not_visible`
- `unsupported_action`
- `invalid_snapshot`
- `execution_failed`

---

## 14. 动作后的重新观察

每次 `browser.act` 后，调用方都应该重新执行 `browser.observe`。

原因：

- DOM 可能变化。
- 菜单可能打开。
- 弹窗可能出现。
- 按钮状态可能改变。
- 输入后发送按钮可能从 disabled 变为 enabled。
- 页面导航可能发生。

MVP 不需要自动把新的 observe 内联到 act 返回中，但可以返回：

```json
{
  "shouldObserveAgain": true
}
```

---

## 15. LLM 使用协议

给 LLM 的规则应保持简单：

```text
你会收到一段 agent-html。
只有带 data-eid 的元素可以被操作。
不要自己编 CSS selector。
根据标签、文本、aria-label、placeholder、href 和父级上下文选择目标元素。
输出 snapshotId、elementId 和 action。
每次动作后重新观察页面。
```

LLM 不需要理解内部 DOM registry。

---

## 16. 示例 agent-html

```html
<page snapshot="S1" title="ChatGPT - Braiser" url="https://chatgpt.com/...">
  <header>
    <a data-eid="E1" href="/g/g-p-xxx/project" aria-label="打开“Braiser”项目">Braiser</a>
    <button data-eid="E2" aria-label="分享">分享</button>
    <button data-eid="E3" aria-label="打开对话选项"></button>
  </header>

  <aside aria-label="历史聊天记录">
    <nav aria-label="历史聊天记录">
      <a data-eid="E4" href="/">新聊天</a>
      <button data-eid="E5">搜索聊天</button>

      <section>
        <ul>
          <li>
            <a data-eid="E6" href="/g/g-p-xxx/project">Braiser</a>
            <button data-eid="E7" aria-label="打开 Braiser 的项目选项"></button>
          </li>

          <li>
            <a data-eid="E8" href="/g/g-p-xxx/c/xxx">MCP Server 结构解析</a>
            <button data-eid="E9" aria-label="打开“MCP Server 结构解析”的对话选项"></button>
          </li>
        </ul>
      </section>
    </nav>
  </aside>

  <main>
    <section data-testid="conversation-turn-4">
      <article>
        <p>你这里问的是 MCP 里的 Prompt...</p>
        <button data-eid="E10" aria-label="复制回复"></button>
        <button data-eid="E11" aria-label="更多操作"></button>
      </article>
    </section>

    <form aria-label="Composer">
      <div data-eid="E12" role="textbox" contenteditable="true" aria-label="与 ChatGPT 聊天"></div>
      <button data-eid="E13" aria-label="添加文件等"></button>
      <button data-eid="E14" aria-label="开始听写"></button>
      <button data-eid="E15" aria-label="启动语音功能"></button>
    </form>
  </main>
</page>
```

---

## 17. 实现约束

Codex 实现时应遵守以下约束：

- 不要让 LLM 直接接触真实 DOM selector。
- 不要把完整网页 HTML 原样返回。
- 不要输出大量样式、脚本或 SVG。
- 不要暴露页面 JS 代码。
- 不要默认返回隐藏菜单和隐藏弹窗中的元素。
- 不要把 `data-eid` 持久化到业务 DOM 中，除非能确保不会影响页面。
- 不要依赖页面框架内部实现。
- 不要假设 React/Vue 事件可以被读取。
- 不要为了追求全量覆盖牺牲输出清晰度。

---

## 18. 验收标准

MVP 完成后，应满足以下标准：

1. 在普通网页上，`browser.observe` 能返回一段可读的 agent-html。
2. agent-html 中只包含压缩后的语义结构和可交互元素。
3. 每个可操作元素都有唯一 `data-eid`。
4. LLM 可以根据 agent-html 判断要点击或输入哪个元素。
5. `browser.act` 可以根据 `data-eid` 点击按钮或链接。
6. `browser.act` 可以向普通 input、textarea、contenteditable 输入文本。
7. 动作后可以重新 observe，并得到新的 snapshot。
8. 如果元素失效，能返回明确错误。
9. 输出不会被 class/style/svg/script 噪音淹没。
10. 对包含大量重复按钮的页面，agent-html 至少能保留基本父级上下文，例如 list item、nav、main、form。

---

## 19. 推荐后续扩展，但不属于 MVP

后续可以逐步加入：

- action hints
- accessible name 增强
- nearby text
- ancestor scoring
- role/name/path 索引
- screenshot overlay
- query-based observe
- region-based observe
- shadow DOM 支持
- iframe 支持
- stale element fallback locator
- token budget optimizer
- interaction replay log
- page memory

这些都不应阻塞 MVP。

---

## 20. 最终一句话

本 MVP 要实现的是：

```text
把当前 DOM 压缩成带 data-eid 的 agent-html；
LLM 通过 data-eid 选择元素；
插件根据内部 registry 执行真实浏览器交互。
```

这版不追求完美语义，只追求足够简单、足够稳定、足够容易让 LLM 使用。
