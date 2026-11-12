import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { tokenMatches } from "./auth.js";
import type { Mode } from "./config.js";
import { toolAllowed } from "./policy.js";
import type { DaemonRequest, DaemonResponse, ExtensionRequest, ExtensionResponse } from "./protocol.js";

const requestTypes = new Set([
  "browser.get_active_tab", "browser.list_tabs", "browser.create_tab", "browser.open_tab",
  "browser.close_tab", "browser.switch_tab", "browser.download", "browser.upload", "browser.observe",
  "browser.act", "page.extract_readable_text", "debug.inject_js", "debug.cdp_command"
]);
interface Pending {
  client: WebSocket;
  clientId: string;
  timer: NodeJS.Timeout;
}
export interface DaemonOptions {
  extensionPort: number;
  clientPort: number;
  localToken: string;
  remoteToken: string;
}

export class BraiserDaemon {
  private readonly extensionServer: WebSocketServer;
  private readonly clientServer: WebSocketServer;
  private extension: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  readonly ready: Promise<void>;

  constructor(options: DaemonOptions) {
    if (!options.localToken || !options.remoteToken || options.localToken === options.remoteToken) {
      throw new Error("Daemon requires distinct local and remote tokens");
    }
    this.extensionServer = new WebSocketServer({ host: "127.0.0.1", port: options.extensionPort });
    this.clientServer = new WebSocketServer({
      host: "127.0.0.1", port: options.clientPort,
      verifyClient: (info, done) => {
        const header = info.req.headers.authorization;
        const authorized = !info.origin && (tokenMatches(header, options.localToken) || tokenMatches(header, options.remoteToken));
        done(authorized, authorized ? undefined : 401, authorized ? undefined : "Unauthorized");
      }
    });
    this.ready = Promise.all([this.extensionServer, this.clientServer].map(server => new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.on("error", reject);
    }))).then(() => undefined);
    this.extensionServer.on("connection", socket => this.connectExtension(socket));
    this.clientServer.on("connection", (socket, request) => {
      const mode: Mode = tokenMatches(request.headers.authorization, options.localToken) ? "local" : "remote";
      socket.on("error", () => socket.terminate());
      socket.on("message", data => this.handleClient(socket, mode, data.toString()));
      socket.on("close", () => {
        for (const [id, pending] of this.pending) {
          if (pending.client === socket) { clearTimeout(pending.timer); this.pending.delete(id); }
        }
      });
    });
  }

  get ports(): { extension: number; client: number } {
    const extension = this.extensionServer.address();
    const client = this.clientServer.address();
    if (!extension || typeof extension === "string" || !client || typeof client === "string") throw new Error("Daemon is not listening");
    return { extension: extension.port, client: client.port };
  }

  async close(): Promise<void> {
    this.rejectPending("Daemon stopped; operation outcome is unknown. Observe again before retrying.");
    for (const server of [this.extensionServer, this.clientServer]) {
      for (const socket of server.clients) socket.terminate();
    }
    await Promise.all([this.extensionServer, this.clientServer].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }

  private connectExtension(socket: WebSocket): void {
    // D-0005: the old socket must not cancel requests sent to its replacement.
    this.rejectPending("Chrome extension replaced; operation outcome is unknown. Observe again before retrying.");
    this.extension?.terminate();
    this.extension = socket;
    socket.on("error", () => socket.terminate());
    socket.on("message", data => {
      if (this.extension !== socket) return;
      let response: ExtensionResponse;
      try {
        response = JSON.parse(data.toString()) as ExtensionResponse;
        if (!response || typeof response.id !== "string" || typeof response.ok !== "boolean") throw new Error();
      } catch {
        socket.close(1003, "Invalid extension response");
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      this.respond(pending.client, { id: pending.clientId, ok: response.ok, result: response.result, error: response.error });
    });
    socket.on("close", () => {
      if (this.extension !== socket) return;
      this.extension = null;
      this.rejectPending("Chrome extension disconnected; operation outcome is unknown. Observe again before retrying.");
    });
  }

  private handleClient(socket: WebSocket, mode: Mode, raw: string): void {
    let request: DaemonRequest;
    try {
      request = JSON.parse(raw) as DaemonRequest;
      if (!request || typeof request.id !== "string" || !request.id || request.id.length > 256) throw new Error();
    } catch {
      this.respond(socket, { id: "", ok: false, error: "Invalid daemon request" });
      return;
    }
    const fail = (error: string) => this.respond(socket, { id: request.id, ok: false, error });
    if (request.type === "daemon.status") {
      this.respond(socket, { id: request.id, ok: true, result: {
        daemon: "ok", protocolVersion: 2, clientMode: mode,
        extensionConnected: this.extension?.readyState === WebSocket.OPEN
      } });
      return;
    }
    if (request.type !== "extension.request" || !request.request || !requestTypes.has(request.request.type)) {
      fail("Unknown daemon request"); return;
    }
    if (!toolAllowed(request.request.type, mode)) {
      fail(`Tool unavailable in remote mode: ${request.request.type}`); return;
    }
    const timeoutMs = request.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      fail("Invalid request timeout"); return;
    }
    if (!this.extension || this.extension.readyState !== WebSocket.OPEN) {
      fail("Chrome extension is not connected to the browser host daemon; open the extension Bridge page"); return;
    }
    const id = randomUUID();
    const extensionRequest: ExtensionRequest = { id, type: request.request.type, payload: request.request.payload };
    const timer = setTimeout(() => {
      this.pending.delete(id);
      fail(`Extension request timed out: ${request.request.type}; operation outcome is unknown. Observe again before retrying.`);
    }, timeoutMs);
    this.pending.set(id, { client: socket, clientId: request.id, timer });
    this.extension.send(JSON.stringify(extensionRequest), error => {
      if (!error || !this.pending.has(id)) return;
      clearTimeout(timer);
      this.pending.delete(id);
      fail("Extension send failed; operation outcome is unknown. Observe again before retrying.");
    });
  }

  private respond(socket: WebSocket, response: DaemonResponse): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  }

  private rejectPending(error: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      this.respond(pending.client, { id: pending.clientId, ok: false, error });
    }
    this.pending.clear();
  }
}
