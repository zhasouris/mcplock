import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import {
  McpFixtureServer,
  type FixtureTool,
} from "../../../test/mcp/fixture-server";
import type { Clock } from "../../core/clock";
import { run, type CliIo } from "../run";

const clock: Clock = () => 1_700_000_000_000;

let dir: string;
let fixture: McpFixtureServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcplock-verify-"));
  fixture = await McpFixtureServer.start();
});

afterEach(async () => {
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

function io(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    env: {},
    cwd: dir,
    clock,
  };
}

const manifestPath = () => join(dir, "mcp-tools.yaml");
const lockfilePath = () => join(dir, "mcp-tools.lock");
const globals = () => [
  "--manifest",
  manifestPath(),
  "--lockfile",
  lockfilePath(),
];

/** Pin the given live tools, then return a fresh io for the verify call. */
async function pin(tools: FixtureTool[]): Promise<void> {
  writeFileSync(
    manifestPath(),
    stringifyYaml({
      version: 1,
      sources: [{ name: "src", url: fixture.url }],
      tools: [{ name: "a.tool", source: "src" }],
    }),
    "utf8",
  );
  fixture.setTools(tools);
  await run([...globals(), "resolve"], io());
}

const PINNED: FixtureTool = {
  name: "a.tool",
  description: "one",
  inputSchema: { type: "object" },
};

describe("verify exit codes (drift matrix)", () => {
  it("clean → 0", async () => {
    await pin([PINNED]);
    expect(await run([...globals(), "verify"], io())).toBe(0);
  });

  it("structural drift → 1", async () => {
    await pin([PINNED]);
    fixture.setTools([
      {
        name: "a.tool",
        description: "one",
        inputSchema: { type: "object", required: ["x"] },
      },
    ]);
    expect(await run([...globals(), "verify"], io())).toBe(1);
  });

  it("missing tool → 1", async () => {
    await pin([PINNED]);
    fixture.setTools([]);
    expect(await run([...globals(), "verify"], io())).toBe(1);
  });

  it("undeclared tool → 0", async () => {
    await pin([PINNED]);
    fixture.setTools([PINNED, { name: "extra.tool" }]);
    expect(await run([...globals(), "verify"], io())).toBe(0);
  });

  describe("semantic drift", () => {
    async function pinThenReword(): Promise<void> {
      await pin([PINNED]);
      fixture.setTools([
        { name: "a.tool", description: "two", inputSchema: { type: "object" } },
      ]);
    }

    it("warns but exits 0 under --semantic warn", async () => {
      await pinThenReword();
      const sink = io();
      expect(await run([...globals(), "verify"], sink)).toBe(0);
      expect(sink.stderr.join("")).toMatch(/semantic/);
    });

    it("exits 2 under --semantic fail", async () => {
      await pinThenReword();
      expect(
        await run([...globals(), "verify", "--semantic", "fail"], io()),
      ).toBe(2);
    });

    it("exits 0 silently under --semantic ignore", async () => {
      await pinThenReword();
      const sink = io();
      expect(
        await run([...globals(), "verify", "--semantic", "ignore"], sink),
      ).toBe(0);
      expect(sink.stderr.join("")).not.toMatch(/semantic/);
    });
  });

  it("structural beats semantic → 1 even under --semantic fail", async () => {
    await pin([PINNED]);
    fixture.setTools([
      {
        name: "a.tool",
        description: "two",
        inputSchema: { type: "object", required: ["x"] },
      },
    ]);
    expect(
      await run([...globals(), "verify", "--semantic", "fail"], io()),
    ).toBe(1);
  });

  it("unreachable source → 3", async () => {
    await pin([PINNED]);
    await fixture.close();
    expect(await run([...globals(), "verify"], io())).toBe(3);
    fixture = await McpFixtureServer.start(); // afterEach closes this one
  });

  it("no lockfile → 3", async () => {
    writeFileSync(
      manifestPath(),
      stringifyYaml({
        version: 1,
        sources: [{ name: "src", url: fixture.url }],
        tools: [],
      }),
      "utf8",
    );
    expect(await run([...globals(), "verify"], io())).toBe(3);
  });

  it("invalid --semantic → 64", async () => {
    await pin([PINNED]);
    expect(
      await run([...globals(), "verify", "--semantic", "bogus"], io()),
    ).toBe(64);
  });
});
