interface ReadablePage {
  title: string;
  url: string;
  html: string;
  text: string;
}

interface AgentHtmlSnapshot {
  snapshotId: string;
  format: "agent-html";
  html: string;
  meta: {
    elementCount: number;
    truncated: boolean;
  };
}

type BrowserActAction =
  | "click"
  | "input-text"
  | "select-option"
  | "toggle"
  | "focus"
  | "scroll-into-view";

interface BrowserActInput {
  snapshotId: string;
  elementId: string;
  action: BrowserActAction;
  text?: string;
  clearFirst?: boolean;
  value?: string;
  checked?: boolean;
}

interface BrowserActResult {
  ok: boolean;
  message?: string;
  error?: string;
  shouldObserveAgain: boolean;
}

interface ContentRequest {
  type: "page.extract_readable_text" | "browser.observe" | "browser.act";
  payload?: unknown;
}

interface RegistryState {
  snapshotId: string;
  elements: Map<string, Element>;
}

{
const GLOBAL_KEY = "__braiserContentState";
const MAX_TEXT_LENGTH = 120;
const MAX_AGENT_HTML_LENGTH = 60000;
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='menuitem']",
  "[role='tab']",
  "[tabindex='0']",
  "[aria-haspopup]",
  "[aria-expanded]",
  "[onclick]"
].join(",");

const SEMANTIC_TAGS = new Set([
  "header",
  "nav",
  "main",
  "aside",
  "footer",
  "section",
  "article",
  "form",
  "dialog",
  "menu",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "fieldset",
  "label",
  "p"
]);

const KEPT_ATTRIBUTES = [
  "href",
  "type",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-expanded",
  "aria-checked",
  "aria-selected",
  "aria-haspopup",
  "placeholder",
  "title",
  "alt",
  "value",
  "disabled",
  "contenteditable",
  "data-testid"
];

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: {
    listenerInstalled: boolean;
    registry: RegistryState | null;
    nextSnapshotNumber: number;
  };
};

if (!globalState[GLOBAL_KEY]) {
  globalState[GLOBAL_KEY] = {
    listenerInstalled: false,
    registry: null,
    nextSnapshotNumber: 1
  };
}

const state = globalState[GLOBAL_KEY];

if (!state.listenerInstalled) {
  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    void handleContentRequest(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });

  state.listenerInstalled = true;
}

async function handleContentRequest(message: ContentRequest): Promise<unknown> {
  switch (message.type) {
    case "page.extract_readable_text":
      return extractReadablePage();
    case "browser.observe":
      return observePage();
    case "browser.act":
      return actOnElement(assertActInput(message.payload));
    default:
      throw new Error("Unsupported content request");
  }
}

function getVisibleText(): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalizeText(node.textContent ?? "");
      if (!text) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const chunks: string[] = [];
  while (walker.nextNode()) {
    const text = normalizeText(walker.currentNode.textContent ?? "");
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.join("\n").replace(/\n{3,}/g, "\n\n");
}

function extractReadablePage(): ReadablePage {
  return {
    title: document.title,
    url: window.location.href,
    html: document.documentElement.outerHTML,
    text: getVisibleText()
  };
}

function observePage(): AgentHtmlSnapshot {
  const snapshotId = `S${state.nextSnapshotNumber++}`;
  const registry: RegistryState = {
    snapshotId,
    elements: new Map()
  };

  const interactiveElements = collectInteractiveElements();
  const keptElements = collectKeptElements(interactiveElements);
  const bodyHtml = serializeChildren(document.body, keptElements, registry);
  const pageOpen = `<page snapshot="${escapeAttribute(snapshotId)}" title="${escapeAttribute(document.title)}" url="${escapeAttribute(window.location.href)}">`;
  let html = `${pageOpen}\n${bodyHtml}\n</page>`;
  let truncated = false;

  if (html.length > MAX_AGENT_HTML_LENGTH) {
    html = `${html.slice(0, MAX_AGENT_HTML_LENGTH)}\n<!-- truncated -->\n</page>`;
    truncated = true;
  }

  state.registry = registry;

  return {
    snapshotId,
    format: "agent-html",
    html,
    meta: {
      elementCount: registry.elements.size,
      truncated
    }
  };
}

function collectInteractiveElements(): Element[] {
  return Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((element) => isElementCandidate(element) && isVisible(element));
}

function isElementCandidate(element: Element): boolean {
  if (element.closest("script,style,svg")) {
    return false;
  }

  if (element instanceof HTMLInputElement && element.type === "hidden") {
    return false;
  }

  return true;
}

function collectKeptElements(interactiveElements: Element[]): Set<Element> {
  const kept = new Set<Element>();

  for (const element of interactiveElements) {
    kept.add(element);

    let current = element.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isMeaningfulAncestor(current)) {
        kept.add(current);
      }

      current = current.parentElement;
    }
  }

  return kept;
}

function isMeaningfulAncestor(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    SEMANTIC_TAGS.has(tagName) ||
    element.hasAttribute("role") ||
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby") ||
    element.hasAttribute("data-testid")
  );
}

