#!/usr/bin/env node
// D-0018: remote access is a switch; the daemon keeps the SSH tunnel up while it is on.
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clientConfig } from "./config.js";
import { clientToken, readToken } from "./auth.js";
import { ExtensionBridge } from "./websocket.js";
import { ensureDaemon } from "./lifecycle.js";
import { checkBatchLogin, parseRemoteCommand, REMOTE_USAGE } from "./ssh-tunnel.js";
import { readRemoteSettings, writeRemoteSettings, type TunnelStatus } from "./tunnel-supervisor.js";
import { latestBuilds, RUNNING_BUILD, versionWarnings } from "./build-info.js";

const HELP = `${REMOTE_USAGE}
Run on the browser host.
  enable   save the SSH target and switch remote access on; the daemon keeps the tunnel up and reconnects
  disable  switch remote access off and close the tunnel
  status   show the saved setting and the tunnel state
Only key-based SSH login without prompts is supported. Copy only ~/.braiser/remote-token to the agent host
and configure BRAISER_MODE=remote, BRAISER_TOKEN_FILE and BRAISER_DAEMON_URL there.`;

function describe(status: TunnelStatus | undefined): string {
  if (!status) return "daemon 未运行";
  const target = status.destination ? `${status.destination}（服务器 127.0.0.1:${status.remotePort}）` : "";
  switch (status.state) {
    case "disabled": return `远程访问已关闭${status.lastError ? `；${status.lastError}` : ""}`;
    case "connecting": return `正在连接 ${target}`;
    case "connected": return `隧道已连接 ${target}，自 ${status.since ? new Date(status.since).toLocaleString() : "刚才"}`;
    case "retrying": return `隧道断开，将自动重连 ${target}；上次错误：${status.lastError ?? "未知"}`;
  }
}

async function daemonStatus(bridge: ExtensionBridge) {
  try { return await bridge.status(); } catch { return undefined; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(HELP); return; }
  const command = parseRemoteCommand(args);
  if (process.platform === "win32") throw new Error("Remote access currently requires macOS or Linux OpenSSH multiplexing");
  const config = clientConfig();
  if (config.mode !== "local") throw new Error("Run remote commands on the browser host with BRAISER_MODE=local");
  const bridge = new ExtensionBridge(config.url, await clientToken(config), config.requestTimeoutMs);
  try {
    if (command.command === "status") {
      const settings = await readRemoteSettings(config.stateDir);
      const status = await daemonStatus(bridge);
      console.log(`设置：${settings.enabled ? "开启" : "关闭"}${settings.destination ? `，目标 ${settings.destination}` : ""}`);
      console.log(`状态：${status ? describe(status.tunnel) : "daemon 未运行"}`);
      if (status) {
        console.log(`Chrome 扩展：${status.extensionConnected ? "已连接" : "未连接，请打开扩展 Bridge 页面"}`);
        for (const warning of versionWarnings(status.versions, RUNNING_BUILD, latestBuilds().mcp, "local", status.extensionConnected)) console.log(`注意：${warning}`);
      }
      return;
    }

    if (command.command === "disable") {
      const settings = await readRemoteSettings(config.stateDir);
      await writeRemoteSettings(config.stateDir, { ...settings, enabled: false });
      const status = await daemonStatus(bridge);
      if (!status) { console.log("远程访问已关闭（daemon 未运行）"); return; }
      try {
        console.log(describe(await bridge.reloadTunnel()));
      } catch {
        console.log("远程访问已关闭（运行中的 daemon 是旧版本，不管理隧道）");
      }
      return;
    }

    const { options } = command;
    console.log(`检查能否免交互登录 ${options.destination} ...`);
    try {
      await checkBatchLogin(options);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n先在终端运行 ssh ${options.destination}，确认主机密钥并配置密钥登录后再试。`);
    }
    await writeRemoteSettings(config.stateDir, { enabled: true, ...options });
    await ensureDaemon(bridge, config);
    const remoteTokenFile = path.join(config.stateDir, "remote-token");
    const remoteBridge = new ExtensionBridge(config.url, await readToken(remoteTokenFile));
    try {
      if ((await remoteBridge.status()).clientMode !== "remote") throw new Error("Daemon does not recognize the remote credential");
    } finally { remoteBridge.close(); }
    let status: TunnelStatus;
    try {
      status = await bridge.reloadTunnel();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}；运行中的 daemon 可能是旧版本，请重启 daemon 后再试`);
    }
    for (let i = 0; i < 60 && status.state === "connecting"; i++) {
      await delay(500);
      status = (await bridge.status()).tunnel ?? status;
    }
    console.log(describe(status));
    console.log(`远程凭据文件：${remoteTokenFile}（只复制此文件，不要复制 local-token）`);
    if (!(await bridge.status()).extensionConnected) console.log("Chrome 扩展未连接，请从扩展弹窗打开 Bridge 页面");
    if (status.state !== "connected") process.exitCode = 1;
  } finally {
    bridge.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
