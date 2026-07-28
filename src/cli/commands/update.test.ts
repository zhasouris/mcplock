import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import {
  McpFixtureServer,
  type FixtureTool,
} from "../../../test/mcp/fixture-server";
import type { Clock } from "../../core/clock";
import { parseLockfileText } from "../../schema/lockfile";
import { run, type CliIo } from "../run";

const clock: Clock = () => 1_700_000_000_000;

let dir: string;
let fixture: McpFixtureServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcplock-update-"));
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

function lockfileBytes(): string {
  return readFileSync(join(dir, "mcp-tools.lock"), "utf8");
}

function entry(tool: string): unknown {
  return parseLockfileText(lockfileBytes()).tools[tool];
}

async function pin(tools: FixtureTool[]): Promise<void> {
  writeFileSync(
    join(dir, "mcp-tools.yaml"),
    stringifyYaml({
      version: 1,
      sources: [{ name: "src", url: fixture.url }],
      tools: tools.map((t) => ({ name: t.name, source: "src" })),
    }),
    "utf8",
  );
  fixture.setTools(tools);
  await run([...paths(), "resolve"], io());
}

const A1: FixtureTool = { name: "a.tool", inputSchema: { type: "object" } };
const A2: FixtureTool = {
  name: "a.tool",
  inputSchema: { type: "object", required: ["x"] },
};
const B: FixtureTool = { name: "b.tool", inputSchema: { type: "object" } };

describe("update", () => {
  it("re-pins drifted tools and reports the change", async () => {
    await pin([A1]);
    fixture.setTools([A2]);

    const sink = io();
    expect(await run([...paths(), "update"], sink)).toBe(0);
    expect(sink.stdout.join("\n")).toContain("changed\ta.tool");
    // The lockfile now reflects the new schema.
    const a = entry("a.tool") as { schemaHash: string };
    expect(a.schemaHash).toBeDefined();
  });

  it("targeted update leaves other pins byte-identical", async () => {
    await pin([A1, B]);
    const bBefore = entry("b.tool");
    fixture.setTools([A2, B]); // both would resolve; we only update a.tool

    expect(await run([...paths(), "update", "a.tool"], io())).toBe(0);

    // a.tool re-pinned; b.tool untouched (deep-equal proves byte-identical).
    expect(entry("b.tool")).toEqual(bBefore);
  });

  it("--dry-run writes nothing", async () => {
    await pin([A1]);
    fixture.setTools([A2]);
    const before = lockfileBytes();

    const sink = io();
    expect(await run([...paths(), "update", "--dry-run"], sink)).toBe(0);
    expect(sink.stdout.join("\n")).toContain("dry run");
    expect(lockfileBytes()).toBe(before);
  });

  it("reports no changes when nothing drifted", async () => {
    await pin([A1]);
    const sink = io();
    await run([...paths(), "update"], sink);
    expect(sink.stdout.join("\n")).toContain("no changes");
  });

  it("reports an added tool", async () => {
    await pin([A1]);
    // Declare a second tool and re-pin all.
    writeFileSync(
      join(dir, "mcp-tools.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "src", url: fixture.url }],
        tools: [
          { name: "a.tool", source: "src" },
          { name: "b.tool", source: "src" },
        ],
      }),
      "utf8",
    );
    fixture.setTools([A1, B]);

    const sink = io();
    await run([...paths(), "update"], sink);
    expect(sink.stdout.join("\n")).toContain("added\tb.tool");
  });

  it("reports a removed tool", async () => {
    await pin([A1, B]);
    // Drop b.tool from the manifest and re-pin all.
    writeFileSync(
      join(dir, "mcp-tools.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "src", url: fixture.url }],
        tools: [{ name: "a.tool", source: "src" }],
      }),
      "utf8",
    );
    fixture.setTools([A1]);

    const sink = io();
    await run([...paths(), "update"], sink);
    expect(sink.stdout.join("\n")).toContain("removed\tb.tool");
  });

  it("errors (64) on an undeclared tool", async () => {
    await pin([A1]);
    expect(await run([...paths(), "update", "ghost"], io())).toBe(64);
  });
});
