import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type ExtensionRequest,
  type ExtensionResponse,
  type PopupRequest,
  type PopupStatus,
  type ReadablePage
} from "./protocol.js";

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;

type ActiveChromeTab = chrome.tabs.Tab & { id: number };

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) {
    return;
  }

  reconnectTimer = self.setTimeout(() => {
    reconnectTimer = undefined;
    connectWebSocket();
  }, 1500);
}

function connectWebSocket(): void {
  if (
    socket?.readyState === WebSocket.CONNECTING ||
    socket?.readyState === WebSocket.OPEN
  ) {
    return;
  }

  socket = new WebSocket(BRAISER_WS_URL);

  socket.addEventListener("open", () => {
    chrome.storage.local.set({ connectionState: getConnectionState() });
  });

  socket.addEventListener("close", () => {
    chrome.storage.local.set({ connectionState: getConnectionState() });
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket?.close();
  });

  socket.addEventListener("message", (event) => {
    handleSocketMessage(event.data).catch((error: unknown) => {
      console.error("Braiser message handling failed", error);
    });
  });
}

async function handleSocketMessage(rawData: string): Promise<void> {
  const request = JSON.parse(rawData) as ExtensionRequest;

  try {
    const result = await handleExtensionRequest(request);
    sendResponse({ id: request.id, ok: true, result });
  } catch (error) {
    sendResponse({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleExtensionRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "browser.get_active_tab":
      return getActiveTabInfo();
    case "page.extract_readable_text":
      return extractReadablePage();
    default:
      throw new Error(`Unsupported request type: ${(request as ExtensionRequest).type}`);
  }
}

function sendResponse(response: ExtensionResponse): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(response));
  }
}

function getConnectionState(): PopupStatus["connectionState"] {
  if (socket?.readyState === WebSocket.OPEN) {
    return "connected";
  }

  if (socket?.readyState === WebSocket.CONNECTING) {
    return "connecting";
  }

  return "offline";
}

async function getActiveTab(): Promise<ActiveChromeTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab is available");
  }

  return tab as ActiveChromeTab;
}

async function getActiveTabInfo(): Promise<ActiveTabInfo> {
  const tab = await getActiveTab();
  return {
    title: tab.title ?? "",
    url: tab.url ?? ""
  };
}

async function extractReadablePage(): Promise<ReadablePage> {
  const tab = await getActiveTab();

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["dist/content.js"]
  });

  const page = injection?.result as ReadablePage | undefined;
  if (!page) {
    throw new Error("Content script did not return a readable page");
  }

  return page;
}

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, sendResponse) => {
  void handlePopupRequest(message).then(sendResponse);
  return true;
});

async function handlePopupRequest(message: PopupRequest): Promise<PopupStatus | ActiveTabInfo> {
  switch (message.type) {
    case "popup.get_status":
      connectWebSocket();
      const connectionState = getConnectionState();
      return {
        extensionConnected: connectionState === "connected",
        connectionState,
        websocketUrl: BRAISER_WS_URL
      };
    case "popup.get_active_tab":
      return getActiveTabInfo();
    default:
      throw new Error("Unsupported popup request");
  }
}

connectWebSocket();
