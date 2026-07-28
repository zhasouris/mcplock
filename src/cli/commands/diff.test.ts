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
  dir = mkdtempSync(join(tmpdir(), "mcplock-diff-"));
  fixture = await McpFixtureServer.start();
});

afterEach(async () => {
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

function io(): CliIo & { stdout: string[] } {
  const stdout: string[] = [];
  return {
    stdout,
    out: (t) => stdout.push(t),
    err: () => undefined,
    env: {},
    cwd: dir,
    clock,
  };
}

const paths = () => [
  "--manifest",
  join(dir, "mcp-tools.yaml"),
  "--lockfile",
  join(dir, "mcp-tools.lock"),
];

async function pin(names: string[]): Promise<void> {
  writeFileSync(
    join(dir, "mcp-tools.yaml"),
    stringifyYaml({
      version: 1,
      sources: [{ name: "src", url: fixture.url }],
      tools: names.map((name) => ({ name, source: "src" })),
    }),
    "utf8",
  );
  fixture.setTools(names.map((name) => ({ name })));
  await run([...paths(), "resolve"], io());
}

async function diff(args: string[] = []): Promise<string[]> {
  const sink = io();
  const code = await run([...paths(), "diff", ...args], sink);
  expect(code).toBe(0);
  return sink.stdout;
}

const S2: FixtureTool = {
  name: "a.tool",
  inputSchema: { type: "object", required: ["x"] },
};

describe("diff", () => {
  it("reports no drift", async () => {
    await pin(["a.tool"]);
    expect(await diff()).toEqual(["No drift."]);
  });

  it("errors (3) when there is no lockfile", async () => {
    writeFileSync(
      join(dir, "mcp-tools.yaml"),
      stringifyYaml({ version: 1, sources: [], tools: [] }),
      "utf8",
    );
    expect(await run([...paths(), "diff"], io())).toBe(3);
  });

  it("shows a structural change (never fails)", async () => {
    await pin(["a.tool"]);
    fixture.setTools([S2]);
    const [line] = await diff();
    expect(line).toMatch(/^~ a\.tool {2}structural {2}sha256:/);
  });

  it("shows missing and undeclared", async () => {
    await pin(["a.tool"]);
    fixture.setTools([{ name: "b.tool" }]);
    const lines = (await diff()).join("\n");
    expect(lines).toContain("- a.tool  missing");
    expect(lines).toContain("+ b.tool  undeclared");
  });

  it("--tool restricts, reporting no change for a clean tool", async () => {
    await pin(["a.tool", "b.tool"]);
    fixture.setTools([S2, { name: "b.tool" }]);
    expect(await diff(["--tool", "b.tool"])).toEqual(["b.tool: no change"]);
  });

  it("--semantic-only hides structural changes", async () => {
    await pin(["a.tool"]);
    fixture.setTools([S2]); // structural only
    expect(await diff(["--semantic-only"])).toEqual(["No drift."]);
  });

  it("--semantic-only shows a reworded description", async () => {
    fixture.setTools([{ name: "a.tool", description: "one" }]);
    await pin(["a.tool"]);
    fixture.setTools([{ name: "a.tool", description: "two" }]);
    const [line] = await diff(["--semantic-only"]);
    expect(line).toMatch(/^~ a\.tool {2}semantic/);
  });
});
