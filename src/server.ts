import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ParseRelayClient, ParseRelayError, type ScanRequest } from "@parserelay/client";
import { z } from "zod";

/** The `scan` tool's input — a 1:1 mirror of the sync `ScanRequest` fields.
 *  `relay` (async webhooks) is intentionally omitted: an MCP tool call is
 *  synchronous, so the caller wants the envelope back inline. */
const scanInput = {
  image: z
    .string()
    .describe(
      "The document to scan: an https URL or a base64 data URI (data:image/...;base64,...).",
    ),
  // Exactly two valid forms — a field-name array, or a JSON Schema with a `properties`
  // map. Requiring `properties` on the object branch makes a flat {"field":"type"} object
  // fail MCP validation here (it would otherwise be silently ignored server-side).
  schema: z
    .union([
      z
        .array(z.string())
        .describe(
          'Field-list form — names only, e.g. ["merchant","total","date"]. Use for flat fields.',
        ),
      z
        .object({
          type: z.literal("object").optional(),
          properties: z.record(z.string(), z.unknown()),
          required: z.array(z.string()).optional(),
        })
        // Keep other top-level JSON Schema keywords ($defs/$ref/allOf/additionalProperties/…);
        // requiring `properties` still rejects flat {field:type} objects.
        .passthrough()
        .describe(
          'JSON Schema form (for types/constraints/nesting), e.g. {"type":"object","properties":{"total":{"type":"number"}},"required":["total"]}.',
        ),
    ])
    .optional()
    .describe(
      'What to extract, in ONE of two forms: a field-name array, OR a JSON Schema object with a `properties` map. Do NOT pass a flat {"field":"type"} object. Omit for a generic document.',
    ),
  doc_type: z
    .enum(["receipt", "invoice", "id", "business_card", "freeform"])
    .optional()
    .describe("Optional document-type hint."),
  engine: z
    .enum(["auto", "ocr", "ocr+rescue", "ocr+check", "vision"])
    .optional()
    .describe(
      "Extraction mode. Default `auto` (deterministic-first, LLM rescues only flagged fields).",
    ),
  // Mirrors the OcrConfig discriminated union: `text` is required exactly when
  // backend is `passthrough`, and the other backends take no text. Modeling it
  // as a union (not a flat object) makes "passthrough without text" a schema
  // validation error at the MCP layer instead of a server error downstream.
  ocr: z
    .union([
      z.object({
        backend: z
          .enum(["auto", "tesseract", "paddle", "vision"])
          .optional()
          .describe("OCR backend to run. Default `auto`."),
      }),
      z.object({
        backend: z.literal("passthrough"),
        text: z.string().describe("Pre-OCR'd text supplied by the caller; no OCR is run."),
      }),
    ])
    .optional()
    .describe("OCR backend selection. Use backend `passthrough` with `text` to skip OCR."),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "Preview only: returns which fields WOULD trigger a paid rescue + estimated credits, spends nothing.",
    ),
  model: z
    .string()
    .nullable()
    .optional()
    .describe('Pin a specific model, e.g. "claude-haiku-4-5".'),
  model_key: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Bring your own provider key — you're billed plumbing only; the model bill is on your key.",
    ),
};

/** Build an MCP server exposing the single `scan` tool, backed by the given client. */
export function createMcpServer(client: ParseRelayClient): McpServer {
  const server = new McpServer({ name: "parserelay", version: "0.0.1" });

  server.registerTool(
    "scan",
    {
      title: "Scan a document",
      description:
        "Parse a document (receipt, invoice, form, ID) into structured, confidence-scored fields. " +
        "Returns the ParseRelay envelope: `fields`, per-field `confidence`, `needs_review`, `field_source` " +
        "provenance, and `meta` (engine, credits, tokens). Set `dry_run: true` to preview cost without spending.",
      inputSchema: scanInput,
    },
    async (args) => {
      // Drop undefined keys so we send a clean ScanRequest (the contract is presence-sensitive).
      const request = Object.fromEntries(
        Object.entries(args).filter(([, v]) => v !== undefined),
      ) as unknown as ScanRequest;

      try {
        const result = await client.scan(request);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message =
          err instanceof ParseRelayError
            ? `scan failed (${err.status}${err.code ? ` ${err.code}` : ""}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "scan failed";
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}
