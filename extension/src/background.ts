import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type AgentHtmlSnapshot,
  type BrowserActInput,
  type BrowserActResult,
  type BridgeRuntimeRequest,
  type DebugInjectJsInput,
  type DebugInjectJsResult,
  type ExtensionRequest,
  type PopupRequest,
  type PopupStatus,
  type ReadablePage
} from "./protocol.js";

type ActiveChromeTab = chrome.tabs.Tab & { id: number };
const TARGET_TAB_GROUP_TITLE = "Braised";

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
    case "debug.inject_js":
      return injectDebugJs(request.payload as DebugInjectJsInput);
    default:
      throw new Error(`Unsupported request type: ${(request as ExtensionRequest).type}`);
  }
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

async function injectDebugJs(input: DebugInjectJsInput): Promise<DebugInjectJsResult> {
  if (!input || typeof input.script !== "string" || !input.script.trim()) {
    throw new Error("debug.inject_js requires a non-empty script string");
  }

  const tab = await getActiveTab();
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: async (script: string) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as {
        new (source: string): () => Promise<unknown>;
      };
      const value = await new AsyncFunction(script)();
      return JSON.parse(JSON.stringify(value ?? null)) as unknown;
    },
    args: [input.script]
  });

  return {
    ok: true,
    result: injection?.result
  };
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

chrome.runtime.onMessage.addListener((message: PopupRequest | BridgeRuntimeRequest, _sender, sendResponse) => {
  void handleRuntimeRequest(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function handleRuntimeRequest(
  message: PopupRequest | BridgeRuntimeRequest
): Promise<PopupStatus | ActiveTabInfo | ReadablePage | AgentHtmlSnapshot | unknown> {
  if (message.type === "bridge.handle_extension_request") {
    return handleExtensionRequest(message.request);
  }

  return handlePopupRequest(message);
}

async function handlePopupRequest(
  message: PopupRequest
): Promise<PopupStatus | ActiveTabInfo | ReadablePage | AgentHtmlSnapshot> {
  switch (message.type) {
    case "popup.get_status":
      const { connectionState = "offline" } = await chrome.storage.local.get("connectionState") as {
        connectionState?: PopupStatus["connectionState"];
      };
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
