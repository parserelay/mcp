import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ParseRelayError } from "@parserelay/client";
import type { ParseRelayClient, ScanRequest } from "@parserelay/client";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server";

/** A ParseRelayClient stub whose `scan` is whatever the test supplies. */
function fakeClient(scan: (req: ScanRequest) => Promise<unknown>): ParseRelayClient {
  return { scan } as unknown as ParseRelayClient;
}

/** Connect an MCP Client to a server over a linked in-memory transport pair. */
async function connect(server: ReturnType<typeof createMcpServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("createMcpServer", () => {
  it("exposes the scan tool with image required", async () => {
    const client = await connect(createMcpServer(fakeClient(async () => ({}))));
    const { tools } = await client.listTools();
    const scan = tools.find((t) => t.name === "scan");
    expect(scan).toBeDefined();
    expect(scan?.inputSchema.required).toContain("image");
  });

  it("forwards the request and returns the envelope as text", async () => {
    const envelope = {
      scan_id: "scn_x",
      status: "ok",
      fields: { merchant: "Acme" },
      meta: { total_credits: 1 },
    };
    let seen: ScanRequest | undefined;
    const client = await connect(
      createMcpServer(
        fakeClient(async (req) => {
          seen = req;
          return envelope;
        }),
      ),
    );

    const res = await client.callTool({
      name: "scan",
      arguments: { image: "data:,", schema: ["merchant"], dry_run: false },
    });

    expect(res.isError).toBeFalsy();
    // undefined keys must not leak into the request the client sends.
    expect(seen).toEqual({ image: "data:,", schema: ["merchant"], dry_run: false });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text).fields.merchant).toBe("Acme");
  });

  it("passes a JSON Schema through intact, keeping extra top-level keywords", async () => {
    let seen: ScanRequest | undefined;
    const client = await connect(
      createMcpServer(
        fakeClient(async (req) => {
          seen = req;
          return { status: "ok" };
        }),
      ),
    );

    const schema = {
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
      additionalProperties: false, // a keyword not in the zod shape — must survive
    };
    const res = await client.callTool({ name: "scan", arguments: { image: "data:,", schema } });

    expect(res.isError).toBeFalsy();
    // .passthrough() must not strip additionalProperties (or $defs/$ref/allOf/…).
    expect(seen?.schema).toEqual(schema);
  });

  it("surfaces a ParseRelayError as an MCP tool error", async () => {
    const client = await connect(
      createMcpServer(
        fakeClient(async () => {
          throw new ParseRelayError("not enough credits", 402, undefined, "insufficient_credits");
        }),
      ),
    );

    const res = await client.callTool({ name: "scan", arguments: { image: "data:," } });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("402");
    expect(content[0].text).toContain("insufficient_credits");
  });

  it("surfaces a generic Error as an MCP tool error with its message", async () => {
    const client = await connect(
      createMcpServer(
        fakeClient(async () => {
          throw new Error("network timeout");
        }),
      ),
    );

    const res = await client.callTool({ name: "scan", arguments: { image: "data:," } });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("network timeout");
  });
});
