#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ParseRelayClient } from "@parserelay/client";
import { createMcpServer } from "./server.js";

/**
 * stdio entry point — the form MCP clients (Claude Desktop, Cursor) spawn.
 * Config the host with:
 *   command: "npx", args: ["-y", "@parserelay/mcp"],
 *   env: { PARSERELAY_API_KEY: "...", PARSERELAY_BASE_URL?: "..." }
 */
const apiKey = process.env.PARSERELAY_API_KEY;
if (!apiKey) {
  // stderr, not stdout: stdout is the JSON-RPC channel and must stay clean.
  console.error("@parserelay/mcp: PARSERELAY_API_KEY is required");
  process.exit(1);
}

const client = new ParseRelayClient({ apiKey, baseUrl: process.env.PARSERELAY_BASE_URL });
const server = createMcpServer(client);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("@parserelay/mcp: scan tool ready on stdio");
