import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type AgentHtmlSnapshot,
  type BrowserActInput,
  type BrowserActResult,
  type BridgeRuntimeRequest,
  type DebugCdpCommandInput,
  type DebugCdpCommandResult,
  type DebugInjectJsInput,
  type DebugInjectJsResult,
  type ExtensionRequest,
  type PopupRequest,
  type PopupStatus,
  type ReadablePage
} from "./protocol.js";

type ActiveChromeTab = chrome.tabs.Tab & { id: number };
const TARGET_TAB_GROUP_TITLE = "Braised";
const CDP_CLICKABLE_ATTRIBUTE = "data-braiser-cdp-clickable";
const CDP_CLICKABLE_VALUE = "true";

interface CdpSnapshotResult {
  documents?: Array<{
    nodes?: {
      backendNodeId?: number[];
      isClickable?: {
        index?: number[];
      };
      nodeType?: number[];
    };
  }>;
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
    case "debug.inject_js":
      return injectDebugJs(request.payload as DebugInjectJsInput);
    case "debug.cdp_command":
      return sendDebugCdpCommand(request.payload as DebugCdpCommandInput);
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
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);

  const cdpClickableMarkedCount = await markCdpClickableElements(tab.id);
  const backgroundMarkerDomCount = await countCdpClickableMarkers(tab.id);
  try {
    return sendContentRequestToTab<AgentHtmlSnapshot>(tab.id, "browser.observe", {
      cdpClickableMarkedCount,
      backgroundMarkerDomCount
    });
  } finally {
    await clearCdpClickableMarkers(tab.id);
  }
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

async function sendDebugCdpCommand(input: DebugCdpCommandInput): Promise<DebugCdpCommandResult> {
  if (!input || typeof input.method !== "string" || !input.method.trim()) {
    throw new Error("debug.cdp_command requires a non-empty method string");
  }

  if (
    input.params !== undefined &&
    (!input.params || typeof input.params !== "object" || Array.isArray(input.params))
  ) {
    throw new Error("debug.cdp_command params must be an object when provided");
  }

  const tab = await getActiveTab();
  const result = await withDebuggerSession(tab.id, (target) =>
    chrome.debugger.sendCommand(
      target,
      input.method,
      input.params ?? {}
    )
  );

  return {
    ok: true,
    result: JSON.parse(JSON.stringify(result ?? null)) as unknown
  };
}

async function markCdpClickableElements(tabId: number): Promise<number> {
  try {
    return await withDebuggerSession(tabId, async (target) => {
      await chrome.debugger.sendCommand(target, "DOM.getDocument", { depth: 0 });
      const snapshot = await chrome.debugger.sendCommand(
        target,
        "DOMSnapshot.captureSnapshot",
        { computedStyles: [] }
      ) as CdpSnapshotResult;
      const nodes = snapshot.documents?.[0]?.nodes;
      const clickableIndexes = nodes?.isClickable?.index ?? [];
      const backendNodeIds = nodes?.backendNodeId ?? [];
      const nodeTypes = nodes?.nodeType ?? [];
      let markedCount = 0;

      for (const nodeIndex of clickableIndexes) {
        if (nodeTypes[nodeIndex] !== 1) {
          continue;
        }

        const backendNodeId = backendNodeIds[nodeIndex];
        if (!backendNodeId) {
          continue;
        }

        if (await setCdpBackendNodeAttribute(target, backendNodeId)) {
          markedCount++;
        }
      }

      return markedCount;
    });
  } catch {
    // CDP clickability is a best-effort supplement; base observe should still work.
    return 0;
  }
}

async function setCdpBackendNodeAttribute(
  target: chrome.debugger.Debuggee,
  backendNodeId: number
): Promise<boolean> {
  try {
    const pushed = await chrome.debugger.sendCommand(
      target,
      "DOM.pushNodesByBackendIdsToFrontend",
      { backendNodeIds: [backendNodeId] }
    ) as {
      nodeIds?: number[];
    };
    const nodeId = pushed.nodeIds?.[0];
    if (!nodeId) {
      return false;
    }

    await chrome.debugger.sendCommand(target, "DOM.setAttributeValue", {
      nodeId,
      name: CDP_CLICKABLE_ATTRIBUTE,
      value: CDP_CLICKABLE_VALUE
    });
    return true;
  } catch {
    return false;
  }
}

async function clearCdpClickableMarkers(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (attributeName: string) => {
      document.querySelectorAll(`[${attributeName}]`).forEach((element) => {
        element.removeAttribute(attributeName);
      });
    },
    args: [CDP_CLICKABLE_ATTRIBUTE]
  }).catch(() => undefined);
}

async function countCdpClickableMarkers(tabId: number): Promise<number> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (attributeName: string) => document.querySelectorAll(`[${attributeName}]`).length,
    args: [CDP_CLICKABLE_ATTRIBUTE]
  });

  return typeof result?.result === "number" ? result.result : 0;
}

async function withDebuggerSession<T>(
  tabId: number,
  callback: (target: chrome.debugger.Debuggee) => Promise<T>
): Promise<T> {
  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    return await callback(target);
  } finally {
    if (attached) {
      await chrome.debugger.detach(target).catch(() => undefined);
    }
  }
}

async function sendContentRequest<T>(type: string, payload?: unknown): Promise<T> {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);

  return sendContentRequestToTab<T>(tab.id, type, payload);
}

async function sendContentRequestToTab<T>(
  tabId: number,
  type: string,
  payload?: unknown
): Promise<T> {
  const response = await chrome.tabs.sendMessage(tabId, { type, payload }) as {
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
