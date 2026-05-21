import type { ActiveTabInfo, AgentHtmlSnapshot, PopupStatus, ReadablePage } from "./protocol.js";

const connectionState = getElement("connectionState");
const bridgeStatus = getElement("bridgeStatus");
const tabTitle = getElement("tabTitle");
const tabUrl = getElement("tabUrl");
const refreshButton = getElement("refreshButton");
const downloadDomButton = getElement("downloadDomButton") as HTMLButtonElement;
const downloadObserveButton = getElement("downloadObserveButton") as HTMLButtonElement;

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {
    ok?: boolean;
    result?: T;
    error?: string;
  };

  if (response?.ok === false) {
    throw new Error(response.error ?? "Extension request failed");
  }

  return response?.result ?? response as T;
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

downloadDomButton.addEventListener("click", () => {
  downloadRuntimeDom().catch(showError);
});

downloadObserveButton.addEventListener("click", () => {
  downloadObservedOutput().catch(showError);
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

async function downloadRuntimeDom(): Promise<void> {
  setButtonBusy(downloadDomButton, true);
  try {
    const page = await sendRuntimeMessage<ReadablePage>({ type: "popup.get_runtime_dom" });
    downloadTextFile(
      `${fileStamp()}-${hostFromUrl(page.url)}-runtime-dom.html`,
      page.html,
      "text/html"
    );
  } finally {
    setButtonBusy(downloadDomButton, false);
  }
}

async function downloadObservedOutput(): Promise<void> {
  setButtonBusy(downloadObserveButton, true);
  try {
    const snapshot = await sendRuntimeMessage<AgentHtmlSnapshot>({
      type: "popup.get_observed_output"
    });
    downloadTextFile(
      `${fileStamp()}-${snapshot.snapshotId}-observed-output.json`,
      JSON.stringify(snapshot, null, 2),
      "application/json"
    );
  } finally {
    setButtonBusy(downloadObserveButton, false);
  }
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/[^a-zA-Z0-9.-]+/g, "-") || "page";
  } catch {
    return "page";
  }
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.textContent = busy ? "处理中..." : button.dataset.label ?? button.textContent;
}

function showError(error: unknown): void {
  bridgeStatus.textContent = error instanceof Error ? error.message : String(error);
}

for (const button of [downloadDomButton, downloadObserveButton]) {
  button.dataset.label = button.textContent ?? "";
}
