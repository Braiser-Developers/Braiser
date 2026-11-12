#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { ExtensionBridge } from "./websocket.js";
import { callTool, toolsForMode } from "./tools.js";
import { clientConfig } from "./config.js";
import { clientToken } from "./auth.js";
import { ensureDaemon } from "./lifecycle.js";

const config = clientConfig();
const bridge = new ExtensionBridge(config.url, await clientToken(config), config.requestTimeoutMs);
await ensureDaemon(bridge, config);

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
  return { tools: toolsForMode(config.mode) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await callTool(
    request.params.name,
    bridge,
    request.params.arguments ?? {},
    config.mode
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { bridge.close(); process.exit(0); });
}
server.onclose = () => bridge.close();

const transport = new StdioServerTransport();
await server.connect(transport);
