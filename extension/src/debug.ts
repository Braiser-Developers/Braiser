import {
  BRAISER_WS_URL,
  type BridgeRuntimeRequest,
  type ExtensionRequest,
  type ExtensionResponse,
  type PopupStatus
} from "./protocol.js";

const connectionState = getElement("connectionState");
const bridgeUrl = getElement("bridgeUrl");
const logOutput = getElement("logOutput");

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;

bridgeUrl.textContent = BRAISER_WS_URL;
connectWebSocket();

window.addEventListener("beforeunload", () => {
  chrome.storage.local.set({ connectionState: "offline" satisfies PopupStatus["connectionState"] });
  socket?.close();
});

function connectWebSocket(): void {
  if (
    socket?.readyState === WebSocket.CONNECTING ||
    socket?.readyState === WebSocket.OPEN
  ) {
    return;
  }

  setConnectionState("connecting");
  socket = new WebSocket(BRAISER_WS_URL);

  socket.addEventListener("open", () => {
    setConnectionState("connected");
    log("connected");
  });

  socket.addEventListener("close", () => {
    setConnectionState("offline");
    log("disconnected");
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket?.close();
  });

  socket.addEventListener("message", (event) => {
    handleSocketMessage(event.data).catch((error: unknown) => {
      log(error instanceof Error ? error.message : String(error));
    });
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectWebSocket();
  }, 1500);
}

async function handleSocketMessage(rawData: string): Promise<void> {
  const request = JSON.parse(rawData) as ExtensionRequest;
  log(`request ${request.type}`);

  try {
    const result = await sendRuntimeMessage<unknown>({
      type: "bridge.handle_extension_request",
      request
    });
    sendResponse({ id: request.id, ok: true, result });
  } catch (error) {
    sendResponse({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function sendRuntimeMessage<T>(message: BridgeRuntimeRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {
    ok?: boolean;
    result?: T;
    error?: string;
  };

  if (response?.ok === false) {
    throw new Error(response.error ?? "Extension request failed");
  }

  return response?.result as T;
}

function sendResponse(response: ExtensionResponse): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(response));
  }
}

function setConnectionState(state: PopupStatus["connectionState"]): void {
  connectionState.textContent = state;
  connectionState.classList.toggle("connected", state === "connected");
  connectionState.classList.toggle("connecting", state === "connecting");
  chrome.storage.local.set({ connectionState: state });
}

function log(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.textContent = `${line}\n${logOutput.textContent ?? ""}`.slice(0, 6000);
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}
