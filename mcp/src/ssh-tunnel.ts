import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { portNumber } from "./config.js";

const exec = promisify(execFile);
export interface RemoteOptions { destination: string; remotePort: number; sshPort?: number }

export function parseRemoteArgs(args: string[]): RemoteOptions {
  if (args[0] !== "remote" || args[1] !== "start") throw new Error("Usage: braiser remote start --ssh <user@host|alias> [--remote-port 27833] [--ssh-port 22]");
  const values = new Map<string, string>();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--ssh", "--remote-port", "--ssh-port"].includes(key) || !value || values.has(key)) throw new Error(`Invalid or duplicate option: ${key}`);
    values.set(key, value);
  }
  const destination = values.get("--ssh") ?? "";
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*(?:@[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(destination)) {
    throw new Error("--ssh requires a user@hostname, user@IPv4 or SSH config alias");
  }
  return {
    destination,
    remotePort: portNumber(values.get("--remote-port") ?? "27833", "--remote-port"),
    sshPort: values.has("--ssh-port") ? portNumber(values.get("--ssh-port")!, "--ssh-port") : undefined
  };
}

export class SshTunnel {
  private child?: ChildProcess;
  private exited?: Promise<number>;
  private directory?: string;
  private stopped = false;
  private exitCode: number | undefined;
  private startupError?: Error;
  private abortListener?: () => void;

  constructor(private readonly options: RemoteOptions, private readonly localPort: number) {}

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.directory = await mkdtemp(path.join(tmpdir(), "braiser-ssh-"));
    const controlPath = path.join(this.directory, "control");
    // D-0004: first establish a dedicated master, then request and acknowledge exactly one forwarding.
    const args = ["-NT", "-M", "-S", controlPath,
      "-o", "ControlPersist=no", "-o", "ForkAfterAuthentication=no", "-o", "ClearAllForwardings=yes",
      "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
      "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "PermitLocalCommand=no"];
    if (this.options.sshPort) args.push("-p", String(this.options.sshPort));
    args.push("--", this.options.destination);
    this.child = spawn("ssh", args, { stdio: "inherit" });
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
      if (this.exitCode !== undefined) throw this.startupError ?? new Error(`SSH exited before establishing the tunnel (code ${this.exitCode})`);
      if (Date.now() - started > 120000) throw new Error("SSH login timed out after 120 seconds");
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
