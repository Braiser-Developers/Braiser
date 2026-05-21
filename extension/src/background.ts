import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type AgentHtmlSnapshot,
  type BrowserActInput,
  type BrowserActResult,
  type ExtensionRequest,
  type ExtensionResponse,
  type PopupRequest,
  type PopupStatus,
  type ReadablePage
} from "./protocol.js";

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;

type ActiveChromeTab = chrome.tabs.Tab & { id: number };
const TARGET_TAB_GROUP_TITLE = "Braised";

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
    case "browser.observe":
      return observePage();
    case "browser.act":
      return actOnPage(request.payload as BrowserActInput);
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
  const groups = await chrome.tabGroups.query({});
  const targetGroups = groups.filter((group) => group.title === TARGET_TAB_GROUP_TITLE);
  if (!targetGroups.length) {
    throw new Error(`No Chrome tab group named "${TARGET_TAB_GROUP_TITLE}" is available`);
  }

  const tabs = (
    await Promise.all(
      targetGroups.map((group) => chrome.tabs.query({ groupId: group.id }))
    )
  )
    .flat()
    .filter((tab): tab is ActiveChromeTab => typeof tab.id === "number")
    .sort((a, b) => {
      if ((a.windowId ?? 0) !== (b.windowId ?? 0)) {
        return (a.windowId ?? 0) - (b.windowId ?? 0);
      }

      return (a.index ?? 0) - (b.index ?? 0);
    });

  const tab = tabs.at(-1);
  if (!tab) {
    throw new Error(`Chrome tab group "${TARGET_TAB_GROUP_TITLE}" does not contain any pages`);
  }

  return tab;
}

async function getActiveTabInfo(): Promise<ActiveTabInfo> {
  const tab = await getActiveTab();
  return {
    title: tab.title ?? "",
    url: tab.url ?? ""
  };
}

async function extractReadablePage(): Promise<ReadablePage> {
  return sendContentRequest<ReadablePage>("page.extract_readable_text");
}

async function observePage(): Promise<AgentHtmlSnapshot> {
  return sendContentRequest<AgentHtmlSnapshot>("browser.observe");
}

async function actOnPage(input: BrowserActInput): Promise<BrowserActResult> {
  return sendContentRequest<BrowserActResult>("browser.act", input);
}

async function sendContentRequest<T>(type: string, payload?: unknown): Promise<T> {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);

  const response = await chrome.tabs.sendMessage(tab.id, { type, payload }) as {
    ok: boolean;
    result?: T;
    error?: string;
  };

  if (!response?.ok) {
    throw new Error(response?.error ?? "Content script request failed");
  }

  return response.result as T;
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/content.js"]
  });
}

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, sendResponse) => {
  void handlePopupRequest(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function handlePopupRequest(
  message: PopupRequest
): Promise<PopupStatus | ActiveTabInfo | ReadablePage | AgentHtmlSnapshot> {
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
    case "popup.get_runtime_dom":
      return extractReadablePage();
    case "popup.get_observed_output":
      return observePage();
    default:
      throw new Error("Unsupported popup request");
  }
}

connectWebSocket();
