# D-0001 保留既有浏览器桥接与 Observe/Act 架构

- 状态：部分被取代（→ [D-0016](0016-observe-output-format.md)）：observe 的页面表示（agent-html）和 CDP 可点击补充
- 日期：2026-11-12
- 决策者：agent
- 服务于：[作者预期](../overview.md)

## 背景

现状来自改造前提交 `154537e`、旧架构文档和代码。历史文档称拆分 daemon 是为避免多个 MCP 争抢端口；其余当时的理由不清楚。

## 决策

保留 TypeScript MCP stdio → 本地 daemon → Chrome Bridge → content script 的结构，继续使用 Braised 标签组的共享焦点以及 snapshotId/elementId registry。此次不修改扩展协议和页面交互实现。职责边界遵循原[代码设计规范](../../docs/code_design_guidelines.md)。

## 考虑过、没有采用

重写扩展或换成坐标操作：本次跨机器连接需求不要求这些改动。

## 代价

多个 Agent 共享焦点与快照，首版按单 Agent 操作使用；并发隔离以后另作决策。

## 什么时候应该重新考虑

需要并发操作、多浏览器或现有页面表示无法满足任务时。
