import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionBridge } from "./websocket.js";
import type { ActiveTabInfo, CleanPage, ReadablePage } from "./protocol.js";
import { cleanReadablePage } from "./cleaner.js";
import { savePage } from "./storage.js";

export const tools: Tool[] = [
  {
    name: "braiser.status",
    description: "Check whether the Braiser MCP process and Chrome extension are connected.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "browser.get_active_tab",
    description: "Get the current Chrome active tab title and URL.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "page.extract_readable_text",
    description: "Extract readable text from the current Chrome page.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "page.save_current_page",
    description: "Extract the current Chrome page and save it locally as Markdown.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export async function callTool(name: string, bridge: ExtensionBridge): Promise<unknown> {
  switch (name) {
    case "braiser.status":
      return {
        mcp: "ok",
        extensionConnected: bridge.isExtensionConnected()
      };

    case "browser.get_active_tab":
      return bridge.request<ActiveTabInfo>("browser.get_active_tab");

    case "page.extract_readable_text":
      return extractReadableText(bridge);

    case "page.save_current_page":
      return saveCurrentPage(bridge);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function extractReadableText(bridge: ExtensionBridge): Promise<CleanPage> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text");
  return cleanReadablePage(page);
}

async function saveCurrentPage(bridge: ExtensionBridge): Promise<CleanPage & { filePath: string }> {
  const page = await extractReadableText(bridge);
  const filePath = await savePage(page);
  return {
    ...page,
    filePath
  };
}
