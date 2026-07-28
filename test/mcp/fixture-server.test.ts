import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpFixtureServer, type FixtureTool } from "./fixture-server";

const TOOL_A: FixtureTool = {
  name: "a.tool",
  description: "First tool.",
  inputSchema: { type: "object", properties: { x: { type: "string" } } },
};
const TOOL_B: FixtureTool = { name: "b.tool", title: "Bee" };

let server: McpFixtureServer;

beforeEach(async () => {
  server = await McpFixtureServer.start({ serverVersion: "1.0.0" });
});

afterEach(async () => {
  await server.close();
});

async function call(
  method: string,
  params?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  });
  return (await res.json()) as Record<string, unknown>;
}

function toolNames(result: Record<string, unknown>): string[] {
  return (result.tools as { name: string }[]).map((t) => t.name);
}

describe("initialize", () => {
  it("reports serverInfo with the configured version", async () => {
    server.setServerVersion("2.3.4");
    const body = await call("initialize");
    const result = body.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: unknown };
    };
    expect(result.serverInfo.version).toBe("2.3.4");
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toBeDefined();
  });
});

describe("tools/list", () => {
  it("advertises the configured tools with a defaulted inputSchema", async () => {
    server.setTools([TOOL_A, TOOL_B]);
    const result = (await call("tools/list")).result as Record<string, unknown>;
    expect(toolNames(result)).toEqual(["a.tool", "b.tool"]);
    const [, b] = result.tools as Record<string, unknown>[];
    expect(b?.inputSchema).toEqual({ type: "object" });
    expect(b?.title).toBe("Bee");
    expect(result.nextCursor).toBeUndefined();
  });

  it("reflects a tool set mutated mid-session", async () => {
    server.setTools([TOOL_A]);
    expect(toolNames((await call("tools/list")).result as never)).toEqual([
      "a.tool",
    ]);

    server.setTools([TOOL_A, TOOL_B]);
    expect(toolNames((await call("tools/list")).result as never)).toEqual([
      "a.tool",
      "b.tool",
    ]);
  });

  it("paginates with a cursor", async () => {
    server.setTools([TOOL_A, TOOL_B]);
    server.setPageSize(1);

    const page1 = (await call("tools/list")).result as Record<string, unknown>;
    expect(toolNames(page1)).toEqual(["a.tool"]);
    expect(page1.nextCursor).toBe("1");

    const page2 = (await call("tools/list", { cursor: page1.nextCursor }))
      .result as Record<string, unknown>;
    expect(toolNames(page2)).toEqual(["b.tool"]);
    expect(page2.nextCursor).toBeUndefined();
  });
});

describe("protocol edges", () => {
  it("returns a JSON-RPC method-not-found for unknown methods", async () => {
    const body = await call("tools/call");
    expect((body.error as { code: number }).code).toBe(-32601);
  });

  it("returns a parse error for malformed JSON", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("accepts the initialized notification with 202", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect(res.status).toBe(202);
  });

  it("rejects non-POST with 405", async () => {
    const res = await fetch(server.url, { method: "GET" });
    expect(res.status).toBe(405);
  });
});
