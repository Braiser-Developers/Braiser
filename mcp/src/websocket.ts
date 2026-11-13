import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { DaemonRequestInput, DaemonResponse, DaemonStatus, ExtensionRequestType } from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeError extends Error {
  constructor(public readonly kind: "unavailable" | "unauthorized" | "protocol" | "unknown_outcome", message: string) {
    super(message);
  }
}

export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(
    public readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = 30000,
    private readonly connectTimeoutMs = 3000
  ) {}

  async status(): Promise<DaemonStatus> {
    const status = await this.daemonRequest<DaemonStatus>({ type: "daemon.status" }, 3000);
    if (status?.daemon !== "ok" || status.protocolVersion !== 2 ||
        !["local", "remote"].includes(status.clientMode) || typeof status.extensionConnected !== "boolean") {
      throw new BridgeError("protocol", "Incompatible Braiser daemon; rebuild and restart it before enabling remote access");
    }
    return status;
  }

  /** Asks the daemon to re-read remote.json (D-0018); requires the local credential. */
  async reloadTunnel(): Promise<import("./tunnel-supervisor.js").TunnelStatus> {
    return this.daemonRequest({ type: "daemon.tunnel_reload" }, 10000);
  }

  async isDaemonConnected(): Promise<boolean> {
    try { await this.status(); return true; } catch { return false; }
  }

  async isExtensionConnected(): Promise<boolean> {
    try { return (await this.status()).extensionConnected; } catch { return false; }
  }

  async request<T>(type: ExtensionRequestType, payload?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    return this.daemonRequest<T>({ type: "extension.request", request: { type, payload }, timeoutMs }, timeoutMs + 1000);
  }

  close(): void {
    this.closed = true;
    this.socket?.terminate();
    this.socket = null;
    this.rejectPending(new BridgeError("unknown_outcome", "Daemon connection closed; in-flight operation outcome is unknown. Observe again before retrying."));
  }

  private async daemonRequest<T>(request: DaemonRequestInput, timeoutMs: number): Promise<T> {
    const socket = await this.ensureSocket();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("unknown_outcome", "Daemon response timed out; operation outcome is unknown. Observe again before retrying."));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, ...request }), (error) => {
        if (error) this.rejectPending(new BridgeError("unknown_outcome", "Daemon send failed; operation outcome is unknown. Observe again before retrying."));
      });
    });
  }

  private ensureSocket(): Promise<WebSocket> {
    if (this.closed) return Promise.reject(new Error("Braiser bridge is closed"));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.url, {
        headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: this.connectTimeoutMs
      });
      this.socket = socket;
      let opened = false;
      const fail = (error: Error) => {
        if (!opened) reject(error);
        if (this.socket === socket) {
          this.connecting = null;
          this.socket = null;
          this.rejectPending(error);
        }
      };
      socket.on("open", () => { opened = true; this.connecting = null; resolve(socket); });
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        fail(new BridgeError("unauthorized", `Daemon refused connection (HTTP ${response.statusCode}); check the token and restart an outdated daemon`));
        socket.terminate();
      });
      socket.on("error", (error: NodeJS.ErrnoException) => {
        fail(opened
          ? new BridgeError("unknown_outcome", "Daemon connection failed; operation outcome is unknown. Observe again before retrying.")
          : new BridgeError(error.code === "ECONNREFUSED" ? "unavailable" : "protocol", `Cannot connect to Braiser daemon at ${this.url}: ${error.message}`));
      });
      socket.on("close", () => fail(new BridgeError("unknown_outcome", "Daemon disconnected; operation outcome is unknown. Observe again before retrying.")));
      socket.on("message", (data) => {
        if (this.socket !== socket) return;
        let response: DaemonResponse;
        try {
          response = JSON.parse(data.toString()) as DaemonResponse;
          if (!response || typeof response.id !== "string" || typeof response.ok !== "boolean") throw new Error();
        } catch {
          fail(new BridgeError("protocol", "Invalid response from Braiser daemon"));
          socket.terminate();
          return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new Error(response.error ?? "Daemon request failed"));
      });
    });
    return this.connecting;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
