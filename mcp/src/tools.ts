import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionBridge } from "./websocket.js";
import type {
  ActiveTabInfo,
  AgentHtmlSnapshot,
  BrowserActInput,
  BrowserActResult,
  CleanPage,
  DebugInjectJsInput,
  DebugInjectJsResult,
  ReadablePage
} from "./protocol.js";
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
    description: "Get the title and URL of the last Chrome tab in the Braised tab group.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "browser.observe",
    description: "Observe the last Chrome tab in the Braised tab group and return compressed agent-html with data-eid handles for interactive elements.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "browser.act",
    description: "Act on an element from the latest browser.observe snapshot by snapshotId and elementId.",
    inputSchema: {
      type: "object",
      properties: {
        snapshotId: {
          type: "string",
          description: "Snapshot id returned by browser.observe, such as S1."
        },
        elementId: {
          type: "string",
          description: "Element id from agent-html data-eid, such as E2."
        },
        action: {
          type: "string",
          enum: [
            "click",
            "input-text",
            "select-option",
            "toggle",
            "focus",
            "scroll-into-view"
          ]
        },
        text: {
          type: "string",
          description: "Text for input-text."
        },
        clearFirst: {
          type: "boolean",
          description: "Whether input-text should clear existing content first."
        },
        value: {
          type: "string",
          description: "Option value for select-option."
        },
        checked: {
          type: "boolean",
          description: "Target checked state for toggle."
        }
      },
      required: ["snapshotId", "elementId", "action"],
      additionalProperties: false
    }
  },
  {
    name: "debug.inject_js",
    description: "For debug purpose only: directly inject JavaScript into the active Braised page and return a JSON-serializable result.",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript function body to run in the page MAIN world. Use return to send back a JSON-serializable value."
        }
      },
      required: ["script"],
      additionalProperties: false
    }
  },
  {
    name: "page.extract_readable_text",
    description: "Extract readable text from the last Chrome tab in the Braised tab group.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "page.save_current_page",
    description: "Extract the last Chrome tab in the Braised tab group and save it locally as Markdown.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export async function callTool(
  name: string,
  bridge: ExtensionBridge,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  switch (name) {
    case "braiser.status":
      return {
        mcp: "ok",
        daemonConnected: await bridge.isDaemonConnected(),
        extensionConnected: await bridge.isExtensionConnected()
      };

    case "browser.get_active_tab":
      return bridge.request<ActiveTabInfo>("browser.get_active_tab");

    case "browser.observe":
      return bridge.request<AgentHtmlSnapshot>("browser.observe");

    case "browser.act":
      return bridge.request<BrowserActResult>("browser.act", assertBrowserActInput(args));

    case "debug.inject_js":
      return bridge.request<DebugInjectJsResult>("debug.inject_js", assertDebugInjectJsInput(args));

    case "page.extract_readable_text":
      return extractReadableText(bridge);

    case "page.save_current_page":
      return saveCurrentPage(bridge);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function assertBrowserActInput(args: Record<string, unknown>): BrowserActInput {
  const { snapshotId, elementId, action } = args;

  if (typeof snapshotId !== "string" || typeof elementId !== "string" || typeof action !== "string") {
    throw new Error("browser.act requires string snapshotId, elementId, and action");
  }

  return args as unknown as BrowserActInput;
}

function assertDebugInjectJsInput(args: Record<string, unknown>): DebugInjectJsInput {
  if (typeof args.script !== "string" || !args.script.trim()) {
    throw new Error("debug.inject_js requires a non-empty script string");
  }

  return {
    script: args.script
  };
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
