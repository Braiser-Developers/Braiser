// Content script entry, bundled into a classic script by scripts/build-extension.mjs (D-0015).
// It runs in every frame; the background stitches frame snapshots together (D-0016).
import { isElementVisible } from "./vendor/playwright/injected/domUtils";
import { setOwnFrameId } from "./observe/frames";
import { buildFrameInventory, buildFrameSnapshot } from "./observe/snapshot";
import type {
  BrowserActInput,
  ContentActResult,
  ContentInventory,
  ContentObserveInput,
  ContentRequest,
  FrameSnapshotResult,
  ReadablePage
} from "./protocol";

const GLOBAL_KEY = "__braiserContentState";
const CDP_BRIDGE_KEY = "__braiserCdpBridge";

interface ContentState {
  listenerInstalled: boolean;
  snapshotId: string | null;
  registry: Map<string, Element>;
}

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: ContentState;
  [CDP_BRIDGE_KEY]?: { version: 2; getSnapshotElement(snapshotId: string, elementId: string): Element | null };
};

const state = globalState[GLOBAL_KEY] ??= { listenerInstalled: false, snapshotId: null, registry: new Map() };

// browser.upload resolves the target element through CDP in this isolated world.
globalState[CDP_BRIDGE_KEY] = {
  version: 2,
  getSnapshotElement(snapshotId, elementId) {
    if (state.snapshotId !== snapshotId) return null;
    const element = state.registry.get(elementId);
    return element?.isConnected ? element : null;
  }
};

if (!state.listenerInstalled) {
  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    Promise.resolve()
      .then(() => handleContentRequest(message))
      .then(result => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
  state.listenerInstalled = true;
}

function handleContentRequest(message: ContentRequest): unknown {
  switch (message.type) {
    case "browser.frame_id":
      setOwnFrameId(message.payload.frameId);
      return true;
    case "page.extract_readable_text":
      return extractReadablePage();
    case "browser.observe":
      return observeFrame(message.payload as ContentObserveInput);
    case "browser.inventory":
      return inventory(message.payload as { snapshotId?: string } | undefined);
    case "browser.act":
      return actOnElement(message.payload as BrowserActInput);
    default:
      throw new Error("Unsupported content request");
  }
}

function extractReadablePage(): ReadablePage {
  return {
    title: document.title,
    url: location.href,
    html: document.documentElement.outerHTML,
    text: document.body?.innerText ?? ""
  };
}

async function observeFrame(input: ContentObserveInput): Promise<FrameSnapshotResult> {
  if (!input || typeof input.snapshotId !== "string" || typeof input.idPrefix !== "string") {
    throw new Error("browser.observe requires snapshotId and idPrefix");
  }
  const snapshot = await buildFrameSnapshot(input.idPrefix);
  state.snapshotId = input.snapshotId;
  state.registry = snapshot.registry;
  return { text: snapshot.text, elementCount: snapshot.elementCount };
}

function inventory(input: { snapshotId?: string } | undefined): ContentInventory {
  return {
    items: buildFrameInventory(),
    hasSnapshot: !!input?.snapshotId && state.snapshotId === input.snapshotId
  };
}

// ---------------------------------------------------------------------------
// Controlled page actions
// ---------------------------------------------------------------------------

function actOnElement(input: BrowserActInput): ContentActResult {
  if (!input || !input.snapshotId || !input.elementId || !input.action) {
    throw new Error("browser.act requires snapshotId, elementId, and action");
  }
  if (state.snapshotId !== input.snapshotId) {
    return failure("invalid_snapshot", `Snapshot ${input.snapshotId} is not active. Please call browser.observe again.`);
  }
  const element = state.registry.get(input.elementId);
  if (!element || !element.isConnected) {
    return failure("stale_element", `Element ${input.elementId} no longer exists. Please call browser.observe again.`);
  }
  if (!isElementVisible(element)) {
    return failure("element_not_visible", `Element ${input.elementId} is not visible.`);
  }
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return failure("element_disabled", `Element ${input.elementId} is disabled.`);
  }
  try {
    executeAction(element, input);
    return { ok: true };
  } catch (error) {
    return failure("execution_failed", error instanceof Error ? error.message : String(error));
  }
}

function executeAction(element: Element, input: BrowserActInput): void {
  switch (input.action) {
    case "click":
      (element as HTMLElement).click();
      return;
    case "input-text":
      inputText(element, input.text ?? "", input.clearFirst ?? true);
      return;
    case "select-option":
      selectOption(element, input.value ?? "");
      return;
    case "toggle":
      toggleElement(element, input.checked);
      return;
    case "focus":
      (element as HTMLElement).focus();
      return;
    case "scroll-into-view":
      element.scrollIntoView({ block: "center", inline: "center" });
      return;
    default:
      throw new Error(`Unsupported action: ${String(input.action)}`);
  }
}

function inputText(element: Element, text: string, clearFirst: boolean): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    element.value = clearFirst ? text : `${element.value}${text}`;
    dispatchInputEvents(element);
    return;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = clearFirst ? text : `${element.textContent ?? ""}${text}`;
    dispatchInputEvents(element);
    return;
  }
  throw new Error("input-text is only supported for input, textarea, and contenteditable elements");
}

// The snapshot shows option labels, not values, so either is accepted.
function selectOption(element: Element, value: string): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("select-option is only supported for select elements");
  }
  const options = Array.from(element.options);
  const option = options.find(candidate => candidate.value === value) ??
    options.find(candidate => candidate.label.trim() === value.trim() || candidate.text.trim() === value.trim());
  if (!option) throw new Error(`No option with value or label ${JSON.stringify(value)}`);
  element.value = option.value;
  dispatchInputEvents(element);
}

function toggleElement(element: Element, checked: boolean | undefined): void {
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
    element.checked = checked ?? !element.checked;
    dispatchInputEvents(element);
    return;
  }
  (element as HTMLElement).click();
}

function dispatchInputEvents(element: Element): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function failure(error: string, message: string): ContentActResult {
  return { ok: false, error, message };
}
