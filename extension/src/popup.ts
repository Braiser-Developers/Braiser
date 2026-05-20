import type { ActiveTabInfo, PopupStatus } from "./protocol.js";

const connectionState = getElement("connectionState");
const bridgeStatus = getElement("bridgeStatus");
const tabTitle = getElement("tabTitle");
const tabUrl = getElement("tabUrl");
const refreshButton = getElement("refreshButton");

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function refresh(): Promise<void> {
  const [status, activeTab] = await Promise.all([
    sendRuntimeMessage<PopupStatus>({ type: "popup.get_status" }),
    sendRuntimeMessage<ActiveTabInfo>({ type: "popup.get_active_tab" })
  ]);

  connectionState.textContent = status.connectionState;
  connectionState.classList.toggle("connected", status.extensionConnected);
  bridgeStatus.textContent = formatBridgeStatus(status);

  tabTitle.textContent = activeTab.title || "未命名页面";
  tabUrl.textContent = activeTab.url || "";
}

refreshButton.addEventListener("click", () => {
  refresh().catch((error: unknown) => {
    bridgeStatus.textContent = error instanceof Error ? error.message : String(error);
  });
});

refresh().catch((error: unknown) => {
  bridgeStatus.textContent = error instanceof Error ? error.message : String(error);
});

function formatBridgeStatus(status: PopupStatus): string {
  switch (status.connectionState) {
    case "connected":
      return `已连接到 ${status.websocketUrl}`;
    case "connecting":
      return `正在连接 ${status.websocketUrl}`;
    case "offline":
      return `未连接到 ${status.websocketUrl}`;
  }
}
