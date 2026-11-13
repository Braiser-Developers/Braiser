# D-0004 用前台入口管理一条独立 SSH 隧道

- 状态：已取代（→ [D-0018](0018-remote-tunnel-switch.md)）
- 日期：2026-11-12
- 决策者：agent
- 服务于：[作者预期](../overview.md)、[D-0002](0002-remote-access.md)

## 背景

作者询问是否开启 daemon 时建立隧道，并认可一个启动入口、分开管理进程的方案。

## 决策

新增 npm run remote -- start --ssh <目标>。依次准备 daemon、核验远程凭据、建立专用 SSH ControlMaster、用 -O forward 获取转发确认后报告就绪。master 清除继承的转发，控制命令不读取 SSH 配置，避免意外转发。保留正常 SSH 登录与主机密钥校验。前台处理 SIGINT/SIGTERM，结束时只终止本入口的 SSH 子进程并清理私有控制 socket，daemon 保留。显示连接状态变化；断线退出并提示重新运行，不自动重连。首版启动器支持 macOS/Linux。

## 考虑过、没有采用

- spawn ssh 就宣告成功：子进程启动不代表远程端口绑定成功。
- 后台常驻/autossh：超出本次前台入口范围。
- 复用作者现有 SSH master：退出可能影响已有连接。

## 代价

依赖 OpenSSH multiplexing；登录等待最多 120 秒，端口确认最多 15 秒；远程 sshd 策略需实际启用时验证。SSH 成功绑定不等于浏览器已连接，入口另外显示 daemon 和扩展状态。

## 什么时候应该重新考虑

需要后台托管、Windows 启动器或自动恢复时。
