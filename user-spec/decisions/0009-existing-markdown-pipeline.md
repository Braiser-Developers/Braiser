# D-0009 保留既有 Markdown 转换依赖与执行位置

- 状态：有效
- 日期：2026-11-12
- 决策者：agent
- 服务于：[作者预期](../overview.md)、[D-0002](0002-remote-access.md)

## 背景

现状来自改造前提交 `154537e` 和 [Markdown 协议](../../docs/markdown_pipeline.md)。历史说明将转换依赖设为必需，并固定 MarkItDown 版本以兼容自定义 converter；更早的选择理由不清楚。

## 决策

保留项目本地 Python 环境、MarkItDown 0.1.5、BeautifulSoup 4.14.3 和 KaTeX 预处理。page.extract_readable_text 继续返回 Markdown，在 MCP 所在机器转换；因此远程 Linux 也需要准备 Python 依赖。临时文件在 Linux 清理，不提供远程保存页面工具。

## 考虑过、没有采用

远程读取改成另一种文本格式或把转换搬入 daemon：会引入额外语义差异，本次无此需求。

## 代价

读取 Markdown 仍需传输 DOM 和运行 Python；observe/act 不调用转换管线，但标准安装仍按既有规则准备依赖。

## 什么时候应该重新考虑

DOM 传输量或 Python 环境成为实际瓶颈时。
