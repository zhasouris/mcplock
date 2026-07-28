import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  McpFixtureServer,
  type FixtureTool,
} from "../../test/mcp/fixture-server";
import { McpClient, McpError } from "./client";

const TOOL_A: FixtureTool = { name: "a.tool", description: "First." };
const TOOL_B: FixtureTool = { name: "b.tool", title: "Bee" };

let server: McpFixtureServer;

beforeEach(async () => {
  server = await McpFixtureServer.start();
});

afterEach(async () => {
  try {
    await server.close();
  } catch {
    // Some tests close the server themselves.
  }
});

function client(timeoutMs?: number): McpClient {
  return new McpClient({
    url: server.url,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

describe("listTools", () => {
  it("returns mapped tool definitions and the server version", async () => {
    server.setServerVersion("2.1.0");
    server.setTools([
      {
        name: "a.tool",
        title: "A",
        description: "desc",
        inputSchema: { type: "object" },
        outputSchema: { type: "array" },
        annotations: { readOnlyHint: true },
      },
    ]);

    const result = await client().listTools();

    expect(result.serverVersion).toBe("2.1.0");
    expect(result.tools).toEqual([
      {
        name: "a.tool",
        title: "A",
        description: "desc",
        inputSchema: { type: "object" },
        outputSchema: { type: "array" },
        annotations: { readOnlyHint: true },
      },
    ]);
  });

  it("follows pagination cursors", async () => {
    server.setTools([TOOL_A, TOOL_B]);
    server.setPageSize(1);

    const { tools } = await client().listTools();

    expect(tools.map((t) => t.name)).toEqual(["a.tool", "b.tool"]);
  });

  it("reads an SSE (text/event-stream) response", async () => {
    server.setTools([TOOL_A]);
    server.setFaults({ responseMode: "sse" });

    const { tools } = await client().listTools();

    expect(tools.map((t) => t.name)).toEqual(["a.tool"]);
  });
});

describe("failures (all McpError, naming the server)", () => {
  it("times out a slow response", async () => {
    server.setTools([TOOL_A]);
    server.setFaults({ delayMs: 300 });

    await expect(client(40).listTools()).rejects.toThrow(/timed out/);
  });

  it("rejects a malformed response", async () => {
    server.setFaults({ malformed: true });

    await expect(client().listTools()).rejects.toThrow(/malformed/);
  });

  it("rejects a non-2xx status", async () => {
    server.setFaults({ statusOverride: 503 });

    await expect(client().listTools()).rejects.toThrow(/HTTP 503/);
  });

  it("surfaces a JSON-RPC error from tools/list", async () => {
    server.setTools([TOOL_A]);
    server.setFaults({ listError: { code: -32000, message: "boom" } });

    const error = await client()
      .listTools()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).message).toMatch(/boom.*-32000/);
  });

  it("wraps a connection failure", async () => {
    const url = server.url;
    await server.close();

    await expect(
      new McpClient({ url, timeoutMs: 500 }).listTools(),
    ).rejects.toThrow(/failed/);
  });
});
