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
    debug?: Record<string, unknown>;
  };
}

interface ObserveInput {
  bridgeRunId?: string;
  cdpRegisteredCount?: number;
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

interface CdpBridgeRun {
  createdAt: number;
  elements: Element[];
}

interface CdpBridge {
  version: 1;
  registerElement: (runId: string, element: unknown) => boolean;
}

interface AgentAttribute {
  name: string;
  value: string;
}

interface AgentTextNode {
  kind: "text";
  text: string;
  flow: "inline" | "line";
}

interface AgentElementNode {
  kind: "element";
  tagName: string;
  attributes: AgentAttribute[];
  children: AgentNode[];
  interactive: boolean;
  sourceElement: Element;
}

type AgentNode = AgentTextNode | AgentElementNode;

{
const GLOBAL_KEY = "__braiserContentState";
const CDP_BRIDGE_KEY = "__braiserCdpBridge";
const MAX_TEXT_LENGTH = 120;
const MAX_AGENT_HTML_LENGTH = 300000;
const CDP_BRIDGE_RUN_TTL_MS = 30_000;
const INDENT_UNIT = "  ";
const INDENT_RESET_DEPTH = 6;
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
    cdpBridgeRuns: Map<string, CdpBridgeRun>;
  };
  [CDP_BRIDGE_KEY]?: CdpBridge;
};

if (!globalState[GLOBAL_KEY]) {
  globalState[GLOBAL_KEY] = {
    listenerInstalled: false,
    registry: null,
    nextSnapshotNumber: 1,
    cdpBridgeRuns: new Map()
  };
} else if (!globalState[GLOBAL_KEY].cdpBridgeRuns) {
  globalState[GLOBAL_KEY].cdpBridgeRuns = new Map();
}

const state = globalState[GLOBAL_KEY];

// ---------------------------------------------------------------------------
// Content script bridge
// ---------------------------------------------------------------------------

globalState[CDP_BRIDGE_KEY] = {
  version: 1,
  registerElement(runId: string, element: unknown): boolean {
    pruneCdpBridgeRuns();
    if (!runId || !(element instanceof Element)) {
      return false;
    }

    const run = state.cdpBridgeRuns.get(runId) ?? {
      createdAt: Date.now(),
      elements: []
    };
    run.elements.push(element);
    state.cdpBridgeRuns.set(runId, run);
    return true;
  }
};

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
      return observePage(assertObserveInput(message.payload));
    case "browser.act":
      return actOnElement(assertActInput(message.payload));
    default:
      throw new Error("Unsupported content request");
  }
}

// ---------------------------------------------------------------------------
// Readable page extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Observe: DOM -> AgentNode tree -> simplified tree -> agent-html
// ---------------------------------------------------------------------------

// Keep docs/mvp_architecture.md browser.observe algorithm notes in sync when changing observe filtering or serialization.
function observePage(input: ObserveInput = {}): AgentHtmlSnapshot {
  pruneCdpBridgeRuns();
  const snapshotId = `S${state.nextSnapshotNumber++}`;
  const registry: RegistryState = {
    snapshotId,
    elements: new Map()
  };

  const localInteractiveElements = collectInteractiveElements();
  const cdpInteractiveElements = consumeCdpBridgeElements(input.bridgeRunId);
  const interactiveElements = dedupeElements([
    ...localInteractiveElements,
    ...cdpInteractiveElements
  ]).filter((element) => isElementCandidate(element) && isVisible(element));
  const interactiveElementSet = new Set(interactiveElements);
  const bodyNodes = buildAgentChildren(document.body, interactiveElementSet);
  const simplifiedNodes = simplifyAgentNodes(bodyNodes);
  assignElementIds(simplifiedNodes, registry);
  const bodyHtml = renderAgentNodes(simplifiedNodes);
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
      truncated,
      debug: {
        bridgeRunId: input.bridgeRunId ?? null,
        backgroundCdpRegisteredCount: input.cdpRegisteredCount ?? null,
        contentCdpReceivedCount: cdpInteractiveElements.length,
        localInteractiveCandidateCount: localInteractiveElements.length,
        interactiveCandidateCount: interactiveElements.length
      }
    }
  };
}

function assertObserveInput(payload: unknown): ObserveInput {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const input = payload as Partial<ObserveInput>;
  return {
    bridgeRunId: typeof input.bridgeRunId === "string"
      ? input.bridgeRunId
      : undefined,
    cdpRegisteredCount: typeof input.cdpRegisteredCount === "number"
      ? input.cdpRegisteredCount
      : undefined
  };
}

function collectInteractiveElements(): Element[] {
  return Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((element) => isElementCandidate(element) && isVisible(element));
}

function consumeCdpBridgeElements(runId: string | undefined): Element[] {
  if (!runId) {
    return [];
  }

  const elements = state.cdpBridgeRuns.get(runId)?.elements ?? [];
  state.cdpBridgeRuns.delete(runId);
  return elements;
}

function pruneCdpBridgeRuns(): void {
  const cutoff = Date.now() - CDP_BRIDGE_RUN_TTL_MS;
  for (const [runId, run] of state.cdpBridgeRuns) {
    if (run.createdAt < cutoff) {
      state.cdpBridgeRuns.delete(runId);
    }
  }
}

function dedupeElements(elements: Element[]): Element[] {
  return Array.from(new Set(elements));
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

function buildAgentChildren(parent: Element, interactiveElements: Set<Element>): AgentNode[] {
  return Array.from(parent.childNodes)
    .flatMap((child) => buildAgentChild(child, interactiveElements));
}

function buildAgentChild(node: ChildNode, interactiveElements: Set<Element>): AgentNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return buildAgentTextNodes(node.textContent ?? "");
  }

  if (node instanceof Element) {
    return buildAgentElement(node, interactiveElements);
  }

  return [];
}

