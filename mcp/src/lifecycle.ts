import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { ClientConfig } from "./config.js";
import { BridgeError, ExtensionBridge } from "./websocket.js";

export async function ensureDaemon(bridge: ExtensionBridge, config: ClientConfig): Promise<void> {
  // D-0002: a disconnected SSH tunnel must never create a daemon on the agent host.
  if (config.mode === "remote") return;
  try {
    const status = await bridge.status();
    if (status.clientMode !== "local") throw new Error("Local mode requires the local-token credential");
    return;
  } catch (error) {
    if (!(error instanceof BridgeError) || error.kind !== "unavailable") throw error;
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL("./daemon.js", import.meta.url))], {
    detached: true, stdio: "ignore", windowsHide: true,
    env: { ...process.env, BRAISER_STATE_DIR: config.stateDir, BRAISER_DAEMON_PORT: new URL(config.url).port || "80" }
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(100);
    if (spawnError) throw spawnError;
    try { await bridge.status(); return; } catch (error) {
      if (!(error instanceof BridgeError) || error.kind !== "unavailable") throw error;
    }
  }
  throw new Error("Braiser daemon did not become ready; check port conflicts and credentials, or start npm run daemon in a terminal");
}
