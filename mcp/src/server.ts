#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { ExtensionBridge } from "./websocket.js";
import { callTool, tools } from "./tools.js";

const bridge = new ExtensionBridge();
await ensureDaemon(bridge);

const server = new Server(
  {
    name: "braiser-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await callTool(
    request.params.name,
    bridge,
    request.params.arguments ?? {}
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
});

process.on("SIGINT", () => {
  bridge.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);

async function ensureDaemon(bridge: ExtensionBridge): Promise<void> {
  if (await bridge.isDaemonConnected()) {
    return;
  }

  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    if (await bridge.isDaemonConnected()) {
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
