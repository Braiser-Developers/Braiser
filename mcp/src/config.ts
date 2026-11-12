import { homedir } from "node:os";
import path from "node:path";

export type Mode = "local" | "remote";
export interface ClientConfig {
  mode: Mode;
  url: string;
  stateDir: string;
  tokenFile?: string;
  token?: string;
  requestTimeoutMs: number;
}

export function portNumber(value: string, name: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(value);
}

// D-0002: remote means a loopback SSH forwarding endpoint, never a local daemon fallback.
export function clientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const mode = env.BRAISER_MODE ?? "local";
  if (mode !== "local" && mode !== "remote") throw new Error("BRAISER_MODE must be local or remote");
  const defaultPort = mode === "remote" ? 27833 : portNumber(env.BRAISER_DAEMON_PORT ?? "17833", "BRAISER_DAEMON_PORT");
  const url = new URL(env.BRAISER_DAEMON_URL ?? `ws://127.0.0.1:${defaultPort}`);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BRAISER_DAEMON_URL must be ws://127.0.0.1:<port> (use an SSH tunnel for remote access)");
  }
  const requestTimeoutMs = Number(env.BRAISER_REQUEST_TIMEOUT_MS ?? "30000");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120000) {
    throw new Error("BRAISER_REQUEST_TIMEOUT_MS must be between 1000 and 120000");
  }
  const stateDir = path.resolve(env.BRAISER_STATE_DIR ?? path.join(homedir(), ".braiser"));
  const tokenFile = env.BRAISER_TOKEN_FILE || (mode === "local" ? path.join(stateDir, "local-token") : undefined);
  if (mode === "remote" && !tokenFile && !env.BRAISER_TOKEN) {
    throw new Error("Remote mode requires BRAISER_TOKEN_FILE or BRAISER_TOKEN (the browser host's remote-token)");
  }
  return { mode, url: url.href, stateDir, tokenFile, token: env.BRAISER_TOKEN, requestTimeoutMs };
}
