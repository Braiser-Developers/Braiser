# 既有材料归位

依据：[D-0008](../user-spec/decisions/0008-user-spec-migration.md)。改造基线是提交 `154537e`，保留原文件路径，下面覆盖基线全部文档与笔记。

| 既有材料 | 归属与处理 |
|---|---|
| [根 README](../README.md) | 项目入口与用法，更新为当前本机/远程模式说明 |
| [文件架构](file_architecture.md) | 技术文档，随新增模块更新 |
| [MVP 架构](mvp_architecture.md) | 技术文档，更新当前链路；既有结构记入 D-0001 |
| [Markdown 协议](markdown_pipeline.md) | 保留技术协议；既有依赖与转换选择记入 D-0009 |
| [代码设计规范](code_design_guidelines.md) | 保留既有规范，补充新增职责边界，不推定为作者原话 |
| [项目定位与展望](project_positioning.md) | 原文原地保留为历史材料，作者已选择本次不迁入愿景/spec |
| [realskc 原始备注](todo/realskc_remarks.md) | 笔记原文原地保留，不覆盖、不推定为当前作者预期 |
| [Observe/Act 设计草稿](todo/browser-agent-dom-mvp-agent-html.md) | 草稿原文原地保留，部分已实现、部分可能过时；当前行为以代码、技术文档及决策为准 |
| [LICENSE](../LICENSE) | 保持原许可证 |

没有将旧文档中的项目愿景当作外部客观事实。项目外的 SSH 手册事实新记入 [OpenSSH 资料](../references/OpenSSH.md)。源代码和配置继续留在各自目录，不移入 user spec。
