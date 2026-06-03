import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type AgentHtmlSnapshot,
  type BrowserActInput,
  type BrowserActResult,
  type BrowserCloseTabInput,
  type BrowserCreateTabInput,
  type BrowserDownloadInput,
  type BrowserDownloadResult,
  type BrowserOpenTabInput,
  type BrowserSwitchTabInput,
  type BrowserTabInfo,
  type BrowserTabList,
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
const CDP_BRIDGE_GLOBAL = "__braiserCdpBridge";
const FOCUSED_TAB_STORAGE_KEY = "focusedBraisedTabId";

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

interface CdpExecutionContextDescription {
  id: number;
  name?: string;
  origin?: string;
  auxData?: {
    frameId?: string;
    isDefault?: boolean;
    type?: string;
  };
}

interface CdpEvaluateResult {
  result?: {
    type?: string;
    value?: unknown;
    objectId?: string;
  };
}

interface CdpResolveNodeResult {
  object?: {
    objectId?: string;
  };
}

interface CdpCallFunctionResult {
  result?: {
    value?: unknown;
  };
}

async function handleExtensionRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "browser.get_active_tab":
      return getActiveTabInfo();
    case "browser.list_tabs":
      return listTabs();
    case "browser.create_tab":
      return createTab(request.payload as BrowserCreateTabInput);
    case "browser.open_tab":
      return openTab(request.payload as BrowserOpenTabInput);
    case "browser.close_tab":
      return closeTab(request.payload as BrowserCloseTabInput);
    case "browser.switch_tab":
      return switchTab(request.payload as BrowserSwitchTabInput);
    case "browser.download":
      return downloadUrl(request.payload as BrowserDownloadInput);
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
  const tabs = await getBraisedTabs();
  const focusedTabId = await getFocusedTabId();
  const focusedTab = tabs.find((tab) => tab.id === focusedTabId);
  if (focusedTab) {
    return focusedTab;
  }

  const fallback = tabs.at(-1);
  if (!fallback) {
    throw new Error(`Chrome tab group "${TARGET_TAB_GROUP_TITLE}" does not contain any pages`);
  }

  await setFocusedTabId(fallback.id);
  return fallback;
}

async function getBraisedTabs(): Promise<ActiveChromeTab[]> {
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

  return tabs;
}

async function getActiveTabInfo(): Promise<ActiveTabInfo> {
  const tab = await getActiveTab();
  return tabToInfo(tab, true);
}

async function listTabs(): Promise<BrowserTabList> {
  const focusedTab = await getActiveTab();
  const tabs = await getBraisedTabs();
  return {
    focusedTabId: focusedTab.id,
    tabs: tabs.map((tab) => tabToInfo(tab, tab.id === focusedTab.id))
  };
}

async function createTab(input: BrowserCreateTabInput = {}): Promise<BrowserTabInfo> {
  const group = await getOrCreateBraisedGroup(input.url);
  const url = normalizeOptionalUrl(input.url);
  let tab: ActiveChromeTab;

  if (group.createdTab) {
    tab = group.createdTab;
    if (url && tab.url !== url) {
      tab = assertTabId(await chrome.tabs.update(tab.id, { url }));
    }
  } else {
    tab = assertTabId(await chrome.tabs.create({
      windowId: group.group.windowId,
      url,
      active: input.active ?? true
    }));
    await chrome.tabs.group({ groupId: group.group.id, tabIds: [tab.id] });
  }

  await setFocusedTabId(tab.id);
  if (input.active !== false) {
    await activateTab(tab.id, tab.windowId);
  }

  const refreshed = assertTabId(await chrome.tabs.get(tab.id));
  return tabToInfo(refreshed, true);
}

async function openTab(input: BrowserOpenTabInput): Promise<BrowserTabInfo> {
  if (!input || typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("browser.open_tab requires a non-empty url string");
  }

  const tab = input.tabId === undefined ? await getActiveTab() : await getBraisedTabById(input.tabId);
  const updated = assertTabId(await chrome.tabs.update(tab.id, {
    url: normalizeRequiredUrl(input.url),
    active: input.active ?? tab.active
  }));

  await setFocusedTabId(updated.id);
  if (input.active === true) {
    await activateTab(updated.id, updated.windowId);
  }

  const refreshed = assertTabId(await chrome.tabs.get(updated.id));
  return tabToInfo(refreshed, true);
}

