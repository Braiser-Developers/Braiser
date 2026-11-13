import {
  BRAISER_WS_URL,
  type ActiveTabInfo,
  type BrowserActChanges,
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
  type BrowserUploadInput,
  type BrowserUploadResult,
  type BridgeRuntimeRequest,
  type ContentActResult,
  type ContentInventory,
  type ContentRequest,
  type DebugCdpCommandInput,
  type DebugCdpCommandResult,
  type DebugInjectJsInput,
  type DebugInjectJsResult,
  type ExtensionRequest,
  type FrameSnapshotResult,
  type PageSnapshot,
  type PopupRequest,
  type PopupStatus,
  type ReadablePage
} from "./protocol.js";
import { diffInventories, FRAME_TOKEN_PATTERN } from "./observe/render.js";

type ActiveChromeTab = chrome.tabs.Tab & { id: number };
const TARGET_TAB_GROUP_TITLE = "Braised";
const CDP_BRIDGE_GLOBAL = "__braiserCdpBridge";
const FOCUSED_TAB_STORAGE_KEY = "focusedBraisedTabId";
const SNAPSHOT_STORAGE_KEY = "braiserSnapshot";
const MAX_SNAPSHOT_LENGTH = 300000;
const ELEMENT_ID_PATTERN = /^(?:(F\d+))?E\d+$/;

