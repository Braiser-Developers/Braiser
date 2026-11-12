# 技术文档

`docs/` 是**技术文档层**：描述当前的做法与已定的技术设计，是派生物，可以随时重写。

- 作者的预期（为什么做、要达到什么）见 [../user-spec/README.md](../user-spec/README.md)；
- 设计依据见 `../user-spec/decisions/`（`D-NNNN`），说明依据时引用对应的决策。
- 做法改了，在同一次（或紧随其后的）提交里同步更新这里。

| 文档 | 内容 |
|---|---|
| [远程访问](remote-access.md) | 启用步骤、凭据、配置、故障定位与验证边界 |
| [当前 MVP 架构](mvp_architecture.md) | 本机/远程链路与能力边界 |
| [文件架构](file_architecture.md) | 模块职责 |
| [Markdown 协议](markdown_pipeline.md) | 既有转换管线 |
| [代码设计规范](code_design_guidelines.md) | 既有规范与新增职责 |
| [材料归位](materials-inventory.md) | 基线材料完整索引与来源边界 |
| [旧定位与展望](project_positioning.md) | 历史材料，本次不作为当前作者预期 |
| [原始备注](todo/realskc_remarks.md) | 原文保留的笔记 |
| [Observe/Act 草稿](todo/browser-agent-dom-mvp-agent-html.md) | 原文保留的历史设计草稿 |
| [远程部署实测](../references/deployment-2026-11-12.md) | 当前远程联调状态和验证边界 |
