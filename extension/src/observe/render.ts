// Braiser's output layer on top of Playwright's aria tree (D-0013, D-0016).
// Pure functions: no DOM access, so the format can be unit tested in Node.
import type { AriaNode } from "../vendor/playwright/isomorphic/ariaSnapshot";

const ACTIONABLE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menuitem", "menuitemcheckbox",
  "menuitemradio", "option", "radio", "searchbox", "slider", "spinbutton", "switch", "tab",
  "textbox", "treeitem"
]);

export interface RenderHooks {
  /** Registers an actionable node and returns its Braiser element id. */
  elementId(node: AriaNode): string;
  /** Name of an iframe and the placeholder line that the background replaces with its snapshot. */
  frame(node: AriaNode): { name?: string; token?: string };
}

export interface RenderOptions {
  /** Same-origin link URLs are shortened to path, query and hash. */
  pageUrl?: string;
}

export function frameTokenFor(frameId: number): string {
  return `{{braiser-frame:${frameId}}}`;
}

export const FRAME_TOKEN_PATTERN = /^(\s*)\{\{braiser-frame:(\d+)\}\}$/gm;

function hasPointerCursor(node: AriaNode): boolean {
  return node.box?.cursor === "pointer";
}

/** Actionable nodes get an element id: interactive roles, plus the outermost pointer-cursor target. */
export function isActionable(node: AriaNode, insidePointerTarget: boolean): boolean {
  if (!node.ref) return false;
  if (ACTIONABLE_ROLES.has(node.role)) return true;
  return hasPointerCursor(node) && !insidePointerTarget && node.role !== "iframe";
}

function startsPointerTarget(node: AriaNode, insidePointerTarget: boolean): boolean {
  return insidePointerTarget || (!!node.ref && hasPointerCursor(node));
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function states(node: AriaNode): string {
  const parts: string[] = [];
  if (node.checked === true) parts.push("checked");
  if (node.checked === "mixed") parts.push("checked=mixed");
  if (node.disabled) parts.push("disabled");
  if (node.expanded) parts.push("expanded");
  if (node.active) parts.push("active");
  if (node.invalid) parts.push(node.invalid === true ? "invalid" : `invalid=${node.invalid}`);
  if (node.level) parts.push(`level=${node.level}`);
  if (node.pressed === true) parts.push("pressed");
  if (node.pressed === "mixed") parts.push("pressed=mixed");
  if (node.selected) parts.push("selected");
  return parts.map(part => ` [${part}]`).join("");
}

export function shortUrl(url: string, pageUrl?: string): string {
  if (!pageUrl) return url;
  try {
    const target = new URL(url, pageUrl);
    const page = new URL(pageUrl);
    if (target.origin !== page.origin) return target.href;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return url;
  }
}

function isLeaf(node: AriaNode): boolean {
  return node.children.every(child => typeof child === "string");
}

function leafText(node: AriaNode): string {
  return node.children.filter((child): child is string => typeof child === "string").join(" ").trim();
}

function hasStates(node: AriaNode): boolean {
  return states(node) !== "" || !!node.props.placeholder;
}

const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);
const PHRASING_ROLES = new Set(["generic", "strong", "emphasis", "code", "mark", "superscript", "subscript", "deletion", "insertion", "time", "img"]);

// A child that can be written inside a line of prose: text-only nodes and phrasing wrappers such as
// <sup><a>[9]</a></sup>. An actionable child may contain phrasing content but no other actionable node.
function isInlineChild(child: AriaNode, insidePointerTarget: boolean): boolean {
  if (hasStates(child) || child.role === "iframe" || VALUE_ROLES.has(child.role)) return false;
  if (isLeaf(child)) return true;
  const actionable = isActionable(child, insidePointerTarget);
  if (!actionable && !PHRASING_ROLES.has(child.role)) return false;
  const inner = startsPointerTarget(child, insidePointerTarget);
  return child.children.every(grandchild => typeof grandchild === "string" ||
    (isInlineChild(grandchild, inner) && (!actionable || !containsActionable(grandchild, inner))));
}

function containsActionable(node: AriaNode, insidePointerTarget: boolean): boolean {
  if (isActionable(node, insidePointerTarget)) return true;
  const inner = startsPointerTarget(node, insidePointerTarget);
  return node.children.some(child => typeof child !== "string" && containsActionable(child, inner));
}

// Prose such as a paragraph with links is rendered on one line: text [link text](E3 /url).
function canInline(node: AriaNode, childrenInsidePointerTarget: boolean): boolean {
  const hasText = node.children.some(child => typeof child === "string" && child.trim());
  return hasText && node.children.every(child => typeof child === "string" || isInlineChild(child, childrenInsidePointerTarget));
}

