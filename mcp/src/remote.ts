#!/usr/bin/env node
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clientConfig } from "./config.js";
import { clientToken, readToken } from "./auth.js";
import { ExtensionBridge } from "./websocket.js";
import { ensureDaemon } from "./lifecycle.js";
import { parseRemoteArgs, SshTunnel } from "./ssh-tunnel.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: braiser remote start --ssh <user@host|alias> [--remote-port 27833] [--ssh-port 22]\nRun on the browser host. Keep this terminal open; Ctrl-C closes only this SSH tunnel.\nDefault credentials: ~/.braiser/local-token and ~/.braiser/remote-token. Copy only remote-token to the agent host and configure BRAISER_MODE=remote, BRAISER_TOKEN_FILE and BRAISER_DAEMON_URL.");
    return;
  }
  const options = parseRemoteArgs(args);
  if (process.platform === "win32") throw new Error("The foreground remote launcher currently requires macOS or Linux OpenSSH multiplexing");
  const config = clientConfig();
  if (config.mode !== "local") throw new Error("Run remote start on the browser host with BRAISER_MODE=local");
  const bridge = new ExtensionBridge(config.url, await clientToken(config), config.requestTimeoutMs);
  const tunnel = new SshTunnel(options, Number(new URL(config.url).port || 80));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  let monitor: Promise<void> | undefined;
  try {
    await ensureDaemon(bridge, config);
    controller.signal.throwIfAborted();
    const remoteTokenFile = path.join(config.stateDir, "remote-token");
    const remoteBridge = new ExtensionBridge(config.url, await readToken(remoteTokenFile));
    try {
      if ((await remoteBridge.status()).clientMode !== "remote") throw new Error("Daemon does not recognize the remote credential");
    } finally { remoteBridge.close(); }
    console.log(`本机 daemon 已就绪。远程凭据文件：${remoteTokenFile}（只复制此文件，不要复制 local-token）`);
    console.log("正在建立 SSH 隧道；SSH 可能要求确认主机密钥或登录。");
    await tunnel.start(controller.signal);
    console.log(`SSH 已确认转发：服务器 127.0.0.1:${options.remotePort} → 本机 ${config.url}`);
    console.log("按 Ctrl-C 关闭此次隧道；daemon 保持运行。断线后重新运行本命令，不自动重放浏览器动作。");
    monitor = monitorStatus(bridge, controller.signal);
    const code = await tunnel.wait();
    if (!controller.signal.aborted) throw new Error(`SSH 隧道已断开（退出码 ${code}）；远程访问已停止，请重新运行命令`);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    controller.abort();
    await tunnel.stop(controller.signal);
    bridge.close();
    await monitor;
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

async function monitorStatus(bridge: ExtensionBridge, signal: AbortSignal): Promise<void> {
  let previous = "";
  while (!signal.aborted) {
    let state: string;
    try {
      const status = await bridge.status();
      state = `daemon：在线；Chrome 扩展：${status.extensionConnected ? "已连接" : "未连接，请打开扩展 Bridge 页面"}`;
    } catch { state = "daemon：离线；请检查本机服务"; }
    if (!signal.aborted && state !== previous) { console.log(state); previous = state; }
    try { await delay(5000, undefined, { signal }); } catch { break; }
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
