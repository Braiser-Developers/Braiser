import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  BRAISER_DAEMON_WS_PORT,
  type DaemonRequest,
  type DaemonRequestInput,
  type DaemonResponse,
  type DaemonStatus,
  type ExtensionRequestType
} from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly port = BRAISER_DAEMON_WS_PORT,
    private readonly host = "127.0.0.1"
  ) {}

  async isDaemonConnected(): Promise<boolean> {
    try {
      await this.ensureSocket();
      return true;
    } catch {
      return false;
    }
  }

  async isExtensionConnected(): Promise<boolean> {
    try {
      const status = await this.daemonRequest<DaemonStatus>({ type: "daemon.status" });
      return status.extensionConnected;
    } catch {
      return false;
    }
  }

  async request<T>(type: ExtensionRequestType, payload?: unknown, timeoutMs = 10000): Promise<T> {
    return this.daemonRequest<T>(
      {
        type: "extension.request",
        request: { type, payload }
      },
      timeoutMs
    );
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.connecting = null;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Daemon bridge closed"));
      this.pending.delete(id);
    }
  }

  private async daemonRequest<T>(
    request: DaemonRequestInput,
    timeoutMs = 10000
  ): Promise<T> {
    const socket = await this.ensureSocket();
    const id = randomUUID();
    const message = { id, ...request } as DaemonRequest;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Daemon request timed out: ${request.type}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });

      socket.send(JSON.stringify(message));
    });
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://${this.host}:${this.port}`);

      socket.on("open", () => {
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });

      socket.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.rejectPending(new Error("Daemon connection closed"));
      });

      socket.on("error", (error) => {
        if (this.connecting) {
          this.connecting = null;
          reject(error);
          return;
        }

        this.rejectPending(error);
      });
    });

    return this.connecting;
  }

  private handleMessage(rawData: string): void {
    const response = JSON.parse(rawData) as DaemonResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(new Error(response.error ?? "Daemon request failed"));
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