function buildAgentElement(element: Element, interactiveElements: Set<Element>): AgentNode[] {
  if (shouldDropElement(element) || shouldDropInvisibleSubtree(element)) {
    return [];
  }

  const tagName = element.tagName.toLowerCase();
  const children = buildAgentChildren(element, interactiveElements);

  return [{
    kind: "element",
    tagName,
    attributes: collectAgentAttributes(element),
    children,
    interactive: interactiveElements.has(element),
    sourceElement: element
  }];
}

function simplifyAgentNodes(nodes: AgentNode[]): AgentNode[] {
  return mergeAdjacentInlineTextNodes(
    nodes.flatMap((node) => simplifyAgentNode(node))
  );
}

function simplifyAgentNode(node: AgentNode): AgentNode[] {
  if (node.kind === "text") {
    return [node];
  }

  const simplifiedChildren = simplifyAgentNodes(node.children);
  const simplifiedNode: AgentElementNode = {
    ...node,
    children: simplifiedChildren
  };

  if (!isTransparentWrapper(simplifiedNode)) {
    return [simplifiedNode];
  }

  if (simplifiedChildren.length === 0) {
    return [];
  }

  if (simplifiedChildren.every((child) => child.kind === "text")) {
    return simplifiedChildren;
  }

  if (simplifiedChildren.length === 1) {
    return simplifiedChildren;
  }

  return [simplifiedNode];
}

function mergeAdjacentInlineTextNodes(nodes: AgentNode[]): AgentNode[] {
  const merged: AgentNode[] = [];
  let inlineTexts: string[] = [];

  const flushInlineTexts = () => {
    if (inlineTexts.length === 0) {
      return;
    }

    merged.push({
      kind: "text",
      text: truncateText(normalizeText(inlineTexts.join(" "))),
      flow: "inline"
    });
    inlineTexts = [];
  };

  for (const node of nodes) {
    if (node.kind === "text" && node.flow === "inline") {
      inlineTexts.push(node.text);
      continue;
    }

    flushInlineTexts();
    merged.push(node);
  }

  flushInlineTexts();
  return merged;
}

function isTransparentWrapper(node: AgentElementNode): boolean {
  return (
    (node.tagName === "div" || node.tagName === "span") &&
    !node.interactive &&
    node.attributes.length === 0
  );
}

function assignElementIds(nodes: AgentNode[], registry: RegistryState): void {
  for (const node of nodes) {
    if (node.kind === "text") {
      continue;
    }

    if (node.interactive) {
      const elementId = `E${registry.elements.size + 1}`;
      node.attributes = [
        { name: "data-eid", value: elementId },
        ...node.attributes
      ];
      registry.elements.set(elementId, node.sourceElement);
    }

    assignElementIds(node.children, registry);
  }
}

function renderAgentNodes(nodes: AgentNode[], depth = 1): string {
  return nodes
    .map((node) => renderAgentNode(node, depth))
    .filter(Boolean)
    .join("\n");
}

function renderAgentNode(node: AgentNode, depth: number): string {
  const indent = observeIndent(depth);

  if (node.kind === "text") {
    return `${indent}${escapeText(node.text)}`;
  }

  const attributes = renderAgentAttributes(node.attributes);
  const open = attributes ? `<${node.tagName} ${attributes}>` : `<${node.tagName}>`;

  if (node.children.length === 0) {
    return `${indent}${open}</${node.tagName}>`;
  }

  if (node.children.length === 1 && node.children[0].kind === "text") {
    return `${indent}${open}${escapeText(node.children[0].text)}</${node.tagName}>`;
  }

  const body = renderAgentNodes(node.children, depth + 1);
  return `${indent}${open}\n${body}\n${indent}</${node.tagName}>`;
}

function observeIndent(depth: number): string {
  return INDENT_UNIT.repeat(depth % INDENT_RESET_DEPTH);
}

function shouldDropElement(element: Element): boolean {
  return ["script", "style", "link", "meta", "svg", "path"].includes(
    element.tagName.toLowerCase()
  );
}

function shouldDropInvisibleSubtree(element: Element): boolean {
  return isVisibilitySuppressed(element);
}

function collectAgentAttributes(element: Element): AgentAttribute[] {
  const attributes: AgentAttribute[] = [];
  for (const name of KEPT_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null || value.length > 200) {
      continue;
    }

    if (name === "href") {
      attributes.push({ name, value: trimUrl(value) });
      continue;
    }

    attributes.push({ name, value });
  }

  return attributes;
}

function renderAgentAttributes(attributes: AgentAttribute[]): string {
  return attributes
    .map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join(" ");
}

function buildAgentTextNodes(textContent: string): AgentTextNode[] {
  const lines = normalizeObserveTextLines(textContent);
  const flow = lines.length > 1 ? "line" : "inline";
  return lines.map((text) => ({
    kind: "text",
    text: truncateText(text),
    flow
  }));
}

function normalizeObserveTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Controlled page actions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared DOM and text helpers
// ---------------------------------------------------------------------------

function isVisible(element: Element): boolean {
  if (isVisibilitySuppressed(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return (
    rect.width > 0 &&
    rect.height > 0
  );
}

function isVisibilitySuppressed(element: Element): boolean {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return true;
  }

  if (element.hasAttribute("hidden")) {
    return true;
  }

  const style = window.getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
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
