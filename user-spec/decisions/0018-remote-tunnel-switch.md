# D-0018 远程隧道改为开关，由 daemon 维持

- 状态：有效
- 日期：2026-11-14
- 决策者：讨论
- 服务于：
  - 作者预期：[overview.md「当前远程访问需求」](../overview.md)
  - 上游决策：[D-0002](0002-remote-access.md)、[D-0003](0003-credentials-and-tools.md)
- 取代：[D-0004](0004-foreground-ssh-launcher.md)

## 背景

D-0004 用前台命令管理隧道：终端开着就开放远程访问，关掉就停止，断线后不自动恢复。作者问为什么这不是 daemon 负责的事。agent 说明了当初的理由（远程访问应由作者主动打开；后台无法回答 SSH 提问；没做断线恢复），并提出"开关"方案：设置一次后由 daemon 维持隧道、自动重连，用 disable 关闭。作者同意，并要求先关着，有需要时自己再打开（2026-11-14）。作者的 SSH 已是密钥登录，不需要交互。

## 决策

- `npm run remote -- enable --ssh <目标> [--remote-port 27833] [--ssh-port 22]`：先用 `BatchMode=yes` 检查能否免交互登录，再把设置写入 `~/.braiser/remote.json`（权限 0600），确保 daemon 运行，并请 daemon 按新设置建立隧道。
- `npm run remote -- disable`：把设置改为关闭，daemon 立即断开隧道。`status` 显示设置和隧道状态。
- daemon 启动时读取设置；开启时建立专用的 SSH master 和一条转发（沿用 D-0004 的做法：清除继承的转发、只申请服务器回环地址、确认转发成功才算连上），全程 `BatchMode=yes`，从不提示输入。连接断开后按 2、5、10、30、60 秒的间隔重连，稳定连接超过 60 秒后重新从 2 秒计。重连只恢复转发，不重发任何浏览器动作。
- 开关状态记在文件里，daemon 重启后照旧。daemon 本身仍在本机 Codex/OpenCode 会话或命令需要时启动，不做开机自启（作者没有选择方案 C）。
- 只有 local-token 能查看隧道状态和请求 daemon 重新读取设置（`daemon.tunnel_reload`）；remote-token 看不到也改不了。`braiser.status` 在本机模式下附带隧道状态。
- 原来的 `remote start` 前台命令删除。

## 考虑过、没有采用

- daemon 无条件建立隧道：本机任何会话拉起 daemon 时就开放了远程访问，作者不一定知道。
- 继续用前台命令：需要一直开着终端，断线不能恢复。
- 用 autossh 等外部工具：多一个依赖，状态也无法在 `braiser.status` 里看到。
- 允许密码或主机密钥确认：后台 daemon 没有终端；首次连接新服务器时，先在终端手动 `ssh` 一次即可。

## 代价

- 开关打开期间，服务器上任何持有 remote-token 的进程随时都能操作浏览器（限于浏览、点击、填写、读取）。
- 电脑休眠后，SSH 要等保活超时（约 90 秒）才发现断线，之后才重连。
- 重启电脑后，要等 daemon 被启动后隧道才恢复。

## 什么时候应该重新考虑

需要开机自启、同时连多台服务器、密码登录或 Windows 支持时。
