import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { portNumber } from "./config.js";

const exec = promisify(execFile);
export interface RemoteOptions { destination: string; remotePort: number; sshPort?: number }
export type RemoteCommand =
  | { command: "enable"; options: RemoteOptions }
  | { command: "disable" }
  | { command: "status" };

export const REMOTE_USAGE = "Usage: braiser remote enable --ssh <user@host|alias> [--remote-port 27833] [--ssh-port 22] | remote disable | remote status";

export function parseRemoteCommand(args: string[]): RemoteCommand {
  if (args[0] !== "remote") throw new Error(REMOTE_USAGE);
  if (args[1] === "disable" || args[1] === "status") {
    if (args.length > 2) throw new Error(REMOTE_USAGE);
    return { command: args[1] };
  }
  if (args[1] !== "enable") throw new Error(REMOTE_USAGE);
  const values = new Map<string, string>();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--ssh", "--remote-port", "--ssh-port"].includes(key) || !value || values.has(key)) throw new Error(`Invalid or duplicate option: ${key}`);
    values.set(key, value);
  }
  return { command: "enable", options: validateRemoteOptions({
    destination: values.get("--ssh") ?? "",
    remotePort: portNumber(values.get("--remote-port") ?? "27833", "--remote-port"),
    sshPort: values.has("--ssh-port") ? portNumber(values.get("--ssh-port")!, "--ssh-port") : undefined
  }) };
}

// The destination becomes an ssh argument; reject anything that could be read as an option.
export function validateRemoteOptions(options: RemoteOptions): RemoteOptions {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*(?:@[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(options.destination)) {
    throw new Error("--ssh requires a user@hostname, user@IPv4 or SSH config alias");
  }
  portNumber(String(options.remotePort), "--remote-port");
  if (options.sshPort !== undefined) portNumber(String(options.sshPort), "--ssh-port");
  return options;
}

/** Checks that key-based login works without any prompt, as the daemon has no terminal (D-0018). */
export async function checkBatchLogin(options: RemoteOptions): Promise<void> {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  if (options.sshPort) args.push("-p", String(options.sshPort));
  try {
    await exec("ssh", [...args, "--", options.destination, "true"], { timeout: 30000 });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(`Cannot log in to ${options.destination} without prompts${stderr ? `: ${lastLines(stderr)}` : ""}`);
  }
}

function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" ").slice(-400);
}

export class SshTunnel {
  private child?: ChildProcess;
  private exited?: Promise<number>;
  private directory?: string;
  private stopped = false;
  private exitCode: number | undefined;
  private startupError?: Error;
  private abortListener?: () => void;
  private stderr = "";

  constructor(private readonly options: RemoteOptions, private readonly localPort: number) {}

  /** Recent ssh error output, for status reports. */
  get errorOutput(): string {
    return lastLines(this.stderr);
  }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.directory = await mkdtemp(path.join(tmpdir(), "braiser-ssh-"));
    const controlPath = path.join(this.directory, "control");
    // D-0004/D-0018: a dedicated master without prompts, then exactly one acknowledged forwarding.
    const args = ["-NT", "-M", "-S", controlPath,
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
      "-o", "ControlPersist=no", "-o", "ForkAfterAuthentication=no", "-o", "ClearAllForwardings=yes",
      "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
      "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "PermitLocalCommand=no"];
    if (this.options.sshPort) args.push("-p", String(this.options.sshPort));
    args.push("--", this.options.destination);
    this.child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    this.child.stderr?.on("data", (chunk: Buffer) => { this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000); });
    this.exited = new Promise<number>(resolve => {
      this.child!.once("error", error => { this.startupError = error; this.exitCode = 1; resolve(1); });
      this.child!.once("exit", code => { this.exitCode = code ?? 1; resolve(this.exitCode); });
    });
    this.abortListener = () => { this.child?.kill("SIGTERM"); };
    signal.addEventListener("abort", this.abortListener, { once: true });
    if (signal.aborted) this.abortListener();
    const started = Date.now();
    const controlArgs = ["-F", process.platform === "win32" ? "NUL" : "/dev/null", "-S", controlPath];
    while (true) {
      signal.throwIfAborted();
      if (this.exitCode !== undefined) {
        throw this.startupError ?? new Error(`SSH exited before establishing the tunnel (code ${this.exitCode})${this.errorOutput ? `: ${this.errorOutput}` : ""}`);
      }
      if (Date.now() - started > 60000) throw new Error("SSH login timed out after 60 seconds");
      try {
        await exec("ssh", [...controlArgs, "-O", "check", "--", this.options.destination], { timeout: 2000, signal });
        break;
      } catch {
        await delay(250, undefined, { signal });
      }
    }
    const forward = `127.0.0.1:${this.options.remotePort}:127.0.0.1:${this.localPort}`;
    try {
      await exec("ssh", [...controlArgs, "-O", "forward", "-o", "ExitOnForwardFailure=yes", "-R", forward, "--", this.options.destination], { timeout: 15000, signal });
    } catch {
      signal.throwIfAborted();
      throw new Error(`SSH remote forwarding failed for 127.0.0.1:${this.options.remotePort}; check port conflicts and sshd AllowTcpForwarding/PermitListen policy`);
    }
    signal.throwIfAborted();
    if (this.exitCode !== undefined) throw new Error("SSH disconnected while establishing the forwarding");
  }

  async wait(): Promise<number> {
    if (!this.exited) throw new Error("SSH tunnel was not started");
    return this.exited;
  }

  async stop(signal?: AbortSignal): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (signal && this.abortListener) signal.removeEventListener("abort", this.abortListener);
    if (this.child && this.exitCode === undefined) {
      this.child.kill("SIGTERM");
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([this.exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]);
      clearTimeout(timer);
      if (this.exitCode === undefined) { this.child.kill("SIGKILL"); await this.exited; }
    }
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