function serializeChildren(
  parent: Element,
  keptElements: Set<Element>,
  registry: RegistryState
): string {
  const parts: string[] = [];

  for (const child of Array.from(parent.children)) {
    const serialized = serializeElement(child, keptElements, registry, 1);
    if (serialized) {
      parts.push(serialized);
    }
  }

  return parts.join("\n");
}

function serializeElement(
  element: Element,
  keptElements: Set<Element>,
  registry: RegistryState,
  depth: number
): string {
  if (!isVisible(element) || shouldDropElement(element)) {
    return "";
  }

  if (!keptElements.has(element)) {
    return Array.from(element.children)
      .map((child) => serializeElement(child, keptElements, registry, depth))
      .filter(Boolean)
      .join("\n");
  }

  const tagName = element.tagName.toLowerCase();
  const elementId = isElementCandidate(element) && element.matches(INTERACTIVE_SELECTOR)
    ? `E${registry.elements.size + 1}`
    : "";

  if (elementId) {
    registry.elements.set(elementId, element);
  }

  const attributes = serializeAttributes(element, elementId);
  const text = directText(element);
  const childParts = Array.from(element.children)
    .map((child) => serializeElement(child, keptElements, registry, depth + 1))
    .filter(Boolean);

  if (!elementId && !text && childParts.length === 0) {
    return "";
  }

  const indent = "  ".repeat(depth);
  const open = attributes ? `<${tagName} ${attributes}>` : `<${tagName}>`;

  if (childParts.length === 0) {
    return `${indent}${open}${escapeText(text)}</${tagName}>`;
  }

  const textLine = text ? `${indent}  ${escapeText(text)}` : "";
  const body = [textLine, ...childParts].filter(Boolean).join("\n");
  return `${indent}${open}\n${body}\n${indent}</${tagName}>`;
}

function shouldDropElement(element: Element): boolean {
  return ["script", "style", "link", "meta", "svg", "path"].includes(
    element.tagName.toLowerCase()
  );
}

function serializeAttributes(element: Element, elementId: string): string {
  const attributes: string[] = [];

  if (elementId) {
    attributes.push(`data-eid="${escapeAttribute(elementId)}"`);
  }

  for (const name of KEPT_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null || value.length > 200) {
      continue;
    }

    if (name === "href") {
      attributes.push(`${name}="${escapeAttribute(trimUrl(value))}"`);
      continue;
    }

    attributes.push(`${name}="${escapeAttribute(value)}"`);
  }

  return attributes.join(" ");
}

function directText(element: Element): string {
  const chunks: string[] = [];

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.textContent ?? "");
      if (text) {
        chunks.push(text);
      }
    }
  }

  return truncateText(chunks.join(" "));
}

function actOnElement(input: BrowserActInput): BrowserActResult {
  const registry = state.registry;
  if (!registry) {
    return failure("invalid_snapshot", "No active snapshot. Please call browser.observe first.");
  }

  if (registry.snapshotId !== input.snapshotId) {
    return failure("invalid_snapshot", `Snapshot ${input.snapshotId} is not active. Please call browser.observe again.`);
  }

  const element = registry.elements.get(input.elementId);
  if (!element || !document.contains(element)) {
    return failure("stale_element", `Element ${input.elementId} no longer exists. Please call browser.observe again.`);
  }

  if (!isVisible(element)) {
    return failure("element_not_visible", `Element ${input.elementId} is not visible.`);
  }

  if (isDisabled(element)) {
    return failure("element_disabled", `Element ${input.elementId} is disabled.`);
  }

  try {
    executeAction(element, input);
    return {
      ok: true,
      message: "Action executed",
      shouldObserveAgain: true
    };
  } catch (error) {
    return failure(
      "execution_failed",
      error instanceof Error ? error.message : String(error)
    );
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
      throw new Error(`Unsupported action: ${input.action}`);
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
    if (clearFirst) {
      element.textContent = "";
    }
    element.textContent = `${element.textContent ?? ""}${text}`;
    dispatchInputEvents(element);
    return;
  }

  throw new Error("input-text is only supported for input, textarea, and contenteditable elements");
}

function selectOption(element: Element, value: string): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("select-option is only supported for select elements");
  }

  element.value = value;
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

function assertActInput(payload: unknown): BrowserActInput {
  if (!payload || typeof payload !== "object") {
    throw new Error("browser.act requires an input object");
  }

  const input = payload as Partial<BrowserActInput>;
  if (!input.snapshotId || !input.elementId || !input.action) {
    throw new Error("browser.act requires snapshotId, elementId, and action");
  }

  return input as BrowserActInput;
}

function failure(error: string, message: string): BrowserActResult {
  return {
    ok: false,
    error,
    message,
    shouldObserveAgain: true
  };
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isDisabled(element: Element): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}...` : text;
}

function trimUrl(url: string): string {
  return url.length > 180 ? `${url.slice(0, 180)}...` : url;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}
}
