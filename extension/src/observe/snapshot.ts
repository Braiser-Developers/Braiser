// DOM side of observe: Playwright builds the aria tree, Braiser assigns ids and renders (D-0013, D-0016).
import { generateAriaTree } from "../vendor/playwright/injected/ariaSnapshot";
import type { AriaNode } from "../vendor/playwright/isomorphic/ariaSnapshot";
import { resolveChildFrameIds } from "./frames";
import { collectActionable, frameTokenFor, renderAriaTree } from "./render";

export interface FrameSnapshot {
  text: string;
  elementCount: number;
  registry: Map<string, Element>;
}

function snapshotRoot(): Element {
  return document.body ?? document.documentElement;
}

export async function buildFrameSnapshot(idPrefix: string): Promise<FrameSnapshot> {
  const snapshot = generateAriaTree(snapshotRoot(), { mode: "ai" });
  const registry = new Map<string, Element>();
  const elementOf = (node: AriaNode) => node.ref ? snapshot.info.get(node.ref)?.element : undefined;
  const nextId = () => `${idPrefix}E${registry.size + 1}`;

  // The page body is focused by default; marking it [active] only adds noise.
  for (const child of snapshot.root.children) {
    if (typeof child !== "string" && elementOf(child) === document.body) child.active = false;
  }

  const iframes = snapshot.iframeRefs
    .map(ref => snapshot.info.get(ref)?.element)
    .filter((element): element is Element => !!element);
  const frameIds = await resolveChildFrameIds(iframes);

  let text = renderAriaTree(snapshot.root, {
    elementId(node) {
      const element = elementOf(node);
      const id = nextId();
      if (element) registry.set(id, element);
      return id;
    },
    frame(node) {
      const element = elementOf(node);
      const frameId = element ? frameIds.get(element) : undefined;
      return {
        name: element?.getAttribute("title") || element?.getAttribute("aria-label") || undefined,
        token: frameId === undefined ? undefined : frameTokenFor(frameId)
      };
    }
  }, { pageUrl: location.href, aliasPagePath: window.top === window });

  // Upload targets are often hidden behind a styled button; keep them reachable.
  const known = new Set(registry.values());
  const hiddenFileInputs = Array.from(document.querySelectorAll("input[type='file']"))
    .filter(input => !known.has(input) && !(input as HTMLInputElement).disabled);
  if (hiddenFileInputs.length) {
    const lines = hiddenFileInputs.map(input => {
      const id = nextId();
      registry.set(id, input);
      const attributes = ["accept", "multiple", "webkitdirectory"]
        .filter(name => input.hasAttribute(name))
        .map(name => name === "accept" ? ` accept="${input.getAttribute(name)}"` : ` [${name}]`)
        .join("");
      return `  - file input [${id}]${attributes}`;
    });
    text += `${text ? "\n" : ""}- hidden file inputs:\n${lines.join("\n")}`;
  }

  return { text, elementCount: registry.size, registry };
}

export function buildFrameInventory(): string[] {
  return collectActionable(generateAriaTree(snapshotRoot(), { mode: "ai" }).root);
}
