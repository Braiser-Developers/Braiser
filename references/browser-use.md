# browser-use

最近核对：2026-11-13。

- 0.x 版本：每一步把带编号的 DOM 文本（`[index]<tag>`，编号来自 CDP 的 backend node id，由 DOMSnapshot、DOM 和无障碍树合成）和一张截图交给模型。待核实：二手资料称文本上限 4 万字符。来源：<http://llms-technical-reviews.com:8080/p/browser-use>
- 1.0 版本改为让模型在持久的 Python REPL 里调用辅助函数和原始 CDP（例如 `bu.click(41)`）；`mode='ultrafast'` 按无障碍树 id 操作。来源：<https://github.com/browser-use/browser-use>
