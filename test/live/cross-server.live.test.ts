/**
 * Cross-server protocol conformance (NOT the hermetic gate).
 *
 * Validates mcplock against a DIFFERENT real MCP server than the everything
 * server — @modelcontextprotocol/server-memory (knowledge-graph tools) — bridged
 * from stdio to streamable-HTTP via supergateway. Exercises the client's real
 * handshake + transport and pushes a different real schema set through
 * canonical hashing, resolve, and verify.
 *
 * Runs only when MCPLOCK_LIVE=1.
 */
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { systemClock } from "../../src/core/clock";
import { run, type CliIo } from "../../src/cli/run";
import { McpClient } from "../../src/mcp/client";
import { parseLockfileText, type LockedTool } from "../../src/schema/lockfile";
import { bridgeUrl, startBridge, stopServer } from "./server-harness";

const LIVE = process.env.MCPLOCK_LIVE === "1";
const SERVER = "npx -y @modelcontextprotocol/server-memory";
const PORT = 8000;
const URL = bridgeUrl(PORT);

describe.skipIf(!LIVE)("live: cross-server (server-memory via bridge)", () => {
  let dir: string;
  let bridge: ChildProcess;

  function io(): CliIo & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout,
      stderr,
      out: (t) => stdout.push(t),
      err: (t) => stderr.push(t),
      env: process.env,
      cwd: dir,
      clock: systemClock,
    };
  }

  const paths = (): string[] => [
    "--manifest",
    join(dir, "mcp-tools.yaml"),
    "--lockfile",
    join(dir, "mcp-tools.lock"),
  ];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "mcplock-cross-"));
    bridge = await startBridge(SERVER, PORT);
  }, 200_000);

  afterAll(async () => {
    await stopServer(bridge);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists, pins, and verifies real server-memory tools", async () => {
    // Our client against a different real server (via the bridge).
    const tools = (await new McpClient({ url: URL }).listTools()).tools;
    expect(tools.length).toBeGreaterThan(3);
    const names = tools.map((t) => t.name);
    process.stderr.write(
      `[live cross] server-memory tools: ${names.join(", ")}\n`,
    );

    writeFileSync(
      join(dir, "mcp-tools.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "memory", url: URL }],
        tools: names.map((name) => ({ name, source: "memory" })),
      }),
      "utf8",
    );

    // Resolve pins every tool with a real sha256 structural + semantic hash.
    expect(await run([...paths(), "resolve"], io())).toBe(0);
    const locked = parseLockfileText(
      readFileSync(join(dir, "mcp-tools.lock"), "utf8"),
    ).tools;
    expect(Object.keys(locked)).toHaveLength(names.length);
    expect(
      Object.values(locked).every((t: LockedTool) =>
        /^sha256:[0-9a-f]{64}$/.test(t.schemaHash),
      ),
    ).toBe(true);

    // Everything is pinned from the same server -> verify is clean.
    expect(await run([...paths(), "verify"], io())).toBe(0);
  }, 200_000);
});