async function closeTab(input: BrowserCloseTabInput = {}): Promise<BrowserTabList> {
  const tab = input.tabId === undefined ? await getActiveTab() : await getBraisedTabById(input.tabId);
  const focusedTabId = await getFocusedTabId();
  await chrome.tabs.remove(tab.id);

  const tabs = (await getBraisedTabs().catch(() => []))
    .filter((candidate) => candidate.id !== tab.id);
  const preservedFocus = tabs.find((candidate) => candidate.id === focusedTabId);
  const nextTab = preservedFocus ?? tabs.at(Math.min(tab.index, Math.max(tabs.length - 1, 0))) ?? tabs.at(-1);
  if (!nextTab) {
    await chrome.storage.local.remove(FOCUSED_TAB_STORAGE_KEY);
    return {
      focusedTabId: -1,
      tabs: []
    };
  }

  await setFocusedTabId(nextTab.id);
  return {
    focusedTabId: nextTab.id,
    tabs: tabs.map((candidate) => tabToInfo(candidate, candidate.id === nextTab.id))
  };
}

async function switchTab(input: BrowserSwitchTabInput): Promise<BrowserTabInfo> {
  if (!input || !Number.isInteger(input.tabId)) {
    throw new Error("browser.switch_tab requires an integer tabId");
  }

  const tab = await getBraisedTabById(input.tabId);
  await setFocusedTabId(tab.id);
  if (input.activate !== false) {
    await activateTab(tab.id, tab.windowId);
  }

  const refreshed = assertTabId(await chrome.tabs.get(tab.id));
  return tabToInfo(refreshed, true);
}

async function downloadUrl(input: BrowserDownloadInput): Promise<BrowserDownloadResult> {
  if (!input || typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("browser.download requires a non-empty url string");
  }

  const tab = await getActiveTab();
  const url = resolveDownloadUrl(input.url, tab.url);
  const options: chrome.downloads.DownloadOptions = {
    url,
    conflictAction: input.conflictAction ?? "uniquify",
    saveAs: input.saveAs ?? false
  };

  if (input.filename !== undefined) {
    options.filename = normalizeDownloadFilename(input.filename);
  }

  const downloadId = await chrome.downloads.download(options);
  const [item] = await chrome.downloads.search({ id: downloadId });

  return {
    downloadId,
    url,
    filename: item?.filename,
    state: item?.state,
    danger: item?.danger,
    mime: item?.mime,
    totalBytes: item?.totalBytes
  };
}

function tabToInfo(tab: ActiveChromeTab, focused: boolean): BrowserTabInfo {
  return {
    tabId: tab.id,
    title: tab.title ?? "",
    url: tab.url ?? "",
    windowId: tab.windowId,
    index: tab.index,
    active: tab.active,
    focused
  };
}

async function getFocusedTabId(): Promise<number | null> {
  const stored = await chrome.storage.local.get(FOCUSED_TAB_STORAGE_KEY) as {
    [FOCUSED_TAB_STORAGE_KEY]?: unknown;
  };
  return Number.isInteger(stored[FOCUSED_TAB_STORAGE_KEY])
    ? stored[FOCUSED_TAB_STORAGE_KEY] as number
    : null;
}

async function setFocusedTabId(tabId: number): Promise<void> {
  await chrome.storage.local.set({ [FOCUSED_TAB_STORAGE_KEY]: tabId });
}

async function getBraisedTabById(tabId: number): Promise<ActiveChromeTab> {
  if (!Number.isInteger(tabId)) {
    throw new Error("tabId must be an integer");
  }

  const tabs = await getBraisedTabs();
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    throw new Error(`Tab ${tabId} is not in the "${TARGET_TAB_GROUP_TITLE}" tab group`);
  }

  return tab;
}

async function activateTab(tabId: number, windowId: number): Promise<void> {
  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
}

async function getOrCreateBraisedGroup(
  initialUrl?: string
): Promise<{ group: chrome.tabGroups.TabGroup; createdTab?: ActiveChromeTab }> {
  const groups = await chrome.tabGroups.query({});
  const group = groups
    .filter((candidate) => candidate.title === TARGET_TAB_GROUP_TITLE)
    .sort((a, b) => {
      if (a.windowId !== b.windowId) {
        return a.windowId - b.windowId;
      }
      return a.id - b.id;
    })
    .at(-1);
  if (group) {
    return { group };
  }

  const createdTab = assertTabId(await chrome.tabs.create({
    url: normalizeOptionalUrl(initialUrl),
    active: true
  }));
  const groupId = await chrome.tabs.group({ tabIds: [createdTab.id] });
  const createdGroup = await chrome.tabGroups.update(groupId, { title: TARGET_TAB_GROUP_TITLE });
  if (!createdGroup) {
    throw new Error(`Failed to create Chrome tab group "${TARGET_TAB_GROUP_TITLE}"`);
  }

  return {
    group: createdGroup,
    createdTab
  };
}

function assertTabId(tab: chrome.tabs.Tab | undefined): ActiveChromeTab {
  if (!tab || typeof tab.id !== "number") {
    throw new Error("Chrome returned a tab without an id");
  }
  return tab as ActiveChromeTab;
}

