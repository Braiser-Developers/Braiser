import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  BRAISER_WS_PORT,
  type ExtensionRequest,
  type ExtensionRequestType,
  type ExtensionResponse
} from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class ExtensionBridge {
  private readonly server: WebSocketServer;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(port = BRAISER_WS_PORT) {
    this.server = new WebSocketServer({ host: "127.0.0.1", port });
    this.server.on("connection", (socket) => {
      this.socket = socket;

      socket.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
    });
  }

  isExtensionConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async request<T>(type: ExtensionRequestType, timeoutMs = 10000): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Chrome extension is not connected");
    }

    const id = randomUUID();
    const request: ExtensionRequest = { id, type };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension request timed out: ${type}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });

      this.socket?.send(JSON.stringify(request));
    });
  }

  close(): void {
    this.server.close();
    this.socket?.close();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Extension bridge closed"));
      this.pending.delete(id);
    }
  }

  private handleMessage(rawData: string): void {
    const response = JSON.parse(rawData) as ExtensionResponse;
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

    pending.reject(new Error(response.error ?? "Extension request failed"));
  }
}