// Kept in session storage because the MV3 service worker can restart between requests.
interface StoredSnapshot {
  snapshotId: string;
  tabId: number;
  frames: Record<string, number>;
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
    case "browser.upload":
      return uploadFiles(request.payload as BrowserUploadInput);
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
  // D-0020: tabs open in the background unless the caller explicitly asks for the front.
  const group = await getOrCreateBraisedGroup(input.url, input.active === true);
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
      active: input.active === true
    }));
    await chrome.tabs.group({ groupId: group.group.id, tabIds: [tab.id] });
  }

  await setFocusedTabId(tab.id);
  if (input.active === true) {
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
  if (input.activate === true) {
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
  initialUrl?: string,
  active = false
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

  // D-0019: creating the group must not bring a background tab to the front.
  const createdTab = assertTabId(await chrome.tabs.create({
    url: normalizeOptionalUrl(initialUrl),
    active
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
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  return sendContentRequestToFrame<ReadablePage>(tab.id, 0, { type: "page.extract_readable_text" });
}

// D-0016: every frame renders its own snapshot; iframe placeholders are replaced here.
async function observePage(): Promise<PageSnapshot> {
  const tab = await getActiveTab();
  const frameIds = await ensureContentScript(tab.id);
  const snapshotId = await nextSnapshotId();
  const frames: Record<string, number> = { "": 0 };
  const prefixOf = new Map<number, string>([[0, ""]]);
  frameIds.filter(frameId => frameId !== 0).forEach((frameId, index) => {
    frames[`F${index + 1}`] = frameId;
    prefixOf.set(frameId, `F${index + 1}`);
  });

  // Children must know their own frame id before parents probe them.
  await Promise.all(frameIds.map(frameId =>
    sendContentRequestToFrame(tab.id, frameId, { type: "browser.frame_id", payload: { frameId } }).catch(() => undefined)));
  const results = new Map<number, FrameSnapshotResult>();
  await Promise.all(frameIds.map(async frameId => {
    try {
      results.set(frameId, await sendContentRequestToFrame<FrameSnapshotResult>(tab.id, frameId, {
        type: "browser.observe",
        payload: { snapshotId, idPrefix: prefixOf.get(frameId) ?? "" }
      }));
    } catch (error) {
      if (frameId === 0) throw error;
    }
  }));
  const main = results.get(0);
  if (!main) throw new Error("Could not observe the page");

  const used = new Set<number>([0]);
  const expand = (text: string, depth: number): string => text.replace(FRAME_TOKEN_PATTERN, (_line, indent: string, id: string) => {
    const frameId = Number(id);
    const frame = results.get(frameId);
    if (!frame || used.has(frameId) || depth > 8) return `${indent}- text: (frame content unavailable)`;
    used.add(frameId);
    const body = expand(frame.text, depth + 1);
    return body ? body.split("\n").map(line => `${indent}${line}`).join("\n") : `${indent}- text: (empty frame)`;
  });
  let text = expand(main.text, 0);
  let elementCount = 0;
  for (const frameId of used) elementCount += results.get(frameId)?.elementCount ?? 0;

  await chrome.storage.session.set({ [SNAPSHOT_STORAGE_KEY]: { snapshotId, tabId: tab.id, frames } satisfies StoredSnapshot });

  const header = `- page ${JSON.stringify(tab.title ?? "")} → ${tab.url ?? ""}`;
  text = text ? `${header}\n${text}` : header;
  const truncated = text.length > MAX_SNAPSHOT_LENGTH;
  if (truncated) text = `${text.slice(0, MAX_SNAPSHOT_LENGTH)}\n- text: (snapshot truncated)`;
  return { snapshotId, format: "braiser-aria", text, meta: { elementCount, frameCount: used.size, truncated } };
}

async function nextSnapshotId(): Promise<string> {
  const { braiserSnapshotCounter = 0 } = await chrome.storage.session.get("braiserSnapshotCounter") as { braiserSnapshotCounter?: number };
  await chrome.storage.session.set({ braiserSnapshotCounter: braiserSnapshotCounter + 1 });
  return `S${braiserSnapshotCounter + 1}`;
}

async function resolveSnapshotFrame(snapshotId: string, elementId: string): Promise<{ tabId: number; frameId: number } | string> {
  const match = ELEMENT_ID_PATTERN.exec(elementId);
  if (!match) return `Element id ${elementId} is not valid. Use an id such as E3 or F1E3 from browser.observe.`;
  const stored = (await chrome.storage.session.get(SNAPSHOT_STORAGE_KEY))[SNAPSHOT_STORAGE_KEY] as StoredSnapshot | undefined;
  if (!stored || stored.snapshotId !== snapshotId) return `Snapshot ${snapshotId} is not active. Please call browser.observe again.`;
  const frameId = stored.frames[match[1] ?? ""];
  if (frameId === undefined) return `Element ${elementId} is not in snapshot ${snapshotId}.`;
  return { tabId: stored.tabId, frameId };
}

// D-0014: report success plus coarse changes; page text is never included.
async function actOnPage(input: BrowserActInput): Promise<BrowserActResult> {
  if (!input || typeof input.snapshotId !== "string" || typeof input.elementId !== "string") {
    return { ok: false, error: "invalid_input", message: "browser.act requires snapshotId and elementId.", snapshotValid: false };
  }
  const target = await resolveSnapshotFrame(input.snapshotId, input.elementId);
  if (typeof target === "string") return { ok: false, error: "invalid_snapshot", message: target, snapshotValid: false };
  const tab = assertTabId(await chrome.tabs.get(target.tabId));
  const focused = await getActiveTab();
  if (focused.id !== tab.id) {
    return { ok: false, error: "invalid_snapshot", message: "The snapshot belongs to another tab. Please call browser.observe again.", snapshotValid: false };
  }

  const before = await collectInventory(tab.id, input.snapshotId);
  const newTabs: Array<{ tabId: number; url: string }> = [];
  const downloads: string[] = [];
  const onTab = (created: chrome.tabs.Tab) => {
    if (created.openerTabId === tab.id && created.id !== undefined) newTabs.push({ tabId: created.id, url: created.pendingUrl ?? created.url ?? "" });
  };
  const onDownload = (item: chrome.downloads.DownloadItem) => { downloads.push(item.finalUrl || item.url); };
  chrome.tabs.onCreated.addListener(onTab);
  chrome.downloads.onCreated.addListener(onDownload);
  try {
    const result = await sendContentRequestToFrame<ContentActResult>(tab.id, target.frameId, { type: "browser.act", payload: input });
    if (!result.ok) return { ...result, snapshotValid: result.error !== "invalid_snapshot" && result.error !== "stale_element" };
    await waitForPageToSettle(tab.id);
  } finally {
    chrome.tabs.onCreated.removeListener(onTab);
    chrome.downloads.onCreated.removeListener(onDownload);
  }

  const afterTab = await chrome.tabs.get(tab.id);
  const after = await collectInventory(tab.id, input.snapshotId);
  const changes: BrowserActChanges = {};
  const navigated = !after.hasSnapshot || afterTab.url !== tab.url;
  if (navigated) changes.navigated = true;
  if (afterTab.url !== tab.url) changes.url = afterTab.url ?? "";
  if (afterTab.title !== tab.title) changes.title = afterTab.title ?? "";
  for (const created of newTabs) {
    const current = await chrome.tabs.get(created.tabId).catch(() => undefined);
    created.url = current?.pendingUrl || current?.url || created.url;
  }
  if (newTabs.length) changes.newTabs = newTabs;
  if (downloads.length) changes.downloads = downloads;
  // After a new document loads, listing every old element as removed is noise; navigation is the change.
  if (after.hasSnapshot) {
    const diff = diffInventories(before.items, after.items);
    if (diff.addedCount) { changes.added = diff.added; changes.addedCount = diff.addedCount; }
    if (diff.removedCount) { changes.removed = diff.removed; changes.removedCount = diff.removedCount; }
  }
  return { ok: true, snapshotValid: after.hasSnapshot, changes };
}

async function collectInventory(tabId: number, snapshotId: string): Promise<{ items: string[]; hasSnapshot: boolean }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const frameIds = await ensureContentScript(tabId);
      const results = await Promise.all(frameIds.map(frameId =>
        sendContentRequestToFrame<ContentInventory>(tabId, frameId, { type: "browser.inventory", payload: { snapshotId } })
          .then(result => ({ frameId, result }))
          .catch(() => undefined)));
      const main = results.find(entry => entry?.frameId === 0);
      if (!main) throw new Error("main frame unavailable");
      return { items: results.flatMap(entry => entry?.result.items ?? []), hasSnapshot: main.result.hasSnapshot };
    } catch {
      await delay(300);
    }
  }
  return { items: [], hasSnapshot: false };
}

// Gives the page a moment to react; waits for a started navigation to finish (bounded).
async function waitForPageToSettle(tabId: number): Promise<void> {
  await delay(400);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab || tab.status !== "loading") break;
    await delay(200);
  }
  await delay(100);
}