function normalizeOptionalUrl(url: unknown): string | undefined {
  if (url === undefined || url === null || url === "") {
    return undefined;
  }
  if (typeof url !== "string") {
    throw new Error("url must be a string when provided");
  }
  return normalizeRequiredUrl(url);
}

function normalizeRequiredUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("url must not be empty");
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function resolveDownloadUrl(url: string, baseUrl?: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("url must not be empty");
  }

  try {
    return new URL(trimmed, baseUrl || undefined).toString();
  } catch {
    throw new Error("browser.download url must be absolute or relative to the current page");
  }
}

function normalizeDownloadFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new Error("browser.download filename must not be empty");
  }
  if (/[\\/]/.test(trimmed) || trimmed.includes("..")) {
    throw new Error("browser.download filename must be a file name, not a path");
  }
  return trimmed;
}

async function extractReadablePage(): Promise<ReadablePage> {
  return sendContentRequest<ReadablePage>("page.extract_readable_text");
}

async function observePage(): Promise<AgentHtmlSnapshot> {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);

  const bridgeRunId = createBridgeRunId();
  const cdpRegisteredCount = await registerCdpClickableElements(tab.id, bridgeRunId);
  return sendContentRequestToTab<AgentHtmlSnapshot>(tab.id, "browser.observe", {
    bridgeRunId,
    cdpRegisteredCount
  });
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

async function registerCdpClickableElements(tabId: number, bridgeRunId: string): Promise<number> {
  try {
    return await withDebuggerSession(tabId, async (target) => {
      const contextId = await findCdpBridgeContextId(target);
      if (!contextId) {
        return 0;
      }

      const snapshot = await chrome.debugger.sendCommand(
        target,
        "DOMSnapshot.captureSnapshot",
        { computedStyles: [] }
      ) as CdpSnapshotResult;
      const nodes = snapshot.documents?.[0]?.nodes;
      const clickableIndexes = nodes?.isClickable?.index ?? [];
      const backendNodeIds = nodes?.backendNodeId ?? [];
      const nodeTypes = nodes?.nodeType ?? [];
      let registeredCount = 0;

      for (const nodeIndex of clickableIndexes) {
        if (nodeTypes[nodeIndex] !== 1) {
          continue;
        }

        const backendNodeId = backendNodeIds[nodeIndex];
        if (!backendNodeId) {
          continue;
        }

        if (await registerCdpBackendNode(target, backendNodeId, contextId, bridgeRunId)) {
          registeredCount++;
        }
      }

      return registeredCount;
    });
  } catch {
    // CDP clickability is a best-effort supplement; base observe should still work.
    return 0;
  }
}

async function findCdpBridgeContextId(
  target: chrome.debugger.Debuggee
): Promise<number | null> {
  const contexts: CdpExecutionContextDescription[] = [];
  const onEvent = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: unknown
  ) => {
    if (source.tabId !== target.tabId || method !== "Runtime.executionContextCreated") {
      return;
    }

    const context = (params as { context?: CdpExecutionContextDescription } | undefined)?.context;
    if (typeof context?.id === "number") {
      contexts.push(context);
    }
  };

  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(target, "Runtime.enable");
    await delay(50);

    const isolatedContexts = contexts.filter((context) => context.auxData?.isDefault === false);
    const candidates = isolatedContexts.length ? isolatedContexts : contexts;
    for (const context of candidates) {
      if (await isCdpBridgeContext(target, context.id)) {
        return context.id;
      }
    }

    return null;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
  }
}

async function isCdpBridgeContext(
  target: chrome.debugger.Debuggee,
  contextId: number
): Promise<boolean> {
  try {
    const result = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `globalThis.${CDP_BRIDGE_GLOBAL}?.version === 1`,
      contextId,
      returnByValue: true,
      silent: true
    }) as CdpEvaluateResult;

    return result.result?.value === true;
  } catch {
    return false;
  }
}

async function registerCdpBackendNode(
  target: chrome.debugger.Debuggee,
  backendNodeId: number,
  executionContextId: number,
  bridgeRunId: string
): Promise<boolean> {
  let objectId: string | undefined;
  try {
    const resolved = await chrome.debugger.sendCommand(
      target,
      "DOM.resolveNode",
      { backendNodeId, executionContextId }
    ) as CdpResolveNodeResult;
    objectId = resolved.object?.objectId;
    if (!objectId) {
      return false;
    }

    const registration = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(runId) {
        return globalThis.${CDP_BRIDGE_GLOBAL}?.registerElement(runId, this) === true;
      }`,
      arguments: [{ value: bridgeRunId }],
      returnByValue: true,
      silent: true
    }) as CdpCallFunctionResult;
    return registration.result?.value === true;
  } catch {
    return false;
  } finally {
    if (objectId) {
      await chrome.debugger.sendCommand(target, "Runtime.releaseObject", { objectId })
        .catch(() => undefined);
    }
  }
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

function createBridgeRunId(): string {
  return `cdp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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
