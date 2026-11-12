# OpenSSH

最近核对：2026-11-12。

来源：本机 OpenSSH_10.3p1 的 `ssh(1)`、`ssh_config(5)`、`sshd_config(5)` 手册，通过 `man` 读取。远程服务端实际配置尚未查询。

| 已核对事实 | 出处 |
|---|---|
| `-R [bind_address:]port:host:hostport` 在服务器监听并转发到 SSH 客户端侧目标 | ssh(1)，-R |
| `-N` 不执行远程命令，`-T` 不分配伪终端 | ssh(1)，-N、-T |
| `-O check` 检查 master，`-O forward` 请求转发 | ssh(1)，-O |
| `ExitOnForwardFailure` 检测转发建立失败，但不检测最终目标连接失败 | ssh_config(5)，ExitOnForwardFailure |
| `ClearAllForwardings=yes` 会清除配置文件和命令行指定的转发 | ssh_config(5)，ClearAllForwardings |
| `ControlPersist=no` 不在原始连接结束后保持后台 master | ssh_config(5)，ControlPersist |
| `-F` 指定独立配置文件；`-S` 指定控制 socket | ssh(1)，-F、-S |
| `GatewayPorts no` 限制回环，`yes` 强制通配监听，`clientspecified` 允许客户端指定地址 | sshd_config(5)，GatewayPorts |
| `AllowTcpForwarding` 可允许全部、仅本地、仅远程或禁用转发；`PermitListen` 可限制监听地址和端口 | sshd_config(5)，同名项 |

待核实：作者服务器是否允许远程 TCP 转发、是否限制 PermitListen、GatewayPorts 的实际值、目标端口占用情况。本次没有建立真实 SSH 连接。

推断：即使转发只监听服务器回环地址，同主机其他进程仍可能访问 TCP 端口，因此应用认证仍有作用。不是按操作系统账号隔离的端口。
