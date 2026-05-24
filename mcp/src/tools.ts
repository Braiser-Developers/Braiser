import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionBridge } from "./websocket.js";
import type {
  ActiveTabInfo,
  AgentHtmlSnapshot,
  BrowserActInput,
  BrowserActResult,
  BrowserCloseTabInput,
  BrowserCreateTabInput,
  BrowserOpenTabInput,
  BrowserSwitchTabInput,
  BrowserTabInfo,
  BrowserTabList,
  CleanPage,
  DebugCdpCommandInput,
  DebugCdpCommandResult,
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
    description: "Get the currently focused tab in the Braised tab group. All observation and action tools target this tab.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "browser.list_tabs",
    description: "List tabs in the Braised tab group and identify the current agent focus tab.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "browser.create_tab",
    description: "Create a new tab in the Braised tab group and make it the agent focus tab.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional URL to open in the new tab. Bare domains are normalized to https://."
        },
        active: {
          type: "boolean",
          description: "Whether to also make Chrome visually activate the tab. Defaults to true."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser.open_tab",
    description: "Open a URL in a Braised tab. Defaults to the current agent focus tab when tabId is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab id from browser.list_tabs or browser.get_active_tab."
        },
        url: {
          type: "string",
          description: "URL to open. Bare domains are normalized to https://."
        },
        active: {
          type: "boolean",
          description: "Whether to also make Chrome visually activate the tab."
        }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "browser.close_tab",
    description: "Close a Braised tab. Defaults to the current agent focus tab when tabId is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab id from browser.list_tabs or browser.get_active_tab."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser.switch_tab",
    description: "Switch the agent focus to a tab in the Braised tab group. Later MCP reads and actions target this tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab id from browser.list_tabs or browser.get_active_tab."
        },
        activate: {
          type: "boolean",
          description: "Whether to also make Chrome visually activate the tab. Defaults to true."
        }
      },
      required: ["tabId"],
      additionalProperties: false
    }
  },
  {
    name: "browser.observe",
    description: "Observe the current agent focus tab in the Braised tab group and return compressed agent-html with data-eid handles for interactive elements.",
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
    description: "For debug purpose only: directly inject JavaScript into the current agent focus Braised page and return a JSON-serializable result.",
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
    name: "debug.cdp_command",
    description: "For debug purpose only: send a Chrome DevTools Protocol command to the current agent focus Braised tab and return a JSON-serializable result.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "CDP method name, such as DOMSnapshot.captureSnapshot."
        },
        params: {
          type: "object",
          description: "Optional CDP command parameters."
        }
      },
      required: ["method"],
      additionalProperties: false
    }
  },
  {
    name: "page.extract_readable_text",
    description: "Extract readable text from the current agent focus tab in the Braised tab group.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "page.save_current_page",
    description: "Extract the current agent focus tab in the Braised tab group and save it locally as Markdown.",
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

    case "browser.list_tabs":
      return bridge.request<BrowserTabList>("browser.list_tabs");

    case "browser.create_tab":
      return bridge.request<BrowserTabInfo>("browser.create_tab", assertBrowserCreateTabInput(args));

    case "browser.open_tab":
      return bridge.request<BrowserTabInfo>("browser.open_tab", assertBrowserOpenTabInput(args));

    case "browser.close_tab":
      return bridge.request<BrowserTabList>("browser.close_tab", assertBrowserCloseTabInput(args));

    case "browser.switch_tab":
      return bridge.request<BrowserTabInfo>("browser.switch_tab", assertBrowserSwitchTabInput(args));

    case "browser.observe":
      return bridge.request<AgentHtmlSnapshot>("browser.observe");

    case "browser.act":
      return bridge.request<BrowserActResult>("browser.act", assertBrowserActInput(args));

    case "debug.inject_js":
      return bridge.request<DebugInjectJsResult>("debug.inject_js", assertDebugInjectJsInput(args));

    case "debug.cdp_command":
      return bridge.request<DebugCdpCommandResult>("debug.cdp_command", assertDebugCdpCommandInput(args));

    case "page.extract_readable_text":
      return extractReadableText(bridge);

    case "page.save_current_page":
      return saveCurrentPage(bridge);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function assertOptionalTabId(tabId: unknown, fieldName = "tabId"): number | undefined {
  if (tabId === undefined) {
    return undefined;
  }
  if (!Number.isInteger(tabId)) {
    throw new Error(`${fieldName} must be an integer when provided`);
  }
  return tabId as number;
}

function assertOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean when provided`);
  }
  return value;
}

function assertBrowserCreateTabInput(args: Record<string, unknown>): BrowserCreateTabInput {
  if (args.url !== undefined && typeof args.url !== "string") {
    throw new Error("browser.create_tab url must be a string when provided");
  }

  return {
    url: args.url as string | undefined,
    active: assertOptionalBoolean(args.active, "active")
  };
}

function assertBrowserOpenTabInput(args: Record<string, unknown>): BrowserOpenTabInput {
  if (typeof args.url !== "string" || !args.url.trim()) {
    throw new Error("browser.open_tab requires a non-empty url string");
  }

  return {
    tabId: assertOptionalTabId(args.tabId),
    url: args.url,
    active: assertOptionalBoolean(args.active, "active")
  };
}

function assertBrowserCloseTabInput(args: Record<string, unknown>): BrowserCloseTabInput {
  return {
    tabId: assertOptionalTabId(args.tabId)
  };
}

function assertBrowserSwitchTabInput(args: Record<string, unknown>): BrowserSwitchTabInput {
  if (!Number.isInteger(args.tabId)) {
    throw new Error("browser.switch_tab requires an integer tabId");
  }

  return {
    tabId: args.tabId as number,
    activate: assertOptionalBoolean(args.activate, "activate")
  };
}

function assertBrowserActInput(args: Record<string, unknown>): BrowserActInput {
  const { snapshotId, elementId, action } = args;

  if (typeof snapshotId !== "string" || typeof elementId !== "string" || typeof action !== "string") {
    throw new Error("browser.act requires string snapshotId, elementId, and action");
  }

  return args as unknown as BrowserActInput;
}

function assertDebugCdpCommandInput(args: Record<string, unknown>): DebugCdpCommandInput {
  if (typeof args.method !== "string" || !args.method.trim()) {
    throw new Error("debug.cdp_command requires a non-empty method string");
  }

  if (
    args.params !== undefined &&
    (!args.params || typeof args.params !== "object" || Array.isArray(args.params))
  ) {
    throw new Error("debug.cdp_command params must be an object when provided");
  }

  return {
    method: args.method,
    params: args.params as Record<string, unknown> | undefined
  };
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
