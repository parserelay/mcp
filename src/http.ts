import { type IncomingMessage, createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ParseRelayClient } from "@parserelay/client";
import { createMcpServer } from "./server.js";

/**
 * Streamable-HTTP entry point — for remote/hosted MCP. Stateless: a fresh
 * server + transport per request (no session reuse), so it scales horizontally.
 * Auth per request via `Authorization: Bearer <key>`, falling back to
 * PARSERELAY_API_KEY for single-tenant deployments.
 */
const PORT = Number(process.env.PORT ?? 8080);
const baseUrl = process.env.PARSERELAY_BASE_URL;
const envApiKey = process.env.PARSERELAY_API_KEY;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = createHttpServer(async (req, res) => {
  const path = req.url?.split("?")[0];
  if (req.method !== "POST" || path !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST /mcp only" }));
    return;
  }

  const auth = req.headers.authorization;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const apiKey = bearer ?? envApiKey;
  if (!apiKey) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "missing API key (Authorization: Bearer <key> or PARSERELAY_API_KEY)",
      }),
    );
    return;
  }

  const client = new ParseRelayClient({ apiKey, baseUrl });
  const server = createMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  try {
    const body = await readBody(req);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "bad request" }));
    }
  }
});

httpServer.listen(PORT, () => {
  console.error(`@parserelay/mcp: streamable-HTTP listening on http://localhost:${PORT}/mcp`);
});
