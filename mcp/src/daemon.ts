#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  BRAISER_DAEMON_WS_PORT,
  BRAISER_EXTENSION_WS_PORT,
  type DaemonRequest,
  type DaemonResponse,
  type ExtensionRequest,
  type ExtensionResponse
} from "./protocol.js";

interface ExtensionPendingRequest {
  clientSocket: WebSocket;
  clientRequestId: string;
  timer: NodeJS.Timeout;
}

class BraiserDaemon {
  private readonly extensionServer: WebSocketServer;
  private readonly clientServer: WebSocketServer;
  private extensionSocket: WebSocket | null = null;
  private readonly pendingExtensionRequests = new Map<string, ExtensionPendingRequest>();

  constructor(
    extensionPort = BRAISER_EXTENSION_WS_PORT,
    clientPort = BRAISER_DAEMON_WS_PORT
  ) {
    this.extensionServer = new WebSocketServer({ host: "127.0.0.1", port: extensionPort });
    this.clientServer = new WebSocketServer({ host: "127.0.0.1", port: clientPort });

    this.extensionServer.on("connection", (socket) => this.handleExtensionConnection(socket));
    this.clientServer.on("connection", (socket) => this.handleClientConnection(socket));

    this.extensionServer.on("listening", () => {
      console.error(`Braiser daemon extension bridge listening on ws://127.0.0.1:${extensionPort}`);
    });
    this.clientServer.on("listening", () => {
      console.error(`Braiser daemon MCP client bridge listening on ws://127.0.0.1:${clientPort}`);
    });
  }

  close(): void {
    this.extensionServer.close();
    this.clientServer.close();
    this.extensionSocket?.close();

    for (const [id, pending] of this.pendingExtensionRequests) {
      clearTimeout(pending.timer);
      this.sendClientResponse(pending.clientSocket, {
        id: pending.clientRequestId,
        ok: false,
        error: "Braiser daemon closed"
      });
      this.pendingExtensionRequests.delete(id);
    }
  }

  private handleExtensionConnection(socket: WebSocket): void {
    this.extensionSocket?.close();
    this.extensionSocket = socket;

    socket.on("message", (data) => {
      this.handleExtensionMessage(data.toString());
    });

    socket.on("close", () => {
      if (this.extensionSocket === socket) {
        this.extensionSocket = null;
      }

      this.rejectPendingExtensionRequests("Chrome extension disconnected");
    });
  }

  private handleClientConnection(socket: WebSocket): void {
    socket.on("message", (data) => {
      this.handleClientMessage(socket, data.toString());
    });

    socket.on("close", () => {
      this.rejectClientPendingRequests(socket, "MCP client disconnected");
    });
  }

  private handleClientMessage(socket: WebSocket, rawData: string): void {
    let request: DaemonRequest;
    try {
      request = JSON.parse(rawData) as DaemonRequest;
    } catch (error) {
      this.sendClientResponse(socket, {
        id: "",
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    switch (request.type) {
      case "daemon.status":
        this.sendClientResponse(socket, {
          id: request.id,
          ok: true,
          result: {
            daemon: "ok",
            extensionConnected: this.isExtensionConnected()
          }
        });
        return;

      case "extension.request":
        this.forwardClientRequest(socket, request);
        return;

    }
  }

  private forwardClientRequest(socket: WebSocket, request: Extract<DaemonRequest, { type: "extension.request" }>): void {
    if (!this.extensionSocket || this.extensionSocket.readyState !== WebSocket.OPEN) {
      this.sendClientResponse(socket, {
        id: request.id,
        ok: false,
        error: "Chrome extension is not connected"
      });
      return;
    }

    const extensionRequestId = randomUUID();
    const extensionRequest: ExtensionRequest = {
      id: extensionRequestId,
      ...request.request
    };

    const timer = setTimeout(() => {
      this.pendingExtensionRequests.delete(extensionRequestId);
      this.sendClientResponse(socket, {
        id: request.id,
        ok: false,
        error: `Extension request timed out: ${request.request.type}`
      });
    }, 10000);

    this.pendingExtensionRequests.set(extensionRequestId, {
      clientSocket: socket,
      clientRequestId: request.id,
      timer
    });

    this.extensionSocket.send(JSON.stringify(extensionRequest));
  }

  private handleExtensionMessage(rawData: string): void {
    const response = JSON.parse(rawData) as ExtensionResponse;
    const pending = this.pendingExtensionRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingExtensionRequests.delete(response.id);

    this.sendClientResponse(pending.clientSocket, {
      id: pending.clientRequestId,
      ok: response.ok,
      result: response.result,
      error: response.error
    });
  }

  private sendClientResponse(socket: WebSocket, response: DaemonResponse): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(response));
    }
  }

  private isExtensionConnected(): boolean {
    return this.extensionSocket?.readyState === WebSocket.OPEN;
  }

  private rejectPendingExtensionRequests(error: string): void {
    for (const [id, pending] of this.pendingExtensionRequests) {
      clearTimeout(pending.timer);
      this.sendClientResponse(pending.clientSocket, {
        id: pending.clientRequestId,
        ok: false,
        error
      });
      this.pendingExtensionRequests.delete(id);
    }
  }

  private rejectClientPendingRequests(socket: WebSocket, error: string): void {
    for (const [id, pending] of this.pendingExtensionRequests) {
      if (pending.clientSocket !== socket) {
        continue;
      }

      clearTimeout(pending.timer);
      this.sendClientResponse(socket, {
        id: pending.clientRequestId,
        ok: false,
        error
      });
      this.pendingExtensionRequests.delete(id);
    }
  }
}

const daemon = new BraiserDaemon();

process.on("SIGINT", () => {
  daemon.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  daemon.close();
  process.exit(0);
});