// Inline parts lost their original spacing; avoid " ," and "( x" artifacts when joining them.
function joinInline(parts: string[]): string {
  let text = "";
  for (const part of parts.map(part => part.trim()).filter(Boolean)) {
    const glue = !text || /^[,.;:!?)\]}%、，。；：！？）】」』]/.test(part) || /[(\[{（【「『]$/.test(text) ? "" : " ";
    text += glue + part;
  }
  return text;
}

// Text-only wrappers that merely repeat the accessible name, such as <a>Issues <span>2</span></a>.
// Inside a pointer target, descendants inherit the cursor but are not separately actionable.
function repeatsName(node: AriaNode, childrenInsidePointerTarget: boolean): boolean {
  if (!node.name || ["textbox", "searchbox", "combobox", "spinbutton", "slider"].includes(node.role)) return false;
  const name = node.name.replace(/\s+/g, "");
  const visit = (child: AriaNode | string): boolean => {
    if (typeof child === "string") return name.includes(child.replace(/\s+/g, ""));
    if (child.role !== "generic" || isActionable(child, childrenInsidePointerTarget) || hasStates(child)) return false;
    return (!child.name || name.includes(child.name.replace(/\s+/g, ""))) && child.children.every(visit);
  };
  return node.children.length > 0 && node.children.every(visit);
}

interface Context {
  hooks: RenderHooks;
  options: RenderOptions;
  lines: string[];
}

function renderInlineChild(child: AriaNode, insidePointerTarget: boolean, ctx: Context): string {
  if (isActionable(child, insidePointerTarget)) {
    const id = ctx.hooks.elementId(child);
    const url = child.props.url !== undefined ? ` ${shortUrl(child.props.url, ctx.options.pageUrl)}` : "";
    const role = child.role === "link" ? "" : ` ${child.role}`;
    return `[${nodeText(child)}](${id}${role}${url})`;
  }
  if (child.role === "img") return child.name ? `[img ${quote(child.name)}]` : "";
  if (isLeaf(child)) return child.name || leafText(child);
  const inner = startsPointerTarget(child, insidePointerTarget);
  return joinInline(child.children.map(grandchild => typeof grandchild === "string" ? grandchild : renderInlineChild(grandchild, inner, ctx)));
}

function renderNode(node: AriaNode, depth: number, insidePointerTarget: boolean, ctx: Context): void {
  const indent = "  ".repeat(depth);
  if (node.role === "iframe") {
    const { name, token } = ctx.hooks.frame(node);
    ctx.lines.push(`${indent}- iframe${name ? ` ${quote(name)}` : ""}${token ? ":" : ""}`);
    if (token) ctx.lines.push(`${"  ".repeat(depth + 1)}${token}`);
    return;
  }

  const actionable = isActionable(node, insidePointerTarget);
  const childPointer = startsPointerTarget(node, insidePointerTarget);
  let header = `${indent}- ${node.role}`;
  if (node.name) header += ` ${quote(node.name)}`;
  header += states(node);
  if (actionable) header += ` [${ctx.hooks.elementId(node)}]`;
  if (node.props.url !== undefined) header += ` → ${shortUrl(node.props.url, ctx.options.pageUrl)}`;
  if (node.props.placeholder !== undefined) header += ` placeholder=${quote(node.props.placeholder)}`;

  const children = repeatsName(node, childPointer) ? [] : node.children.filter(child => typeof child !== "string" || child.trim());
  if (children.length === 0) {
    ctx.lines.push(header);
    return;
  }
  if (children.length === 1 && typeof children[0] === "string") {
    ctx.lines.push(`${header}: ${children[0]}`);
    return;
  }
  if (canInline(node, childPointer)) {
    const parts = children.map(child => typeof child === "string" ? child : renderInlineChild(child, childPointer, ctx));
    ctx.lines.push(`${header}: ${joinInline(parts).replace(/\s+/g, " ")}`);
    return;
  }
  ctx.lines.push(`${header}:`);
  for (const child of children) {
    if (typeof child === "string") ctx.lines.push(`${"  ".repeat(depth + 1)}- text: ${child}`);
    else renderNode(child, depth + 1, childPointer, ctx);
  }
}

/** Renders the children of the aria tree root (a "fragment"). */
export function renderAriaTree(root: AriaNode, hooks: RenderHooks, options: RenderOptions = {}): string {
  const ctx: Context = { hooks, options, lines: [] };
  for (const child of root.children) {
    if (typeof child === "string") {
      if (child.trim()) ctx.lines.push(`- text: ${child}`);
    } else {
      renderNode(child, 0, false, ctx);
    }
  }
  return ctx.lines.join("\n");
}

function nodeText(node: AriaNode): string {
  if (node.name) return node.name;
  return node.children.map(child => typeof child === "string" ? child : nodeText(child))
    .join(" ").replace(/\s+/g, " ").trim();
}

/** "role name" entries for actionable nodes, used to describe what an action changed (D-0014). */
export function collectActionable(root: AriaNode): string[] {
  const items: string[] = [];
  const visit = (node: AriaNode, insidePointerTarget: boolean) => {
    if (node.role !== "fragment" && isActionable(node, insidePointerTarget)) {
      const text = nodeText(node);
      const name = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      items.push(name ? `${node.role} ${quote(name)}` : node.role);
    }
    const childPointer = node.role === "fragment" ? false : startsPointerTarget(node, insidePointerTarget);
    for (const child of node.children) {
      if (typeof child !== "string") visit(child, childPointer);
    }
  };
  visit(root, false);
  return items;
}

/** Multiset difference of two inventories, capped for a short action result. */
export function diffInventories(before: string[], after: string[], limit = 15): {
  added: string[]; removed: string[]; addedCount: number; removedCount: number;
} {
  const count = (items: string[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const beforeCount = count(before);
  const afterCount = count(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const item of after) {
    const remaining = beforeCount.get(item) ?? 0;
    if (remaining > 0) beforeCount.set(item, remaining - 1);
    else added.push(item);
  }
  for (const item of before) {
    const remaining = afterCount.get(item) ?? 0;
    if (remaining > 0) afterCount.set(item, remaining - 1);
    else removed.push(item);
  }
  return { added: added.slice(0, limit), removed: removed.slice(0, limit), addedCount: added.length, removedCount: removed.length };
}
