#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { ExtensionBridge } from "./websocket.js";
import { callTool, tools } from "./tools.js";

const bridge = new ExtensionBridge();

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
  const result = await callTool(request.params.name, bridge);

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
