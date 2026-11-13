# D-0012 Braiser 内部可以使用 CDP，Agent 只用固定动作

- 状态：有效
- 日期：2026-11-13
- 决策者：作者
- 服务于：
  - 作者预期：[overview.md「设计初衷」](../overview.md)

## 背景

设计初衷里写着"不使用 JS 或 CDP"。这句话可以理解成两种意思：Agent 不需要写 JS、不需要调 CDP；或者 Braiser 内部也不用 CDP。Braiser 现在内部已经用 CDP 发现可点击元素、设置上传文件。agent 问作者指哪一种，作者确认是前一种（2026-11-13）。

## 决策

对 Agent 只暴露 Braiser 定义的固定动作，不要求 Agent 写 JS 或调用 CDP。Braiser 内部实现可以使用 CDP，例如发送真实的点击和输入事件、读取 Chrome 计算好的无障碍树、进入 iframe。现有的 `debug.inject_js`、`debug.cdp_command` 仍然只用于调试。

## 代价

扩展需要 `debugger` 权限，使用时 Chrome 会显示正在被调试的提示条（推断，现有实现已经如此）。

## 什么时候应该重新考虑

作者改变对"简单操作"的理解，或者 CDP 带来的提示条、权限、稳定性问题影响使用时。