async function uploadFiles(input: BrowserUploadInput): Promise<BrowserUploadResult> {
  if (
    !input ||
    typeof input.snapshotId !== "string" ||
    typeof input.elementId !== "string" ||
    !Array.isArray(input.files) ||
    input.files.length === 0 ||
    input.files.some((file) => typeof file !== "string" || !file)
  ) {
    return uploadFailure("invalid_input", "browser.upload requires snapshotId, elementId, and one or more file paths.");
  }

  const tab = await getActiveTab();
  await ensureContentScript(tab.id);

  try {
    return await withDebuggerSession(tab.id, async (target) => {
      const objectId = await findSnapshotElementObject(target, input.snapshotId, input.elementId);
      if (!objectId) {
        return uploadFailure(
          "stale_element",
          `Element ${input.elementId} is not available in snapshot ${input.snapshotId}. Please call browser.observe again.`
        );
      }

      try {
        const validation = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(fileCount) {
            if (!(this instanceof HTMLInputElement) || this.type !== "file") {
              return { ok: false, error: "element_not_file_input", message: "Target element is not an input[type=file]." };
            }
            if (!this.isConnected) {
              return { ok: false, error: "stale_element", message: "Target file input is no longer connected." };
            }
            if (this.matches(":disabled") || this.getAttribute("aria-disabled") === "true") {
              return { ok: false, error: "element_disabled", message: "Target file input is disabled." };
            }
            if (fileCount > 1 && !this.multiple) {
              return { ok: false, error: "multiple_files_not_allowed", message: "Target file input does not allow multiple files." };
            }
            return { ok: true };
          }`,
          arguments: [{ value: input.files.length }],
          returnByValue: true,
          silent: true
        }) as CdpCallFunctionResult;
        const result = validation.result?.value as {
          ok?: boolean;
          error?: string;
          message?: string;
        } | undefined;
        if (!result?.ok) {
          return uploadFailure(
            result?.error ?? "invalid_upload_target",
            result?.message ?? "Target element cannot accept these files."
          );
        }

        await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", {
          objectId,
          files: input.files
        });

        return {
          ok: true,
          status: "files_selected",
          fileCount: input.files.length,
          targetUrl: tab.url ?? "",
          shouldObserveAgain: true
        };
      } finally {
        await chrome.debugger.sendCommand(target, "Runtime.releaseObject", { objectId })
          .catch(() => undefined);
      }
    });
  } catch (error) {
    return uploadFailure(
      "execution_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function uploadFailure(error: string, message: string): BrowserUploadResult {
  return {
    ok: false,
    error,
    message,
    shouldObserveAgain: true
  };
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

// browser.upload: each frame's content script lives in its own isolated world; try them all.
async function findSnapshotElementObject(
  target: chrome.debugger.Debuggee,
  snapshotId: string,
  elementId: string
): Promise<string | null> {
  const contexts: CdpExecutionContextDescription[] = [];
  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: unknown) => {
    if (source.tabId !== target.tabId || method !== "Runtime.executionContextCreated") return;
    const context = (params as { context?: CdpExecutionContextDescription } | undefined)?.context;
    if (typeof context?.id === "number") contexts.push(context);
  };

  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(target, "Runtime.enable");
    await delay(50);
    const isolated = contexts.filter((context) => context.auxData?.isDefault === false);
    for (const context of isolated.length ? isolated : contexts) {
      try {
        const resolved = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression: `globalThis.${CDP_BRIDGE_GLOBAL}?.getSnapshotElement(${JSON.stringify(snapshotId)}, ${JSON.stringify(elementId)}) ?? null`,
          contextId: context.id,
          returnByValue: false,
          silent: true
        }) as CdpEvaluateResult;
        if (resolved.result?.objectId) return resolved.result.objectId;
      } catch {
        // The context may belong to a frame that navigated away.
      }
    }
    return null;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Always address one frame: without frameId, Chrome delivers to every frame and takes the first reply.
async function sendContentRequestToFrame<T>(tabId: number, frameId: number, message: ContentRequest): Promise<T> {
  const response = await chrome.tabs.sendMessage(tabId, message, { frameId }) as {
    ok: boolean;
    result?: T;
    error?: string;
  } | undefined;

  if (!response?.ok) {
    throw new Error(response?.error ?? "Content script request failed");
  }

  return response.result as T;
}

// Injects the content script into frames that do not have it yet and returns the reachable frame ids.
async function ensureContentScript(tabId: number): Promise<number[]> {
  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => !!(globalThis as { __braiserContentState?: { listenerInstalled?: boolean } }).__braiserContentState?.listenerInstalled
  }).catch(() => [] as chrome.scripting.InjectionResult<boolean>[]);
  const frameIds = probes.map((probe) => probe.frameId);
  const missing = probes.filter((probe) => probe.result !== true).map((probe) => probe.frameId);
  if (!frameIds.includes(0)) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
    return [0];
  }
  if (missing.length) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: missing }, files: ["dist/content.js"] })
      .catch(() => undefined);
  }
  return frameIds;
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
): Promise<PopupStatus | ActiveTabInfo | ReadablePage | PageSnapshot | unknown> {
  if (message.type === "bridge.handle_extension_request") {
    return handleExtensionRequest(message.request);
  }

  return handlePopupRequest(message);
}

async function handlePopupRequest(
  message: PopupRequest
): Promise<PopupStatus | ActiveTabInfo | ReadablePage | PageSnapshot> {
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
