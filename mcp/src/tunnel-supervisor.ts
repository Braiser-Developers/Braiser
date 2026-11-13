// D-0018: the daemon keeps the reverse SSH tunnel up while remote access is switched on.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SshTunnel, validateRemoteOptions, type RemoteOptions } from "./ssh-tunnel.js";

export interface RemoteSettings {
  enabled: boolean;
  destination?: string;
  remotePort?: number;
  sshPort?: number;
}

export interface TunnelStatus {
  enabled: boolean;
  state: "disabled" | "connecting" | "connected" | "retrying";
  destination?: string;
  remotePort?: number;
  since?: string;
  lastError?: string;
  nextRetryAt?: string;
}

interface Tunnel {
  start(signal: AbortSignal): Promise<void>;
  wait(): Promise<number>;
  stop(signal?: AbortSignal): Promise<void>;
  readonly errorOutput: string;
}

export interface SupervisorOptions {
  createTunnel?: (options: RemoteOptions, localPort: number) => Tunnel;
  retryDelaysMs?: number[];
  /** A connection that lasted this long resets the retry delay. */
  stableAfterMs?: number;
}

export function remoteSettingsPath(stateDir: string): string {
  return path.join(stateDir, "remote.json");
}

export async function readRemoteSettings(stateDir: string): Promise<RemoteSettings> {
  try {
    const parsed = JSON.parse(await readFile(remoteSettingsPath(stateDir), "utf8")) as Partial<RemoteSettings>;
    return {
      enabled: parsed.enabled === true,
      destination: typeof parsed.destination === "string" ? parsed.destination : undefined,
      remotePort: Number.isInteger(parsed.remotePort) ? parsed.remotePort : undefined,
      sshPort: Number.isInteger(parsed.sshPort) ? parsed.sshPort : undefined
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false };
    throw new Error(`Cannot read ${remoteSettingsPath(stateDir)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeRemoteSettings(stateDir: string, settings: RemoteSettings): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const target = remoteSettingsPath(stateDir);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function optionsOf(settings: RemoteSettings): RemoteOptions | undefined {
  if (!settings.enabled || !settings.destination) return undefined;
  return validateRemoteOptions({ destination: settings.destination, remotePort: settings.remotePort ?? 27833, sshPort: settings.sshPort });
}

const sameOptions = (a?: RemoteOptions, b?: RemoteOptions) =>
  a?.destination === b?.destination && a?.remotePort === b?.remotePort && a?.sshPort === b?.sshPort;

export class TunnelSupervisor {
  private current?: { options: RemoteOptions; controller: AbortController; loop: Promise<void> };
  private state: TunnelStatus = { enabled: false, state: "disabled" };
  private readonly createTunnel: NonNullable<SupervisorOptions["createTunnel"]>;
  private readonly retryDelaysMs: number[];
  private readonly stableAfterMs: number;
  private reloading: Promise<TunnelStatus> = Promise.resolve(this.state);

  constructor(private readonly stateDir: string, private readonly localPort: number, options: SupervisorOptions = {}) {
    this.createTunnel = options.createTunnel ?? ((remote, port) => new SshTunnel(remote, port));
    this.retryDelaysMs = options.retryDelaysMs ?? [2000, 5000, 10000, 30000, 60000];
    this.stableAfterMs = options.stableAfterMs ?? 60000;
  }

  status(): TunnelStatus {
    return { ...this.state };
  }

  /** Re-reads remote.json and starts, keeps or stops the tunnel accordingly. */
  reload(): Promise<TunnelStatus> {
    this.reloading = this.reloading.catch(() => undefined).then(() => this.applySettings());
    return this.reloading;
  }

  async stop(): Promise<void> {
    await this.reloading.catch(() => undefined);
    await this.stopCurrent();
    this.state = { enabled: false, state: "disabled" };
  }

  private async applySettings(): Promise<TunnelStatus> {
    let options: RemoteOptions | undefined;
    try {
      options = optionsOf(await readRemoteSettings(this.stateDir));
    } catch (error) {
      await this.stopCurrent();
      this.state = { enabled: false, state: "disabled", lastError: error instanceof Error ? error.message : String(error) };
      return this.status();
    }
    if (this.current && sameOptions(this.current.options, options)) return this.status();
    await this.stopCurrent();
    if (!options) {
      this.state = { enabled: false, state: "disabled" };
      return this.status();
    }
    const controller = new AbortController();
    this.state = { enabled: true, state: "connecting", destination: options.destination, remotePort: options.remotePort };
    this.current = { options, controller, loop: this.run(options, controller.signal) };
    return this.status();
  }

  private async stopCurrent(): Promise<void> {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    current.controller.abort();
    await current.loop;
  }

  // Reconnects with growing delays; never replays anything, it only re-establishes the forwarding.
  private async run(options: RemoteOptions, signal: AbortSignal): Promise<void> {
    let attempt = 0;
    const base = { enabled: true, destination: options.destination, remotePort: options.remotePort };
    while (!signal.aborted) {
      const tunnel = this.createTunnel(options, this.localPort);
      let connectedAt: number | undefined;
      let lastError: string | undefined;
      try {
        this.state = { ...base, state: "connecting", lastError: this.state.lastError };
        await tunnel.start(signal);
        connectedAt = Date.now();
        this.state = { ...base, state: "connected", since: new Date(connectedAt).toISOString() };
        const code = await tunnel.wait();
        lastError = `SSH connection closed (code ${code})${tunnel.errorOutput ? `: ${tunnel.errorOutput}` : ""}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        await tunnel.stop(signal).catch(() => undefined);
      }
      if (signal.aborted) break;
      if (connectedAt !== undefined && Date.now() - connectedAt >= this.stableAfterMs) attempt = 0;
      const wait = this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)];
      attempt += 1;
      this.state = { ...base, state: "retrying", lastError, nextRetryAt: new Date(Date.now() + wait).toISOString() };
      try { await delay(wait, undefined, { signal }); } catch { break; }
    }
  }
}
