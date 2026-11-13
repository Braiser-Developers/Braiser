# D-0013 页面识别照搬 Playwright，输出格式自己做

- 状态：有效（未实现）
- 日期：2026-11-13
- 决策者：讨论
- 服务于：
  - 作者预期：[overview.md「observe 改版」](../overview.md)、[overview.md「设计初衷」](../overview.md)
  - 上游决策：[D-0012](0012-internal-cdp.md)

## 背景

2026-11-13 的实测发现，现有 observe 看不到表单当前状态，不进入 shadow DOM 和 iframe，长文字被截断，在 GitHub 页面上还会超时（见 [docs/observe_act.md](../../docs/observe_act.md)）。Playwright 的 AI 快照在页面里用 JS 计算角色、可访问名称和状态，进入 shadow DOM，按 frame 生成，正好覆盖这些缺口（见 [Playwright MCP 资料](../../references/Playwright-MCP.md)）。agent 提出"识别层照搬 Playwright，输出层自己写"，作者回复"可以试试"。

## 决策

把 Playwright 注入脚本中生成无障碍树的代码（`generateAriaTree` 及其依赖的角色、名称、可见性计算和"蒸馏"步骤）连同 Apache-2.0 版权声明一起复制进扩展的 content script，只做必要的修改并注明。Braiser 在这棵树之上自己决定给 Agent 输出什么、以什么格式输出。

## 考虑过、没有采用

- 继续改进自己的 DOM 遍历：要补的规则（可访问名称计算、隐式角色、各种状态）正是 Playwright 已经做好并经过大量网站检验的部分。
- 用 CDP 读取 Chrome 自己算好的无障碍树：每次观察都要挂调试器，Chrome 会显示调试提示条；Playwright 的做法在页面里计算，读取时不需要调试器。
- 直接使用 Playwright 的 YAML 输出：它追求完整，在英文维基上比现有 observe 还大约 26%。

## 代价

- 要维护一份第三方代码副本，升级 Playwright 版本时需要重新复制并核对修改。
- content script 需要打包工具把多个文件合成一个经典脚本。

## 什么时候应该重新考虑

试做结果不好，或者 Playwright 的这部分代码改动频繁、难以跟进时。
