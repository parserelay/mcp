# @parserelay/mcp

ParseRelay's `scan` operation as an [MCP](https://modelcontextprotocol.io) tool — so any
MCP host (Claude Desktop, Cursor, …) can parse a document into structured, confidence-scored
fields. Same contract as the REST API and the `<DeadSimpleMicroScanner>` component; one tool,
`scan`.

## The `scan` tool

Input mirrors the sync [`ScanRequest`](https://github.com/parserelay/core) — `image` (required), plus
`schema`, `doc_type`, `engine`, `ocr`, `dry_run`, `model`, `model_key`. (`relay` webhooks are
omitted: a tool call is synchronous, so you get the envelope back inline.) The result is the
full [`ScanEnvelope`](https://github.com/parserelay/core) as JSON: `fields`, per-field `confidence`,
`needs_review`, `field_source`, and `meta` (engine, credits, tokens).

Set `dry_run: true` to preview which fields would trigger a paid rescue — and the estimated
credits — without spending anything.

## Run it

### stdio (Claude Desktop, Cursor)

```jsonc
{
  "mcpServers": {
    "parserelay": {
      "command": "npx",
      "args": ["-y", "@parserelay/mcp"],
      "env": {
        "PARSERELAY_API_KEY": "your-key",
        "PARSERELAY_BASE_URL": "https://api.parserelay.app" // optional
      }
    }
  }
}
```

### streamable-HTTP (remote / hosted)

```bash
PARSERELAY_API_KEY=your-key PORT=8080 node node_modules/@parserelay/mcp/dist/http.js
# → POST http://localhost:8080/mcp
```

Stateless: a fresh server per request, so it scales horizontally. Auth per request via
`Authorization: Bearer <key>`, falling back to `PARSERELAY_API_KEY` for single-tenant setups.

## Programmatic

```ts
import { createMcpServer } from "@parserelay/mcp";
import { ParseRelayClient } from "@parserelay/client";

const server = createMcpServer(new ParseRelayClient({ apiKey }));
// then wire your own transport: await server.connect(transport)
```

## Config

| Env var | Required | Default | Notes |
| --- | --- | --- | --- |
| `PARSERELAY_API_KEY` | stdio: yes | — | HTTP can override per request via `Authorization: Bearer`. |
| `PARSERELAY_BASE_URL` | no | `https://api.parserelay.app` | Point at a local worker for testing. |
| `PORT` | no | `8080` | HTTP transport only. |
