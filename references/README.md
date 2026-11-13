# 参考：外部资料

这里记录 Braiser 以外、值得留下来的东西：产品、开源项目、论文、工具，也包括**领域资料**——人物、作品、版本、数据集、某个网站或平台能查到什么，以及其他任何值得参考的东西。工作中搜集到的、值得记录的资料都放进来。

**为什么要记**：换 agent 的时候不用重新查资料，资料还可以越积越多、越来越有用。所以 references 里不能有没标注的错误——错误越积越多，就不一定是正效果了。

**什么时候记**：随查随记。为了做事去查的外部事实也算，不要只留在对话或试验记录里；以后可能还用得上的就记；拿不准值不值得记时也记。发现记错了就改。

每个对象（产品、项目、论文、人物、作品、数据集……）一个 Markdown 文件，直接放在本目录下，文件名就是它的名字（例如 `NumPy.md`）。条目多了可以按类别分目录。

- **资料**：文件名就是它的名字；
- **我们的想法**：文件名用 `<名字>-thoughts.md`。还没有想法时可以没有这个文件。

和它密切相关的条目可以各自成文件，用文件名区分；一个对象有多个资料文件时，用 `<名字>-<主题>.md`。

## 资料

- 调研出来的事实：它是什么、怎么做的、有什么限制、实测表现如何……
- agent 可以自行调研、补充、更正，也可以自行新建。
- 只写事实，不写评价；每条注明来源（链接，或「实测」及怎么测的）；文件开头写最近一次核对的日期——外部的东西会变，资料可能过时。
- 不是直接查到、而是推断出来的，标「推断」；没核对过的，标「待核实」；来源之间有矛盾的，两边都记下来，查清了再写结论。

## 我们的想法

- 对它的看法：有什么值得借鉴、有什么新奇的、能不能为我们所用……
- 和 user spec 一样，**只记作者说的，或者作者明确认可的 agent 的说法**。agent 自己想到的不记；拿不准作者是否认可时，先问。
- 作者认可的 agent 说法，注明「agent 提出，作者认可」。
- 「明确认可」指作者说了「说得好」「有道理」这类表示赞同的话；没有表态不算。
- 某个想法变成了对 Braiser 的具体预期时，写进对应的 spec 文档，并链接回这里。

## 文件

| 对象 | 资料 | 我们的想法 |
|---|---|---|
| OpenSSH | [手册事实与待核实项](OpenSSH.md) | — |
| 2026-11-12 远程部署实测 | [环境、验证结果与边界](deployment-2026-11-12.md) | — |
| 2026-11-13 本机 MCP 客户端接入 | [Codex 与 OpenCode 配置及实测](local-client-integration-2026-11-13.md) | — |
| 2026-11-13 observe 实测 | [自制测试页与维基百科页面的输出](observe-measurement-2026-11-13.md) | — |
| 2026-11-13 浏览器快照 token 实测 | [Braiser、Playwright MCP、Chrome DevTools MCP 对比](browser-snapshot-tokens-2026-11-13.md) | — |
| Claude 的浏览器操作 | [Claude in Chrome、browser use tool、computer use](Claude-browser-tools.md) | — |
| Codex 与 OpenAI 的浏览器操作 | [Codex 应用、CLI 与 API 工具](Codex-browser-tools.md) | — |
| Playwright MCP | [快照格式、省 token 尝试与他人报告](Playwright-MCP.md) | — |
| Chrome DevTools MCP | [快照格式与实测](Chrome-DevTools-MCP.md) | — |
| agent-browser | [精简快照与 token 说法](agent-browser.md) | — |
| browser-use | [页面表示方式](browser-use.md) | — |
| Stagehand | [act/observe/extract](Stagehand.md) | — |
