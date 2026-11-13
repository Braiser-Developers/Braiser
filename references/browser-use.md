# browser-use

最近核对：2026-11-13。

- 0.x 版本：每一步把带编号的 DOM 文本（`[index]<tag>`，编号来自 CDP 的 backend node id，由 DOMSnapshot、DOM 和无障碍树合成）和一张截图交给模型。待核实：二手资料称文本上限 4 万字符。来源：<http://llms-technical-reviews.com:8080/p/browser-use>
- 0.5.0、0.7.10 的系统提示：在 URL 没变的情况下，自上一步以来新出现的可交互元素标成 `*[编号]`，并提示模型"这是你上一步动作造成的变化"，例如输入文字后可能需要从弹出的列表里选一项。来源：<https://github.com/browser-use/browser-use/blob/0.7.10/browser_use/agent/system_prompt.md>
- 1.0 版本改为让模型在持久的 Python REPL 里调用辅助函数和原始 CDP（例如 `bu.click(41)`）；`mode='ultrafast'` 按无障碍树 id 操作。来源：<https://github.com/browser-use/browser-use>
